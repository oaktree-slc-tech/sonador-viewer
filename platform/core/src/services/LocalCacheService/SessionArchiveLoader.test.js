// The session archive loader (imaging-development-env#103): what it registers, in what order it
// fetches, what it evicts when a study is left, and how browsing contexts share their claims.

jest.mock('./seriesArchiveTransfer', () => jest.fn());
jest.mock('../UserPreferencesService/UserPreferencesService', () => {
  const values = { studyArchiveLoading: true };
  const listeners = [];
  return {
    __esModule: true,
    STUDY_ARCHIVE_LOADING_PREFERENCE_KEY: 'studyArchiveLoading',
    UserPreferencesServiceEvents: { GENERAL_CHANGED: 'general-changed' },
    default: {
      getGeneral: key => values[key],
      subscribe: (event, listener) => {
        listeners.push(listener);
        return { unsubscribe: () => listeners.splice(listeners.indexOf(listener), 1) };
      },
      // What hydration or a Settings save does: set the value, then announce it
      _set(key, value) { values[key] = value; listeners.forEach(l => l({ key, value, hydrated: true })); },
      _values: values,
    },
  };
});

import LocalCacheService from './LocalCacheService';
import transferSeriesArchive from './seriesArchiveTransfer';
import UserPreferencesService from '../UserPreferencesService/UserPreferencesService';
import { isInstancePendingSync, isSeriesScheduledSync, whenInstanceAvailable } from './sessionArchiveRegistry';
import {
  CLAIM_STALE_MS,
  RELOAD_GRACE_MS,
  SESSION_CLAIMS_STORAGE_KEY,
  SessionArchiveLoaderClass,
} from './SessionArchiveLoader';

global.CustomEvent = global.CustomEvent || class CustomEvent {
  constructor(type, params = {}) { this.type = type; this.detail = params.detail; }
};
global.document = global.document || { body: { dispatchEvent: () => {} } };

// A localStorage for the claims document; `window` so the loader finds it
const store = new Map();
global.window = global.window || {};
global.window.localStorage = {
  getItem: key => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: key => store.delete(key),
};
global.window.sessionStorage = { getItem: () => null, setItem: () => {} };
// The Web Locks API, which the cache needs before the loader may create temporary copies
const makeLocks = () => {
  const chains = new Map();
  return {
    request: (name, options, callback) => {
      const previous = chains.get(name) || Promise.resolve();
      const run = previous.catch(() => undefined).then(callback);
      chains.set(name, run.catch(() => undefined));
      return run;
    },
  };
};
global.navigator = { locks: makeLocks() };

const STUDY = '1.2.3.1';
const OTHER_STUDY = '1.2.3.2';
const SERVER = { wadoRoot: 'http://server/dicom-web' };

// The viewer's instance objects: the naturalized dataset under `metadata`, the URLs beside it
const instance = (sop, SeriesInstanceUID, StudyInstanceUID = STUDY) => ({
  getData: () => ({
    metadata: { SOPInstanceUID: sop, SeriesInstanceUID, StudyInstanceUID, Modality: 'CT' },
    wadouri: `http://x/${sop}`,
    wadorsuri: `http://x/${sop}/frames/1`,
  }),
});
const series = (uid, sops) => ({
  getSeriesInstanceUID: () => uid,
  forEachInstance: cb => sops.forEach(sop => cb(instance(sop, uid))),
});
const study = (uid, seriesList) => ({
  getStudyInstanceUID: () => uid,
  forEachSeries: cb => seriesList.forEach(s => cb(s)),
});

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const claims = () => JSON.parse(store.get(SESSION_CLAIMS_STORAGE_KEY) || '{}');

let now;
let loader;
let pendingTransfers;

beforeEach(async () => {
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'debug').mockImplementation(() => {});
  store.clear();
  now = 1_000_000;
  pendingTransfers = [];
  transferSeriesArchive.mockReset();
  // Each transfer stores its series' instances as session copies and settles when told to
  transferSeriesArchive.mockImplementation(opts => new Promise(resolve => {
    pendingTransfers.push({ opts, resolve: async () => {
      for (const sop of Object.keys(opts.metadataBySOP)) {
        if (opts.isCancelled()) break;
        await LocalCacheService.putInstance({
          StudyInstanceUID: opts.StudyInstanceUID, SeriesInstanceUID: opts.SeriesInstanceUID, SOPInstanceUID: sop,
          bytes: new ArrayBuffer(8), metadata: opts.metadataBySOP[sop], session: opts.session,
        });
        opts.onInstanceStored?.({ StudyInstanceUID: opts.StudyInstanceUID, SeriesInstanceUID: opts.SeriesInstanceUID, SOPInstanceUID: sop });
      }
      resolve({ stored: 1, failed: 0, unmatched: 0, skipped: 0, bytesReceived: 8, totalBytes: 8, cancelled: opts.isCancelled() });
    } });
  }));
  UserPreferencesService._values.studyArchiveLoading = true;
  await LocalCacheService.ready();
  await LocalCacheService.clearAll();
  loader = new SessionArchiveLoaderClass({ now: () => now, tabId: 'tab-A' });
});

