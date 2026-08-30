// Per-series archive retrieval for the offline cache (ohif-viewers#129).
//
// The offline cache's original transfer shape is one WADO-RS request per DICOM instance, so a
// 700-slice CT is 700 round trips. This module is the other strategy: ONE server-built `.zip` per
// series, unpacked in the browser, with every instance inside written through the cache's existing
// per-instance write path.
//
// NOT the archive EXPORT queue. `ArchiveDownloadService` streams a server-built zip to the user's
// FILE SYSTEM and shares no state with the offline cache (#52 AR-1, #129 AR-1). The request and
// streaming mechanics here are reproduced from it deliberately -- same URL construction, same
// bearer header, no explicit `redirect` option -- but nothing is called into it and nothing is
// extracted out of it. The two queues stay separate; a shared helper would be the first step back
// to a shared queue.
//
// MEMORY (#129 FR-14, the reason this feature exists): the archive is never buffered whole. The
// response body is read incrementally and fed into fflate's streaming `Unzip`, and the read loop
// awaits two things before pulling the next chunk -- the writes the last chunk's completed members
// produced, and a bound on how many members are still being decoded. Both are needed: an
// asynchronously-inflated member is not in `pending` when `push()` returns, so draining `pending`
// alone would let the network run ahead of decompression while fflate held a copy of everything it
// had been handed. See `awaitDecodeWindow`.
//
// AR-8: fflate's asynchronous decoder (`AsyncUnzipInflate`) manages its own worker for members
// large enough to be worth one; there is no application-owned worker pool here and this feature is
// not the place to introduce one.

import dcmjs from 'dcmjs';
import { Unzip, AsyncUnzipInflate } from 'fflate';

import * as urlUtil from '../../utils/urlUtil';
import { isUsablePart10 } from '../../utils/dicomPart10';
// Imported by path rather than through the `utils` / `api` barrels: those pull in the cornerstone
// and DICOM-loader surface, which a service loaded this early (and a unit test running under node)
// has no business dragging along. `getAuthToken` is `api/sonador`'s one-liner, inlined for the same
// reason -- exactly as ArchiveDownloadService does.
import user from '../../user.js';

import LocalCacheService from './LocalCacheService';

const getAuthToken = () => user && user.getAccessToken && user.getAccessToken();

// Progress throttle, same shape as the export queue's (#52 AR-8): a 600 MB archive read in 64 KB
// chunks would otherwise emit tens of thousands of events. Whichever trips first releases one.
const PROGRESS_INTERVAL_MS = 200;
const PROGRESS_BYTE_STEP = 1024 * 1024;

// How many archive members may be mid-decode before the read loop stops pulling body (see
// `awaitDecodeWindow`). Must be > 1 or the member currently being fed would deadlock waiting for
// input the loop is refusing to read. Exported so the bound itself can be asserted.
export const MAX_OPEN_MEMBERS = 4;

// Read the member's identifying attributes and stop. The dataset is stored in ascending tag order,
// so stopping after InstanceNumber (0020,0013) reads the patient/study/series identifiers,
// Modality and SeriesNumber while never touching PixelData (7FE0,0010) -- the difference between
// parsing a few hundred bytes and parsing the whole image.
const IDENTITY_UNTIL_TAG = '00200013';

// PixelData. Reading "until" this tag yields a complete metadata header without the image bytes --
// what an archive-only instance needs to be describable in the stored study payload.
const PIXEL_DATA_TAG = '7FE00010';

/** Per-series transfer states (#129 FR-6). Deliberately NOT named `JOB_STATES` (the offline-cache
 * study states) or `ARCHIVE_JOB_STATES` (the save-as export states) -- three vocabularies coexist
 * in this codebase and none of them may shadow another (#129 AR-6). */
