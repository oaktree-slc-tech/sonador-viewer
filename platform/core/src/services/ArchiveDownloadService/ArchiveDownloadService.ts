// Archive export queue -- "download this study to my computer as a .zip" (ohif-viewers#52).
//
// NOT the offline cache. `DownloadManagerService` (services/LocalCacheService) pulls a study's
// instances into IndexedDB so the study can be VIEWED without a network; this service streams a
// server-built zip archive to the user's FILE SYSTEM. Two queues, two toolbar controls, two badges,
// no shared state: an archive export never appears in the Offline Storage dialog, and a cache job
// never appears in the Downloads dropdown (#52 AR-1). Every symbol here says "archive" for exactly
// that reason.
//
// Lifecycle: a plain module singleton, deliberately outside the React tree, so navigating between
// Studies / Worklist / Shared -- or unmounting the study list entirely -- does not pause, cancel or
// lose an export (#52 FR-15). Same shape as the sibling service.
//
// NOTHING IS PERSISTED, and that is a deliberate divergence from `DownloadManagerService` (#52
// AR-3). That service persists job rows because its work product -- cached instances -- survives a
// reload. An archive export's work product is a byte stream held in memory; a reload destroys it
// and it cannot be resumed. Persisting rows would only ever restore rows that are already dead, so
// jobs are dropped on reload instead.
//
// The response body is read INCREMENTALLY through `response.body.getReader()` rather than
// `response.blob()` (#52 AR-7). `blob()` buffers the whole archive with no progress information at
// all, which is what made the old helpers indistinguishable from a hang. The read loop is also
// where cancellation becomes possible: an AbortController plus `reader.cancel()` stops the transfer
// and discards every buffered byte without writing a file.
//
// Memory bound, called out rather than silently accepted: the whole archive accumulates in memory
// before the file is written, exactly as the helpers this replaces already did. Streaming straight
// to disk through the File System Access API would lift that bound; it is follow-up work (#52 §8).

import { PubSubService } from '../_shared/pubSubServiceInterface';
import * as urlUtil from '../../utils/urlUtil';
import { describeStudyFilename, describeSeriesFilename } from '../../utils/describeStudy';
// Modules imported by path rather than through the `utils` / `api` barrels: those pull in the
// cornerstone and DICOM-loader surface, which a service loaded this early (and a unit test running
// under node) has no business dragging along. `getAuthToken` is `api/sonador`'s one-liner, inlined
// here for the same reason.
import user from '../../user.js';

const getAuthToken = () => user && user.getAccessToken && user.getAccessToken();

const EVENTS = {
  JOB_QUEUED: 'event::archiveDownloadService:jobQueued',
  JOB_PROGRESS: 'event::archiveDownloadService:jobProgress',
  JOB_STATE_CHANGED: 'event::archiveDownloadService:jobStateChanged',
};

// Exported as ARCHIVE_JOB_STATES, never as the bare `JOB_STATES` -- @ohif/core already exports that
// name for the offline-cache queue and shadowing it would silently mix the two vocabularies
// (#52 AR-4).
const ARCHIVE_JOB_STATES = {
  QUEUED: 'queued',
  PROCESSING: 'processing',
  DOWNLOADING: 'downloading',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  ERROR: 'error',
} as const;

type ArchiveJobState = typeof ARCHIVE_JOB_STATES[keyof typeof ARCHIVE_JOB_STATES];

const TERMINAL_STATES: ArchiveJobState[] = [
  ARCHIVE_JOB_STATES.COMPLETED,
  ARCHIVE_JOB_STATES.CANCELLED,
  ARCHIVE_JOB_STATES.ERROR,
];

const ACTIVE_STATES: ArchiveJobState[] = [
  ARCHIVE_JOB_STATES.QUEUED,
  ARCHIVE_JOB_STATES.PROCESSING,
  ARCHIVE_JOB_STATES.DOWNLOADING,
];

/** Concurrent archive exports. Independent of the offline cache's own limit -- the two queues never
 * contend for each other's slots (#52 AR-10). */
const MAX_CONCURRENT_JOBS = 2;

// Progress throttle (#52 AR-8). A 5 GB archive read in 64 KB chunks would otherwise emit tens of
// thousands of events; whichever of these trips first releases one.
const PROGRESS_INTERVAL_MS = 200;
const PROGRESS_BYTE_STEP = 1024 * 1024;