afterEach(async () => {
  // The real transfer settles when cancelled; the fake one has to be told to
  const closing = loader.closeAll();
  await Promise.all(pendingTransfers.map(t => t.resolve()));
  await closing;
  loader.stop();
  jest.restoreAllMocks();
});

describe('SessionArchiveLoader', () => {
  it('does nothing with the preference off, or without an archive-capable server', async () => {
    UserPreferencesService._values.studyArchiveLoading = false;
    expect(loader.registerStudy({ server: SERVER, studyMetadata: study(STUDY, [series('s1', ['a'])]) })).toBe(false);
    UserPreferencesService._values.studyArchiveLoading = true;
    expect(loader.registerStudy({ server: {}, studyMetadata: study(STUDY, [series('s1', ['a'])]) })).toBe(false);
    await flush();
    expect(transferSeriesArchive).not.toHaveBeenCalled();
    expect(isSeriesScheduledSync('s1')).toBe(false);
    expect(loader.isStudyOpen(STUDY)).toBe(false);
  });

  it('does nothing where the browser has no Web Locks API, whatever the preference says: temporary copies need the shared lock', async () => {
    const saved = global.navigator;
    global.navigator = {};
    try {
      expect(loader.isSupported()).toBe(false);
      expect(loader.registerStudy({ server: SERVER, studyMetadata: study(STUDY, [series('s1', ['a1'])]) })).toBe(false);
      await flush();
      expect(transferSeriesArchive).not.toHaveBeenCalled();
      expect(isSeriesScheduledSync('s1')).toBe(false);
      expect(console.info).toHaveBeenCalledWith(expect.stringContaining('no Web Locks API'));
    } finally {
      global.navigator = saved;
    }
  });

  it('does not take up a study already open when the preference turns on later: it applies to the next open', async () => {
    UserPreferencesService._values.studyArchiveLoading = false;
    loader.registerStudy({ server: SERVER, studyMetadata: study(STUDY, [series('s1', ['a1'])]) });
    UserPreferencesService._set('studyArchiveLoading', true);
    await flush();
    expect(transferSeriesArchive).not.toHaveBeenCalled();
    expect(isSeriesScheduledSync('s1')).toBe(false);
    // Registered again (the next open), it is fetched
    loader.registerStudy({ server: SERVER, studyMetadata: study(STUDY, [series('s1', ['a1'])]) });
    await flush();
    expect(pendingTransfers.map(t => t.opts.SeriesInstanceUID)).toEqual(['s1']);
  });

  it('a page going away shortens its claim to the reload grace: the same tab reopening within it keeps the copies, a tab that is gone is swept once it is over', async () => {
    // The pagehide handler the loader registers
    const listeners = {};
    global.window.addEventListener = (type, fn) => { listeners[type] = fn; };
    await loader.start();
    loader.registerStudy({ server: SERVER, studyMetadata: study(STUDY, [series('s1', ['a1'])]) });
    await flush();
    await pendingTransfers[0].resolve();
    await flush();
    expect(LocalCacheService.isInstanceCachedSync('a1')).toBe(true);
    listeners.pagehide();
    const claim = claims()['tab-A'];
    expect(claim.studies).toEqual([STUDY]);
    expect(now - claim.ts).toBe(CLAIM_STALE_MS - RELOAD_GRACE_MS);

    // The same tab starts again (a reload) within the grace: the copies survive the start-up sweep
    now += 5000;
    const reloaded = new SessionArchiveLoaderClass({ now: () => now, tabId: 'tab-A' });
    await reloaded.start();
    expect(LocalCacheService.isInstanceCachedSync('a1')).toBe(true);
    reloaded.registerStudy({ server: SERVER, studyMetadata: study(STUDY, [series('s1', ['a1'])]) });
    await flush();
    expect(transferSeriesArchive).toHaveBeenCalledTimes(1);
    await reloaded.closeAll();
    reloaded.stop();

    // Abandoned instead: once the shortened claim is stale, any start sweeps the copies
    await LocalCacheService.putInstance({ StudyInstanceUID: STUDY, SeriesInstanceUID: 's1', SOPInstanceUID: 'a1', bytes: new ArrayBuffer(8), metadata: {}, session: true });
    store.set(SESSION_CLAIMS_STORAGE_KEY, JSON.stringify({ 'tab-A': { ts: now - (CLAIM_STALE_MS - RELOAD_GRACE_MS), studies: [STUDY] } }));
    now += RELOAD_GRACE_MS + 1;
    const later = new SessionArchiveLoaderClass({ now: () => now, tabId: 'tab-Z' });
    expect(await later.sweepOrphans()).toEqual([STUDY]);
    expect(LocalCacheService.isInstanceCachedSync('a1')).toBe(false);
    later.stop();
    delete global.window.addEventListener;
  });

  it('the inherited claim survives the heartbeat of a reloaded tab that has not reopened the study yet, for the whole grace, and another tab honours it', async () => {
    await LocalCacheService.putInstance({ StudyInstanceUID: STUDY, SeriesInstanceUID: 's1', SOPInstanceUID: 'a1', bytes: new ArrayBuffer(8), metadata: {}, session: true });
    // The claim as pagehide left it
    store.set(SESSION_CLAIMS_STORAGE_KEY, JSON.stringify({ 'tab-A': { ts: now - (CLAIM_STALE_MS - RELOAD_GRACE_MS), studies: [STUDY] } }));
    const reloaded = new SessionArchiveLoaderClass({ now: () => now, tabId: 'tab-A' });
    await reloaded.start();
    expect(LocalCacheService.isInstanceCachedSync('a1')).toBe(true);

    // The heartbeat fires with nothing open here yet (the study is still waiting for its preferences)
    now += 20_000;
    reloaded._writeClaim();
    const other = new SessionArchiveLoaderClass({ now: () => now, tabId: 'tab-B' });
    expect(await other.sweepOrphans()).toEqual([]);
    expect(LocalCacheService.isInstanceCachedSync('a1')).toBe(true);

    // Once the grace is over the inherited claim is stale and the copies go
    now += 10_001;
    reloaded._writeClaim();
    expect(await other.sweepOrphans()).toEqual([STUDY]);
    expect(LocalCacheService.isInstanceCachedSync('a1')).toBe(false);
    expect(Object.keys(claims())).toEqual([]);
    reloaded.stop();
    other.stop();
  });

  it('a study reopened within the grace moves from the inherited claim to the live one; a claim pagehide never shortened still expires with the grace', async () => {
    store.set(SESSION_CLAIMS_STORAGE_KEY, JSON.stringify({ 'tab-A': { ts: now - 1000, studies: [STUDY, OTHER_STUDY] } }));
    const reloaded = new SessionArchiveLoaderClass({ now: () => now, tabId: 'tab-A' });
    await reloaded.start();
    expect(claims()['tab-A']).toBeUndefined();
    expect(claims()['tab-A.reload']).toEqual({ ts: now - (CLAIM_STALE_MS - RELOAD_GRACE_MS), studies: [STUDY, OTHER_STUDY] });

    reloaded.registerStudy({ server: SERVER, studyMetadata: study(STUDY, [series('s1', ['a1'])]) });
    expect(claims()['tab-A'].studies).toEqual([STUDY]);
    expect(claims()['tab-A.reload'].studies).toEqual([OTHER_STUDY]);
    now += RELOAD_GRACE_MS;
    reloaded._writeClaim();
    expect(claims()['tab-A.reload']).toBeUndefined();
    await reloaded.closeAll();
    reloaded.stop();
  });

  it('a close that finishes after the same study was reopened leaves the new session and its copies alone', async () => {
    loader.registerStudy({ server: SERVER, studyMetadata: study(STUDY, [series('s1', ['a1']), series('s2', ['b1'])]) });
    await flush();
    await pendingTransfers[0].resolve();
    await flush();
    expect(LocalCacheService.isInstanceCachedSync('a1')).toBe(true);

    // Leave while s2 is still in flight, then reopen before the old transfer settles
    const closing = loader.closeStudies([STUDY]);
    loader.registerStudy({ server: SERVER, studyMetadata: study(STUDY, [series('s1', ['a1']), series('s2', ['b1'])]) });
    await flush();
    await pendingTransfers[1].resolve();
    await closing;

    expect(loader.isStudyOpen(STUDY)).toBe(true);
    expect(LocalCacheService.isInstanceCachedSync('a1')).toBe(true);
    expect(isSeriesScheduledSync('s1')).toBe(true);
    // The reopened session fetched s2 again, since the old transfer was cancelled
    expect(pendingTransfers.map(t => t.opts.SeriesInstanceUID)).toEqual(['s1', 's2', 's2']);
  });

  it('registers every remote series, marks them local for getImageId, fetches two at a time with the displayed series first, and stores session copies', async () => {
    const registered = loader.registerStudy({
      server: SERVER,
      studyMetadata: study(STUDY, [series('s1', ['a1', 'a2']), series('s2', ['b1']), series('s3', ['c1'])]),
    });
    expect(registered).toBe(true);
    ['s1', 's2', 's3'].forEach(uid => expect(isSeriesScheduledSync(uid)).toBe(true));
    expect(claims()['tab-A'].studies).toEqual([STUDY]);

    // Two transfers start at once, in registration order, once the start-up sweep has settled
    await flush();
    expect(pendingTransfers.map(t => t.opts.SeriesInstanceUID)).toEqual(['s1', 's2']);
    // The owed instances are marked for the local reader to wait on
    expect(isInstancePendingSync('a1')).toBe(true);
    expect(isInstancePendingSync('c1')).toBe(false);
    expect(pendingTransfers[0].opts).toMatchObject({ server: SERVER, StudyInstanceUID: STUDY, session: true });
    expect(Object.keys(pendingTransfers[0].opts.metadataBySOP)).toEqual(['a1', 'a2']);
    // The transfer receives the naturalized datasets, which is what the cache stores as metadata
    expect(pendingTransfers[0].opts.metadataBySOP.a1).toEqual(expect.objectContaining({ SOPInstanceUID: 'a1', Modality: 'CT' }));

    // A fourth series registered later and then shown jumps the queue
    loader.registerStudy({ server: SERVER, studyMetadata: study(STUDY, [series('s4', ['d1'])]) });
    loader.prioritize('s4');
    const waited = whenInstanceAvailable('a1').then(() => 'a1 available');
    await pendingTransfers[0].resolve();
    await flush();
    expect(pendingTransfers.map(t => t.opts.SeriesInstanceUID)).toEqual(['s1', 's2', 's4']);
    // Stored members are released to whoever waits for them; nothing of s1 is owed any more
    expect(await waited).toBe('a1 available');
    expect(isInstancePendingSync('a2')).toBe(false);

    expect(LocalCacheService.isInstanceCachedSync('a1')).toBe(true);
    expect(LocalCacheService.isStudySavedSync(STUDY)).toBe(false);
    expect(LocalCacheService.hasSessionInstancesSync(STUDY)).toBe(true);
  });

  it('registers a series as its instances arrive, before its display sets are built', async () => {
    // The viewer's study loader hands over series with empty instance lists and fills them in later
    const empty = { getSeriesInstanceUID: () => 's1', forEachInstance: () => {} };
    expect(loader.registerStudy({ server: SERVER, studyMetadata: study(STUDY, [empty]) })).toBe(true);
    expect(transferSeriesArchive).not.toHaveBeenCalled();
    expect(isSeriesScheduledSync('s1')).toBe(false);
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('1 awaiting their instances'));

    // The instances land: the viewer registers the series before building its display sets
    expect(loader.registerSeries({ StudyInstanceUID: STUDY, seriesMetadata: series('s1', ['a1', 'a2']) })).toBe(true);
    expect(isSeriesScheduledSync('s1')).toBe(true);
    await flush();
    expect(pendingTransfers.map(t => t.opts.SeriesInstanceUID)).toEqual(['s1']);
    // Known series are not queued twice, and a study that is not open registers nothing
    expect(loader.registerSeries({ StudyInstanceUID: STUDY, seriesMetadata: series('s1', ['a1', 'a2']) })).toBe(false);
    expect(loader.registerSeries({ StudyInstanceUID: OTHER_STUDY, seriesMetadata: series('o1', ['x1']) })).toBe(false);
    expect(transferSeriesArchive).toHaveBeenCalledTimes(1);
  });

  it('accepts a bare dataset instance as well as the wrapped form', async () => {
    const bare = { getSeriesInstanceUID: () => 'b1', forEachInstance: cb => cb({ getData: () => ({ SOPInstanceUID: 'z1', SeriesInstanceUID: 'b1', wadouri: 'http://x/z1' }) }) };
    loader.registerStudy({ server: SERVER, studyMetadata: study(STUDY, [bare]) });
    await flush();
    expect(pendingTransfers.map(t => t.opts.SeriesInstanceUID)).toEqual(['b1']);
  });

  it('fetches nothing for a series the cache already holds in full, and skips a series without remote instances', async () => {
    await LocalCacheService.putInstance({ StudyInstanceUID: STUDY, SeriesInstanceUID: 's1', SOPInstanceUID: 'a1', bytes: new ArrayBuffer(8), metadata: {} });
    const local = { getSeriesInstanceUID: () => 'loc', forEachInstance: cb => cb({ getData: () => ({ SOPInstanceUID: 'l1', url: 'dicomfile:1' }) }) };
    loader.registerStudy({ server: SERVER, studyMetadata: study(STUDY, [series('s1', ['a1']), local, series('s2', ['b1'])]) });
    await flush();
    // The cached series is scheduled (its ids are local either way) but no archive is requested for it
    expect(pendingTransfers.map(t => t.opts.SeriesInstanceUID)).toEqual(['s2']);
    expect(isSeriesScheduledSync('s1')).toBe(true);
    expect(isSeriesScheduledSync('loc')).toBe(false);
  });

  it('decides what a series still needs only after the start-up sweep has settled', async () => {
    // Leftover session copies of this study from a context that is gone
    await LocalCacheService.putInstance({ StudyInstanceUID: STUDY, SeriesInstanceUID: 's1', SOPInstanceUID: 'a1', bytes: new ArrayBuffer(8), metadata: {}, session: true });
    store.set(SESSION_CLAIMS_STORAGE_KEY, JSON.stringify({ 'tab-old': { ts: now - CLAIM_STALE_MS - 1, studies: [STUDY] } }));
    // The sweep's removal of this study is slow, as hundreds of IndexedDB deletes are
    let finishRemoval;
    const original = LocalCacheService.removeSessionInstances.bind(LocalCacheService);
    jest.spyOn(LocalCacheService, 'removeSessionInstances').mockImplementation(async uid => {
      await new Promise(resolve => { finishRemoval = resolve; });
      return original(uid);
    });
    const starting = loader.start();
    await flush();
    expect(finishRemoval).toBeDefined();
    // The study opens while the removal is in flight: the series looks cached right now
    loader.registerStudy({ server: SERVER, studyMetadata: study(STUDY, [series('s1', ['a1'])]) });
    await flush();
    expect(transferSeriesArchive).not.toHaveBeenCalled();
    finishRemoval();
    await starting;
    await flush();
    // The transfer decided after the sweep: the leftover is gone, so the series is fetched
    expect(LocalCacheService.isInstanceCachedSync('a1')).toBe(false);
    expect(pendingTransfers.map(t => t.opts.SeriesInstanceUID)).toEqual(['s1']);
  });

  it('keeps the leftover copies of a study that is already open when the sweep reaches it', async () => {
    await LocalCacheService.putInstance({ StudyInstanceUID: STUDY, SeriesInstanceUID: 's1', SOPInstanceUID: 'a1', bytes: new ArrayBuffer(8), metadata: {}, session: true });
    loader.registerStudy({ server: SERVER, studyMetadata: study(STUDY, [series('s1', ['a1'])]) });
    await loader.start();
    await flush();
    expect(LocalCacheService.isInstanceCachedSync('a1')).toBe(true);
    expect(transferSeriesArchive).not.toHaveBeenCalled();
  });

  it('keeps the session copies this same context claimed before a reload, for the grace period', async () => {
    await LocalCacheService.putInstance({ StudyInstanceUID: STUDY, SeriesInstanceUID: 's1', SOPInstanceUID: 'a1', bytes: new ArrayBuffer(8), metadata: {}, session: true });
    store.set(SESSION_CLAIMS_STORAGE_KEY, JSON.stringify({ 'tab-A': { ts: now - 1000, studies: [STUDY] } }));
    await loader.start();
    expect(LocalCacheService.isInstanceCachedSync('a1')).toBe(true);
    // Reopened straight away: nothing is fetched again
    loader.registerStudy({ server: SERVER, studyMetadata: study(STUDY, [series('s1', ['a1'])]) });
    await flush();
    expect(transferSeriesArchive).not.toHaveBeenCalled();
    // Without the allowance (the grace period over, the study not open) the copies go
    await loader.closeStudies([STUDY]);
    expect(LocalCacheService.isInstanceCachedSync('a1')).toBe(false);
  });

  it('leaving a study cancels its transfers, unmarks its series and evicts its session copies, keeping what was saved', async () => {
    await LocalCacheService.putInstance({ StudyInstanceUID: STUDY, SeriesInstanceUID: 's0', SOPInstanceUID: 'saved', bytes: new ArrayBuffer(8), metadata: {} });
    loader.registerStudy({ server: SERVER, studyMetadata: study(STUDY, [series('s1', ['a1']), series('s2', ['b1']), series('s3', ['c1'])]) });
    await flush();
    await pendingTransfers[0].resolve();
    await flush();
    expect(LocalCacheService.isInstanceCachedSync('a1')).toBe(true);

    // s1 done, so s3 has taken the second slot beside s2
    expect(pendingTransfers.map(t => t.opts.SeriesInstanceUID)).toEqual(['s1', 's2', 's3']);

    const closing = loader.closeStudies([STUDY]);
    // The transfers still running see the cancellation and settle without storing; nothing stays owed
    expect(pendingTransfers[1].opts.isCancelled()).toBe(true);
    expect(pendingTransfers[2].opts.isCancelled()).toBe(true);
    expect(isInstancePendingSync('b1')).toBe(false);
    await Promise.all(pendingTransfers.slice(1).map(t => t.resolve()));
    await closing;

    expect(LocalCacheService.isInstanceCachedSync('a1')).toBe(false);
    expect(LocalCacheService.isInstanceCachedSync('b1')).toBe(false);
    expect(LocalCacheService.isInstanceCachedSync('c1')).toBe(false);
    expect(LocalCacheService.isInstanceCachedSync('saved')).toBe(true);
    expect(LocalCacheService.isStudySavedSync(STUDY)).toBe(true);
    ['s1', 's2', 's3'].forEach(uid => expect(isSeriesScheduledSync(uid)).toBe(false));
    expect(claims()['tab-A']).toBeUndefined();
  });

  it('keeps the session copies while another live context claims the study, and sweeps them once that claim is stale', async () => {
    loader.registerStudy({ server: SERVER, studyMetadata: study(STUDY, [series('s1', ['a1'])]) });
    await flush();
    await pendingTransfers[0].resolve();
    await flush();
    // Another tab shows the same study
    store.set(SESSION_CLAIMS_STORAGE_KEY, JSON.stringify({
      ...claims(), 'tab-B': { ts: now, studies: [STUDY] },
    }));
    await loader.closeStudies([STUDY]);
    expect(LocalCacheService.isInstanceCachedSync('a1')).toBe(true);

    // Later, with tab-B gone quiet, a fresh start sweeps the leftovers
    now += CLAIM_STALE_MS + 1;
    const fresh = new SessionArchiveLoaderClass({ now: () => now, tabId: 'tab-C' });
    expect(await fresh.sweepOrphans()).toEqual([STUDY]);
    expect(LocalCacheService.isInstanceCachedSync('a1')).toBe(false);
    fresh.stop();
  });

  it('a study saved offline while open is left in place when the viewer leaves it', async () => {
    loader.registerStudy({ server: SERVER, studyMetadata: study(STUDY, [series('s1', ['a1'])]) });
    await flush();
    await pendingTransfers[0].resolve();
    await flush();
    // What DownloadManagerService does when its job for the study completes
    await LocalCacheService.markSaved(STUDY);
    await loader.closeStudies([STUDY]);
    expect(LocalCacheService.isInstanceCachedSync('a1')).toBe(true);
    expect(LocalCacheService.isStudySavedSync(STUDY)).toBe(true);
  });

  it('a transfer that fails leaves the series local and logs; the other studies are unaffected', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    transferSeriesArchive.mockImplementationOnce(() => Promise.reject(new Error('HTTP 500')));
    loader.registerStudy({ server: SERVER, studyMetadata: study(STUDY, [series('s1', ['a1'])]) });
    loader.registerStudy({ server: SERVER, studyMetadata: study(OTHER_STUDY, [{ getSeriesInstanceUID: () => 'o1', forEachInstance: cb => cb(instance('x1', 'o1', OTHER_STUDY)) }]) });
    await flush();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('s1 could not be fetched'), expect.any(Error));
    expect(isSeriesScheduledSync('s1')).toBe(true);
    // The failed archive owes nothing any more: the reader may fetch a1 itself
    expect(isInstancePendingSync('a1')).toBe(false);
    expect(pendingTransfers.map(t => t.opts.SeriesInstanceUID)).toEqual(['o1']);
    warn.mockRestore();
  });
});
