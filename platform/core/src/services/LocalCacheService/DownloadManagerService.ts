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
//
// TWO TRANSFER MODES (ohif-viewers#129). `instances` is the original strategy and the default: one
// WADO-RS request per SOP instance. `archives` fetches ONE server-built zip per series and unpacks
// it in the browser (see seriesArchiveTransfer). The mode is resolved once, when a job starts, from
// the user preference -- changing the preference does not disturb a running job (FR-1).
//
// The job model stays study-scoped and count-based: `progress.total / completed / failed` keeps its
// instance-count meaning in BOTH modes, because the Download Manager dialog, the notifications, the
// header badge and the study-list menus all read it. Series-level detail and byte counters are
// additive optional fields, and a job hydrated from a previous release simply has none of them
// (#129 AR-2).
//
// A per-instance failure is classified before it is counted (#131): transient failures are
// re-attempted within the job's attempt budget, 403/404 fails the instance at once, and quota
// still halts the job. `retry()` re-arms a failed job and sends it back through this same
// pipeline; because every path already diffs enumeration output against the cache, a re-run
// fetches only what is missing. Which instances failed is deliberately not recorded -- the
// increment is "everything absent from the cache" (#131 AR-1).

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
import transferSeriesArchive, {
  SERIES_TRANSFER_STATES,
  SeriesArchiveRequestError,
} from './seriesArchiveTransfer';

