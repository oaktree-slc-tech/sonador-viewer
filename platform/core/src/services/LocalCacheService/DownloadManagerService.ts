// Background download queue for the local/offline DICOM study cache (ohif-viewers#125, FR-4).
//
// This is a plain module singleton with its own lifecycle, deliberately independent of any React
// tree: navigating away from the study list or viewer unmounts components but does NOT stop or lose
// an in-progress download (AC-7). It coordinates with LocalCacheService (the persistence layer) and
// enumerates a study's instances through the existing WADO retrieve pipeline.
//
// Concurrency model: multiple study jobs may run at once (FR-4), each fetching its own instances
// with a bounded per-job pool. Cancellation is cooperative (a per-job flag + AbortController) and
// leaves already-cached instances independently usable (AC-3).

import { get, set, createStore } from 'idb-keyval';

import dcmjs from 'dcmjs';

import DICOMWeb from '../../DICOMWeb';
import errorHandler from '../../errorHandler';
import getSeriesInfo from '../../studies/getSeriesInfo';
import { sortStudySeries, sortingCriteria } from '../../studies/sortStudy';
import StaticWadoClient from '../../studies/services/qido/StaticWadoClient';
import { isUsablePart10 } from '../../utils/dicomPart10';
import { PubSubService } from '../_shared/pubSubServiceInterface';

import LocalCacheService from './LocalCacheService';

const EVENTS = {
  JOB_QUEUED: 'event::downloadManagerService:jobQueued',
  JOB_PROGRESS: 'event::downloadManagerService:jobProgress',
  JOB_STATE_CHANGED: 'event::downloadManagerService:jobStateChanged',
};

const JOB_STATES = {
  QUEUED: 'queued',
  DOWNLOADING: 'downloading',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
  ERROR: 'error',
} as const;

type JobState = typeof JOB_STATES[keyof typeof JOB_STATES];

const TERMINAL_STATES: JobState[] = [JOB_STATES.CANCELLED, JOB_STATES.COMPLETED, JOB_STATES.ERROR];

// How many study jobs run concurrently, and how many instance fetches per job.
const MAX_CONCURRENT_JOBS = 2;
const PER_JOB_FETCH_CONCURRENCY = 5;

const JOBS_KEY = 'jobs';

interface InstanceUIDsForCleanup {
  StudyInstanceUID: string;
  SeriesInstanceUID: string;
  SOPInstanceUID: string;
}

interface DownloadJob {
  id: string;
  StudyInstanceUID: string;
  state: JobState;
  progress: { total: number; completed: number; failed: number };
  error?: string;
  createdAt: number;
  // Search fields for the Download Manager "Active Transfers" tab (AC-9).
  PatientName?: string;
  PatientID?: string;
  StudyDescription?: string;
  AccessionNumber?: string;
  ServiceEpisodeID?: string;
}

class DownloadManagerServiceClass extends PubSubService {
  public readonly name = 'downloadManagerService';

  private _jobs = new Map<string, DownloadJob>();
  private _servers = new Map<string, any>(); // jobId -> server config (not persisted / serialisable)
  private _cancelFlags = new Map<string, boolean>();

  private _runningJobIds = new Set<string>();
  private _pendingQueue: string[] = [];

  // Created lazily only when IndexedDB is available (createStore opens the DB eagerly).
  private _jobStore: ReturnType<typeof createStore> | null = null;
  private _ready: Promise<void>;

  constructor() {
    super(EVENTS);
    if (typeof indexedDB !== 'undefined') {
      this._jobStore = createStore('sonador-local-cache-jobs', 'jobs');
    }
    this._ready = this._hydrate();
  }

  create() {
    return this;
  }

  ready(): Promise<void> {
    return this._ready;
  }

  get STATES() {
    return JOB_STATES;
  }

