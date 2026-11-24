// Unit tests for LocalCacheService's index bookkeeping (ohif-viewers#125).
//
// jsdom provides no `indexedDB`, so the service constructor takes its documented degraded path:
// no idb-keyval stores are created and every persistence call is skipped. What remains is exactly
// the synchronous in-memory logic the render paths depend on (getImageId cannot await), which is
// what these tests exercise: membership sets, byte accounting, summaries, search, and events.
// Byte round-trips through real IndexedDB were verified separately with a Node harness.

import LocalCacheService from './LocalCacheService';

// Jest 29 runs in a node environment (jest-environment-jsdom is not installed in this repo).
// PubSubService._broadcastEvent additionally mirrors every event onto `document.body` as a
// CustomEvent; shim just enough of that for broadcasts to run — subscriber callbacks themselves
// are plain function calls and need no DOM. (Import-time service construction does not broadcast,
// so ordering after the import is safe.)
global.CustomEvent = global.CustomEvent || class CustomEvent {
  constructor(type, params = {}) {
    this.type = type;
    this.detail = params.detail;
  }
};
global.document = global.document || { body: { dispatchEvent: () => {} } };

const STUDY = '1.2.826.0.1.999.1';

/** Poll until `predicate` holds, so a test never depends on a fixed number of microtask turns. */
async function waitFor(predicate, label = 'condition') {
  for (let i = 0; i < 200; i += 1) {
    if (predicate()) return;
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  throw new Error(`Timed out waiting for ${label}`);
}
const SERIES_A = '1.2.826.0.1.999.1.1';
const SERIES_B = '1.2.826.0.1.999.1.2';

function makeInstance(SOPInstanceUID, { SeriesInstanceUID = SERIES_A, byteLength = 100, metadata = {} } = {}) {
  return {
    StudyInstanceUID: STUDY,
    SeriesInstanceUID,
    SOPInstanceUID,
    bytes: new ArrayBuffer(byteLength),
    metadata: {
      StudyInstanceUID: STUDY,
      SeriesInstanceUID,
      SOPInstanceUID,
      // Naturalized PN values arrive as an ARRAY of person-name objects.
      PatientName: [{ Alphabetic: 'Doe^Jane' }],
      PatientID: 'PID-1',
      StudyDescription: 'CT CHEST W/O CONTRAST',
      AccessionNumber: 'ACC-9',
      ServiceEpisodeID: 'SEID-42',
      SeriesDescription: 'Axial 2mm',
      SeriesNumber: 1,
      Modality: 'CT',
      ...metadata,
    },
  };
}

describe('LocalCacheService (in-memory index)', () => {
  beforeEach(async () => {
    await LocalCacheService.ready();
    await LocalCacheService.clearAll();
  });

  it('starts empty', () => {
    expect(LocalCacheService.getCachedStudyUIDsSync()).toEqual([]);
    expect(LocalCacheService.isStudyCachedSync(STUDY)).toBe(false);
  });

  it('putInstance updates synchronous membership at study/series/instance level', async () => {
    await LocalCacheService.putInstance(makeInstance('sop-1'));

    expect(LocalCacheService.isInstanceCachedSync('sop-1')).toBe(true);
    expect(LocalCacheService.isSeriesCachedSync(SERIES_A)).toBe(true);
    expect(LocalCacheService.isStudyCachedSync(STUDY)).toBe(true);
    expect(LocalCacheService.getCachedStudyUIDsSync()).toEqual([STUDY]);
  });

  it('builds a study summary with unwrapped PatientName and byte totals', async () => {
    await LocalCacheService.putInstance(makeInstance('sop-1', { byteLength: 100 }));
    await LocalCacheService.putInstance(makeInstance('sop-2', { byteLength: 150 }));

    const summary = LocalCacheService.getStudySummary(STUDY);
    expect(summary).toMatchObject({
      PatientName: 'Doe^Jane',
      PatientID: 'PID-1',
      AccessionNumber: 'ACC-9',
      ServiceEpisodeID: 'SEID-42',
      seriesCount: 1,
      instanceCount: 2,
      totalBytes: 250,
      modalities: 'CT',
    });
  });

  it('re-caching the same instance does not double-count bytes (AC-4)', async () => {
    await LocalCacheService.putInstance(makeInstance('sop-1', { byteLength: 100 }));
    await LocalCacheService.putInstance(makeInstance('sop-1', { byteLength: 120 }));

    const summary = LocalCacheService.getStudySummary(STUDY);
    expect(summary.instanceCount).toBe(1);
    expect(summary.totalBytes).toBe(120);
  });

  it('sorts per-series summaries numerically by SeriesNumber', async () => {
    await LocalCacheService.putInstance(
      makeInstance('sop-b', { SeriesInstanceUID: SERIES_B, metadata: { SeriesNumber: 10, SeriesDescription: 'Coronal' } })
    );
    await LocalCacheService.putInstance(makeInstance('sop-a', { metadata: { SeriesNumber: 2 } }));

    const series = LocalCacheService.getStudySeriesSummaries(STUDY);
    expect(series.map(s => s.SeriesNumber)).toEqual([2, 10]);
  });

  it('searchCachedStudies matches study- and series-level fields, case-insensitively (AC-9)', async () => {
    await LocalCacheService.putInstance(makeInstance('sop-1'));

    expect(LocalCacheService.searchCachedStudies('doe^jane')).toHaveLength(1);
    expect(LocalCacheService.searchCachedStudies('acc-9')).toHaveLength(1);
    expect(LocalCacheService.searchCachedStudies('axial')).toHaveLength(1); // SeriesDescription
    expect(LocalCacheService.searchCachedStudies(SERIES_A)).toHaveLength(1); // Series UID
    expect(LocalCacheService.searchCachedStudies('seid-42')).toHaveLength(1);
    expect(LocalCacheService.searchCachedStudies('no-such-value')).toHaveLength(0);
    expect(LocalCacheService.searchCachedStudies('')).toHaveLength(1); // empty term returns all
  });

  it('removeInstance prunes empty series/studies and broadcasts INSTANCE_REMOVED', async () => {
    await LocalCacheService.putInstance(makeInstance('sop-1'));

    const removed = [];
    const sub = LocalCacheService.subscribe(
      LocalCacheService.EVENTS.INSTANCE_REMOVED,
      payload => removed.push(payload.SOPInstanceUID)
    );

    await LocalCacheService.removeInstance(STUDY, SERIES_A, 'sop-1');
    sub.unsubscribe();

    expect(removed).toEqual(['sop-1']);
    expect(LocalCacheService.isInstanceCachedSync('sop-1')).toBe(false);
    expect(LocalCacheService.isSeriesCachedSync(SERIES_A)).toBe(false);
    expect(LocalCacheService.isStudyCachedSync(STUDY)).toBe(false);
    expect(LocalCacheService.getStudySummary(STUDY)).toBeNull();
  });

  it('is safe to invoke twice in quick succession', async () => {
    // Callers fire removeSeries without awaiting it, so two activations can overlap. Each must
    // subtract the series' bytes from the study total once between them.
    await LocalCacheService.putInstance(makeInstance('1', { SeriesInstanceUID: SERIES_A, byteLength: 100 }));
    await LocalCacheService.putInstance(makeInstance('2', { SeriesInstanceUID: SERIES_B, byteLength: 250 }));
    expect(LocalCacheService.getStudySummary(STUDY).totalBytes).toBe(350);

    await Promise.all([
      LocalCacheService.removeSeries(STUDY, SERIES_A),
      LocalCacheService.removeSeries(STUDY, SERIES_A),
    ]);

    const summary = LocalCacheService.getStudySummary(STUDY);
    // 350 - 100, not 350 - 100 - 100.
    expect(summary.totalBytes).toBe(250);
    expect(summary.seriesCount).toBe(1);
    expect(LocalCacheService.isSeriesCachedSync(SERIES_A)).toBe(false);
    expect(LocalCacheService.isSeriesCachedSync(SERIES_B)).toBe(true);
  });

  it('returns the same promise to a caller that joins an in-flight removal', async () => {
    await LocalCacheService.putInstance(makeInstance('1', { SeriesInstanceUID: SERIES_A }));

    const first = LocalCacheService.removeSeries(STUDY, SERIES_A);
    const second = LocalCacheService.removeSeries(STUDY, SERIES_A);
    expect(second).toBe(first);

    await Promise.all([first, second]);
    // The key is released, so a later removal of the same series is not short-circuited.
    expect(LocalCacheService.removeSeries(STUDY, SERIES_A)).not.toBe(first);
  });

  it('applies concurrent removals of two series of one study', async () => {
    // Per-series de-duplication does not apply across two different series, and both rewrite the
    // same study-scoped payload; the read-modify-write is serialised so neither removal is lost.
    await LocalCacheService.putInstance(makeInstance('1', { SeriesInstanceUID: SERIES_A }));
    await LocalCacheService.putInstance(makeInstance('2', { SeriesInstanceUID: SERIES_B }));

    const SERIES_C = `${STUDY}.3`;
    await LocalCacheService.putInstance(makeInstance('3', { SeriesInstanceUID: SERIES_C }));

    const stored = new Map([[`__studymeta__::${STUDY}`, {
      series: [
        { '0020000E': { Value: [SERIES_A] } },
        { '0020000E': { Value: [SERIES_B] } },
        { '0020000E': { Value: [SERIES_C] } },
      ],
      instancesBySeries: { [SERIES_A]: [], [SERIES_B]: [], [SERIES_C]: [] },
    }]]);
    const idb = require('idb-keyval');
    LocalCacheService._instanceStore = {};
    jest.spyOn(idb, 'get').mockImplementation(async key => stored.get(key));
    jest.spyOn(idb, 'set').mockImplementation(async (key, value) => { stored.set(key, value); });
    jest.spyOn(idb, 'del').mockImplementation(async key => { stored.delete(key); });
    LocalCacheService._index.studies[STUDY].hasMetadataPayload = true;

    await Promise.all([
      LocalCacheService.removeSeries(STUDY, SERIES_A),
      LocalCacheService.removeSeries(STUDY, SERIES_B),
    ]);

    const payload = stored.get(`__studymeta__::${STUDY}`);
    // Both removals are reflected in the payload.
    expect(Object.keys(payload.instancesBySeries)).toEqual([SERIES_C]);
    expect(payload.series.map(e => e['0020000E'].Value[0])).toEqual([SERIES_C]);

    jest.restoreAllMocks();
    LocalCacheService._instanceStore = null;
  });

  it('does not write a payload for a study clearAll wiped while the removal was reading', async () => {
    await LocalCacheService.putInstance(makeInstance('1', { SeriesInstanceUID: SERIES_A }));
    await LocalCacheService.putInstance(makeInstance('2', { SeriesInstanceUID: SERIES_B }));

    const stored = new Map([[`__studymeta__::${STUDY}`, {
      series: [{ '0020000E': { Value: [SERIES_A] } }, { '0020000E': { Value: [SERIES_B] } }],
      instancesBySeries: { [SERIES_A]: [], [SERIES_B]: [] },
    }]]);
    const idb = require('idb-keyval');
    LocalCacheService._instanceStore = {};

    // The payload read resolves after the wipe, so the prune reaches its write with data that
    // describes a study the cache no longer holds.
    let releaseRead;
    jest.spyOn(idb, 'get').mockImplementation(
      key => new Promise(resolve => { releaseRead = () => resolve(stored.get(key)); })
    );
    jest.spyOn(idb, 'set').mockImplementation(async (key, value) => { stored.set(key, value); });
    jest.spyOn(idb, 'del').mockImplementation(async key => { stored.delete(key); });
    jest.spyOn(idb, 'clear').mockImplementation(async () => { stored.clear(); });
    LocalCacheService._index.studies[STUDY].hasMetadataPayload = true;

    const removal = LocalCacheService.removeSeries(STUDY, SERIES_A);
    await new Promise(resolve => setTimeout(resolve, 0));

    await LocalCacheService.clearAll();
    releaseRead();
    await removal;

    expect(stored.has(`__studymeta__::${STUDY}`)).toBe(false);
    expect(LocalCacheService.getCachedStudyUIDsSync()).toEqual([]);

    jest.restoreAllMocks();
    LocalCacheService._instanceStore = null;
  });

  it('does not write a payload for a mutation that began while clearAll was running', async () => {
    // The opposite ordering to the case above: the mutation starts after the wipe has begun, so it
    // captures a generation the wipe has already moved once, and must still be refused when its
    // write lands after the wipe finishes.
    await LocalCacheService.putInstance(makeInstance('1', { SeriesInstanceUID: SERIES_A }));
    await LocalCacheService.putInstance(makeInstance('2', { SeriesInstanceUID: SERIES_B }));

    const stored = new Map();
    const idb = require('idb-keyval');
    LocalCacheService._instanceStore = {};
    jest.spyOn(idb, 'get').mockImplementation(async key => stored.get(key));
    jest.spyOn(idb, 'set').mockImplementation(async (key, value) => { stored.set(key, value); });
    jest.spyOn(idb, 'del').mockImplementation(async key => { stored.delete(key); });

    // Hold the store clear open, and start the payload write while it is in flight.
    let finishClear;
    jest.spyOn(idb, 'clear').mockImplementation(
      () => new Promise(resolve => { finishClear = () => { stored.clear(); resolve(); }; })
    );

    const wipe = LocalCacheService.clearAll();
    await new Promise(resolve => setTimeout(resolve, 0));

    const write = LocalCacheService.putStudyMetadataPayload(STUDY, {
      series: [{ '0020000E': { Value: [SERIES_A] } }],
      instancesBySeries: { [SERIES_A]: [] },
    });

    finishClear();
    await Promise.all([wipe, write]);

    expect(stored.has(`__studymeta__::${STUDY}`)).toBe(false);
    expect(LocalCacheService.getCachedStudyUIDsSync()).toEqual([]);

    jest.restoreAllMocks();
    LocalCacheService._instanceStore = null;
  });

  it('rejects a payload write that both starts and finishes while clearAll is persisting', async () => {
    // The interval a generation bump alone cannot express. The payload and the index live in
    // separate stores, so clearAll is still awaiting its index persist long after the instance
    // store is gone -- and a write that starts and finishes inside that window sees an unchanged
    // generation at both ends of its own lifetime.
    await LocalCacheService.putInstance(makeInstance('1', { SeriesInstanceUID: SERIES_A }));

    const stored = new Map();
    const idb = require('idb-keyval');
    LocalCacheService._instanceStore = {};
    // Non-null, so _persistIndex actually awaits rather than resolving immediately.
    LocalCacheService._indexStore = {};

    let finishIndexPersist;
    jest.spyOn(idb, 'get').mockImplementation(async key => stored.get(key));
    jest.spyOn(idb, 'del').mockImplementation(async key => { stored.delete(key); });
    jest.spyOn(idb, 'clear').mockImplementation(async () => { stored.clear(); });
    jest.spyOn(idb, 'set').mockImplementation((key, value, store) => {
      if (store === LocalCacheService._indexStore) {
        return new Promise(resolve => { finishIndexPersist = resolve; });
      }
      stored.set(key, value);
      return Promise.resolve();
    });

    const wipe = LocalCacheService.clearAll();
    await waitFor(() => typeof finishIndexPersist === 'function');

    // Entirely inside the window: starts and settles before the index persist resolves.
    await LocalCacheService.putStudyMetadataPayload(STUDY, {
      series: [],
      instancesBySeries: { [SERIES_A]: [] },
    });

    expect(stored.has(`__studymeta__::${STUDY}`)).toBe(false);

    finishIndexPersist();
    await wipe;
    expect(stored.has(`__studymeta__::${STUDY}`)).toBe(false);

    jest.restoreAllMocks();
    LocalCacheService._instanceStore = null;
    LocalCacheService._indexStore = null;
  });

  it('rejects a payload merge that began during the wipe, even though it writes afterwards', async () => {
    // The merge reads before it writes, so taking its eligibility at write time would classify it
    // as a post-clear operation and let stale data through.
    await LocalCacheService.putInstance(makeInstance('1', { SeriesInstanceUID: SERIES_A }));

    const stored = new Map([[`__studymeta__::${STUDY}`, {
      series: [{ '0020000E': { Value: [SERIES_A] } }],
      instancesBySeries: { [SERIES_A]: [] },
    }]]);
    const idb = require('idb-keyval');
    LocalCacheService._instanceStore = {};

    let finishClear;
    jest.spyOn(idb, 'get').mockImplementation(async key => stored.get(key));
    jest.spyOn(idb, 'set').mockImplementation(async (key, value) => { stored.set(key, value); });
    jest.spyOn(idb, 'del').mockImplementation(async key => { stored.delete(key); });
    jest.spyOn(idb, 'clear').mockImplementation(
      () => new Promise(resolve => { finishClear = () => { stored.clear(); resolve(); }; })
    );

    const wipe = LocalCacheService.clearAll();
    await waitFor(() => typeof finishClear === 'function');

    const merge = LocalCacheService.mergeStudyMetadataPayload(STUDY, {
      series: [{ '0020000E': { Value: [SERIES_B] } }],
      instancesBySeries: { [SERIES_B]: [] },
    }, { partial: true });

    finishClear();
    await Promise.all([wipe, merge]);

    expect(stored.has(`__studymeta__::${STUDY}`)).toBe(false);
    expect(LocalCacheService.getCachedStudyUIDsSync()).toEqual([]);

    jest.restoreAllMocks();
    LocalCacheService._instanceStore = null;
  });

  it('joins overlapping clears, so a write between their completions is still rejected', async () => {
    // The Clear Storage control returns before its clear settles, so two can overlap. With a
    // boolean flag the first to finish would declare the cache quiet while the second was still
    // emptying it, and a write starting then would take a clean token.
    await LocalCacheService.putInstance(makeInstance('1', { SeriesInstanceUID: SERIES_A }));

    const stored = new Map();
    const idb = require('idb-keyval');
    LocalCacheService._instanceStore = {};

    let finishClear;
    let clearCalls = 0;
    jest.spyOn(idb, 'get').mockImplementation(async key => stored.get(key));
    jest.spyOn(idb, 'set').mockImplementation(async (key, value) => { stored.set(key, value); });
    jest.spyOn(idb, 'del').mockImplementation(async key => { stored.delete(key); });
    jest.spyOn(idb, 'clear').mockImplementation(() => {
      clearCalls += 1;
      return new Promise(resolve => { finishClear = () => { stored.clear(); resolve(); }; });
    });

    const first = LocalCacheService.clearAll();
    await waitFor(() => typeof finishClear === 'function');
    const second = LocalCacheService.clearAll();

    // The second request joins the first rather than starting a competing wipe.
    expect(second).toBe(first);
    expect(clearCalls).toBe(1);

    const write = LocalCacheService.putStudyMetadataPayload(STUDY, {
      series: [],
      instancesBySeries: { [SERIES_A]: [] },
    });

    finishClear();
    await Promise.all([first, second, write]);

    expect(stored.has(`__studymeta__::${STUDY}`)).toBe(false);

    jest.restoreAllMocks();
    LocalCacheService._instanceStore = null;
  });

  it('rejects a write requested before a wipe that acquires its study lock afterwards', async () => {
    // Waiting for the per-study lock is itself an await. A request made before the wipe but queued
    // behind another mutation must not take a clean token when it finally runs.
    await LocalCacheService.putInstance(makeInstance('1', { SeriesInstanceUID: SERIES_A }));

    const stored = new Map();
    const idb = require('idb-keyval');
    LocalCacheService._instanceStore = {};
    jest.spyOn(idb, 'get').mockImplementation(async key => stored.get(key));
    jest.spyOn(idb, 'set').mockImplementation(async (key, value) => { stored.set(key, value); });
    jest.spyOn(idb, 'del').mockImplementation(async key => { stored.delete(key); });
    jest.spyOn(idb, 'clear').mockImplementation(async () => { stored.clear(); });

    // Hold the study lock so the write below queues behind it.
    let releaseHolder;
    const holder = LocalCacheService._withStudyLock(
      STUDY,
      () => new Promise(resolve => { releaseHolder = resolve; })
    );
    await waitFor(() => typeof releaseHolder === 'function');

    const write = LocalCacheService.putStudyMetadataPayload(STUDY, {
      series: [],
      instancesBySeries: { [SERIES_A]: [] },
    });

    // The wipe happens and completes while the write is still waiting for the lock.
    await LocalCacheService.clearAll();

    releaseHolder();
    await Promise.all([holder, write]);

    expect(stored.has(`__studymeta__::${STUDY}`)).toBe(false);
    expect(LocalCacheService.getCachedStudyUIDsSync()).toEqual([]);

    jest.restoreAllMocks();
    LocalCacheService._instanceStore = null;
  });

  it('prunes a removed series from the stored metadata payload', async () => {
    // Without this, an offline open would rebuild the removed series from stale DICOM JSON and
    // present images that are no longer stored.
    await LocalCacheService.putInstance(makeInstance('1', { SeriesInstanceUID: SERIES_A }));
    await LocalCacheService.putInstance(makeInstance('2', { SeriesInstanceUID: SERIES_B }));

    const payload = {
      series: [
        { '0020000E': { Value: [SERIES_A] } },
        { '0020000E': { Value: [SERIES_B] } },
      ],
      instancesBySeries: { [SERIES_A]: [{ '00080018': { Value: ['1'] } }], [SERIES_B]: [{ '00080018': { Value: ['2'] } }] },
    };

    // The service degrades to in-memory-only without IndexedDB, so drive the payload through a
    // stand-in store: what is under test is which series the pruning keeps.
    const stored = new Map([[`__studymeta__::${STUDY}`, payload]]);
    LocalCacheService._instanceStore = {};
    const idb = require('idb-keyval');
    const getSpy = jest.spyOn(idb, 'get').mockImplementation(async key => stored.get(key));
    const setSpy = jest.spyOn(idb, 'set').mockImplementation(async (key, value) => stored.set(key, value));
    jest.spyOn(idb, 'del').mockImplementation(async key => stored.delete(key));
    LocalCacheService._index.studies[STUDY].hasMetadataPayload = true;

    await LocalCacheService.removeSeries(STUDY, SERIES_A);

    const remaining = stored.get(`__studymeta__::${STUDY}`);
    expect(Object.keys(remaining.instancesBySeries)).toEqual([SERIES_B]);
    expect(remaining.series.map(entry => entry['0020000E'].Value[0])).toEqual([SERIES_B]);
    // A payload missing one of the study's series can no longer stand in for the network.
    expect(LocalCacheService.hasCompleteStudyMetadataPayloadSync(STUDY)).toBe(false);
    expect(LocalCacheService.hasStudyMetadataPayloadSync(STUDY)).toBe(true);

    getSpy.mockRestore();
    setSpy.mockRestore();
    jest.restoreAllMocks();
    LocalCacheService._instanceStore = null;
  });

  it('removeStudy removes every series and emits INSTANCE_REMOVED per instance', async () => {
    await LocalCacheService.putInstance(makeInstance('sop-1'));
    await LocalCacheService.putInstance(makeInstance('sop-2', { SeriesInstanceUID: SERIES_B }));

    const removed = [];
    const sub = LocalCacheService.subscribe(
      LocalCacheService.EVENTS.INSTANCE_REMOVED,
      payload => removed.push(payload.SOPInstanceUID)
    );

    await LocalCacheService.removeStudy(STUDY);
    sub.unsubscribe();

    expect(removed.sort()).toEqual(['sop-1', 'sop-2']);
    expect(LocalCacheService.getCachedStudyUIDsSync()).toEqual([]);
  });

  it('clearAll empties membership and broadcasts CACHE_CLEARED', async () => {
    await LocalCacheService.putInstance(makeInstance('sop-1'));

    let cleared = false;
    const sub = LocalCacheService.subscribe(LocalCacheService.EVENTS.CACHE_CLEARED, () => {
      cleared = true;
    });

    await LocalCacheService.clearAll();
    sub.unsubscribe();

    expect(cleared).toBe(true);
    expect(LocalCacheService.getCachedStudyUIDsSync()).toEqual([]);
    expect(LocalCacheService.isInstanceCachedSync('sop-1')).toBe(false);
  });
});


describe('LocalCacheService: instances the viewer created (cacheViewerInstance)', () => {
  const KEY = `__studymeta__::${STUDY}`;
  const ADDS = `__studyadds__::${STUDY}`;
  const SERIES_SR = `${STUDY}.9`;
  const srInstance = sop => ({
    '0020000D': { vr: 'UI', Value: [STUDY] },
    '0020000E': { vr: 'UI', Value: [SERIES_SR] },
    '00080018': { vr: 'UI', Value: [sop] },
    '00080060': { vr: 'CS', Value: ['SR'] },
  });
  const srSeries = { '0020000E': { vr: 'UI', Value: [SERIES_SR] }, '00080060': { vr: 'CS', Value: ['SR'] } };
  const report = sop => ({
    StudyInstanceUID: STUDY,
    bytes: new ArrayBuffer(10),
    metadata: { StudyInstanceUID: STUDY, SeriesInstanceUID: SERIES_SR, SOPInstanceUID: sop, Modality: 'SR' },
    instance: srInstance(sop),
    series: srSeries,
  });
  const serverSnapshot = () => ({
    series: [{ '0020000E': { Value: [SERIES_A] } }],
    instancesBySeries: { [SERIES_A]: [{ '00080018': { Value: ['1'] } }] },
  });
  const sopsOf = (payload, series) => (payload.instancesBySeries[series] || []).map(e => e['00080018'].Value[0]);
  let stored;
  let idb;

  beforeEach(async () => {
    await LocalCacheService.ready();
    await LocalCacheService.clearAll();
    await LocalCacheService.putInstance(makeInstance('1', { SeriesInstanceUID: SERIES_A }));

    stored = new Map();
    idb = require('idb-keyval');
    LocalCacheService._instanceStore = {};
    jest.spyOn(idb, 'get').mockImplementation(async key => stored.get(key));
    jest.spyOn(idb, 'set').mockImplementation(async (key, value) => { stored.set(key, value); });
    jest.spyOn(idb, 'del').mockImplementation(async key => { stored.delete(key); });
    jest.spyOn(idb, 'clear').mockImplementation(async () => { stored.clear(); });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    LocalCacheService._instanceStore = null;
  });

  it('stores the instance and adds it and its series to a stored payload, which stays complete', async () => {
    await LocalCacheService.putStudyMetadataPayload(STUDY, serverSnapshot());
    await expect(LocalCacheService.cacheViewerInstance(report('sr-1'))).resolves.toBe(true);

    expect(stored.get('sr-1').bytes.byteLength).toBe(10);
    expect(LocalCacheService.isInstanceCachedSync('sr-1')).toBe(true);
    const payload = stored.get(KEY);
    expect(payload.series.map(e => e['0020000E'].Value[0])).toEqual([SERIES_A, SERIES_SR]);
    expect(sopsOf(payload, SERIES_A)).toEqual(['1']);
    expect(sopsOf(payload, SERIES_SR)).toEqual(['sr-1']);
    expect(LocalCacheService.hasCompleteStudyMetadataPayloadSync(STUDY)).toBe(true);
  });

  it('keeps the instance when a payload enumerated before it is committed afterwards', async () => {
    await LocalCacheService.putStudyMetadataPayload(STUDY, serverSnapshot());
    await LocalCacheService.cacheViewerInstance(report('sr-1'));

    await LocalCacheService.putStudyMetadataPayload(STUDY, serverSnapshot());
    expect(sopsOf(stored.get(KEY), SERIES_SR)).toEqual(['sr-1']);

    await LocalCacheService.mergeStudyMetadataPayload(STUDY, serverSnapshot(), { partial: true });
    expect(sopsOf(stored.get(KEY), SERIES_SR)).toEqual(['sr-1']);
  });

  it('carries an instance added before the study has a payload into its first payload', async () => {
    await expect(LocalCacheService.cacheViewerInstance(report('sr-1'))).resolves.toBe(true);
    expect(stored.has(KEY)).toBe(false);

    await LocalCacheService.putStudyMetadataPayload(STUDY, serverSnapshot());
    expect(sopsOf(stored.get(KEY), SERIES_SR)).toEqual(['sr-1']);
    expect(sopsOf(stored.get(KEY), SERIES_A)).toEqual(['1']);
  });

  it('lists an instance once however often it is added or a payload is written', async () => {
    await LocalCacheService.putStudyMetadataPayload(STUDY, serverSnapshot());
    await LocalCacheService.cacheViewerInstance(report('sr-1'));
    await LocalCacheService.cacheViewerInstance(report('sr-2'));
    await LocalCacheService.cacheViewerInstance(report('sr-2'));
    await LocalCacheService.putStudyMetadataPayload(STUDY, stored.get(KEY));

    const payload = stored.get(KEY);
    expect(payload.series.filter(e => e['0020000E'].Value[0] === SERIES_SR)).toHaveLength(1);
    expect(sopsOf(payload, SERIES_SR)).toEqual(['sr-1', 'sr-2']);
  });

  it('keeps a partial payload partial', async () => {
    await LocalCacheService.putStudyMetadataPayload(STUDY, serverSnapshot(), { partial: true });
    await LocalCacheService.cacheViewerInstance(report('sr-1'));
    expect(sopsOf(stored.get(KEY), SERIES_SR)).toEqual(['sr-1']);
    expect(LocalCacheService.hasStudyMetadataPayloadSync(STUDY)).toBe(true);
    expect(LocalCacheService.hasCompleteStudyMetadataPayloadSync(STUDY)).toBe(false);
  });

  it('writes nothing for a study that is not cached', async () => {
    await expect(LocalCacheService.cacheViewerInstance({ ...report('sr-1'), StudyInstanceUID: '2.25.404' }))
      .resolves.toBe(false);
    expect(stored.size).toBe(0);
    expect(LocalCacheService.isInstanceCachedSync('sr-1')).toBe(false);
  });

  it('forgets the additions of a removed series, so a later payload does not list them', async () => {
    await LocalCacheService.putStudyMetadataPayload(STUDY, serverSnapshot());
    await LocalCacheService.cacheViewerInstance(report('sr-1'));

    await LocalCacheService.removeSeries(STUDY, SERIES_SR);
    expect(stored.has(ADDS)).toBe(false);
    expect(stored.has('sr-1')).toBe(false);

    await LocalCacheService.putStudyMetadataPayload(STUDY, serverSnapshot());
    expect(stored.get(KEY).instancesBySeries[SERIES_SR]).toBeUndefined();
  });

  it('removes a series deleted from the server and keeps a complete payload complete', async () => {
    await LocalCacheService.putStudyMetadataPayload(STUDY, serverSnapshot());
    await LocalCacheService.cacheViewerInstance(report('sr-1'));

    await LocalCacheService.removeSeries(STUDY, SERIES_SR, { removedFromServer: true });
    expect(stored.has('sr-1')).toBe(false);
    expect(stored.has(ADDS)).toBe(false);
    expect(stored.get(KEY).instancesBySeries[SERIES_SR]).toBeUndefined();
    expect(stored.get(KEY).series.map(e => e['0020000E'].Value[0])).toEqual([SERIES_A]);
    expect(LocalCacheService.hasCompleteStudyMetadataPayloadSync(STUDY)).toBe(true);
    expect(LocalCacheService.isInstanceCachedSync('sr-1')).toBe(false);
  });

  it('marks the payload partial when a series is only evicted from this browser', async () => {
    await LocalCacheService.putStudyMetadataPayload(STUDY, serverSnapshot());
    await LocalCacheService.cacheViewerInstance(report('sr-1'));

    await LocalCacheService.removeSeries(STUDY, SERIES_SR);
    expect(stored.get(KEY).instancesBySeries[SERIES_SR]).toBeUndefined();
    expect(LocalCacheService.hasCompleteStudyMetadataPayloadSync(STUDY)).toBe(false);
  });

  it('prunes a series deleted from the server that this browser holds no instances of', async () => {
    const SERIES_REMOTE = `${STUDY}.7`;
    await LocalCacheService.putStudyMetadataPayload(STUDY, {
      series: [{ '0020000E': { Value: [SERIES_A] } }, { '0020000E': { Value: [SERIES_REMOTE] } }],
      instancesBySeries: { [SERIES_A]: [{ '00080018': { Value: ['1'] } }], [SERIES_REMOTE]: [{ '00080018': { Value: ['r-1'] } }] },
    });

    await LocalCacheService.removeSeries(STUDY, SERIES_REMOTE, { removedFromServer: true });
    expect(stored.get(KEY).instancesBySeries[SERIES_REMOTE]).toBeUndefined();
    expect(stored.get(KEY).series.map(e => e['0020000E'].Value[0])).toEqual([SERIES_A]);
    expect(LocalCacheService.hasCompleteStudyMetadataPayloadSync(STUDY)).toBe(true);
    expect(LocalCacheService.isStudyCachedSync(STUDY)).toBe(true);
  });

  it('forgets the additions of a removed study', async () => {
    await LocalCacheService.cacheViewerInstance(report('sr-1'));
    await LocalCacheService.removeStudy(STUDY);
    expect(stored.has(ADDS)).toBe(false);
    expect(LocalCacheService.isStudyCachedSync(STUDY)).toBe(false);
  });

  it('writes nothing when it was requested during a clear', async () => {
    let finishClear;
    idb.clear.mockImplementation(() => new Promise(resolve => { finishClear = () => { stored.clear(); resolve(); }; }));
    const wipe = LocalCacheService.clearAll();
    await waitFor(() => typeof finishClear === 'function');

    const add = LocalCacheService.cacheViewerInstance(report('sr-1'));
    finishClear();
    await expect(Promise.all([wipe, add])).resolves.toEqual([undefined, false]);

    expect(stored.size).toBe(0);
    expect(LocalCacheService.isInstanceCachedSync('sr-1')).toBe(false);
    expect(LocalCacheService.getCachedStudyUIDsSync()).toEqual([]);
  });

  it('stores DICOM+JSON whose values are Proxies, as dcmjs hands them out', async () => {
    // IndexedDB structured-clones what it stores, and a Proxy cannot be cloned
    idb.set.mockImplementation(async (key, value) => { stored.set(key, structuredClone(value)); });
    const proxied = value => new Proxy(value, {});
    const instance = srInstance('sr-1');
    instance['00100010'] = { vr: 'PN', Value: [proxied({ Alphabetic: 'Test^Patient' })] };
    await LocalCacheService.putStudyMetadataPayload(STUDY, serverSnapshot());

    await expect(LocalCacheService.cacheViewerInstance({ ...report('sr-1'), instance: proxied(instance) }))
      .resolves.toBe(true);
    const listed = stored.get(KEY).instancesBySeries[SERIES_SR][0];
    expect(listed['00100010'].Value[0].Alphabetic).toBe('Test^Patient');
  });

  it('takes back the instance record, and keeps the other additions, when the additions write fails', async () => {
    await LocalCacheService.cacheViewerInstance(report('sr-1'));
    const before = structuredClone(stored.get(ADDS));
    // Reads return copies, as IndexedDB's do
    idb.get.mockImplementation(async key => (stored.has(key) ? structuredClone(stored.get(key)) : undefined));
    idb.set.mockImplementation(async (key, value) => {
      if (key === ADDS) {
        throw Object.assign(new Error('could not be cloned'), { name: 'DataCloneError' });
      }
      stored.set(key, value);
    });

    await expect(LocalCacheService.cacheViewerInstance(report('sr-2'))).rejects.toMatchObject({ name: 'DataCloneError' });
    expect(stored.has('sr-2')).toBe(false);
    expect(LocalCacheService.isInstanceCachedSync('sr-2')).toBe(false);
    expect(stored.get(ADDS)).toEqual(before);
    expect(Object.keys(stored.get(ADDS))).toEqual(['sr-1']);
  });

  it('takes back what it wrote when a clear starts while the bytes are being stored', async () => {
    let releaseWrite;
    let wipe;
    idb.set.mockImplementation(async (key, value) => {
      if (key === 'sr-1') {
        // The clear starts while this write is in flight; IndexedDB commits the write first
        stored.set(key, value);
        wipe = LocalCacheService.clearAll();
        await new Promise(resolve => { releaseWrite = resolve; });
        return;
      }
      stored.set(key, value);
    });

    const add = LocalCacheService.cacheViewerInstance(report('sr-1'));
    await waitFor(() => typeof releaseWrite === 'function');
    releaseWrite();
    await expect(add).resolves.toBe(false);
    await wipe;

    expect(stored.has('sr-1')).toBe(false);
    expect(stored.has(ADDS)).toBe(false);
    expect(LocalCacheService.isInstanceCachedSync('sr-1')).toBe(false);
    expect(LocalCacheService.getCachedStudyUIDsSync()).toEqual([]);
  });
});