interface ArchiveJob {
  id: string;
  kind: 'study' | 'series';
  StudyInstanceUID: string;
  SeriesInstanceUID?: string;
  state: ArchiveJobState;
  bytesReceived: number;
  /** From Content-Length. `null` when the header is absent or unreadable -- drives the
   * determinate/indeterminate split in the progress bar (#52 FR-6). */
  totalBytes: number | null;
  filename: string;
  error?: string;
  /** Diagnostics for a failed request, rendered by the Issues list (#52 FR-12). */
  details?: { url: string; status?: number; body?: string };
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  // Descriptor, supplied at enqueue. Everything user-facing about a job is composed from these
  // rather than from the UID (see describeStudy).
  PatientName?: string;
  PatientID?: string;
  StudyDescription?: string;
  StudyDate?: string;
  AccessionNumber?: string;
  ServiceEpisodeID?: string;
  modalities?: string;
  SeriesNumber?: string | number;
  SeriesDescription?: string;
  Modality?: string;
}

class ArchiveDownloadServiceClass extends PubSubService {
  public readonly name = 'archiveDownloadService';

  private _jobs = new Map<string, ArchiveJob>();
  private _servers = new Map<string, any>();
  private _controllers = new Map<string, AbortController>();

  private _runningJobIds = new Set<string>();
  private _pendingQueue: string[] = [];

  // Progress-throttle bookkeeping, per job.
  private _lastProgressAt = new Map<string, number>();
  private _lastProgressBytes = new Map<string, number>();

  constructor() {
    super(EVENTS);
  }

  create() {
    return this;
  }

  get STATES() {
    return ARCHIVE_JOB_STATES;
  }

  // ---- Public queries ------------------------------------------------------------------------

