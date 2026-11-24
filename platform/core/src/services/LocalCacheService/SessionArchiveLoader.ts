// Archive-based study loading (imaging-development-env#103).
//
// With the "Open studies as per-series archives" preference on, a study the viewer opens has each
// of its series fetched as ONE server-built archive into the local cache -- the transfer the
// offline-storage feature uses (seriesArchiveTransfer) -- instead of one request per image. The
// series on screen is fetched first, the rest in the background, two at a time. The images of a
// registered series get `sonadorlocal:` ids up front (sessionArchiveRegistry, consulted by
// getImageId); while a series' archive is in flight the local reader WAITS for an instance that
// archive still owes (`whenInstanceAvailable`) rather than requesting it per instance, and the
// instances are released -- to the cache when stored, to the per-instance request when the archive
// fails, is cancelled or the study is left. Thumbnails are the exception: their one preview image is
// fetched at once over the per-instance route. The preference is read when a study is registered:
// a study already open when it turns on is not affected.
//
// The copy lasts for the session. Every instance is stored with the cache's `session` marker, so
// the saved-copy queries ignore it, and it is evicted when the viewer leaves the study -- unless
// another browsing context still shows that study, or an offline transfer has since promoted the
// instances to a saved copy (DownloadManagerService marks them when its job completes). A context
// that goes away without leaving cleanly (a closed tab, a reload mid-session) leaves its session
// instances behind; the next start of any context sweeps those whose claims have gone stale.
//
// Browsing contexts coordinate through one localStorage document of claims, `{ tabId: { ts,
// studies } }`, refreshed by a heartbeat: the cache itself has no cross-tab channel. A reloading
// tab's previous claim is kept aside for the reload grace (`_inheritClaim`).

import LocalCacheService from './LocalCacheService';
import transferSeriesArchive from './seriesArchiveTransfer';
import {
  clearScheduledSeries,
  markInstancesPending,
  releasePendingInstance,
  releasePendingInstances,
  scheduleSeries,
  unscheduleSeries,
} from './sessionArchiveRegistry';
import UserPreferencesService, {
  STUDY_ARCHIVE_LOADING_PREFERENCE_KEY,
} from '../UserPreferencesService/UserPreferencesService';

// Series archives in flight at once: the offline job's own archive concurrency (#129 AR-10).
export const SESSION_ARCHIVE_CONCURRENCY = 2;

export const SESSION_CLAIMS_STORAGE_KEY = 'sonador.sessionArchiveLoader.claims';
const TAB_ID_STORAGE_KEY = 'sonador.sessionArchiveLoader.tabId';
// The claim a context left before a reload is set aside under this suffix at start, so the
// heartbeat neither drops nor refreshes it (see _inheritClaim)
const INHERITED_CLAIM_SUFFIX = '.reload';
export const CLAIM_HEARTBEAT_MS = 20 * 1000;
// A claim not refreshed for this long belongs to a context that is gone
export const CLAIM_STALE_MS = 60 * 1000;
// A reload keeps this context's id. Its previous claim is honoured for this long after the start, so a
// study reopened straight away keeps the session copies it already had; the sweep then runs again
// without that allowance and evicts what was not reopened.
export const RELOAD_GRACE_MS = 30 * 1000;

const PRIORITY_DISPLAYED = 0;
const PRIORITY_BACKGROUND = 1;

interface SeriesTask {
  StudyInstanceUID: string;
  SeriesInstanceUID: string;
  /** Instance metadata of the series as the viewer holds it, keyed by SOPInstanceUID */
  metadataBySOP: Record<string, any>;
  priority: number;
  order: number;
  state: 'queued' | 'running' | 'done';
  cancelled: boolean;
  controller: AbortController | null;
  settled: Promise<void> | null;
}

interface Claims {
  [tabId: string]: { ts: number; studies: string[] };
}

interface StudyLike {
  getStudyInstanceUID: () => string;
  forEachSeries: (callback: (series: SeriesLike) => void) => void;
}

interface SeriesLike {
  getSeriesInstanceUID: () => string;
  forEachInstance: (callback: (instance: any) => void) => void;
}

function _storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch (error) {
    return null;
  }
}

function _sessionStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch (error) {
    return null;
  }
}

function _randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function _instanceData(instance: any): any {
  return instance && typeof instance.getData === 'function' ? instance.getData() : instance;
}