  private async _hydrate(): Promise<void> {
    if (!this._jobStore) {
      return;
    }
    try {
      const persisted = (await get<DownloadJob[]>(JOBS_KEY, this._jobStore)) || [];
      persisted.forEach(job => {
        // A job left mid-flight at page reload cannot be resumed byte-for-byte (§5.1 / Out of scope):
        // surface it as an error rather than pretending it is still progressing. Its already-cached
        // instances remain usable through LocalCacheService + the per-instance remote fallback.
        if (!TERMINAL_STATES.includes(job.state)) {
          job.state = JOB_STATES.ERROR;
          job.error = 'Interrupted by page reload';
        }
        this._jobs.set(job.id, job);
      });
    } catch (error) {
      console.warn('[DownloadManagerService] Failed to hydrate persisted jobs.', error);
    }
  }

  private async _persistJobs(): Promise<void> {
    if (!this._jobStore) {
      return;
    }
    // Persist only serialisable job metadata (no servers/AbortControllers/bytes).
    try {
      await set(JOBS_KEY, Array.from(this._jobs.values()), this._jobStore);
    } catch (error) {
      console.warn('[DownloadManagerService] Failed to persist jobs.', error);
    }
  }

  // ---- Public queries ------------------------------------------------------------------------

  listJobs(): DownloadJob[] {
    return Array.from(this._jobs.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Jobs shown in the "Active Transfers" tab: everything not completed. */
  listActiveJobs(): DownloadJob[] {
    return this.listJobs().filter(job => job.state !== JOB_STATES.COMPLETED);
  }

  getJob(jobId: string): DownloadJob | undefined {
    return this._jobs.get(jobId);
  }

  /** The in-flight (queued/downloading) job for a study, if any. Used for de-duplication (AC-4). */
  getActiveJobForStudy(StudyInstanceUID: string): DownloadJob | undefined {
    return this.listJobs().find(
      job =>
        job.StudyInstanceUID === StudyInstanceUID &&
        (job.state === JOB_STATES.QUEUED || job.state === JOB_STATES.DOWNLOADING)
    );
  }

  isStudyDownloading(StudyInstanceUID: string): boolean {
    return !!this.getActiveJobForStudy(StudyInstanceUID);
  }

  // ---- Enqueue / cancel ----------------------------------------------------------------------

  /**
   * Queue a full-study download. If a job for this study is already queued/downloading the existing
   * job is returned instead of spawning a duplicate (AC-4). `descriptor` carries optional display
   * fields (patient name, etc.) for the Active Transfers list before instance metadata arrives.
   */
  enqueueStudy({
    server,
    StudyInstanceUID,
    descriptor = {},
  }: {
    server: any;
    StudyInstanceUID: string;
    descriptor?: Partial<DownloadJob>;
  }): DownloadJob {
    const existing = this.getActiveJobForStudy(StudyInstanceUID);
    if (existing) {
      return existing;
    }

    const job: DownloadJob = {
      id: `dl-${StudyInstanceUID}-${Date.now()}`,
      StudyInstanceUID,
      state: JOB_STATES.QUEUED,
      progress: { total: 0, completed: 0, failed: 0 },
      createdAt: Date.now(),
      // Descriptor PN values may arrive in naturalized form (array/object) — normalise to a string
      // so job rows render safely.
      PatientName: _pn(descriptor.PatientName),
      PatientID: descriptor.PatientID,
      StudyDescription: descriptor.StudyDescription,
      AccessionNumber: descriptor.AccessionNumber,
      ServiceEpisodeID: descriptor.ServiceEpisodeID,
    };

    this._jobs.set(job.id, job);
    this._servers.set(job.id, server);
    this._cancelFlags.set(job.id, false);
    this._persistJobs();

    this._broadcastEvent(EVENTS.JOB_QUEUED, { job });
    this._pendingQueue.push(job.id);
    this._pump();

    return job;
  }

  /**
   * Cancel an in-flight or queued job. Cooperative: the per-instance worker checks the flag before
   * each retrieve, so no further instances are fetched. A cancelled job CLEANS UP AFTER ITSELF —
   * every instance THIS job stored is removed from the local cache when it winds down (an
   * in-flight retrieve is allowed to land first, then removed with the rest). Instances cached by
   * earlier, completed downloads of the same study are untouched.
   */
  cancel(jobId: string): void {
    const job = this._jobs.get(jobId);
    if (!job || TERMINAL_STATES.includes(job.state)) {
      return;
    }
    this._cancelFlags.set(jobId, true);

    // A still-queued job never entered the run loop, so transition it here.
    if (job.state === JOB_STATES.QUEUED) {
      this._pendingQueue = this._pendingQueue.filter(id => id !== jobId);
      this._setState(job, JOB_STATES.CANCELLED);
    }
  }

  /** Cancel by study UID (convenience for the toolbar/study-list "Remove offline"-while-downloading). */
  cancelStudy(StudyInstanceUID: string): void {
    const job = this.getActiveJobForStudy(StudyInstanceUID);
    if (job) {
      this.cancel(job.id);
    }
  }

  /** Cancel every queued/downloading job (used before clearing all local storage). */
  cancelAllActive(): void {
    this.listJobs().forEach(job => {
      if (job.state === JOB_STATES.QUEUED || job.state === JOB_STATES.DOWNLOADING) {
        this.cancel(job.id);
      }
    });
  }

  /** Drop a terminal job from the list (does not touch cached data). */
  dismiss(jobId: string): void {
    const job = this._jobs.get(jobId);
    if (!job || !TERMINAL_STATES.includes(job.state)) {
      return;
    }
    this._jobs.delete(jobId);
    this._servers.delete(jobId);
    this._cancelFlags.delete(jobId);
    this._persistJobs();
    this._broadcastEvent(EVENTS.JOB_STATE_CHANGED, { job });
  }

  // ---- Internals -----------------------------------------------------------------------------

  private _setState(job: DownloadJob, state: JobState, error?: string): void {
    job.state = state;
    if (error !== undefined) {
      job.error = error;
    }
    this._persistJobs();
    this._broadcastEvent(EVENTS.JOB_STATE_CHANGED, { job });
  }

  private _emitProgress(job: DownloadJob): void {
    this._broadcastEvent(EVENTS.JOB_PROGRESS, { job });
  }

  private _pump(): void {
    while (this._runningJobIds.size < MAX_CONCURRENT_JOBS && this._pendingQueue.length > 0) {
      const jobId = this._pendingQueue.shift()!;
      const job = this._jobs.get(jobId);
      if (!job || job.state !== JOB_STATES.QUEUED) {
        continue;
      }
      this._runningJobIds.add(jobId);
      // Fire-and-forget: the run loop owns the job lifecycle and always releases the slot.
      this._runJob(job).finally(() => {
        this._runningJobIds.delete(jobId);
        this._pump();
      });
    }
  }

  private _isCancelled(jobId: string): boolean {
    return this._cancelFlags.get(jobId) === true;
  }

  private async _runJob(job: DownloadJob): Promise<void> {
    const jobId = job.id;
    const server = this._servers.get(jobId);
    this._setState(job, JOB_STATES.DOWNLOADING);

    let instances: any[];
    let metadataPayload: Record<string, unknown> | null = null;
    try {
      ({ instances, metadataPayload } = await this._enumerateInstances(server, job.StudyInstanceUID, jobId));
    } catch (error: any) {
      if (this._isCancelled(jobId)) {
        this._setState(job, JOB_STATES.CANCELLED);
      } else {
        this._setState(job, JOB_STATES.ERROR, `Failed to load study metadata: ${error?.message || error}`);
      }
      return;
    }

    if (this._isCancelled(jobId)) {
      this._setState(job, JOB_STATES.CANCELLED);
      return;
    }

    // Enrich display fields from the first instance if the enqueue descriptor was sparse.
    const firstMeta = instances[0]?.metadata;
    if (firstMeta) {
      job.PatientName = job.PatientName || _pn(firstMeta.PatientName);
      job.PatientID = job.PatientID || firstMeta.PatientID;
      job.StudyDescription = job.StudyDescription || firstMeta.StudyDescription;
      job.AccessionNumber = job.AccessionNumber || firstMeta.AccessionNumber;
      job.ServiceEpisodeID = job.ServiceEpisodeID || firstMeta.ServiceEpisodeID;
    }

    job.progress = { total: instances.length, completed: 0, failed: 0 };
    this._emitProgress(job);

    // Skip instances already cached (idempotent re-queue / partial resume) so completed counts
    // reflect real work and we never double-store (AC-4).
    const pending = instances.filter(
      inst => !LocalCacheService.isInstanceCachedSync(_sop(inst))
    );
    job.progress.completed = instances.length - pending.length;
    this._emitProgress(job);

    // Reuse the app's DICOMweb client (same auth/CORS path as metadata retrieval) to pull each
    // instance's Part10 bytes via WADO-RS, rather than a raw fetch of the WADO-URI (which the
    // server may not serve or CORS-allow when configured for WADO-RS rendering).
    const client = this._makeWadoClient(server);

    let quotaHit = false;

    // Instances stored by THIS job — the cleanup set if the job is cancelled. Instances that were
    // already cached before the job started (filtered into `pending` above) are never in here, so
    // cancelling a top-up download can't evict a previously completed one.
    const downloadedByThisJob: InstanceUIDsForCleanup[] = [];

    const worker = async (inst: any): Promise<void> => {
      if (this._isCancelled(jobId) || quotaHit) {
        return;
      }
      try {
        await this._downloadInstance(client, inst);
        const m = inst.metadata || inst;
        downloadedByThisJob.push({
          StudyInstanceUID: m.StudyInstanceUID,
          SeriesInstanceUID: m.SeriesInstanceUID,
          SOPInstanceUID: m.SOPInstanceUID,
        });
        job.progress.completed += 1;
      } catch (error: any) {
        if (this._isCancelled(jobId)) {
          return;
        }
        if (_isQuotaError(error)) {
          // Stop the whole job on quota exhaustion and surface a visible error (AC-10).
          quotaHit = true;
          return;
        }
        // Log the first failure of a job so the underlying cause (HTTP status, CORS, empty body)
        // is diagnosable without every one of N instances spamming the console.
        if (job.progress.failed === 0) {
          console.error(
            `[DownloadManagerService] Instance download failed for job ${job.id}:`,
            error?.status ? `HTTP ${error.status}` : '',
            error
          );
        }
        job.progress.failed += 1;
      } finally {
        this._emitProgress(job);
      }
    };

    await this._runPool(pending, worker, PER_JOB_FETCH_CONCURRENCY);

    if (this._isCancelled(jobId)) {
      // Clean up after ourselves: remove everything this job stored (including a retrieve that was
      // mid-flight when the cancel landed and completed afterwards).
      await this._cleanupCancelledDownloads(downloadedByThisJob);
      this._setState(job, JOB_STATES.CANCELLED);
      return;
    }

    // Persist the raw study metadata payload so a cached study can be opened with ZERO network
    // requests (the study-open path replays it through the normal retrieve pipeline). Stored even
    // on partial success — missing instances fall back to network per-instance.
    if (metadataPayload && LocalCacheService.isStudyCachedSync(job.StudyInstanceUID)) {
      try {
        await LocalCacheService.putStudyMetadataPayload(job.StudyInstanceUID, metadataPayload);
      } catch (error) {
        console.warn('[DownloadManagerService] Failed to store study metadata payload.', error);
      }
    }

    if (quotaHit) {
      this._setState(
        job,
        JOB_STATES.ERROR,
        'Browser storage quota exceeded — cached what fit before running out of space.'
      );
    } else if (job.progress.failed > 0) {
      this._setState(
        job,
        JOB_STATES.ERROR,
        `${job.progress.failed} of ${job.progress.total} instance(s) failed to download.`
      );
    } else {
      this._setState(job, JOB_STATES.COMPLETED);
    }
  }

  /**
   * Enumerate every instance of a study with the app's DICOMweb client (QIDO series search +
   * per-series WADO-RS metadata — the same requests the online retrieve pipeline makes), keeping
   * the RAW DICOM+JSON payloads so they can be stored for network-free study opens.
   */
  private async _enumerateInstances(
    server: any,
    StudyInstanceUID: string,
    jobId: string
  ): Promise<{ instances: any[]; metadataPayload: Record<string, unknown> | null }> {
    const client = new StaticWadoClient({
      ...server,
      url: server.qidoRoot || server.wadoRoot,
      headers: DICOMWeb.getAuthorizationHeader(server),
      errorInterceptor: errorHandler.getHTTPErrorHandler?.(),
    });

    const seriesJson = (await client.searchForSeries({ studyInstanceUID: StudyInstanceUID })) || [];
    // Same ordering the online pipeline applies, so the cached open renders series identically.
    const seriesSorted = sortStudySeries(
      seriesJson,
      sortingCriteria.seriesSortCriteria.seriesInfoSortingCriteria
    );

    const { naturalizeDataset } = dcmjs.data.DicomMetaDictionary;
    const instances: any[] = [];
    const instancesBySeries: Record<string, any[]> = {};

    for (const series of seriesSorted) {
      if (this._isCancelled(jobId)) {
        break;
      }
      const seriesInstanceUID = getSeriesInfo(series).SeriesInstanceUID;
      if (!seriesInstanceUID) {
        continue;
      }

      const sopInstances =
        (await client.retrieveSeriesMetadata({
          studyInstanceUID: StudyInstanceUID,
          seriesInstanceUID,
        })) || [];
      instancesBySeries[seriesInstanceUID] = sopInstances;

      sopInstances.forEach((instJson: any) => {
        let metadata: Record<string, any>;
        try {
          metadata = naturalizeDataset(instJson);
        } catch (error) {
          metadata = {};
        }
        metadata.StudyInstanceUID = metadata.StudyInstanceUID || StudyInstanceUID;
        metadata.SeriesInstanceUID = metadata.SeriesInstanceUID || seriesInstanceUID;
        instances.push({ metadata });
      });
    }

    return {
      instances,
      metadataPayload: { series: seriesSorted, instancesBySeries },
    };
  }

  /** Remove the instances a cancelled job stored, so a cancelled transfer leaves no partial data. */
  private async _cleanupCancelledDownloads(items: InstanceUIDsForCleanup[]): Promise<void> {
    for (const item of items) {
      try {
        await LocalCacheService.removeInstance(
          item.StudyInstanceUID,
          item.SeriesInstanceUID,
          item.SOPInstanceUID
        );
      } catch (error) {
        console.warn('[DownloadManagerService] Failed to clean up cancelled download.', item, error);
      }
    }
  }

  /** A DICOMweb client bound to the server's WADO-RS root, carrying the app's auth headers. */
  private _makeWadoClient(server: any): any {
    return new StaticWadoClient({
      ...server,
      url: server.wadoRoot || server.wadoUriRoot || server.qidoRoot,
      headers: DICOMWeb.getAuthorizationHeader(server),
      errorInterceptor: errorHandler.getHTTPErrorHandler?.(),
    });
  }

  /** Fetch one instance's Part10 bytes via WADO-RS RetrieveInstance and cache it. */
  private async _downloadInstance(client: any, inst: any): Promise<void> {
    const metadata = inst.metadata || inst;
    const StudyInstanceUID = metadata.StudyInstanceUID;
    const SeriesInstanceUID = metadata.SeriesInstanceUID;
    const SOPInstanceUID = metadata.SOPInstanceUID;

    // Retrieve the instance's Part10 bytes via WADO-RS RetrieveInstance, requesting
    // `transfer-syntax=*`. That media type is REQUIRED: without it the Accept header implies the
    // default (Explicit VR Little Endian) transfer syntax, and servers that won't transcode (e.g.
    // Orthanc behind the Sonador gateway) answer 204 No Content -> undefined bytes.
    //
    // We can't use client.retrieveInstance({ mediaTypes }) because this pinned dicomweb-client
    // version's retrieveInstance is broken for explicit media types: _getCommonMediaType returns
    // just "application/" and fails its own `=== "application/dicom"` guard ("Media type application/
    // is not supported"). So we call the underlying multipart GET directly, which builds the correct
    // `multipart/related; type="application/dicom"; transfer-syntax=*` Accept header.
    // Private API — assert it survives dependency bumps so a future dicomweb-client upgrade fails
    // loudly with the workaround context instead of silently breaking every download job.
    if (typeof client._httpGetMultipartApplicationDicom !== 'function') {
      throw new Error(
        '[DownloadManagerService] dicomweb-client no longer exposes _httpGetMultipartApplicationDicom ' +
        '(private API used to work around the broken retrieveInstance({ mediaTypes }) in the previously ' +
        'pinned version). Re-test whether client.retrieveInstance now handles explicit media types ' +
        'with transfer-syntax=* and update _downloadInstance accordingly.'
      );
    }

    const url =
      `${client.wadoURL}/studies/${encodeURIComponent(StudyInstanceUID)}` +
      `/series/${encodeURIComponent(SeriesInstanceUID)}` +
      `/instances/${encodeURIComponent(SOPInstanceUID)}`;

    const retrieve = async (mediaTypes: any): Promise<ArrayBuffer | undefined> => {
      const parts = await client._httpGetMultipartApplicationDicom(url, mediaTypes, false, false, false);
      return Array.isArray(parts) ? parts[0] : parts;
    };

    // First attempt: as-stored (`transfer-syntax=*`) — required for compressed images the server
    // won't transcode (it answers 204 otherwise).
    let bytes = await retrieve([{ mediaType: 'application/dicom', transferSyntaxUID: '*' }]);

    if (bytes && bytes.byteLength && !isUsablePart10(bytes)) {
      // As-stored file has a sparse/invalid file-meta header (client-authored M3D/PDF/SEG objects
      // can lack 0002,0010, which breaks dicomParser downstream). Refetch WITHOUT the
      // transfer-syntax parameter so the server composes a normalized Part10 with a complete meta
      // group — the same form the online viewer consumes.
      console.warn(
        `[DownloadManagerService] Instance ${SOPInstanceUID} as-stored bytes lack a usable ` +
        'file-meta header; refetching server-normalized form.'
      );
      try {
        const normalized = await retrieve(undefined);
        if (normalized && normalized.byteLength && isUsablePart10(normalized)) {
          bytes = normalized;
        }
      } catch (error) {
        // e.g. 204 for a payload the server won't transcode — fall through to the validity check
        // below, which reports the instance with a precise reason instead.
        console.warn(`[DownloadManagerService] Normalized refetch failed for ${SOPInstanceUID}.`, error);
      }
    }

    if (!bytes || !bytes.byteLength) {
      throw new Error(
        `Empty response for instance ${SOPInstanceUID} (server returned no DICOM content, e.g. HTTP 204).`
      );
    }
    if (!isUsablePart10(bytes)) {
      throw new Error(
        `Instance ${SOPInstanceUID} is not a usable Part10 stream (missing DICM magic or ` +
        'TransferSyntaxUID in the file-meta header) — refusing to cache it.'
      );
    }

    await LocalCacheService.putInstance({
      StudyInstanceUID,
      SeriesInstanceUID,
      SOPInstanceUID,
      bytes,
      metadata,
    });
  }

  /** Bounded-concurrency task pool. */
  private async _runPool<T>(items: T[], worker: (item: T) => Promise<void>, concurrency: number): Promise<void> {
    let cursor = 0;
    const runners = Array(Math.min(concurrency, items.length || 1))
      .fill(null)
      .map(async () => {
        while (cursor < items.length) {
          const index = cursor++;
          await worker(items[index]);
        }
      });
    await Promise.all(runners);
  }
}

function _pn(pn: any): string | undefined {
  if (!pn) return undefined;
  // Naturalized PN values are typically an array of person-name objects.
  if (Array.isArray(pn)) return _pn(pn[0]);
  if (typeof pn === 'string') return pn;
  return pn.Alphabetic || pn.alphabetic || undefined;
}

function _sop(inst: any): string {
  return (inst.metadata || inst).SOPInstanceUID;
}

function _isQuotaError(error: any): boolean {
  return (
    error &&
    (error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error.code === 22 ||
      error.code === 1014)
  );
}

const DownloadManagerService = new DownloadManagerServiceClass();

export { DownloadManagerService, EVENTS as DownloadManagerServiceEvents, JOB_STATES };
export default DownloadManagerService;