  /** Newest first -- the order the Downloads dropdown lists them in (#52 FR-5). */
  listJobs(): ArchiveJob[] {
    return Array.from(this._jobs.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Queued / processing / downloading. This is what the toolbar badge counts (#52 FR-4). */
  listActiveJobs(): ArchiveJob[] {
    return this.listJobs().filter(job => ACTIVE_STATES.includes(job.state));
  }

  listTerminalJobs(): ArchiveJob[] {
    return this.listJobs().filter(job => TERMINAL_STATES.includes(job.state));
  }

  getJob(jobId: string): ArchiveJob | undefined {
    return this._jobs.get(jobId);
  }

  /**
   * The in-flight job for a resource, if any, keyed by the UID that identifies the export: the
   * Series UID for a series job, the Study UID for a study job. De-duplication (#52 FR-14) rests on
   * this, so re-running a bulk action over a partially-queued selection -- or double-clicking a row
   * action -- is harmless.
   */
  getActiveJobForResource(uid: string): ArchiveJob | undefined {
    return this.listJobs().find(
      job =>
        ACTIVE_STATES.includes(job.state) &&
        (job.kind === 'series' ? job.SeriesInstanceUID : job.StudyInstanceUID) === uid
    );
  }

  isResourceDownloading(uid: string): boolean {
    return !!this.getActiveJobForResource(uid);
  }

  // ---- Enqueue -------------------------------------------------------------------------------

  /**
   * Queue a study archive export. Returns the EXISTING job when one is already in flight for this
   * study rather than starting a second request (#52 FR-14) -- callers can tell the two apart by
   * comparing `job.createdAt`, or simply by whether the returned job is already past QUEUED.
   */
  enqueueStudy({
    server,
    StudyInstanceUID,
    descriptor = {},
  }: {
    server: any;
    StudyInstanceUID: string;
    descriptor?: Record<string, any>;
  }): ArchiveJob {
    const existing = this.getActiveJobForResource(StudyInstanceUID);
    if (existing) {
      return existing;
    }

    const study = { ...descriptor, StudyInstanceUID };

    return this._enqueue({
      server,
      job: {
        kind: 'study',
        StudyInstanceUID,
        // The archive is named for the patient and study rather than the UID, so it is as
        // recognisable in the Downloads folder as it was in the toast that announced it. A
        // Content-Disposition filename is only consulted when the descriptor yields nothing --
        // see _resolveFilename.
        filename: describeStudyFilename(study),
        ..._studyDescriptorFields(descriptor),
      },
    });
  }

  /**
   * Queue a series archive export. De-duplicated on the Series UID, so a study export and a series
   * export of one of its series can run at the same time.
   */
  enqueueSeries({
    server,
    StudyInstanceUID,
    SeriesInstanceUID,
    descriptor = {},
  }: {
    server: any;
    StudyInstanceUID?: string;
    SeriesInstanceUID: string;
    descriptor?: Record<string, any>;
  }): ArchiveJob {
    const existing = this.getActiveJobForResource(SeriesInstanceUID);
    if (existing) {
      return existing;
    }

    const series = { ...descriptor, SeriesInstanceUID };

    return this._enqueue({
      server,
      job: {
        kind: 'series',
        StudyInstanceUID: StudyInstanceUID || descriptor.StudyInstanceUID,
        SeriesInstanceUID,
        filename: describeSeriesFilename(series),
        ..._studyDescriptorFields(descriptor),
        SeriesNumber: descriptor.SeriesNumber,
        SeriesDescription: descriptor.SeriesDescription,
        Modality: descriptor.Modality,
      },
    });
  }

  private _enqueue({ server, job: fields }: { server: any; job: Partial<ArchiveJob> }): ArchiveJob {
    const uid = fields.kind === 'series' ? fields.SeriesInstanceUID : fields.StudyInstanceUID;

    const job: ArchiveJob = {
      id: `archive-${uid}-${Date.now()}`,
      state: ARCHIVE_JOB_STATES.QUEUED,
      bytesReceived: 0,
      totalBytes: null,
      createdAt: Date.now(),
      ...fields,
    } as ArchiveJob;

    this._jobs.set(job.id, job);
    this._servers.set(job.id, server);

    this._broadcastEvent(EVENTS.JOB_QUEUED, { job });
    this._pendingQueue.push(job.id);
    this._pump();

    return job;
  }

  // ---- Cancel / clear ------------------------------------------------------------------------

  /**
   * Abort an active job. A job that never got a concurrency slot is simply dropped out of the
   * pending queue without a request ever being issued; a streaming job is aborted and every
   * buffered byte is discarded, so no file is written (#52 FR-7).
   */
  cancel(jobId: string): void {
    const job = this._jobs.get(jobId);
    if (!job || TERMINAL_STATES.includes(job.state)) {
      return;
    }

    const controller = this._controllers.get(jobId);

    if (job.state === ARCHIVE_JOB_STATES.QUEUED) {
      // Never entered the run loop, so transition it here.
      this._pendingQueue = this._pendingQueue.filter(id => id !== jobId);
      this._setState(job, ARCHIVE_JOB_STATES.CANCELLED);
      return;
    }

    // The run loop sees the AbortError and owns the CANCELLED transition, so the chunk buffer is
    // released on the same path a network failure takes.
    controller?.abort();
  }

  cancelAllActive(): void {
    this.listActiveJobs().forEach(job => this.cancel(job.id));
  }

  /** Drop a terminal row from the list. Never touches an active job or a downloaded file (#52 FR-8). */
  dismiss(jobId: string): void {
    const job = this._jobs.get(jobId);
    if (!job || !TERMINAL_STATES.includes(job.state)) {
      return;
    }
    this._forget(jobId);
    this._broadcastEvent(EVENTS.JOB_STATE_CHANGED, { job });
  }

  /** Remove every terminal row at once ("Clear finished", #52 FR-8). */
  clearTerminal(): void {
    this.listTerminalJobs().forEach(job => {
      this._forget(job.id);
      this._broadcastEvent(EVENTS.JOB_STATE_CHANGED, { job });
    });
  }

  private _forget(jobId: string): void {
    this._jobs.delete(jobId);
    this._servers.delete(jobId);
    this._controllers.delete(jobId);
    this._lastProgressAt.delete(jobId);
    this._lastProgressBytes.delete(jobId);
  }

  // ---- Internals -----------------------------------------------------------------------------

  private _setState(job: ArchiveJob, state: ArchiveJobState, extra?: Partial<ArchiveJob>): void {
    job.state = state;
    if (extra) {
      Object.assign(job, extra);
    }
    if (TERMINAL_STATES.includes(state)) {
      job.completedAt = Date.now();
    }
    this._broadcastEvent(EVENTS.JOB_STATE_CHANGED, { job });
  }

  /**
   * Emit a progress event at most every PROGRESS_INTERVAL_MS or every PROGRESS_BYTE_STEP, whichever
   * comes first (#52 AR-8). `force` releases the final event when the stream ends, so the last
   * partial chunk is never left unreported.
   */
  private _emitProgress(job: ArchiveJob, force = false): void {
    const now = Date.now();
    const lastAt = this._lastProgressAt.get(job.id) || 0;
    const lastBytes = this._lastProgressBytes.get(job.id) || 0;

    if (
      !force &&
      now - lastAt < PROGRESS_INTERVAL_MS &&
      job.bytesReceived - lastBytes < PROGRESS_BYTE_STEP
    ) {
      return;
    }

    this._lastProgressAt.set(job.id, now);
    this._lastProgressBytes.set(job.id, job.bytesReceived);
    this._broadcastEvent(EVENTS.JOB_PROGRESS, { job });
  }

  private _pump(): void {
    while (this._runningJobIds.size < MAX_CONCURRENT_JOBS && this._pendingQueue.length > 0) {
      const jobId = this._pendingQueue.shift()!;
      const job = this._jobs.get(jobId);
      if (!job || job.state !== ARCHIVE_JOB_STATES.QUEUED) {
        continue;
      }
      this._runningJobIds.add(jobId);
      // Fire-and-forget: _runJob owns the job lifecycle and always releases the slot.
      this._runJob(job).finally(() => {
        this._runningJobIds.delete(jobId);
        this._pump();
      });
    }
  }

  /**
   * The download routine (#52 §5.5).
   *
   * The request shape is reproduced EXACTLY from the helpers this replaces: same URL construction,
   * same bearer header, no explicit `redirect` option. The gateway answers 302 to Orthanc's own
   * archive URL and the browser follows it transparently -- that path is proven against the
   * deployed server and streaming is added on top of it, not in place of it.
   */
  private async _runJob(job: ArchiveJob): Promise<void> {
    const server = this._servers.get(job.id);
    const uid = job.kind === 'series' ? job.SeriesInstanceUID : job.StudyInstanceUID;
    const url = urlUtil.urlJoin(
      server?.wadoRoot,
      job.kind === 'series' ? 'series' : 'studies',
      uid,
      'archive'
    );

    const controller = new AbortController();
    this._controllers.set(job.id, controller);

    // PROCESSING covers the gap between the click and the response headers. The server builds the
    // archive on demand, so a large study can sit here for a long time with no bytes to show for
    // it -- that is precisely the state the old implementation could not express (#52 FR-6).
    this._setState(job, ARCHIVE_JOB_STATES.PROCESSING, { startedAt: Date.now() });

    let chunks: Uint8Array[] | null = null;

    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await _readErrorBody(response);
        this._setState(job, ARCHIVE_JOB_STATES.ERROR, {
          error: `Failed to fetch archive: ${response.status} ${response.statusText}`,
          details: { url, status: response.status, body },
        });
        return;
      }

      job.totalBytes = _parseContentLength(response);
      job.filename = this._resolveFilename(job, response);
      this._setState(job, ARCHIVE_JOB_STATES.DOWNLOADING);

      chunks = [];

      // `response.body` is absent in a few environments (older Safari, some test doubles). Fall
      // back to arrayBuffer() there: no incremental progress, but the export still completes.
      if (response.body && typeof response.body.getReader === 'function') {
        const reader = response.body.getReader();

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          if (value) {
            chunks.push(value);
            job.bytesReceived += value.byteLength ?? value.length ?? 0;
            this._emitProgress(job);
          }
        }
      } else {
        const buffer = await response.arrayBuffer();
        chunks.push(new Uint8Array(buffer));
        job.bytesReceived = buffer.byteLength;
      }

      this._emitProgress(job, true);

      _saveChunksAs(chunks, job.filename);

      // The byte count read off the wire is authoritative: Content-Length may have been absent, or
      // may have described the pre-redirect response.
      this._setState(job, ARCHIVE_JOB_STATES.COMPLETED, { totalBytes: job.bytesReceived });
    } catch (error: any) {
      if (error?.name === 'AbortError' || controller.signal.aborted) {
        // Cancelled: the buffered bytes are dropped below and no file is written (#52 FR-7).
        this._setState(job, ARCHIVE_JOB_STATES.CANCELLED);
      } else {
        this._setState(job, ARCHIVE_JOB_STATES.ERROR, {
          error: error?.message || String(error),
          details: { url },
        });
      }
    } finally {
      // Release the buffer promptly -- an archive can be gigabytes, and a cancelled or failed job
      // has no reason to keep holding it until the row is cleared.
      chunks = null;
      this._controllers.delete(job.id);
    }
  }