// The viewer's instance objects wrap the naturalized dataset: `{ metadata: <dataset>, wadouri,
// wadorsuri, ... }` (studies/services/wado/studyInstanceHelpers). The UIDs live in the dataset, and
// the dataset is what the cache stores as an instance's metadata. A bare dataset is accepted too.
function _instanceDataset(data: any): any {
  return data && data.metadata && typeof data.metadata === 'object' ? data.metadata : data;
}

function _sopInstanceUID(data: any): string | undefined {
  const dataset = _instanceDataset(data);
  return (
    (dataset && (dataset.SOPInstanceUID || dataset.SopInstanceUID)) ||
    (data && (data.SOPInstanceUID || data.SopInstanceUID)) ||
    undefined
  );
}

function _isRemote(data: any): boolean {
  return !!(data && (data.wadouri || data.wadorsuri));
}

export class SessionArchiveLoaderClass {
  private _started = false;
  // Settles once the start-up sweep is over: a transfer decides what it still has to fetch only
  // after that, or a copy the sweep is about to remove could pass for one already there
  private _sweepSettled: Promise<void> = Promise.resolve();
  private _graceTimer: ReturnType<typeof setTimeout> | null = null;
  private _tabId: string;
  private _heartbeat: ReturnType<typeof setInterval> | null = null;
  private _now: () => number;

  private _open = new Set<string>();
  private _servers = new Map<string, any>();
  // Per study, bumped each time it is registered: a close that finishes after the same study was
  // reopened must not evict the new session's copies or release its resources
  private _generation = new Map<string, number>();
  private _tasks = new Map<string, SeriesTask>();
  private _queue: SeriesTask[] = [];
  private _running = 0;
  private _order = 0;

  /**
   * @param options.now - clock, for the claim timestamps (tests)
   * @param options.tabId - this context's claim id (tests); otherwise kept in sessionStorage so a
   *   reload keeps the same claim
   */
  constructor({ now = () => Date.now(), tabId }: { now?: () => number; tabId?: string } = {}) {
    this._now = now;
    this._tabId = tabId || this._resolveTabId();
  }

  create() {
    return this;
  }

  /** Whether the preference is on: read when a study is registered, so a change affects the next open. */
  isEnabled(): boolean {
    return UserPreferencesService.getGeneral(STUDY_ARCHIVE_LOADING_PREFERENCE_KEY) === true;
  }

  /**
   * Whether the browser can hold temporary copies safely: the cache tells saved copies from
   * temporary ones under a lock shared between browsing contexts (the Web Locks API), and without
   * that lock a temporary copy of one tab could be removed while another tab saves it. Where the
   * API is absent, archive loading stays off whatever the preference says.
   */
  isSupported(): boolean {
    return LocalCacheService.hasSharedLock();
  }

  /**
   * Start the claim heartbeat and sweep the session instances left behind by contexts that are
   * gone. Called once at application start, after the cache is wired.
   */
  async start(): Promise<void> {
    if (this._started) {
      return;
    }
    this._started = true;
    console.info(
      `[SessionArchiveLoader] Started; archive loading preference is ${this.isEnabled() ? 'on' : 'off (or not yet hydrated)'}` +
        (this.isSupported() ? '.' : '; unavailable here, the browser has no Web Locks API.')
    );
    if (typeof setInterval === 'function') {
      this._heartbeat = setInterval(() => this._writeClaim(), CLAIM_HEARTBEAT_MS);
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
      // As the page goes away the claim is not dropped but shortened to the reload grace: a reload
      // that reopens the study within it keeps the copies, a tab that is gone sees them swept once
      // the shortened claim is stale (an eviction cannot run to completion from here)
      window.addEventListener('pagehide', () => this._expireClaimAfterGrace());
    }
    // This context's own claim from before a reload is honoured for the grace period, then the
    // sweep runs once more without it
    this._inheritClaim();
    const sweep = (async () => {
      try {
        await LocalCacheService.ready();
        await this.sweepOrphans({ honourOwnClaim: true });
      } catch (error) {
        console.warn('[SessionArchiveLoader] Start-up sweep failed.', error);
      }
    })();
    this._sweepSettled = sweep;
    if (typeof setTimeout === 'function') {
      this._graceTimer = setTimeout(() => {
        this._graceTimer = null;
        this._sweepSettled = this.sweepOrphans().then(() => undefined).catch(() => undefined);
      }, RELOAD_GRACE_MS);
    }
    await sweep;
  }