export const SERIES_TRANSFER_STATES = {
  QUEUED: 'queued',
  DOWNLOADING: 'downloading',
  EXTRACTING: 'extracting',
  COMPLETE: 'complete',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export type SeriesTransferState =
  typeof SERIES_TRANSFER_STATES[keyof typeof SERIES_TRANSFER_STATES];

export interface SeriesArchiveResult {
  /** Instances written to the cache by this transfer (excludes instances already cached). */
  stored: number;
  /** Archive members that could not become cache instances (unusable Part 10, unparseable). */
  failed: number;
  /** Instances found in the archive but absent from the enumerated metadata (#129 FR-5). */
  unmatched: number;
  /** Members skipped as not-an-instance (DICOMDIR, empty, non-DICOM). */
  skipped: number;
  bytesReceived: number;
  totalBytes: number | null;
  /** True when the transfer stopped because the job was cancelled mid-flight. */
  cancelled: boolean;
}

/** A failed archive REQUEST, carrying what the Issues list renders (#129 FR-13). Distinguished
 * from an extraction failure so the run loop can report the URL and status it actually got. */
export class SeriesArchiveRequestError extends Error {
  public details: { url: string; status?: number; body?: string };

  constructor(message: string, details: { url: string; status?: number; body?: string }) {
    super(message);
    this.name = 'SeriesArchiveRequestError';
    this.details = details;
  }
}

interface TransferOptions {
  server: any;
  StudyInstanceUID: string;
  SeriesInstanceUID: string;
  /** Naturalized metadata for the series' enumerated instances, keyed by SOPInstanceUID. The
   * archive carries no metadata of its own, and `putInstance` requires the naturalized dataset --
   * so enumeration still runs in archive mode and only BYTE retrieval is replaced (#129 FR-4). */
  metadataBySOP: Record<string, any>;
  /** SOP instances of this series already in the cache before the transfer started, so a re-queue
   * does not double-count them into the job's completed total. */
  alreadyCached?: Set<string>;
  isCancelled: () => boolean;
  /**
   * Hands the request's `AbortController` to the caller the moment it exists, BEFORE the fetch is
   * issued.
   *
   * Cooperative cancellation alone is not enough: `isCancelled()` can only be polled between
   * awaits, so a cancel that lands while `fetch()` is still waiting for response headers -- or
   * while `reader.read()` is stalled on a server that has stopped sending -- would not interrupt
   * anything until the network eventually gave up. The run loop keeps the controller for the
   * lifetime of the transfer so `cancel()` can abort the live request immediately.
   */
  onRequestStarted?: (controller: AbortController) => void;
  onState?: (state: SeriesTransferState) => void;
  onProgress?: (progress: { bytesReceived: number; totalBytes: number | null }) => void;
  onInstanceStored?: (uids: {
    StudyInstanceUID: string;
    SeriesInstanceUID: string;
    SOPInstanceUID: string;
  }) => void;
  /**
   * An instance found in the archive but absent from the enumerated metadata (#129 FR-5), together
   * with its DICOM+JSON dataset parsed from its own bytes.
   *
   * Caching it is not enough on its own: the study metadata payload that drives a zero-network open
   * is built from the enumeration, so an instance missing from it stays invisible when the study is
   * opened offline. The run loop merges these into that payload before it is stored.
   */
  onUnmatchedInstance?: (instance: {
    SeriesInstanceUID: string;
    SOPInstanceUID: string;
    dataset: Record<string, any>;
  }) => void;
}

/**
 * Fetch one series archive, extract it as it arrives, and write every DICOM instance inside to the
 * local cache.
 *
 * Resolves with a per-series outcome. Throws `SeriesArchiveRequestError` when the request itself
 * fails, and rethrows a quota error from `putInstance` unchanged so the caller can classify it with
 * the existing `_isQuotaError` and terminate the job (#129 FR-12). It owns retrieval, extraction,
 * validation and the cache writes -- NOT job state, retry, or the per-instance fallback, which stay
 * in the run loop so both transfer modes share one lifecycle (#129 §5.4).
 */
export default async function transferSeriesArchive({
  server,
  StudyInstanceUID,
  SeriesInstanceUID,
  metadataBySOP,
  alreadyCached,
  isCancelled,
  onRequestStarted,
  onState,
  onProgress,
  onInstanceStored,
  onUnmatchedInstance,
}: TransferOptions): Promise<SeriesArchiveResult> {
  const result: SeriesArchiveResult = {
    stored: 0,
    failed: 0,
    unmatched: 0,
    skipped: 0,
    bytesReceived: 0,
    totalBytes: null,
    cancelled: false,
  };

  // AR-5: the proven request shape. `urlJoin` + bearer header + an AbortController signal, and NO
  // explicit `redirect` option -- the gateway answers 302 to Orthanc's own archive URL and the
  // browser follows it transparently. `redirect: 'manual'` yields an opaque response whose headers
  // cannot be read, so it is not a safe "improvement" here.
  const url = urlUtil.urlJoin(server?.wadoRoot, 'series', SeriesInstanceUID, 'archive');
  const controller = new AbortController();

  // Report a state only when it actually changes: downloading and extracting alternate many times
  // within one archive, and an event per chunk would be a re-render storm in the dialog.
  let reportedState: SeriesTransferState | null = null;
  const setState = (state: SeriesTransferState) => {
    if (reportedState !== state) {
      reportedState = state;
      onState?.(state);
    }
  };

  // Published BEFORE the fetch, so a cancel that lands while the request is still waiting for
  // response headers aborts it rather than sitting until the network gives up.
  onRequestStarted?.(controller);
  if (isCancelled()) {
    controller.abort();
    result.cancelled = true;
    return result;
  }

  let response: Response;
  try {
    setState(SERIES_TRANSFER_STATES.DOWNLOADING);
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${getAuthToken()}` },
      signal: controller.signal,
    });
  } catch (error: any) {
    // An abort is a cancellation, not a failure: it must not trigger the retry-and-fall-back-to-
    // per-instance path, which would re-fetch everything the user just cancelled.
    if (error?.name === 'AbortError' || controller.signal.aborted || isCancelled()) {
      result.cancelled = true;
      return result;
    }
    throw new SeriesArchiveRequestError(
      `Series archive request failed: ${error?.message || error}`,
      { url }
    );
  }

  if (!response.ok) {
    throw new SeriesArchiveRequestError(
      `Failed to fetch series archive: ${response.status} ${response.statusText}`,
      { url, status: response.status, body: await _readErrorBody(response) }
    );
  }

  result.totalBytes = _parseContentLength(response);

  // -- Extraction bookkeeping ------------------------------------------------------------------
  //
  // `pending` holds members whose bytes are complete but which have not been written yet. The read
  // loop drains it after every chunk.
  const pending: Array<{ name: string; bytes: Uint8Array }> = [];
  // Members that have been opened but not finished. A member decoded by fflate's ASYNCHRONOUS
  // inflater finishes on a worker, so it can still be outstanding long after the chunk that fed it
  // was pushed -- which is exactly why draining `pending` alone is not flow control (see
  // `awaitDecodeWindow`).
  let openMembers = 0;
  let notifyMemberSettled: (() => void) | null = null;
  // Extraction errors are recorded rather than thrown: fflate reports them through a callback, and
  // one bad member must not abandon the rest of the series.
  let loggedExtractionError = false;
  let loggedUnmatched = false;

  const unzipper = new Unzip(file => {
    const collected: Uint8Array[] = [];
    let size = 0;
    let closed = false;

    openMembers += 1;

    const close = () => {
      if (closed) {
        return;
      }
      closed = true;
      openMembers -= 1;
      notifyMemberSettled?.();
    };

    file.ondata = (error, data, final) => {
      if (error) {
        if (!loggedExtractionError) {
          loggedExtractionError = true;
          console.warn(
            `[seriesArchiveTransfer] Failed to extract "${file.name}" from the archive for ` +
            `series ${SeriesInstanceUID}.`,
            error
          );
        }
        result.failed += 1;
        collected.length = 0;
        close();
        return;
      }

      if (data && data.length) {
        collected.push(data);
        size += data.length;
      }

      if (final) {
        if (size) {
          pending.push({ name: file.name, bytes: _concat(collected, size) });
        } else {
          result.skipped += 1;
        }
        collected.length = 0;
        close();
      }
    };

    // Every member must be started even when it will be discarded: an unstarted member's chunks
    // accumulate inside the unzipper for the lifetime of the stream, which is precisely the
    // unbounded buffer FR-14 exists to prevent.
    file.start();
  });
  // Stored members (compression 0) are handled by the built-in pass-through; this registers the
  // DEFLATE decoder for the compressed case (AR-8).
  unzipper.register(AsyncUnzipInflate);

  const storeCompleted = async (): Promise<void> => {
    while (pending.length) {
      const member = pending.shift()!;
      if (isCancelled()) {
        // Drop the rest: the job's cleanup removes whatever this transfer already stored (FR-10).
        pending.length = 0;
        return;
      }
      await _storeMember({
        member,
        StudyInstanceUID,
        SeriesInstanceUID,
        metadataBySOP,
        alreadyCached,
        result,
        onInstanceStored,
        onUnmatchedInstance,
        onUnmatched: () => {
          if (!loggedUnmatched) {
            loggedUnmatched = true;
            console.warn(
              `[seriesArchiveTransfer] Series ${SeriesInstanceUID}: the archive contains ` +
              'instance(s) absent from the enumerated metadata; caching them with metadata parsed ' +
              'from their own bytes.'
            );
          }
        },
      });
    }
  };

  /**
   * Wait until a member settles (or the transfer is cancelled). Resolves immediately if nothing is
   * outstanding.
   */
  const awaitMemberSettled = async (): Promise<void> => {
    if (openMembers === 0 || isCancelled()) {
      return;
    }
    await new Promise<void>(resolve => {
      notifyMemberSettled = resolve;
      // A member that settled between the check above and this assignment would otherwise park
      // here with nothing left to wake it.
      if (openMembers === 0) {
        notifyMemberSettled = null;
        resolve();
      }
    });
    notifyMemberSettled = null;
  };

  /**
   * Bounds how far decompression may run ahead of storage (#129 FR-14). Draining `pending` is not
   * sufficient on its own.
   *
   * `AsyncUnzipInflate` hands a large member to a worker and returns, so `pending` is still empty
   * when `push()` returns and the read loop would happily pull the next chunk — letting the network
   * run arbitrarily far ahead of decompression and storage, with fflate holding a copy of every
   * chunk it has been handed. This awaits until at most `MAX_OPEN_MEMBERS` members are outstanding
   * before more body is read.
   *
   * The bound cannot be 1: a zip is sequential, so exactly one member is receiving input at any
   * moment, and blocking until it finishes would deadlock — it needs the very chunks we are
   * refusing to read. Anything above 1 leaves the input-receiving member free to progress while
   * capping the backlog of members that are merely finishing.
   */
  const awaitDecodeWindow = async (): Promise<void> => {
    while (openMembers > MAX_OPEN_MEMBERS && !isCancelled()) {
      // eslint-disable-next-line no-await-in-loop
      await awaitMemberSettled();
      // eslint-disable-next-line no-await-in-loop
      await storeCompleted();
    }
  };

  // -- Read / extract / store loop -------------------------------------------------------------

  let lastProgressAt = 0;
  let lastProgressBytes = 0;
  const emitProgress = (force = false) => {
    const now = Date.now();
    if (
      !force &&
      now - lastProgressAt < PROGRESS_INTERVAL_MS &&
      result.bytesReceived - lastProgressBytes < PROGRESS_BYTE_STEP
    ) {
      return;
    }
    lastProgressAt = now;
    lastProgressBytes = result.bytesReceived;
    onProgress?.({ bytesReceived: result.bytesReceived, totalBytes: result.totalBytes });
  };

  try {
    if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();

      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (isCancelled()) {
          result.cancelled = true;
          await reader.cancel().catch(() => {});
          break;
        }

        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (!value || !value.length) {
          continue;
        }

        result.bytesReceived += value.byteLength ?? value.length;
        emitProgress();

        unzipper.push(value instanceof Uint8Array ? value : new Uint8Array(value), false);

        // Flow control, in two parts, both awaited before the next body read (FR-14):
        //   1. write out every member this chunk completed;
        //   2. wait if too many members are still being decoded asynchronously -- `pending` being
        //      empty proves nothing while a worker still owns the input it was handed.
        // Downloading and extracting therefore interleave for the whole transfer, and the state
        // reports whichever is happening now (FR-6) rather than pretending they are two phases.
        if (pending.length || openMembers > MAX_OPEN_MEMBERS) {
          setState(SERIES_TRANSFER_STATES.EXTRACTING);
          await storeCompleted();
          await awaitDecodeWindow();
          setState(SERIES_TRANSFER_STATES.DOWNLOADING);
        }
      }
    } else {
      // `response.body` is absent in a few environments (older Safari, some test doubles). The
      // whole archive lands in memory there, which is the bound FR-14 rules out -- so this path is
      // a compatibility fallback, not a supported mode.
      const buffer = await response.arrayBuffer();
      result.bytesReceived = buffer.byteLength;
      unzipper.push(new Uint8Array(buffer), false);
    }

    if (!result.cancelled && isCancelled()) {
      result.cancelled = true;
    }

    if (!result.cancelled) {
      // Closing the stream flushes any trailing member; members still inflating asynchronously
      // settle afterwards.
      unzipper.push(new Uint8Array(0), true);
      setState(SERIES_TRANSFER_STATES.EXTRACTING);

      while (openMembers > 0 && !isCancelled()) {
        // eslint-disable-next-line no-await-in-loop
        await awaitMemberSettled();
        // eslint-disable-next-line no-await-in-loop
        await storeCompleted();
      }

      await storeCompleted();
      result.cancelled = isCancelled();
    }
  } finally {
    notifyMemberSettled = null;
    pending.length = 0;
    if (result.cancelled) {
      controller.abort();
    }
    emitProgress(true);
  }

  return result;
}

// -- Member handling -----------------------------------------------------------------------------

/**
 * One archive member to one cache instance (#129 §5.3).
 *
 * The archive's internal directory layout and member naming are produced by Orthanc core and are
 * not specified in any Sonador repository, so NOTHING here depends on a member's path or filename
 * beyond the DICOMDIR check: instance identity is read from the member's own dataset.
 */
async function _storeMember({
  member,
  StudyInstanceUID,
  SeriesInstanceUID,
  metadataBySOP,
  alreadyCached,
  result,
  onInstanceStored,
  onUnmatchedInstance,
  onUnmatched,
}: {
  member: { name: string; bytes: Uint8Array };
  StudyInstanceUID: string;
  SeriesInstanceUID: string;
  metadataBySOP: Record<string, any>;
  alreadyCached?: Set<string>;
  result: SeriesArchiveResult;
  onInstanceStored?: (uids: any) => void;
  onUnmatchedInstance?: (instance: {
    SeriesInstanceUID: string;
    SOPInstanceUID: string;
    dataset: Record<string, any>;
  }) => void;
  onUnmatched?: () => void;
}): Promise<void> {
  const { name, bytes } = member;

  // DICOMDIR is the archive's own index, not an instance -- the same member the functional tests
  // in sonador-client skip when they validate these archives.
  if (_isDicomDir(name) || !bytes.byteLength) {
    result.skipped += 1;
    return;
  }

  // AR-9: every member passes the same gate a WADO-RS retrieve does, regardless of transport. The
  // archive route takes no transfer-syntax parameter, so there is no normalized-refetch equivalent
  // here; a series whose members are unusable is what the run loop's per-instance fallback (FR-9)
  // exists for.
  if (!isUsablePart10(bytes)) {
    if (_looksLikeDicom(bytes)) {
      result.failed += 1;
    } else {
      // Not a DICOM object at all (a README, a directory entry): skipped, not failed.
      result.skipped += 1;
    }
    return;
  }

  const identity = _identifyInstance(bytes);
  if (!identity?.SOPInstanceUID) {
    result.failed += 1;
    return;
  }

  const enumerated = metadataBySOP[identity.SOPInstanceUID];

  // FR-5: the archive is the server's own view of the series. Discarding an image because a
  // metadata response was stale would produce an offline copy with holes in it.
  //
  // The cheap identifying parse above stops at InstanceNumber, which is enough to know WHAT this
  // instance is but not enough to describe it: a study opened with no network is reconstructed
  // entirely from the stored metadata payload, and a dataset missing Rows/Columns/PhotometricInterpretation
  // cannot become a usable display set. So an unmatched member -- and only an unmatched member --
  // is re-read up to PixelData for a complete header. This is the rare path by definition.
  let unmatchedDataset: Record<string, any> | null = null;
  if (!enumerated) {
    result.unmatched += 1;
    onUnmatched?.();
    unmatchedDataset = _readDatasetForPayload(bytes);
  }

  const metadata = enumerated || _naturalize(unmatchedDataset) || identity.metadata;
  const uids = {
    StudyInstanceUID: metadata.StudyInstanceUID || identity.StudyInstanceUID || StudyInstanceUID,
    SeriesInstanceUID:
      metadata.SeriesInstanceUID || identity.SeriesInstanceUID || SeriesInstanceUID,
    SOPInstanceUID: identity.SOPInstanceUID,
  };

  // AR-4: one instance, one write, blob before index. A quota rejection propagates unchanged so
  // the run loop can stop the job while the index still describes exactly what was stored.
  await LocalCacheService.putInstance({
    ...uids,
    bytes: _toArrayBuffer(bytes),
    metadata,
  });

  if (!alreadyCached || !alreadyCached.has(uids.SOPInstanceUID)) {
    result.stored += 1;
  }
  onInstanceStored?.(uids);

  if (unmatchedDataset) {
    // Reported AFTER the write, so the payload only ever gains instances the cache actually holds.
    onUnmatchedInstance?.({
      SeriesInstanceUID: uids.SeriesInstanceUID,
      SOPInstanceUID: uids.SOPInstanceUID,
      dataset: unmatchedDataset,
    });
  }
}

/** Identify an instance from its own bytes, reading only as far as InstanceNumber. */
function _identifyInstance(bytes: Uint8Array): {
  StudyInstanceUID?: string;
  SeriesInstanceUID?: string;
  SOPInstanceUID?: string;
  metadata: Record<string, any>;
} | null {
  try {
    const dicomData = dcmjs.data.DicomMessage.readFile(_toArrayBuffer(bytes), {
      untilTag: IDENTITY_UNTIL_TAG,
      includeUntilTagValue: true,
      ignoreErrors: true,
    });
    const metadata = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomData.dict) || {};

    return {
      StudyInstanceUID: metadata.StudyInstanceUID,
      SeriesInstanceUID: metadata.SeriesInstanceUID,
      SOPInstanceUID: metadata.SOPInstanceUID,
      metadata,
    };
  } catch (error) {
    return null;
  }
}

/**
 * The full DICOM+JSON dataset for an archive-only instance, read up to but not including PixelData.
 *
 * Returned in RAW `{ tag: { vr, Value } }` form rather than naturalized, because that is the shape
 * the stored study metadata payload holds and the shape `buildStudyFromCachedMetadata` replays.
 */
function _readDatasetForPayload(bytes: Uint8Array): Record<string, any> | null {
  try {
    const dicomData = dcmjs.data.DicomMessage.readFile(_toArrayBuffer(bytes), {
      untilTag: PIXEL_DATA_TAG,
      includeUntilTagValue: false,
      ignoreErrors: true,
    });
    return dicomData?.dict || null;
  } catch (error) {
    return null;
  }
}

function _naturalize(dataset: Record<string, any> | null): Record<string, any> | null {
  if (!dataset) {
    return null;
  }
  try {
    return dcmjs.data.DicomMetaDictionary.naturalizeDataset(dataset) || null;
  } catch (error) {
    return null;
  }
}

function _isDicomDir(name: string): boolean {
  return /(^|\/)dicomdir$/i.test(String(name || '').trim());
}

/** Part 10 magic without the meta-header requirement -- tells "broken DICOM" from "not DICOM". */
function _looksLikeDicom(bytes: Uint8Array): boolean {
  return (
    bytes.length > 132 &&
    bytes[128] === 0x44 &&
    bytes[129] === 0x49 &&
    bytes[130] === 0x43 &&
    bytes[131] === 0x4d
  );
}

function _concat(chunks: Uint8Array[], size: number): Uint8Array {
  if (chunks.length === 1) {
    return chunks[0];
  }
  const out = new Uint8Array(size);
  let offset = 0;
  chunks.forEach(chunk => {
    out.set(chunk, offset);
    offset += chunk.length;
  });
  return out;
}

function _toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer;
  }
  return bytes.slice().buffer as ArrayBuffer;
}

/**
 * `Content-Length` is CORS-safelisted, so it is readable even across origins. Whether Orthanc
 * sends it for an on-demand archive -- rather than answering chunked -- is a live-server question
 * (#129 V-1), so `null` is a normal outcome and selects the count-based aggregate of FR-7.
 */
function _parseContentLength(response: Response): number | null {
  const raw = response.headers?.get?.('Content-Length');
  const parsed = raw === null || raw === undefined ? NaN : parseInt(String(raw), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function _readErrorBody(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    return text ? text.slice(0, 2000) : undefined;
  } catch (error) {
    return undefined;
  }
}

export { transferSeriesArchive };