  /**
   * Filename resolution (#52 FR-16, with a deliberate reordering).
   *
   * The descriptor-derived name wins when the caller supplied patient/study attributes, because it
   * is the one a reader recognises in their Downloads folder ("Doe-Jane_CT-CHEST_20260314.zip");
   * that treatment came in with the notification work (#84) and is not given up here. The server's
   * Content-Disposition name is the fallback for a caller with no descriptor, and the bare UID the
   * fallback for that -- which is where the old helpers always landed.
   */
  private _resolveFilename(job: ArchiveJob, response: Response): string {
    if (job.filename && !_isBareUidFilename(job)) {
      return job.filename;
    }

    return _contentDispositionFilename(response) || job.filename;
  }
}

// -- Helpers -------------------------------------------------------------------------------------

/** Descriptor fields shared by both job kinds. PN values may arrive naturalized (array or
 * `{ Alphabetic }`) -- normalised to a string here so job rows render safely (#52 §5.1). */
function _studyDescriptorFields(descriptor: Record<string, any>) {
  return {
    PatientName: _pn(descriptor.PatientName),
    PatientID: descriptor.PatientID,
    StudyDescription: descriptor.StudyDescription,
    StudyDate: descriptor.StudyDate,
    AccessionNumber: descriptor.AccessionNumber,
    ServiceEpisodeID: descriptor.ServiceEpisodeID,
    modalities: descriptor.modalities || descriptor.ModalitiesInStudy,
  };
}