  stop(): void {
    if (this._heartbeat) {
      clearInterval(this._heartbeat);
      this._heartbeat = null;
    }
    if (this._graceTimer) {
      clearTimeout(this._graceTimer);
      this._graceTimer = null;
    }
    this._started = false;
  }

  /**
   * Remove the session instances no live context claims. Runs at start; harmless at any time.
   * With `honourOwnClaim`, the studies this context claimed before a reload are kept as well.
   */
  async sweepOrphans({ honourOwnClaim = false }: { honourOwnClaim?: boolean } = {}): Promise<string[]> {
    const swept: string[] = [];
    const own = honourOwnClaim ? this._ownClaimedStudies() : new Set<string>();
    for (const StudyInstanceUID of LocalCacheService.getSessionStudyUIDsSync()) {
      if (
        this._open.has(StudyInstanceUID) ||
        own.has(StudyInstanceUID) ||
        this._claimedElsewhere(StudyInstanceUID)
      ) {
        continue;
      }
      try {
        await LocalCacheService.removeSessionInstances(StudyInstanceUID);
        swept.push(StudyInstanceUID);
      } catch (error) {
        console.warn(`[SessionArchiveLoader] Could not sweep session instances of ${StudyInstanceUID}.`, error);
      }
    }
    return swept;
  }

  /**
   * A study the viewer is opening. Registers its series for archive fetching -- before its display
   * sets are built, so their image ids come out local -- and starts the transfers in the
   * background. Idempotent: called again when more series of the study load. Returns whether the
   * study is being fetched this way (false with the preference off, or no archive-capable server).
   */
  registerStudy({ server, studyMetadata }: { server: any; studyMetadata: StudyLike }): boolean {
    const StudyInstanceUID = studyMetadata?.getStudyInstanceUID?.();
    if (!StudyInstanceUID) {
      return false;
    }
    if (!server || !server.wadoRoot) {
      console.info(
        `[SessionArchiveLoader] Study ${StudyInstanceUID} is not fetched as archives: the server has no DICOMweb root.`
      );
      return false;
    }
    if (!this.isSupported()) {
      console.info(
        `[SessionArchiveLoader] Study ${StudyInstanceUID} is not fetched as archives: the browser has no Web Locks API.`
      );
      return false;
    }
    if (!this.isEnabled()) {
      // Read when the study opens (the viewer waits for preference hydration before loading a
      // study); a study already open when the preference turns on is not affected, as the Settings
      // confirmation says
      console.info(`[SessionArchiveLoader] Study ${StudyInstanceUID} opened with archive loading off.`);
      return false;
    }
    if (!this._open.has(StudyInstanceUID)) {
      this._generation.set(StudyInstanceUID, (this._generation.get(StudyInstanceUID) || 0) + 1);
    }
    this._open.add(StudyInstanceUID);
    this._servers.set(StudyInstanceUID, server);
    this._releaseInheritedClaim(StudyInstanceUID);
    this._writeClaim();

    const counts = { queued: 0, awaiting: 0, skipped: 0, known: 0 };
    studyMetadata.forEachSeries(series => {
      counts[this._registerSeries(StudyInstanceUID, series)] += 1;
    });

    if (counts.queued || counts.awaiting || counts.skipped) {
      console.info(
        `[SessionArchiveLoader] Study ${StudyInstanceUID}: ${counts.queued} series queued for archive fetching` +
          (counts.awaiting ? `, ${counts.awaiting} awaiting their instances` : '') +
          (counts.skipped ? `, ${counts.skipped} skipped (no remote instances)` : '') +
          '.'
      );
    }
    this._pump();
    return true;
  }

  /**
   * One series of an open study whose instances have just arrived. The viewer's study loader
   * delivers series one at a time and builds each one's display sets as soon as it lands, so this
   * runs before those display sets memoise their image ids. A study that is not open here (the
   * preference was off, or it is deferred until the preference lands) is handled wholesale by
   * `registerStudy` when the time comes; its live metadata then carries the instances.
   */
  registerSeries({ StudyInstanceUID, seriesMetadata }: { StudyInstanceUID: string; seriesMetadata: SeriesLike }): boolean {
    if (!StudyInstanceUID || !seriesMetadata || !this._open.has(StudyInstanceUID)) {
      return false;
    }
    const outcome = this._registerSeries(StudyInstanceUID, seriesMetadata);
    if (outcome === 'queued') {
      this._pump();
    }
    return outcome === 'queued';
  }