const EVENTS = {
  JOB_QUEUED: 'event::downloadManagerService:jobQueued',
  JOB_PROGRESS: 'event::downloadManagerService:jobProgress',
  JOB_STATE_CHANGED: 'event::downloadManagerService:jobStateChanged',
  // The transfer-strategy preference changed (#129 FR-1). Emitted for the settings UI: preference
  // hydration is asynchronous and lands after a settings page may already have rendered, so a form
  // that only read the value once would show the default and then save it over the stored one.
  TRANSFER_MODE_CHANGED: 'event::downloadManagerService:transferModeChanged',
  // The per-instance attempt budget changed (#131 FR-12). Same reason as TRANSFER_MODE_CHANGED:
  // the settings form has to follow hydration that lands after it rendered.
  RETRY_ATTEMPTS_CHANGED: 'event::downloadManagerService:retryAttemptsChanged',
  // A failed job was re-armed by the user (#131 §5.3). Consumed by downloadNotifications, which
  // clears the job's announce-once entry and retires its sticky failure toast.
  JOB_RETRIED: 'event::downloadManagerService:jobRetried',
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

/** How a job retrieves instance bytes (ohif-viewers#129 FR-1). */
const TRANSFER_MODES = {
  INSTANCES: 'instances',
  ARCHIVES: 'archives',
} as const;

type TransferMode = typeof TRANSFER_MODES[keyof typeof TRANSFER_MODES];

// How many study jobs run concurrently, and how many instance fetches per job.
const MAX_CONCURRENT_JOBS = 2;
const PER_JOB_FETCH_CONCURRENCY = 5;

// Concurrent SERIES ARCHIVE requests per job, sized independently of PER_JOB_FETCH_CONCURRENCY
// (#129 AR-10). One archive request is far heavier than one instance request and the server packs
// it on demand, so five concurrent archives per study times two concurrent studies would be a
// materially different load on the gateway than the per-instance path. Two per job (four in
// flight across the queue) is the deliberate starting point; #129 V-3 measures it at one, two and
// four before this becomes a settled number.
const PER_JOB_ARCHIVE_CONCURRENCY = 2;

// Per-instance attempt budget (#131 FR-1). TOTAL attempts, not retries; read once when a job
// starts, so a preference change never alters a transfer already in flight.
const RETRY_ATTEMPTS_DEFAULT = 3;
const RETRY_ATTEMPTS_MIN = 1;
const RETRY_ATTEMPTS_MAX = 5;

// Delay before attempt N+1, multiplied by the attempt just made (#131 FR-3). Cancellation is
// observed DURING the wait, in slices this size.
const INSTANCE_RETRY_DELAY_MS = 500;
const RETRY_DELAY_POLL_MS = 50;

/** How a per-instance failure is treated (#131 FR-2 / §5.1). */
const DOWNLOAD_ERROR_CLASSES = {
  /** Browser storage is full: halt the job. Takes precedence over any remaining budget. */
  QUOTA: 'quota',
  /** The user cancelled: not a failure, and it consumes no budget. */
  ABORT: 'abort',
  /** Deterministic for this instance -- retrying would ask the same question again. */
  FATAL_INSTANCE: 'fatal-instance',
  /** Everything else, including anything unrecognised. Retries are cheap; giving up is not. */
  RETRYABLE: 'retryable',
} as const;

// 401 is deliberately absent: in this deployment it arises transiently from token expiry and
// refresh races mid-transfer, so it is retryable rather than fatal (#131 FR-2).
const FATAL_INSTANCE_STATUSES = [403, 404];

const JOBS_KEY = 'jobs';

interface InstanceUIDsForCleanup {
  StudyInstanceUID: string;
  SeriesInstanceUID: string;
  SOPInstanceUID: string;
}

/** An instance an archive carried that the enumerated metadata did not mention (#129 FR-5), with
 * the DICOM+JSON dataset read from its own bytes so it can be added to the stored study payload. */
interface UnmatchedInstance {
  SeriesInstanceUID: string;
  SOPInstanceUID: string;
  dataset: Record<string, any>;
}

/** Per-series detail for an archive-mode job (#129 §5.1). Optional on the job: absent in instance
 * mode and on every job persisted by a release before #129. */
interface SeriesTransfer {
  SeriesInstanceUID: string;
  SeriesNumber?: string | number;
  SeriesDescription?: string;
  Modality?: string;
  state: string;
  bytesReceived: number;
  totalBytes: number | null;
  instanceCount: number;
  cachedCount: number;
  failedCount: number;
  /** Which retrieval actually served this series -- an archive, or the per-instance fallback of
   * FR-9. Surfaced in the transfer dialog, so a fallback is visible without the console. */
  path: 'archive' | 'instances';
  error?: string;
  details?: { url: string; status?: number; body?: string };
}

interface DownloadJob {
  id: string;
  StudyInstanceUID: string;
  /** Series-scoped jobs (ohif-viewers#130) carry the series they transfer; absent means the whole
   * study, which is what every job created before #130 is. */
  SeriesInstanceUID?: string;
  kind?: 'study' | 'series';
  state: JobState;
  progress: { total: number; completed: number; failed: number };
  error?: string;
  createdAt: number;
  // Search fields for the Download Manager "Active Transfers" tab (AC-9), which double as the
  // identifiers every user-facing message about this job is composed from (see describeStudy).
  PatientName?: string;
  PatientID?: string;
  StudyDescription?: string;
  AccessionNumber?: string;
  ServiceEpisodeID?: string;
  StudyDate?: string;
  modalities?: string;
  SeriesNumber?: string | number;
  SeriesDescription?: string;
  Modality?: string;
  // -- Archive-mode additions (#129 §5.1). Additive and optional; a consumer that knows nothing
  // about them still renders the job correctly from `progress` alone (AR-2).
  transferMode?: TransferMode;
  series?: SeriesTransfer[];
  bytesReceived?: number;
  totalBytes?: number | null;
  /** Series that fell back to per-instance retrieval, for the completion notice (#129 FR-9). */
  fallbackSeriesCount?: number;
  // -- Retry additions (#131 §5.2). The persisted model grows by exactly these two: per-instance
  // attempt counters stay loop-local and never reach IndexedDB (AR-2).
  /**
   * The WADO root this job was enqueued against -- a fingerprint, not a credential. Retry attaches
   * the ACTIVE server's config and compares against this. Absent on jobs persisted before #131,
   * which are retryable against whatever server is active (FR-7).
   */
  wadoRoot?: string;
  /** How many times the job has been re-run. Diagnostic only -- nothing renders it. */
  runCount?: number;
}

class DownloadManagerServiceClass extends PubSubService {
  public readonly name = 'downloadManagerService';

  private _jobs = new Map<string, DownloadJob>();
  private _servers = new Map<string, any>(); // jobId -> server config (not persisted / serialisable)
  private _cancelFlags = new Map<string, boolean>();
  // In-flight archive requests, per job. Cancellation is cooperative for everything the run loop
  // can poll between awaits, but a fetch parked on response headers -- or a read stalled on a
  // server that stopped sending -- can only be interrupted by aborting it, so `cancel()` needs to
  // reach the controllers directly.
  private _archiveControllers = new Map<string, Set<AbortController>>();

  private _runningJobIds = new Set<string>();
  private _pendingQueue: string[] = [];

  // Transfer strategy for jobs started from now on (#129 FR-1). Default OFF: the per-instance path
  // stays the default and the fallback. Set from the user preference at startup hydration and
  // whenever the preference is saved; deliberately NOT persisted here, because the preference
  // document is the record and this is only the value a starting job reads.
  private _archiveTransferEnabled = false;
  // True once the user has chosen a value in this session, after which startup hydration is
  // ignored (see applyHydratedArchiveTransfer).
  private _archiveTransferUserSet = false;

  // Per-instance attempt budget for jobs started from now on (#131 FR-12), with the same
  // hydration-versus-user-choice rules as the transfer mode above.
  private _retryAttempts = RETRY_ATTEMPTS_DEFAULT;
  private _retryAttemptsUserSet = false;

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

  get TRANSFER_MODES() {
    return TRANSFER_MODES;
  }

  get SERIES_TRANSFER_STATES() {
    return SERIES_TRANSFER_STATES;
  }

  /**
   * Select the transfer strategy for jobs started from now on (#129 FR-1), on the user's behalf.
   * A job already running keeps the mode it resolved when it started.
   *
   * Recorded as an explicit choice, which startup hydration may no longer override: the preference
   * fetch is asynchronous, so a GET issued before the user pressed Save can land afterwards and
   * would otherwise reinstate the value they had just changed.
   */
  setArchiveTransferEnabled(enabled: boolean): void {
    this._archiveTransferUserSet = true;
    this._setArchiveTransferEnabled(enabled);
  }

  /**
   * Apply the value that startup preference hydration resolved. Ignored once the user has made a
   * choice in this session -- local intent outranks a fetch that was already in flight when they
   * made it.
   */
  applyHydratedArchiveTransfer(enabled: boolean): void {
    if (this._archiveTransferUserSet) {
      return;
    }
    this._setArchiveTransferEnabled(enabled);
  }

  private _setArchiveTransferEnabled(enabled: boolean): void {
    const next = !!enabled;
    if (this._archiveTransferEnabled === next) {
      return;
    }
    this._archiveTransferEnabled = next;
    this._broadcastEvent(EVENTS.TRANSFER_MODE_CHANGED, { archiveTransferEnabled: next });
  }

  isArchiveTransferEnabled(): boolean {
    return this._archiveTransferEnabled;
  }

  /**
   * Set the per-instance attempt budget for jobs started from now on (#131 FR-12), on the user's
   * behalf. Clamped to 1..5; a job already running keeps the budget it read when it started.
   */
  setRetryAttempts(attempts: number): void {
    this._retryAttemptsUserSet = true;
    this._setRetryAttempts(attempts);
  }

  /** Apply the hydrated preference value, unless the user has already chosen one this session. */
  applyHydratedRetryAttempts(attempts: number): void {
    if (this._retryAttemptsUserSet) {
      return;
    }
    this._setRetryAttempts(attempts);
  }

  private _setRetryAttempts(attempts: number): void {
    const next = _clampAttempts(attempts);
    if (this._retryAttempts === next) {
      return;
    }
    this._retryAttempts = next;
    this._broadcastEvent(EVENTS.RETRY_ATTEMPTS_CHANGED, { retryAttempts: next });
  }

  getRetryAttempts(): number {
    return this._retryAttempts;
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

  /** The in-flight (queued/downloading) job for a study, if any. Used for de-duplication (AC-4).
   * Series-scoped jobs are excluded: they transfer part of the study, so one must not stand in for
   * a whole-study download (nor suppress one). */
  getActiveJobForStudy(StudyInstanceUID: string): DownloadJob | undefined {
    return this.listJobs().find(
      job =>
        job.StudyInstanceUID === StudyInstanceUID &&
        job.kind !== 'series' &&
        _isActive(job)
    );
  }

  isStudyDownloading(StudyInstanceUID: string): boolean {
    return !!this.getActiveJobForStudy(StudyInstanceUID);
  }

  /** The in-flight series-scoped job for a series, if any (ohif-viewers#130 FR-2). */
  getActiveJobForSeries(SeriesInstanceUID: string): DownloadJob | undefined {
    return this.listJobs().find(
      job => job.kind === 'series' && job.SeriesInstanceUID === SeriesInstanceUID && _isActive(job)
    );
  }

  isSeriesDownloading(SeriesInstanceUID: string): boolean {
    return !!this.getActiveJobForSeries(SeriesInstanceUID);
  }

  /**
   * True when ANY in-flight transfer is writing this series into the cache -- its own series job,
   * or a whole-study job for the study it belongs to.
   *
   * This is the #130 FR-8 signal: the series menus withhold `Remove Offline Storage` while it
   * holds, so a removal can never be silently undone a moment later by a job that is still
   * downloading the series it just evicted. Cancelling the transfer (or letting it finish) makes
   * the removal available again.
   */
  isSeriesTransferInFlight(StudyInstanceUID: string, SeriesInstanceUID: string): boolean {
    return this.listJobs().some(
      job =>
        _isActive(job) &&
        (job.kind === 'series'
          ? job.SeriesInstanceUID === SeriesInstanceUID
          : job.StudyInstanceUID === StudyInstanceUID)
    );
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

    return this._enqueue({ server, StudyInstanceUID, descriptor, kind: 'study' });
  }

  /**
   * Queue a single series for offline storage (ohif-viewers#130 FR-1). Same lifecycle, same
   * cleanup and the same two transfer modes as a study job -- only the enumeration is narrowed to
   * one series.
   *
   * De-duplicated on the Series UID. A series job and a whole-study job for the same study may
   * both be queued, but they do not run at the same time -- see `_conflictsWithRunningJob`.
   *
   * It writes a study metadata payload covering the series it saved, marked PARTIAL, which is what
   * lets that series be opened with no network. Partial is load-bearing: the open path replays a
   * complete payload instead of the network but treats a partial one as a fallback behind it, so
   * the series this job did not save are never presented as non-existent.
   */
  enqueueSeries({
    server,
    StudyInstanceUID,
    SeriesInstanceUID,
    descriptor = {},
  }: {
    server: any;
    StudyInstanceUID: string;
    SeriesInstanceUID: string;
    descriptor?: Partial<DownloadJob>;
  }): DownloadJob {
    const existing = this.getActiveJobForSeries(SeriesInstanceUID);
    if (existing) {
      return existing;
    }

    return this._enqueue({
      server,
      StudyInstanceUID,
      SeriesInstanceUID,
      descriptor,
      kind: 'series',
    });
  }

  private _enqueue({
    server,
    StudyInstanceUID,
    SeriesInstanceUID,
    descriptor = {},
    kind,
  }: {
    server: any;
    StudyInstanceUID: string;
    SeriesInstanceUID?: string;
    descriptor?: Partial<DownloadJob>;
    kind: 'study' | 'series';
  }): DownloadJob {
    const job: DownloadJob = {
      id: `dl-${SeriesInstanceUID || StudyInstanceUID}-${Date.now()}`,
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
      StudyDate: descriptor.StudyDate,
      modalities: descriptor.modalities,
      // Which server this job belongs to, so a Retry days later can tell whether the study it is
      // about to re-enumerate is even on the server now active (#131 FR-7).
      wadoRoot: _wadoFingerprint(server),
    };

    if (kind === 'series') {
      job.kind = 'series';
      job.SeriesInstanceUID = SeriesInstanceUID;
      job.SeriesNumber = descriptor.SeriesNumber;
      job.SeriesDescription = descriptor.SeriesDescription;
      job.Modality = descriptor.Modality;
    }

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

    // Abort any archive request this job has in flight. Without this the flag is only observed
    // between awaits, so a request waiting on response headers would keep the job "cancelling"
    // until the network timed out.
    this._abortArchiveRequests(jobId);

    // A still-queued job never entered the run loop, so transition it here.
    if (job.state === JOB_STATES.QUEUED) {
      this._pendingQueue = this._pendingQueue.filter(id => id !== jobId);
      this._setState(job, JOB_STATES.CANCELLED);
    }
  }

  private _abortArchiveRequests(jobId: string): void {
    this._archiveControllers.get(jobId)?.forEach(controller => {
      try {
        controller.abort();
      } catch (error) {
        // An already-settled request rejects the abort on some implementations; nothing to do.
      }
    });
  }

  /** Registers an archive request so `cancel()` can abort it; returns its de-registration. */
  private _trackArchiveRequest(jobId: string, controller: AbortController): () => void {
    let controllers = this._archiveControllers.get(jobId);
    if (!controllers) {
      controllers = new Set();
      this._archiveControllers.set(jobId, controllers);
    }
    controllers.add(controller);

    // A cancel that landed between the flag check and this registration would otherwise be missed.
    if (this._isCancelled(jobId)) {
      controller.abort();
    }

    return () => {
      const set = this._archiveControllers.get(jobId);
      if (!set) {
        return;
      }
      set.delete(controller);
      if (!set.size) {
        this._archiveControllers.delete(jobId);
      }
    };
  }

  /** Cancel by study UID (convenience for the toolbar/study-list "Remove offline"-while-downloading). */
  cancelStudy(StudyInstanceUID: string): void {
    const job = this.getActiveJobForStudy(StudyInstanceUID);
    if (job) {
      this.cancel(job.id);
    }
  }

  /** Cancel the in-flight series-scoped job for a series (ohif-viewers#130 FR-2). */
  cancelSeries(SeriesInstanceUID: string): void {
    const job = this.getActiveJobForSeries(SeriesInstanceUID);
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

  // ---- Retry ---------------------------------------------------------------------------------

  /**
   * Can this failed job be re-run against `server`? (#131 FR-5/FR-7) A job persisted before #131
   * carries no `wadoRoot` and is retryable against whatever is active.
   */
  canRetry(jobId: string, server: any): boolean {
    const job = this._jobs.get(jobId);
    if (!job || job.state !== JOB_STATES.ERROR) {
      return false;
    }
    return this.matchesServer(job, server);
  }

  /** Whether a job's recorded server fingerprint matches `server` (absent fingerprint = yes). */
  matchesServer(job: DownloadJob | undefined, server: any): boolean {
    if (!job?.wadoRoot) {
      return true;
    }
    return job.wadoRoot === _wadoFingerprint(server);
  }

  /**
   * Re-run a failed job incrementally (#131 FR-6): re-arm it and push it back through the standard
   * pipeline, which diffs the study against the cache and fetches only what is missing.
   *
   * `server` is supplied by the caller rather than remembered -- configs carry credentials and are
   * never persisted (§8) -- after `canRetry` has confirmed it is the job's server.
   *
   * @returns the re-armed job, or undefined when the request was refused
   */
  retry(jobId: string, server: any): DownloadJob | undefined {
    const job = this._jobs.get(jobId);
    // The state check is also what makes a double-click harmless: the first call moves the job to
    // QUEUED synchronously, so the second finds nothing to re-arm (AC "one re-run, not several").
    if (!job || job.state !== JOB_STATES.ERROR || !server || !this.matchesServer(job, server)) {
      return undefined;
    }

    job.state = JOB_STATES.QUEUED;
    job.error = undefined;
    job.runCount = (job.runCount || 0) + 1;
    // Counters are recomputed at run start from enumeration and the cache; per-series detail is
    // rebuilt by _runArchiveMode. Clearing them here keeps the row from showing the failed run's
    // numbers while the re-run is still enumerating.
    job.progress = { total: 0, completed: 0, failed: 0 };
    job.series = undefined;
    job.bytesReceived = undefined;
    job.totalBytes = undefined;
    job.fallbackSeriesCount = undefined;
    // A legacy job adopts the server it is being retried against, so a later Retry has something
    // to compare.
    job.wadoRoot = job.wadoRoot || _wadoFingerprint(server);

    this._servers.set(jobId, server);
    this._cancelFlags.set(jobId, false);
    this._archiveControllers.delete(jobId);
    this._persistJobs();

    // Queued before anything is announced: `_broadcastEvent` calls subscribers directly, so a
    // listener that throws would otherwise unwind `retry()` before scheduling and strand a
    // persisted QUEUED job that can never be retried again (`retry()` only accepts ERROR).
    this._pendingQueue.push(jobId);

    // Announced before the job runs, so the notification module has cleared its announce-once
    // entry and retired the sticky failure toast before this run reaches a terminal state (FR-9).
    // Isolated per event: reporting must not cost the re-run, nor the other event.
    this._broadcastSafely(EVENTS.JOB_RETRIED, { job });
    this._broadcastSafely(EVENTS.JOB_STATE_CHANGED, { job });

    // `_pump` holds the job behind any job already running for this study (FR-10).
    this._pump();

    return job;
  }

  /** Broadcast without letting a subscriber's failure propagate to the caller. */
  private _broadcastSafely(event: string, payload: Record<string, unknown>): void {
    try {
      this._broadcastEvent(event, payload);
    } catch (error) {
      console.warn(`[DownloadManagerService] A subscriber to ${event} threw.`, error);
    }
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
    this._archiveControllers.delete(jobId);
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

  /**
   * TWO JOBS TOUCHING ONE STUDY NEVER RUN AT THE SAME TIME.
   *
   * This is the invariant several other things rest on, so it is enforced in one place rather than
   * defended against in each of them:
   *
   *   - the stored metadata payload is read, merged and written back by each job that finishes; two
   *     concurrent jobs would read the same payload and last-writer-wins, losing a saved series;
   *   - `pending` is computed from `isInstanceCachedSync` at job start, so two concurrent jobs both
   *     see an instance as uncached, both store it, and both take it into their cancellation
   *     cleanup — whichever cancels first would then revoke a copy the other completed.
   *
   * Serialised, both disappear: the second job starts after the first has finished, sees its
   * instances as already cached, and neither stores nor claims them. The cost is that saving two
   * series of one study queues rather than parallelises, which for transfers this heavy is a
   * reasonable trade and is gentler on the server besides.
   */
  private _conflictsWithRunningJob(job: DownloadJob): boolean {
    for (const runningId of this._runningJobIds) {
      const running = this._jobs.get(runningId);
      if (running && running.StudyInstanceUID === job.StudyInstanceUID) {
        return true;
      }
    }
    return false;
  }

  private _pump(): void {
    while (this._runningJobIds.size < MAX_CONCURRENT_JOBS && this._pendingQueue.length > 0) {
      // The first queued job that is not blocked by a running job for the same study. A blocked job
      // stays queued and starts when that job finishes -- `_pump` runs again on every completion.
      const index = this._pendingQueue.findIndex(id => {
        const candidate = this._jobs.get(id);
        return !candidate || candidate.state !== JOB_STATES.QUEUED || !this._conflictsWithRunningJob(candidate);
      });
      if (index === -1) {
        return;
      }

      const [jobId] = this._pendingQueue.splice(index, 1);
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

    // Resolve the transfer strategy ONCE, here (#129 FR-1): changing the preference mid-transfer
    // must not alter a job already running, and every later decision in this run reads the job.
    job.transferMode = this._archiveTransferEnabled
      ? TRANSFER_MODES.ARCHIVES
      : TRANSFER_MODES.INSTANCES;

    // The attempt budget is likewise resolved ONCE, here (#131 FR-1): a preference change during a
    // transfer must not lengthen or shorten the retries of the instances still to come. It is
    // carried down the call chain rather than stored on the job, because it describes this run and
    // nothing persisted should have to be reasoned about later (AR-2).
    const attempts = this._retryAttempts;

    this._setState(job, JOB_STATES.DOWNLOADING);

    let instances: any[];
    let seriesGroups: any[] = [];
    let metadataPayload: Record<string, unknown> | null = null;
    try {
      ({ instances, seriesGroups, metadataPayload } = await this._enumerateInstances(
        server,
        job.StudyInstanceUID,
        jobId,
        job.SeriesInstanceUID
      ));
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
      job.StudyDate = job.StudyDate || firstMeta.StudyDate;
      job.modalities = job.modalities || firstMeta.Modality;
    }

    job.progress = { total: instances.length, completed: 0, failed: 0 };
    this._emitProgress(job);

    // Reuse the app's DICOMweb client (same auth/CORS path as metadata retrieval) to pull each
    // instance's Part10 bytes via WADO-RS, rather than a raw fetch of the WADO-URI (which the
    // server may not serve or CORS-allow when configured for WADO-RS rendering). Both modes use
    // it: archive mode for the per-series fallback of FR-9.
    const client = this._makeWadoClient(server);

    // Instances stored by THIS job — the cleanup set if the job is cancelled. Instances that were
    // already cached before the job started are never in here, so cancelling a top-up download
    // can't evict a previously completed one.
    const downloadedByThisJob: InstanceUIDsForCleanup[] = [];

    // Archive-only instances (#129 FR-5), merged into the metadata payload below so a zero-network
    // open can see them.
    const unmatchedInstances: UnmatchedInstance[] = [];

    const quotaHit =
      job.transferMode === TRANSFER_MODES.ARCHIVES
        ? await this._runArchiveMode(
            job,
            server,
            client,
            seriesGroups,
            downloadedByThisJob,
            unmatchedInstances,
            attempts
          )
        : await this._runInstanceMode(job, client, instances, downloadedByThisJob, attempts);

    if (this._isCancelled(jobId)) {
      // Clean up after ourselves: remove everything this job stored (including a retrieve that was
      // mid-flight when the cancel landed and completed afterwards).
      await this._cleanupCancelledDownloads(downloadedByThisJob);
      this._setState(job, JOB_STATES.CANCELLED);
      return;
    }

    // Persist the raw study metadata payload so a cached study can be opened with ZERO network
    // requests (the study-open path replays it through the normal retrieve pipeline). Stored even
    // on partial success — missing instances fall back to network per-instance. Unchanged by the
    // archive path: enumeration still runs in both modes and only byte retrieval differs, so a
    // study cached through archives opens exactly as one cached instance-by-instance (#129 FR-4).
    //
    // A SERIES-scoped job stores one too, marked partial: without it the series it saved could not
    // be opened at all without a network, because the open path has nothing to rebuild from. It is
    // marked partial because it describes only that series, and the open path must therefore treat
    // it as a fallback rather than as the study (ohif-viewers#130).
    if (metadataPayload && LocalCacheService.isStudyCachedSync(job.StudyInstanceUID)) {
      try {
        _mergeUnmatchedIntoPayload(metadataPayload, unmatchedInstances);

        // A study job enumerated the whole study, so its payload supersedes. A series job's covers
        // only its series, so it merges into what is stored and is marked partial -- and the read,
        // merge and write happen inside the cache's own per-study critical section rather than
        // here, where the read would sit outside the lock that guards the write.
        if (job.kind === 'series') {
          await LocalCacheService.mergeStudyMetadataPayload(job.StudyInstanceUID, metadataPayload, {
            partial: true,
          });
        } else {
          await LocalCacheService.putStudyMetadataPayload(job.StudyInstanceUID, metadataPayload);
        }
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
   * The original strategy: one WADO-RS request per instance, through a bounded pool.
   *
   * @returns true when the job hit the browser storage quota and must stop.
   */
  private async _runInstanceMode(
    job: DownloadJob,
    client: any,
    instances: any[],
    downloadedByThisJob: InstanceUIDsForCleanup[],
    attempts: number
  ): Promise<boolean> {
    const jobId = job.id;

    // Skip instances already cached (idempotent re-queue / partial resume) so completed counts
    // reflect real work and we never double-store (AC-4). Also what makes a retried job
    // incremental: the same filter, against a cache the failed run has already partly filled.
    const pending = instances.filter(inst => !LocalCacheService.isInstanceCachedSync(_sop(inst)));
    job.progress.completed = instances.length - pending.length;
    this._emitProgress(job);

    let quotaHit = false;

    const worker = async (inst: any): Promise<void> => {
      if (this._isCancelled(jobId) || quotaHit) {
        return;
      }

      const { outcome, error } = await this._retrieveInstance(client, inst, {
        job,
        attempts,
        isHalted: () => quotaHit,
      });

      if (outcome === 'stored') {
        const m = inst.metadata || inst;
        downloadedByThisJob.push({
          StudyInstanceUID: m.StudyInstanceUID,
          SeriesInstanceUID: m.SeriesInstanceUID,
          SOPInstanceUID: m.SOPInstanceUID,
        });
        job.progress.completed += 1;
      } else if (outcome === 'quota') {
        // Stop the whole job on quota exhaustion and surface a visible error (AC-10).
        quotaHit = true;
      } else if (outcome === 'failed') {
        this._logFirstInstanceFailure(job, error);
        job.progress.failed += 1;
      }
      // 'cancelled' counts as nothing: the user stopped the job, and the cleanup pass removes what
      // it had already stored.

      this._emitProgress(job);
    };

    await this._runPool(pending, worker, PER_JOB_FETCH_CONCURRENCY);

    return quotaHit;
  }

  /**
   * Retrieve ONE instance within the job's attempt budget (#131 FR-1..FR-4). The single retrieval
   * point for both transfer paths, so classification and budget cannot diverge between them (§6).
   *
   * Counts nothing: the caller owns `progress.failed` and the per-series counters, and increments
   * them only for a returned 'failed' -- which is what keeps a recovered instance out of the
   * failure count and out of the failure toast (FR-4).
   *
   * @param isHalted - a job-level stop the caller owns (quota); polled between attempts
   */
  private async _retrieveInstance(
    client: any,
    inst: any,
    { job, attempts, isHalted }: { job: DownloadJob; attempts: number; isHalted: () => boolean }
  ): Promise<{ outcome: 'stored' | 'failed' | 'quota' | 'cancelled'; error?: any }> {
    const jobId = job.id;
    const budget = Math.max(1, attempts);

    for (let attempt = 1; attempt <= budget; attempt += 1) {
      if (this._isCancelled(jobId)) {
        return { outcome: 'cancelled' };
      }
      if (isHalted()) {
        return { outcome: 'quota' };
      }

      try {
        await this._downloadInstance(client, inst);
        return { outcome: 'stored' };
      } catch (error: any) {
        if (this._isCancelled(jobId)) {
          return { outcome: 'cancelled', error };
        }

        switch (_classifyDownloadError(error)) {
          case DOWNLOAD_ERROR_CLASSES.QUOTA:
            // Precedence over the remaining budget (FR-11): more attempts cannot make room.
            return { outcome: 'quota', error };
          case DOWNLOAD_ERROR_CLASSES.ABORT:
            return { outcome: 'cancelled', error };
          case DOWNLOAD_ERROR_CLASSES.FATAL_INSTANCE:
            // Deterministic for this instance -- a second identical request is just latency.
            return { outcome: 'failed', error };
          default:
            break;
        }

        if (attempt >= budget) {
          return { outcome: 'failed', error };
        }
        if (!(await this._waitBeforeRetry(jobId, attempt))) {
          return { outcome: 'cancelled', error };
        }
      }
    }

    // Unreachable: the loop returns on its last attempt.
    return { outcome: 'failed' };
  }

  /**
   * Pause between attempts (#131 FR-3). Sliced rather than one long timer so a cancel lands during
   * the wait instead of after it.
   *
   * @returns false when the job was cancelled during (or by the end of) the wait
   */
  private async _waitBeforeRetry(jobId: string, attempt: number): Promise<boolean> {
    const total = INSTANCE_RETRY_DELAY_MS * attempt;

    for (let waited = 0; waited < total; waited += RETRY_DELAY_POLL_MS) {
      if (this._isCancelled(jobId)) {
        return false;
      }
      const slice = Math.min(RETRY_DELAY_POLL_MS, total - waited);
      // eslint-disable-next-line no-await-in-loop
      await new Promise(resolve => setTimeout(resolve, slice));
    }

    return !this._isCancelled(jobId);
  }

  /**
   * Log the first counted failure of a job so the cause (HTTP status, CORS, empty body) is
   * diagnosable without every one of N instances spamming the console. Called only once a budget
   * is spent, so the console describes a real failure rather than a blip.
   */
  private _logFirstInstanceFailure(job: DownloadJob, error: any): void {
    if (job.progress.failed !== 0) {
      return;
    }
    const status = _httpStatus(error);
    console.error(
      `[DownloadManagerService] Instance download failed for job ${job.id}:`,
      status ? `HTTP ${status}` : '',
      error
    );
  }

  /**
   * The archive strategy (#129 §5.2): one server-built zip per series, extracted and indexed as it
   * arrives.
   *
   * Retrieval, extraction and the cache writes live in seriesArchiveTransfer; what stays here is
   * the job lifecycle both modes share — the already-cached skip, the retry, the per-instance
   * fallback, the counter roll-up and the cancellation cleanup set.
   *
   * @returns true when the job hit the browser storage quota and must stop.
   */
  private async _runArchiveMode(
    job: DownloadJob,
    server: any,
    client: any,
    seriesGroups: any[],
    downloadedByThisJob: InstanceUIDsForCleanup[],
    unmatchedInstances: UnmatchedInstance[],
    attempts: number
  ): Promise<boolean> {
    const jobId = job.id;

    job.series = seriesGroups.map(group => ({
      SeriesInstanceUID: group.SeriesInstanceUID,
      SeriesNumber: group.SeriesNumber,
      SeriesDescription: group.SeriesDescription,
      Modality: group.Modality,
      state: SERIES_TRANSFER_STATES.QUEUED,
      bytesReceived: 0,
      totalBytes: null,
      instanceCount: group.instances.length,
      cachedCount: 0,
      failedCount: 0,
      path: 'archive' as const,
    }));
    job.bytesReceived = 0;
    job.totalBytes = null;
    job.fallbackSeriesCount = 0;

    // Series already fully cached are counted in before anything is requested (FR-11).
    const alreadyCachedBySeries = new Map<string, Set<string>>();
    seriesGroups.forEach((group, index) => {
      const cached = new Set<string>(
        group.instances
          .map((inst: any) => _sop(inst))
          .filter((sop: string) => LocalCacheService.isInstanceCachedSync(sop))
      );
      alreadyCachedBySeries.set(group.SeriesInstanceUID, cached);

      const detail = job.series![index];
      detail.cachedCount = cached.size;
      if (cached.size === detail.instanceCount && detail.instanceCount > 0) {
        detail.state = SERIES_TRANSFER_STATES.COMPLETE;
        // A fully-cached series reports a known size of zero rather than an unknown one, so it
        // cannot by itself force the aggregate onto the count-based fallback (FR-7).
        detail.totalBytes = 0;
      }
    });
    this._rollUpSeriesProgress(job);

    let quotaHit = false;

    /**
     * Retrieve one series image by image: the fallback after an archive could not be used
     * (#129 FR-9), and the direct route for a partly-cached series on a re-run (#131 FR-8).
     */
    const runInstanceFallback = async (
      group: any,
      detail: SeriesTransfer,
      alreadyCached: Set<string>
    ): Promise<void> => {
      detail.path = 'instances';
      detail.state = SERIES_TRANSFER_STATES.DOWNLOADING;

      // Discard any abandoned archive attempt's byte counters. They describe a transfer that is no
      // longer happening, and the per-instance path does not advance them: left in place, a
      // numeric `totalBytes` keeps the job's aggregate in byte mode (see _rollUpSeriesProgress),
      // where it would stall short of 100% even as the fallback completes every instance. `null`
      // means "size unknown", which is true, and drops the job to the honest count-based form.
      detail.bytesReceived = 0;
      detail.totalBytes = null;
      this._rollUpSeriesProgress(job);
      this._emitProgress(job);

      let failed = 0;
      const pending = group.instances.filter(
        (inst: any) => !LocalCacheService.isInstanceCachedSync(_sop(inst))
      );

      await this._runPool(
        pending,
        async (inst: any) => {
          if (this._isCancelled(jobId) || quotaHit) {
            return;
          }

          const { outcome, error } = await this._retrieveInstance(client, inst, {
            job,
            attempts,
            isHalted: () => quotaHit,
          });

          if (outcome === 'stored') {
            const m = inst.metadata || inst;
            downloadedByThisJob.push({
              StudyInstanceUID: m.StudyInstanceUID,
              SeriesInstanceUID: m.SeriesInstanceUID,
              SOPInstanceUID: m.SOPInstanceUID,
            });
            if (!alreadyCached.has(m.SOPInstanceUID)) {
              detail.cachedCount += 1;
            }
          } else if (outcome === 'quota') {
            quotaHit = true;
          } else if (outcome === 'failed') {
            this._logFirstInstanceFailure(job, error);
            failed += 1;
          }

          this._rollUpSeriesProgress(job);
          this._emitProgress(job);
        },
        PER_JOB_FETCH_CONCURRENCY
      );

      if (this._isCancelled(jobId)) {
        detail.state = SERIES_TRANSFER_STATES.CANCELLED;
      } else if (quotaHit) {
        detail.state = SERIES_TRANSFER_STATES.FAILED;
        detail.error = 'Browser storage quota exceeded.';
      } else {
        detail.failedCount = failed;
        detail.state = failed ? SERIES_TRANSFER_STATES.FAILED : SERIES_TRANSFER_STATES.COMPLETE;
        if (!failed) {
          detail.error = undefined;
          detail.details = undefined;
        }
      }
      this._rollUpSeriesProgress(job);
      this._emitProgress(job);
    };

    const worker = async (group: any): Promise<void> => {
      const detail = job.series!.find(s => s.SeriesInstanceUID === group.SeriesInstanceUID)!;

      if (this._isCancelled(jobId) || quotaHit) {
        return;
      }
      if (detail.state === SERIES_TRANSFER_STATES.COMPLETE) {
        return; // Fully cached already; no request issued (FR-11).
      }

      const alreadyCached = alreadyCachedBySeries.get(group.SeriesInstanceUID)!;

      // FR-8: on a re-run, a partly-cached series takes the per-instance path rather than moving
      // its whole archive again to recover a few images. Pre-dispatch only -- the archive loop's
      // own retry and fallback rules are unchanged (AR-6), as is a first run.
      //
      // Not counted in `fallbackSeriesCount`: that count feeds a completion notice about archives
      // that could not be used, and no archive was requested here.
      if ((job.runCount || 0) > 0 && detail.cachedCount > 0) {
        await runInstanceFallback(group, detail, alreadyCached);
        return;
      }

      // Every SOP instance of this series known to be cached, counting from what was already there.
      // A union rather than a running increment: an archive carries the whole series, including
      // instances already cached, and a retry re-stores what the first attempt landed — both of
      // which would over-report a counter that only ever went up.
      const cachedSops = new Set<string>(alreadyCached);
      const metadataBySOP: Record<string, any> = {};
      group.instances.forEach((inst: any) => {
        const metadata = inst.metadata || inst;
        if (metadata.SOPInstanceUID) {
          metadataBySOP[metadata.SOPInstanceUID] = metadata;
        }
      });

      const runArchive = async () => {
        detail.error = undefined;
        detail.details = undefined;
        let untrack: (() => void) | null = null;
        try {
          return await transferSeriesArchive({
            server,
            StudyInstanceUID: job.StudyInstanceUID,
            SeriesInstanceUID: group.SeriesInstanceUID,
            metadataBySOP,
            alreadyCached,
            isCancelled: () => this._isCancelled(jobId) || quotaHit,
            onRequestStarted: controller => {
              untrack = this._trackArchiveRequest(jobId, controller);
            },
            onUnmatchedInstance: instance => {
              // Kept so the study metadata payload written at the end of the job describes this
              // instance too -- otherwise it is cached but invisible to a zero-network open (FR-5).
              unmatchedInstances.push(instance);
            },
            onState: state => {
              detail.state = state;
              this._emitProgress(job);
            },
            onProgress: ({ bytesReceived, totalBytes }) => {
              detail.bytesReceived = bytesReceived;
              detail.totalBytes = totalBytes;
              this._rollUpSeriesProgress(job);
              this._emitProgress(job);
            },
            onInstanceStored: uids => {
              // Only instances THIS job introduced go in the cleanup set. An archive carries the
              // whole series, so a partially-cached series re-stores instances an earlier completed
              // download put there — cancelling must not evict those (FR-10).
              if (!alreadyCached.has(uids.SOPInstanceUID)) {
                downloadedByThisJob.push(uids);
              }
              cachedSops.add(uids.SOPInstanceUID);
              detail.cachedCount = cachedSops.size;
              this._rollUpSeriesProgress(job);
            },
          });
        } finally {
          // Always de-register, on success, failure and abort alike, so a finished request cannot
          // be aborted later and the map does not grow across retries.
          untrack?.();
        }
      };

      // FR-9: one retry, then the per-instance fallback for THIS series only. Series granularity
      // exists precisely to make retry cheap, and a study must not be left without an offline copy
      // because one archive response failed.
      let lastError: any = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const outcome = await runArchive();
          if (outcome.cancelled) {
            detail.state = SERIES_TRANSFER_STATES.CANCELLED;
            return;
          }
          detail.failedCount = outcome.failed;
          detail.bytesReceived = outcome.bytesReceived;
          detail.totalBytes = outcome.totalBytes;
          detail.state = outcome.failed
            ? SERIES_TRANSFER_STATES.FAILED
            : SERIES_TRANSFER_STATES.COMPLETE;
          lastError = null;

          if (outcome.failed) {
            // Members arrived but could not be cached (AR-9). There is no transfer-syntax control
            // on the archive route, so the only way to recover those instances is per-instance
            // retrieval — the same fallback a failed request takes.
            break;
          }
          this._rollUpSeriesProgress(job);
          this._emitProgress(job);
          return;
        } catch (error: any) {
          if (this._isCancelled(jobId)) {
            detail.state = SERIES_TRANSFER_STATES.CANCELLED;
            return;
          }
          if (_isQuotaError(error)) {
            quotaHit = true;
            detail.state = SERIES_TRANSFER_STATES.FAILED;
            detail.error = 'Browser storage quota exceeded.';
            this._rollUpSeriesProgress(job);
            this._emitProgress(job);
            return;
          }
          lastError = error;
          detail.error = error?.message || String(error);
          if (error instanceof SeriesArchiveRequestError) {
            detail.details = error.details;
          }
        }
      }

      if (lastError) {
        console.error(
          `[DownloadManagerService] Series archive failed for ${group.SeriesInstanceUID} ` +
          `(job ${job.id}); falling back to per-instance retrieval.`,
          lastError
        );
      }

      // Per-instance fallback for this series. Other series keep using archives.
      job.fallbackSeriesCount = (job.fallbackSeriesCount || 0) + 1;
      await runInstanceFallback(group, detail, alreadyCached);
    };

    await this._runPool(seriesGroups, worker, PER_JOB_ARCHIVE_CONCURRENCY);

    this._rollUpSeriesProgress(job);
    this._emitProgress(job);

    return quotaHit;
  }

  /**
   * Roll the per-series counters up into the study-scoped `progress` (#129 AR-2).
   *
   * `progress.total / completed / failed` keeps its instance-count meaning in both modes, so every
   * existing consumer — the dialog, the notifications, the header badge, the study-list menus —
   * renders an archive job correctly without knowing archive mode exists.
   *
   * The byte aggregate is reported ONLY when every series has a known size (a series that has not
   * started yet does not have one). A denominator that grows as series start would be a false
   * percentage, which FR-7 rules out; until then the dialog falls back to the count-based form.
   */
  private _rollUpSeriesProgress(job: DownloadJob): void {
    if (!job.series) {
      return;
    }

    let completed = 0;
    let failed = 0;
    let bytesReceived = 0;
    let totalBytes: number | null = 0;

    job.series.forEach(series => {
      completed += series.cachedCount;
      failed += series.failedCount;
      bytesReceived += series.bytesReceived;
      if (totalBytes !== null && typeof series.totalBytes === 'number') {
        totalBytes += series.totalBytes;
      } else {
        totalBytes = null;
      }
    });

    job.progress.completed = Math.min(completed, job.progress.total);
    job.progress.failed = failed;
    job.bytesReceived = bytesReceived;
    job.totalBytes = totalBytes;
  }

  /**
   * Enumerate every instance of a study with the app's DICOMweb client (QIDO series search +
   * per-series WADO-RS metadata — the same requests the online retrieve pipeline makes), keeping
   * the RAW DICOM+JSON payloads so they can be stored for network-free study opens.
   *
   * Runs in BOTH transfer modes: a zip archive carries no naturalized metadata, and `putInstance`
   * requires it, so archive mode replaces per-instance byte retrieval only (#129 FR-4).
   *
   * `onlySeriesInstanceUID` narrows the enumeration to one series for a series-scoped job
   * (ohif-viewers#130). The returned payload then covers only that series, and the caller stores it
   * marked partial — enough to rebuild the saved series with no network, while the partial marking
   * keeps it from standing in for the study and hiding the series it does not describe.
   */
  private async _enumerateInstances(
    server: any,
    StudyInstanceUID: string,
    jobId: string,
    onlySeriesInstanceUID?: string
  ): Promise<{
    instances: any[];
    seriesGroups: any[];
    metadataPayload: Record<string, unknown> | null;
  }> {
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
    const seriesGroups: any[] = [];
    const instancesBySeries: Record<string, any[]> = {};

    for (const series of seriesSorted) {
      if (this._isCancelled(jobId)) {
        break;
      }
      const seriesInfo = getSeriesInfo(series);
      const seriesInstanceUID = seriesInfo.SeriesInstanceUID;
      if (!seriesInstanceUID) {
        continue;
      }
      if (onlySeriesInstanceUID && seriesInstanceUID !== onlySeriesInstanceUID) {
        continue;
      }

      const sopInstances =
        (await client.retrieveSeriesMetadata({
          studyInstanceUID: StudyInstanceUID,
          seriesInstanceUID,
        })) || [];
      instancesBySeries[seriesInstanceUID] = sopInstances;

      // Per-series grouping, in the enumerated (sorted) order archive mode transfers in. Instance
      // mode ignores it and works off the flat list, exactly as before.
      // getSeriesInfo exposes Modality and a SeriesNumber that defaults to 0, and no description;
      // the naturalized instance metadata below carries all three properly, so the series JSON is
      // only the fallback.
      const group = {
        SeriesInstanceUID: seriesInstanceUID,
        SeriesNumber: undefined as string | number | undefined,
        SeriesDescription: undefined as string | undefined,
        Modality: seriesInfo.Modality || undefined,
        instances: [] as any[],
      };

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
        group.instances.push({ metadata });

        group.SeriesNumber = group.SeriesNumber ?? metadata.SeriesNumber;
        group.SeriesDescription = group.SeriesDescription || metadata.SeriesDescription;
        group.Modality = group.Modality || metadata.Modality;
      });

      group.SeriesNumber = group.SeriesNumber ?? (seriesInfo.SeriesNumber || undefined);

      seriesGroups.push(group);
    }

    return {
      instances,
      seriesGroups,
      // For a series-scoped job this describes only the requested series, and the caller stores it
      // marked partial. It is stored rather than withheld because it is the only thing that can
      // rebuild that series without a network; marking it partial is what stops the open path from
      // presenting the study's other series as non-existent (ohif-viewers#130).
      metadataPayload: {
        series: onlySeriesInstanceUID
          ? seriesSorted.filter(
              (series: any) => getSeriesInfo(series).SeriesInstanceUID === onlySeriesInstanceUID
            )
          : seriesSorted,
        instancesBySeries,
      },
    };
  }

  /**
   * Remove the instances a cancelled job stored, so a cancelled transfer leaves no partial data.
   *
   * `items` holds only what this job INTRODUCED -- an instance already cached when the job started
   * is never added to it. Combined with the one-job-per-study rule in `_pump`, that makes an
   * unconditional delete correct: no other job can have stored these bytes, because no other job
   * for this study was running.
   */
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

    // Carry whatever HTTP status the client attached through to the classifier (#131 AR-3). It
    // does not promise one on every failure; without a status the error classifies as retryable.
    const retrieve = async (mediaTypes: any): Promise<ArrayBuffer | undefined> => {
      try {
        const parts = await client._httpGetMultipartApplicationDicom(url, mediaTypes, false, false, false);
        return Array.isArray(parts) ? parts[0] : parts;
      } catch (error: any) {
        const status = _httpStatus(error);
        if (status !== undefined && error && error.status === undefined) {
          error.status = status;
        }
        throw error;
      }
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

/**
 * Add archive-only instances to the study metadata payload (#129 FR-5).
 *
 * Caching such an instance is only half the job: `buildStudyFromCachedMetadata` reconstructs a
 * network-free study open purely from this payload and then sets `seriesLoader = null`, so an
 * instance the payload does not mention is stored but invisible — an offline copy with a hole in
 * it, which is exactly what FR-5 exists to prevent.
 *
 * The datasets are already DICOM+JSON, the same shape `retrieveSeriesMetadata` returns, so they
 * append directly. A series the enumeration never saw gets its own entry.
 */
function _mergeUnmatchedIntoPayload(
  payload: Record<string, any>,
  unmatched: UnmatchedInstance[]
): void {
  if (!unmatched.length || !payload?.instancesBySeries) {
    return;
  }

  unmatched.forEach(({ SeriesInstanceUID, SOPInstanceUID, dataset }) => {
    if (!dataset || !SeriesInstanceUID) {
      return;
    }
    const series = payload.instancesBySeries[SeriesInstanceUID] || [];

    // Idempotent: a re-queue re-extracts the same archive, and the payload must not accumulate
    // duplicate instances across runs.
    const alreadyPresent = series.some(
      (instance: any) => instance?.['00080018']?.Value?.[0] === SOPInstanceUID
    );
    if (!alreadyPresent) {
      series.push(dataset);
    }
    payload.instancesBySeries[SeriesInstanceUID] = series;
  });
}

/** Queued or downloading — the two states a job is still writing into the cache from. */
function _isActive(job: DownloadJob): boolean {
  return job.state === JOB_STATES.QUEUED || job.state === JOB_STATES.DOWNLOADING;
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

/**
 * The HTTP status behind a failure, wherever the thrower left it (#131 AR-3) -- this module, the
 * DICOMweb client, or SeriesArchiveRequestError's `details`. Absent is a real answer: a transport
 * error never had one, and the classifier treats it as retryable.
 */
function _httpStatus(error: any): number | undefined {
  const status = error?.status ?? error?.response?.status ?? error?.details?.status;
  return typeof status === 'number' ? status : undefined;
}

/**
 * How a per-instance failure should be treated (#131 FR-2, §5.1). Order is precedence. Everything
 * unrecognised is retryable: a retry costs one request, a wrong verdict costs an instance.
 */
function _classifyDownloadError(error: any): string {
  if (_isQuotaError(error)) {
    return DOWNLOAD_ERROR_CLASSES.QUOTA;
  }
  if (error?.name === 'AbortError') {
    return DOWNLOAD_ERROR_CLASSES.ABORT;
  }
  if (FATAL_INSTANCE_STATUSES.includes(_httpStatus(error) as number)) {
    return DOWNLOAD_ERROR_CLASSES.FATAL_INSTANCE;
  }
  return DOWNLOAD_ERROR_CLASSES.RETRYABLE;
}

/** The attempt budget a stored or user-supplied value resolves to (#131 FR-12). */
function _clampAttempts(attempts: any): number {
  const value = Math.round(Number(attempts));
  if (!Number.isFinite(value)) {
    return RETRY_ATTEMPTS_DEFAULT;
  }
  return Math.min(RETRY_ATTEMPTS_MAX, Math.max(RETRY_ATTEMPTS_MIN, value));
}

/**
 * The server identity a job records (#131 FR-7): a comparison key, not a config. Holds no
 * credentials, which is what makes it safe to persist alongside the job.
 */
function _wadoFingerprint(server: any): string | undefined {
  const root = server?.wadoRoot || server?.wadoUriRoot || server?.qidoRoot;
  return typeof root === 'string' && root ? root.replace(/\/+$/, '') : undefined;
}

const DownloadManagerService = new DownloadManagerServiceClass();

export {
  DownloadManagerService,
  EVENTS as DownloadManagerServiceEvents,
  JOB_STATES,
  // Archive-mode vocabulary (#129 AR-6). Distinct names, never `JOB_STATES` and never the export
  // queue's `ARCHIVE_JOB_STATES`.
  TRANSFER_MODES,
  SERIES_TRANSFER_STATES,
  // Retry vocabulary (#131). The bounds live here, with the code that clamps and applies them, so
  // the settings form and the service cannot drift apart on what "3 attempts" means.
  DOWNLOAD_ERROR_CLASSES,
  RETRY_ATTEMPTS_DEFAULT,
  RETRY_ATTEMPTS_MIN,
  RETRY_ATTEMPTS_MAX,
};
export default DownloadManagerService;