function _pn(pn: any): string | undefined {
  if (!pn) {
    return undefined;
  }
  if (Array.isArray(pn)) {
    return _pn(pn[0]);
  }
  if (typeof pn === 'string') {
    return pn;
  }
  return pn.Alphabetic || pn.alphabetic || undefined;
}

/** True when describeStudyFilename/describeSeriesFilename fell all the way through to the UID,
 * i.e. the caller passed no usable descriptor and the server's name is worth preferring. */
function _isBareUidFilename(job: ArchiveJob): boolean {
  const uid = job.kind === 'series' ? job.SeriesInstanceUID : job.StudyInstanceUID;
  return !uid || job.filename === `${uid}.zip` || job.filename === 'study.zip' || job.filename === 'series.zip';
}

/**
 * `Content-Length` is CORS-safelisted, so it is readable even when the archive comes from a
 * different origin than the gateway. Whether Orthanc sends it for an archive response -- rather
 * than answering chunked -- is NOT confirmed against a live server, so `null` here is a normal
 * outcome, not an error: the progress bar simply runs indeterminate (#52 FR-6, §2.2).
 */
function _parseContentLength(response: Response): number | null {
  const raw = response.headers?.get?.('Content-Length');
  const parsed = raw === null || raw === undefined ? NaN : parseInt(String(raw), 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** RFC 5987 `filename*` first, then the plain `filename`. Absent on a cross-origin response unless
 * the server exposes the header, which is why it is a fallback rather than the primary. */
function _contentDispositionFilename(response: Response): string | undefined {
  const header = response.headers?.get?.('Content-Disposition');
  if (!header) {
    return undefined;
  }

  const extended = /filename\*\s*=\s*[^']*'[^']*'([^;]+)/i.exec(header);
  if (extended) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch (error) {
      // Malformed percent-encoding: fall through to the plain form.
    }
  }

  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : undefined;
}

/** Best-effort body capture for a failed request, for the Issues list Details drawer (#52 FR-12). */
async function _readErrorBody(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    return text ? text.slice(0, 2000) : undefined;
  } catch (error) {
    return undefined;
  }
}

/** Assemble the accumulated chunks and hand them to the browser's download machinery through a
 * throwaway anchor -- the same mechanism the helpers this replaces used. */
function _saveChunksAs(chunks: Uint8Array[], filename: string): void {
  const blob = new Blob(chunks as BlobPart[], { type: 'application/zip' });
  const downloadUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = downloadUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  window.URL.revokeObjectURL(downloadUrl);
}

const ArchiveDownloadService = new ArchiveDownloadServiceClass();

export {
  ArchiveDownloadService,
  EVENTS as ArchiveDownloadServiceEvents,
  ARCHIVE_JOB_STATES,
};
export default ArchiveDownloadService;