  /** Queue one series: 'queued', 'awaiting' (no instances yet), 'skipped' (no remote instances), 'known'. */
  private _registerSeries(StudyInstanceUID: string, series: SeriesLike): 'queued' | 'awaiting' | 'skipped' | 'known' {
    const SeriesInstanceUID = series.getSeriesInstanceUID();
    if (!SeriesInstanceUID || this._tasks.has(SeriesInstanceUID)) {
      return 'known';
    }
    const metadataBySOP: Record<string, any> = {};
    let remote = false;
    series.forEachInstance(instance => {
      const data = _instanceData(instance);
      const sop = _sopInstanceUID(data);
      if (sop) {
        metadataBySOP[sop] = _instanceDataset(data);
        remote = remote || _isRemote(data);
      }
    });
    const sops = Object.keys(metadataBySOP);
    if (!sops.length) {
      // The series-level loader has not delivered this series yet: registerSeries will
      return 'awaiting';
    }
    // Nothing to fetch for a series with no remote instances (a local file load). A series the cache
    // already holds is queued all the same: what it still needs is decided when its transfer runs,
    // once the start-up sweep has settled, not now while that sweep may be removing the copies.
    if (!remote) {
      console.debug(`[SessionArchiveLoader] Series ${SeriesInstanceUID} has no remote instances; left to its own loader.`);
      return 'skipped';
    }
    const task: SeriesTask = {
      StudyInstanceUID,
      SeriesInstanceUID,
      metadataBySOP,
      priority: PRIORITY_BACKGROUND,
      order: this._order++,
      state: 'queued',
      cancelled: false,
      controller: null,
      settled: null,
    };
    this._tasks.set(SeriesInstanceUID, task);
    this._queue.push(task);
    scheduleSeries(SeriesInstanceUID);
    console.debug(`[SessionArchiveLoader] Series ${SeriesInstanceUID} queued for archive fetching (${sops.length} instance(s)).`);
    return 'queued';
  }

  /** A series has come on screen: fetch it before the ones still waiting. */
  prioritize(SeriesInstanceUID: string): void {
    const task = SeriesInstanceUID ? this._tasks.get(SeriesInstanceUID) : undefined;
    if (task && task.state === 'queued' && task.priority !== PRIORITY_DISPLAYED) {
      task.priority = PRIORITY_DISPLAYED;
      this._pump();
    }
  }

  /** Whether the study is open in this context and being fetched as archives. */
  isStudyOpen(StudyInstanceUID: string): boolean {
    return this._open.has(StudyInstanceUID);
  }

  /**
   * The viewer has left these studies. Their transfers stop, their series stop being local by
   * default, and their session instances are evicted -- unless another live context still claims
   * the study. Instances an offline transfer promoted meanwhile are not session instances any more
   * and stay.
   */
  async closeStudies(studyInstanceUIDs: string[]): Promise<void> {
    const uids = (studyInstanceUIDs || []).filter(uid => uid && this._open.has(uid));
    if (!uids.length) {
      return;
    }
    const closingGeneration = new Map(uids.map(uid => [uid, this._generation.get(uid) || 0]));
    const settling: Promise<void>[] = [];
    uids.forEach(StudyInstanceUID => {
      this._open.delete(StudyInstanceUID);
      this._servers.delete(StudyInstanceUID);
      this._tasks.forEach((task, SeriesInstanceUID) => {
        if (task.StudyInstanceUID !== StudyInstanceUID) {
          return;
        }
        task.cancelled = true;
        releasePendingInstances(Object.keys(task.metadataBySOP));
        if (task.controller) {
          try {
            task.controller.abort();
          } catch (error) {
            // An already-settled request
          }
        }
        if (task.settled) {
          settling.push(task.settled);
        }
        this._tasks.delete(SeriesInstanceUID);
        unscheduleSeries(SeriesInstanceUID);
      });
    });
    this._queue = this._queue.filter(task => !task.cancelled);
    this._writeClaim();

    // A member mid-store when the cancel landed finishes first, so the eviction sees it
    await Promise.all(settling);

    for (const StudyInstanceUID of uids) {
      // Reopened while the old transfers settled: the new session owns the copies now
      if (
        this._open.has(StudyInstanceUID) ||
        this._generation.get(StudyInstanceUID) !== closingGeneration.get(StudyInstanceUID)
      ) {
        continue;
      }
      if (this._claimedElsewhere(StudyInstanceUID)) {
        continue;
      }
      if (!LocalCacheService.hasSessionInstancesSync(StudyInstanceUID)) {
        continue;
      }
      try {
        await LocalCacheService.removeSessionInstances(StudyInstanceUID);
      } catch (error) {
        console.warn(`[SessionArchiveLoader] Could not evict session instances of ${StudyInstanceUID}.`, error);
      }
    }
  }

  /** Every study open here is left: for tests and for a full teardown. */
  async closeAll(): Promise<void> {
    await this.closeStudies(Array.from(this._open));
    clearScheduledSeries();
  }

  // ---- Transfers --------------------------------------------------------------------------------

  private _pump(): void {
    while (this._running < SESSION_ARCHIVE_CONCURRENCY && this._queue.length) {
      this._queue.sort((a, b) => a.priority - b.priority || a.order - b.order);
      const task = this._queue.shift()!;
      if (task.cancelled) {
        continue;
      }
      this._running += 1;
      task.state = 'running';
      task.settled = this._runTask(task).finally(() => {
        this._running -= 1;
        task.state = 'done';
        this._pump();
      });
    }
  }

  private async _runTask(task: SeriesTask): Promise<void> {
    // Not before the start-up sweep is over: it may be removing the very copies that would otherwise
    // read as already here
    await this._sweepSettled;
    const server = this._servers.get(task.StudyInstanceUID);
    if (!server || task.cancelled) {
      return;
    }
    const sops = Object.keys(task.metadataBySOP);
    const alreadyCached = new Set<string>(sops.filter(sop => LocalCacheService.isInstanceCachedSync(sop)));
    if (alreadyCached.size === sops.length) {
      console.debug(`[SessionArchiveLoader] Series ${task.SeriesInstanceUID} is already cached in full.`);
      return;
    }
    const owed = sops.filter(sop => !alreadyCached.has(sop));
    console.debug(
      `[SessionArchiveLoader] Fetching series ${task.SeriesInstanceUID} of study ${task.StudyInstanceUID} as an archive ` +
        `(${owed.length} instance(s) to store).`
    );
    // The local reader waits for these rather than fetching them itself while the archive is in flight
    markInstancesPending(owed);
    try {
      await transferSeriesArchive({
        server,
        StudyInstanceUID: task.StudyInstanceUID,
        SeriesInstanceUID: task.SeriesInstanceUID,
        metadataBySOP: task.metadataBySOP,
        alreadyCached,
        session: true,
        isCancelled: () => task.cancelled,
        onRequestStarted: controller => {
          task.controller = controller;
        },
        onInstanceStored: ({ SOPInstanceUID }) => releasePendingInstance(SOPInstanceUID),
      });
    } catch (error) {
      if (!task.cancelled) {
        // The images of this series keep loading one request at a time, as they would without
        // the preference: the local ids fall back per instance
        console.warn(
          `[SessionArchiveLoader] Series ${task.SeriesInstanceUID} could not be fetched as an archive; ` +
            'its images load individually.',
          error
        );
      }
    } finally {
      // Whatever the archive did not deliver is released to the per-instance route
      releasePendingInstances(owed);
    }
  }

  // ---- Claims shared between browsing contexts ---------------------------------------------------

  private _resolveTabId(): string {
    const storage = _sessionStorage();
    try {
      const existing = storage && storage.getItem(TAB_ID_STORAGE_KEY);
      if (existing) {
        return existing;
      }
      const created = _randomId();
      if (storage) {
        storage.setItem(TAB_ID_STORAGE_KEY, created);
      }
      return created;
    } catch (error) {
      return _randomId();
    }
  }

  private _readClaims(): Claims {
    const storage = _storage();
    if (!storage) {
      return {};
    }
    try {
      const raw = storage.getItem(SESSION_CLAIMS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  private _writeClaims(claims: Claims): void {
    const storage = _storage();
    if (!storage) {
      return;
    }
    try {
      storage.setItem(SESSION_CLAIMS_STORAGE_KEY, JSON.stringify(claims));
    } catch (error) {
      // Storage full or blocked: the claim is best effort; the sweep errs on the side of keeping
    }
  }

  /**
   * Refresh this context's claim on the studies it has open; drop the stale claims of others. The
   * claim this context inherited at start (`_inheritClaim`) is another key and is neither refreshed
   * nor dropped here while it is live: it expires on its own once the reload grace is over.
   */
  private _writeClaim(): void {
    const claims = this._readClaims();
    const now = this._now();
    Object.keys(claims).forEach(tabId => {
      if (tabId !== this._tabId && !this._isLive(claims[tabId], now)) {
        delete claims[tabId];
      }
    });
    if (this._open.size) {
      claims[this._tabId] = { ts: now, studies: Array.from(this._open) };
    } else {
      delete claims[this._tabId];
    }
    this._writeClaims(claims);
  }

  /**
   * Shorten this context's claim so it stays live for the reload grace and no longer: a reload of
   * the same tab honours it at start (`sweepOrphans({ honourOwnClaim })`), and a tab that has gone
   * for good leaves a claim that is stale once the grace is over.
   */
  private _expireClaimAfterGrace(): void {
    const claims = this._readClaims();
    const claim = claims[this._tabId];
    if (!claim) {
      return;
    }
    claim.ts = this._now() - (CLAIM_STALE_MS - RELOAD_GRACE_MS);
    this._writeClaims(claims);
  }

  /**
   * At start, the claim this context wrote before a reload is set aside under its own key, with a
   * timestamp that makes it stale once the reload grace is over -- whether or not `pagehide` had
   * shortened it. Until then every context, this one included, treats the studies it names as
   * claimed, and the heartbeat, which writes only the studies open here, cannot drop them: a tab
   * that reloads and takes a while to reopen its study (preference hydration, a slow start) keeps the
   * copies for the whole grace. A study reopened within it moves to the live claim
   * (`_releaseInheritedClaim`); what is not reopened is swept once the key is stale.
   */
  private _inheritClaim(): void {
    const claims = this._readClaims();
    const claim = claims[this._tabId];
    if (!claim) {
      return;
    }
    delete claims[this._tabId];
    const now = this._now();
    if (this._isLive(claim, now) && Array.isArray(claim.studies) && claim.studies.length) {
      claims[this._tabId + INHERITED_CLAIM_SUFFIX] = {
        ts: Math.min(claim.ts, now - (CLAIM_STALE_MS - RELOAD_GRACE_MS)),
        studies: claim.studies,
      };
    }
    this._writeClaims(claims);
  }

  /** A study of the inherited claim is open here now: the live claim covers it from here on. */
  private _releaseInheritedClaim(StudyInstanceUID: string): void {
    const claims = this._readClaims();
    const key = this._tabId + INHERITED_CLAIM_SUFFIX;
    const inherited = claims[key];
    if (!inherited || !Array.isArray(inherited.studies) || !inherited.studies.includes(StudyInstanceUID)) {
      return;
    }
    inherited.studies = inherited.studies.filter(uid => uid !== StudyInstanceUID);
    if (!inherited.studies.length) {
      delete claims[key];
    }
    this._writeClaims(claims);
  }

  private _isLive(claim: { ts: number; studies: string[] } | undefined, now: number): boolean {
    return !!claim && typeof claim.ts === 'number' && now - claim.ts < CLAIM_STALE_MS;
  }

  /** The studies this context's inherited, still-live claim names (from before a reload). */
  private _ownClaimedStudies(): Set<string> {
    const claim = this._readClaims()[this._tabId + INHERITED_CLAIM_SUFFIX];
    return new Set(this._isLive(claim, this._now()) && Array.isArray(claim!.studies) ? claim!.studies : []);
  }

  /** Whether another live context claims the study. */
  private _claimedElsewhere(StudyInstanceUID: string): boolean {
    const claims = this._readClaims();
    const now = this._now();
    return Object.keys(claims).some(
      tabId =>
        tabId !== this._tabId &&
        this._isLive(claims[tabId], now) &&
        Array.isArray(claims[tabId].studies) &&
        claims[tabId].studies.includes(StudyInstanceUID)
    );
  }
}

const SessionArchiveLoader = new SessionArchiveLoaderClass();

export default SessionArchiveLoader;
export { SessionArchiveLoader };
