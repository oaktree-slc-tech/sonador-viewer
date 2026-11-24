// Ownership and atomicity of the cache's saved and session copies under interleavings
// (imaging-development-env#103), over an asynchronous store so the awaits inside the service are real:
// a selective removal running while a promotion or a write lands, a hand-back after the copy was
// saved by something else, and two browsing contexts (two service instances) sharing one store and
// one lock manager while one of them works from a stale index or while their mutations overlap.

// An in-memory idb-keyval with the same asynchronous shape, shared by every service instance, whose
// deletes can be held. Reached through a global because a mock factory may not close over locals.
global.__cacheMockControl = { stores: new Map(), heldDeletes: new Map() };
const control = global.__cacheMockControl;
jest.mock('idb-keyval', () => {
  const control = global.__cacheMockControl;
  const storeOf = store => {
    const key = (store && store.name) || 'default';
    if (!control.stores.has(key)) control.stores.set(key, new Map());
    return control.stores.get(key);
  };
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  return {
    createStore: (dbName, storeName) => ({ name: `${dbName}/${storeName}` }),
    // Copies on the way in and out, as IndexedDB does: two service instances must not end up
    // sharing one index object through the store
    get: async (key, store) => { await tick(); const v = storeOf(store).get(key); return v === undefined ? undefined : structuredClone(v); },
    set: async (key, value, store) => { await tick(); storeOf(store).set(key, structuredClone(value)); },
    del: async (key, store) => {
      const held = control.heldDeletes.get(key);
      if (held) await held;
      await tick();
      storeOf(store).delete(key);
    },
    clear: async store => { await tick(); storeOf(store).clear(); },
  };
});

global.indexedDB = global.indexedDB || {};
global.CustomEvent = global.CustomEvent || class CustomEvent {
  constructor(type, params = {}) { this.type = type; this.detail = params.detail; }
};
global.document = global.document || { body: { dispatchEvent: () => {} } };

// Required after the globals above: the module constructs its singleton at import
const { LocalCacheServiceClass } = require('./LocalCacheService');

const STUDY = '1.2.826.0.1.999.7';
const OTHER_STUDY = '1.2.826.0.1.999.8';
const SERIES_A = `${STUDY}.1`;
const SERIES_B = `${STUDY}.2`;
// Complete study identifiers, so that no service instance starts a background index repair of the
// study (which would take its lock and reorder the interleavings these tests arrange)
const IDENTIFIERS = { PatientName: 'Doe^Jane', PatientID: 'P1', StudyDescription: 'CT', AccessionNumber: 'ACC1', ServiceEpisodeID: 'E1' };
const instance = (sop, SeriesInstanceUID = SERIES_A, session = false) => ({
  StudyInstanceUID: STUDY, SeriesInstanceUID, SOPInstanceUID: sop, bytes: new ArrayBuffer(8),
  metadata: { SOPInstanceUID: sop, SeriesInstanceUID, StudyInstanceUID: STUDY, Modality: 'CT', ...IDENTIFIERS }, session,
});
const hold = key => {
  let release;
  control.heldDeletes.set(key, new Promise(resolve => { release = () => { control.heldDeletes.delete(key); resolve(); }; }));
  return release;
};
const flush = () => new Promise(resolve => setTimeout(resolve, 5));
const records = () => control.stores.get('sonador-local-cache/instances') || new Map();

// The Web Locks API as the browser provides it to every context of the origin: one queue per name
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

let service;
let locks;
beforeEach(async () => {
  control.stores.clear();
  control.heldDeletes.clear();
  locks = makeLocks();
  service = new LocalCacheServiceClass({ locks });
  await service.ready();
});

describe('LocalCacheService: selective removal under concurrent mutations', () => {
  it('a promotion requested while a session removal is in flight is serialised after it: nothing is half-deleted, and the promotion reports what it did not promote', async () => {
    await service.putInstance(instance('s1', SERIES_A, true));
    await service.putInstance(instance('s2', SERIES_A, true));
    // The removal holds the study lock while its first delete is held; the promotion arrives then
    const release = hold('s1');
    const removal = service.removeSessionInstances(STUDY);
    await flush();
    const promotion = service.markSaved(STUDY, SERIES_A);
    await flush();
    release();
    const [, promoted] = await Promise.all([removal, promotion]);

    // The removal that began first completed as a unit; the promotion found nothing to promote and
    // says so, so a caller never believes bytes are saved that are not there
    expect(promoted).toEqual([]);
    expect(service.isInstanceCachedSync('s1')).toBe(false);
    expect(service.isInstanceCachedSync('s2')).toBe(false);
    expect(records().has('s1')).toBe(false);
    expect(service.getStudyCopyStateSync(STUDY).state).toBe('none');
  });

  it('a promotion requested before a session removal is honoured by it, whatever the index said when the removal was requested', async () => {
    await service.putInstance(instance('s1', SERIES_A, true));
    await service.putInstance(instance('s2', SERIES_A, true));
    const release = hold('blocker');
    await service.putInstance(instance('blocker', SERIES_B));
    const blocked = service.removeInstance(STUDY, SERIES_B, 'blocker');
    // Both wait for the lock; the promotion is first in line
    const promotion = service.markSaved(STUDY, SERIES_A);
    const removal = service.removeSessionInstances(STUDY);
    await flush();
    release();
    const [, promoted] = await Promise.all([blocked, promotion, removal]);

    expect(promoted).toEqual(['s1', 's2']);
    expect(service.isInstanceCachedSync('s1')).toBe(true);
    expect(service.isInstanceCachedSync('s2')).toBe(true);
    expect(service.getSeriesCopyStateSync(SERIES_A)).toBe('saved');
    expect(records().get('s1').session).toBeUndefined();
  });

  it('a session copy written while a saved-only removal waits for the study lock is kept', async () => {
    await service.putInstance(instance('saved-1', SERIES_A));
    const release = hold('blocker');
    await service.putInstance(instance('blocker', SERIES_B));
    const blocked = service.removeInstance(STUDY, SERIES_B, 'blocker');
    const removal = service.removeSavedInstances(STUDY);
    const write = service.putInstance(instance('temp-1', SERIES_A, true));
    await flush();
    release();
    await Promise.all([blocked, removal, write]);

    expect(service.isInstanceCachedSync('saved-1')).toBe(false);
    expect(service.isInstanceCachedSync('temp-1')).toBe(true);
    expect(service.getSeriesCopyStateSync(SERIES_A)).toBe('temporary');
    expect(records().has('temp-1')).toBe(true);
  });

  it('a session copy promoted mid-way through a session removal of its series is kept, series path included', async () => {
    await service.putInstance(instance('s1', SERIES_A, true));
    await service.putInstance(instance('s2', SERIES_A, true));
    // Promotion first, removal second: the removal classifies from the records and finds nothing of its kind
    await service.markSaved(STUDY);
    await service.removeSessionInstances(STUDY);
    expect(service.isSeriesCachedSync(SERIES_A)).toBe(true);
    expect(service.getStudyCopyStateSync(STUDY).state).toBe('saved');
  });
});

describe('LocalCacheService: two browsing contexts sharing the store', () => {
  it('a context with a stale index cannot delete bytes another context promoted, and corrects itself', async () => {
    const a = service;
    await a.putInstance(instance('t1', SERIES_A, true));
    await a.putInstance(instance('t2', SERIES_A, true));

    const b = new LocalCacheServiceClass({ locks });
    await b.ready();
    expect(b.getSeriesCopyStateSync(SERIES_A)).toBe('temporary');
    expect(await b.markSaved(STUDY)).toEqual(['t1', 't2']);

    // A still believes both are session copies
    expect(a.getSeriesCopyStateSync(SERIES_A)).toBe('temporary');
    await a.removeSessionInstances(STUDY);

    expect(records().has('t1')).toBe(true);
    expect(records().has('t2')).toBe(true);
    expect(a.getSeriesCopyStateSync(SERIES_A)).toBe('saved');
    const fresh = new LocalCacheServiceClass({ locks });
    await fresh.ready();
    expect(fresh.isInstanceCachedSync('t1')).toBe(true);
    expect(fresh.getSeriesCopyStateSync(SERIES_A)).toBe('saved');
  });

  it('two contexts mutating the same study at once are serialised through the shared lock: a promotion that arrives while a removal is deleting waits for it, and finds nothing left to promote', async () => {
    const a = service;
    await a.putInstance(instance('t1', SERIES_A, true));
    await a.putInstance(instance('t2', SERIES_A, true));
    const b = new LocalCacheServiceClass({ locks });
    await b.ready();

    // A has classified t1 and t2 as session copies and is deleting t1 when B's promotion arrives
    const release = hold('t1');
    const removal = a.removeSessionInstances(STUDY);
    await flush();
    let promotionSettled = false;
    const promotion = b.markSaved(STUDY).then(result => { promotionSettled = true; return result; });
    await flush();
    // B waits on the lock A holds
    expect(promotionSettled).toBe(false);
    release();
    const [, promoted] = await Promise.all([removal, promotion]);

    expect(promoted).toEqual([]);
    expect(records().has('t1')).toBe(false);
    expect(records().has('t2')).toBe(false);
    expect(a.isStudyCachedSync(STUDY)).toBe(false);
    expect(b.isStudyCachedSync(STUDY)).toBe(false);
  });

  it('the other way round, a removal that arrives while another context is promoting waits, and then keeps the saved bytes', async () => {
    const a = service;
    await a.putInstance(instance('t1', SERIES_A, true));
    const b = new LocalCacheServiceClass({ locks });
    await b.ready();

    const promotion = b.markSaved(STUDY);
    const removal = a.removeSessionInstances(STUDY);
    const [promoted] = await Promise.all([promotion, removal]);

    expect(promoted).toEqual(['t1']);
    expect(records().has('t1')).toBe(true);
    expect(records().get('t1').session).toBeUndefined();
    expect(a.getSeriesCopyStateSync(SERIES_A)).toBe('saved');
    expect(b.getSeriesCopyStateSync(SERIES_A)).toBe('saved');
  });

  it('a saved series another context adds survives a write from a context that hydrated before it, and that context then knows of it', async () => {
    const a = service;
    await a.putInstance(instance('t1', SERIES_A, true));
    const b = new LocalCacheServiceClass({ locks });
    await b.ready();

    // B saves a new series; A, still working from the index it hydrated, stores a session copy
    await b.putInstance(instance('saved1', SERIES_B));
    await a.putInstance(instance('t2', SERIES_A, true));

    const fresh = new LocalCacheServiceClass({ locks });
    await fresh.ready();
    expect(fresh.isInstanceCachedSync('saved1')).toBe(true);
    expect(fresh.getSeriesCopyStateSync(SERIES_B)).toBe('saved');
    expect(fresh.getSeriesCopyStateSync(SERIES_A)).toBe('temporary');
    expect(a.isSeriesCachedSync(SERIES_B)).toBe(true);
    expect(a.getStudyCopyStateSync(STUDY)).toMatchObject({ state: 'saved', savedSeriesCount: 1, temporarySeriesCount: 1 });
  });

  it('two contexts writing different studies at the same time both land in the index: the index write is its own shared critical section', async () => {
    const a = service;
    const b = new LocalCacheServiceClass({ locks });
    await b.ready();
    const other = { ...instance('o1', `${OTHER_STUDY}.1`), StudyInstanceUID: OTHER_STUDY };
    other.metadata = { ...other.metadata, StudyInstanceUID: OTHER_STUDY, SeriesInstanceUID: `${OTHER_STUDY}.1` };
    await Promise.all([a.putInstance(instance('a1', SERIES_A)), b.putInstance(other)]);

    const fresh = new LocalCacheServiceClass({ locks });
    await fresh.ready();
    expect(fresh.isInstanceCachedSync('a1')).toBe(true);
    expect(fresh.isInstanceCachedSync('o1')).toBe(true);
    expect(fresh.getCachedStudyUIDsSync().sort()).toEqual([STUDY, OTHER_STUDY].sort());
  });

  it('a context waiting for a study lock does not write that study: its stale entry cannot overwrite a promotion the lock holder committed', async () => {
    const a = service;
    await a.putInstance(instance('t1', SERIES_A, true));
    await a.putInstance(instance('x', SERIES_B));
    const b = new LocalCacheServiceClass({ locks });
    await b.ready();
    // B promotes t1 and then holds the study lock (a removal of x whose delete is held)
    await b.markSaved(STUDY);
    const release = hold('x');
    const removal = b.removeInstance(STUDY, SERIES_B, 'x');
    await flush();
    // A, which still believes t1 is a session copy, queues a mutation of the study and writes another
    const queued = a.markSaved(STUDY);
    const other = { ...instance('o1', `${OTHER_STUDY}.1`), StudyInstanceUID: OTHER_STUDY };
    other.metadata = { ...other.metadata, StudyInstanceUID: OTHER_STUDY, SeriesInstanceUID: `${OTHER_STUDY}.1` };
    await a.putInstance(other);

    const witness = new LocalCacheServiceClass({ locks });
    await witness.ready();
    expect(witness.getSeriesCopyStateSync(SERIES_A)).toBe('saved');
    expect(witness.isInstanceCachedSync('o1')).toBe(true);

    release();
    await removal;
    expect(await queued).toEqual([]);
    expect(a.getSeriesCopyStateSync(SERIES_A)).toBe('saved');
  });

  it('without a shared lock the cache says so, and keeps serialising within its own context', async () => {
    const alone = new LocalCacheServiceClass({ locks: null });
    await alone.ready();
    expect(alone.hasSharedLock()).toBe(false);
    expect(service.hasSharedLock()).toBe(true);
    await alone.putInstance(instance('t1', SERIES_A, true));
    const release = hold('t1');
    const removal = alone.removeSessionInstances(STUDY);
    await flush();
    const promotion = alone.markSaved(STUDY);
    release();
    const [, promoted] = await Promise.all([removal, promotion]);
    expect(promoted).toEqual([]);
    expect(records().has('t1')).toBe(false);
  });

  it('a stale whole-index write from one context does not demote what another promoted', async () => {
    const a = service;
    await a.putInstance(instance('t1', SERIES_A, true));
    const b = new LocalCacheServiceClass({ locks });
    await b.ready();
    await b.markSaved(STUDY);

    // A persists its whole index (a write of an unrelated instance): the promotion must survive it
    await a.putInstance(instance('other', SERIES_B, true));
    const fresh = new LocalCacheServiceClass();
    await fresh.ready();
    expect(fresh.getSeriesCopyStateSync(SERIES_A)).toBe('saved');
    expect(fresh.getSeriesCopyStateSync(SERIES_B)).toBe('temporary');
    expect(a.getSeriesCopyStateSync(SERIES_A)).toBe('saved');
  });

  it('a context whose index still lists bytes another context removed drops the stale entry instead of deleting anything', async () => {
    const a = service;
    await a.putInstance(instance('t1', SERIES_A, true));
    await a.putInstance(instance('t2', SERIES_A, true));
    const b = new LocalCacheServiceClass({ locks });
    await b.ready();
    await b.removeInstance(STUDY, SERIES_A, 't1');
    await b.markSaved(STUDY);

    await a.removeSessionInstances(STUDY);
    expect(a.isInstanceCachedSync('t1')).toBe(false);
    expect(a.isInstanceCachedSync('t2')).toBe(true);
    expect(records().has('t2')).toBe(true);
  });
});

describe('LocalCacheService: a saved copy stays saved', () => {
  it('a session fetch of an instance that is saved refreshes the bytes and keeps it saved, in the record and the index: a session removal leaves it, a saved-only removal takes it', async () => {
    await service.putInstance(instance('a', SERIES_A));
    await service.putInstance(instance('a', SERIES_A, true));
    expect(records().get('a').session).toBeUndefined();
    expect(service.isStudySavedSync(STUDY)).toBe(true);

    await service.removeSessionInstances(STUDY);
    expect(records().has('a')).toBe(true);
    expect(service.isInstanceCachedSync('a')).toBe(true);
    expect(service.getSeriesCopyStateSync(SERIES_A)).toBe('saved');

    await service.removeSavedInstances(STUDY);
    expect(records().has('a')).toBe(false);
    expect(service.isInstanceCachedSync('a')).toBe(false);
  });

  it('the same when the saved copy was written by another context the first one has not heard of', async () => {
    const a = service;
    const b = new LocalCacheServiceClass({ locks });
    await b.ready();
    await b.putInstance(instance('a', SERIES_A));
    await a.putInstance(instance('a', SERIES_A, true));
    expect(records().get('a').session).toBeUndefined();
    await a.removeSessionInstances(STUDY);
    expect(records().has('a')).toBe(true);
    expect(a.getSeriesCopyStateSync(SERIES_A)).toBe('saved');
  });
});

describe('LocalCacheService: markSaved / markSession, with the transfers that rely on a promotion', () => {
  it('a transfer promotes session copies with itself as holder and hands back, on cancellation, what it promoted and nothing saved outright', async () => {
    await service.putInstance(instance('t1', SERIES_A, true));
    await service.putInstance(instance('kept', SERIES_B));
    expect(await service.markSaved(STUDY, undefined, { holder: 'job-1' })).toEqual(['t1']);
    expect(records().get('t1').session).toBeUndefined();
    expect(service.getSeriesCopyStateSync(SERIES_A)).toBe('saved');
    expect(await service.markSession(STUDY, 'job-1')).toEqual(['t1']);
    expect(records().get('t1').session).toBe(true);
    expect(service.getSeriesCopyStateSync(SERIES_A)).toBe('temporary');
    expect(service.getSeriesCopyStateSync(SERIES_B)).toBe('saved');
  });

  it('a hand-back leaves an instance saved that was written as a saved copy since the promotion', async () => {
    await service.putInstance(instance('t1', SERIES_A, true));
    await service.markSaved(STUDY, undefined, { holder: 'job-1' });
    // Another owner saves the same instance (the write of an offline transfer, or a user action)
    await service.putInstance(instance('t1', SERIES_A));
    expect(await service.markSession(STUDY, 'job-1')).toEqual([]);
    expect(records().get('t1').session).toBeUndefined();
    expect(service.getSeriesCopyStateSync(SERIES_A)).toBe('saved');
    await service.removeSessionInstances(STUDY);
    expect(records().has('t1')).toBe(true);
  });

  it('a hand-back leaves an instance saved that another transfer confirmed meanwhile, in another context included', async () => {
    const a = service;
    const b = new LocalCacheServiceClass({ locks });
    await b.ready();
    await a.putInstance(instance('t1', SERIES_A, true));
    await a.putInstance(instance('t2', SERIES_A, true));

    // Transfer 1 (context A) promotes the copies; transfer 2 (context B) completes over the same scope
    await a.markSaved(STUDY, undefined, { holder: 'job-1' });
    expect(await b.markSaved(STUDY, undefined, { holder: 'job-2', confirm: true })).toEqual([]);
    // Transfer 1 is cancelled
    expect(await a.markSession(STUDY, 'job-1')).toEqual([]);
    expect(a.getSeriesCopyStateSync(SERIES_A)).toBe('saved');
    const fresh = new LocalCacheServiceClass({ locks });
    await fresh.ready();
    expect(fresh.getSeriesCopyStateSync(SERIES_A)).toBe('saved');
  });

  it('a copy a still-running transfer relies on stays saved when the transfer that promoted it is cancelled and the study is left; it returns to the session only when no transfer relies on it', async () => {
    await service.putInstance(instance('t1', SERIES_A, true));
    expect(await service.markSaved(STUDY, undefined, { holder: 'job-1' })).toEqual(['t1']);
    // Transfer 2 starts over the same scope: nothing to promote, but it relies on t1 from here on
    expect(await service.markSaved(STUDY, undefined, { holder: 'job-2' })).toEqual([]);

    // Transfer 1 is cancelled, then the viewing session leaves the study
    expect(await service.markSession(STUDY, 'job-1')).toEqual([]);
    await service.removeSessionInstances(STUDY);
    expect(records().has('t1')).toBe(true);
    expect(service.getSeriesCopyStateSync(SERIES_A)).toBe('saved');

    // Transfer 2 completes: confirmed, nothing can hand it back any more
    await service.markSaved(STUDY, undefined, { holder: 'job-2', confirm: true });
    expect(await service.markSession(STUDY, 'job-2')).toEqual([]);
    expect(service.getSeriesCopyStateSync(SERIES_A)).toBe('saved');

    // Had transfer 2 been cancelled as well, the copy would have gone back to the session
    await service.putInstance(instance('t2', SERIES_B, true));
    await service.markSaved(STUDY, SERIES_B, { holder: 'job-3' });
    await service.markSaved(STUDY, SERIES_B, { holder: 'job-4' });
    expect(await service.markSession(STUDY, 'job-3')).toEqual([]);
    expect(await service.markSession(STUDY, 'job-4')).toEqual(['t2']);
    expect(service.getSeriesCopyStateSync(SERIES_B)).toBe('temporary');
  });
});


describe('LocalCacheService: reports the viewer saved, across contexts and lifecycles', () => {
  const SR_SERIES = `${STUDY}.9`;
  const ADDS = `__studyadds__::${STUDY}`;
  const report = (sop, StudyInstanceUID = STUDY) => ({
    StudyInstanceUID,
    bytes: new ArrayBuffer(4),
    metadata: { StudyInstanceUID, SeriesInstanceUID: SR_SERIES, SOPInstanceUID: sop, Modality: 'SR', ...IDENTIFIERS },
    instance: { '0020000E': { vr: 'UI', Value: [SR_SERIES] }, '00080018': { vr: 'UI', Value: [sop] } },
    series: { '0020000E': { vr: 'UI', Value: [SR_SERIES] }, '00080060': { vr: 'CS', Value: ['SR'] } },
  });
  const payload = () => ({
    series: [{ '0020000E': { Value: [SERIES_A] } }],
    instancesBySeries: { [SERIES_A]: [{ '00080018': { Value: ['c1'] } }] },
  });
  const sopsOf = (stored, series) => ((stored && stored.instancesBySeries[series]) || []).map(e => e['00080018'].Value[0]);
  const fresh = async () => {
    const context = new LocalCacheServiceClass({ locks });
    await context.ready();
    return context;
  };

  it('stores a report for a copy another context saved after this one started', async () => {
    const other = await fresh();
    await other.putInstance(instance('c1'));
    await other.putStudyMetadataPayload(STUDY, payload());
    // This context's membership is stale: it hydrated before the copy existed
    expect(service.isStudyCachedSync(STUDY)).toBe(false);

    await expect(service.cacheViewerInstance(report('sr1'))).resolves.toBe(true);

    const reader = await fresh();
    expect(reader.isInstanceCachedSync('sr1')).toBe(true);
    expect(sopsOf(await reader.getStudyMetadataPayload(STUDY), SR_SERIES)).toEqual(['sr1']);
  });

  it('stores nothing for a study no context holds', async () => {
    await expect(service.cacheViewerInstance(report('sr1', OTHER_STUDY))).resolves.toBe(false);
    expect(records().has('sr1')).toBe(false);
    expect((await fresh()).isStudyCachedSync(OTHER_STUDY)).toBe(false);
  });

  it('hands a report back with the copy a cancelled transfer promoted, and the sweep takes it', async () => {
    await service.putInstance(instance('c1', SERIES_A, true));
    await service.markSaved(STUDY, undefined, { holder: 'job' });
    await service.cacheViewerInstance(report('sr1'));
    expect(service.getSeriesCopyStateSync(SR_SERIES)).toBe('saved');

    const demoted = await service.markSession(STUDY, 'job');
    expect(demoted.sort()).toEqual(['c1', 'sr1']);
    await service.removeSessionInstances(STUDY);

    expect(records().has('sr1')).toBe(false);
    expect(records().has(ADDS)).toBe(false);
    expect((await fresh()).isStudyCachedSync(STUDY)).toBe(false);
  });

  it('keeps a report once the transfer that promoted the copy completes', async () => {
    await service.putInstance(instance('c1', SERIES_A, true));
    await service.markSaved(STUDY, undefined, { holder: 'job' });
    await service.cacheViewerInstance(report('sr1'));
    await service.markSaved(STUDY, undefined, { holder: 'job', confirm: true });

    expect(await service.markSession(STUDY, 'job')).toEqual([]);
    await service.removeSessionInstances(STUDY);
    const reader = await fresh();
    expect(reader.getSeriesCopyStateSync(SR_SERIES)).toBe('saved');
    expect(records().get('sr1').session).toBeUndefined();
  });

  it('keeps a report saved while another transfer that holds the copy is still running', async () => {
    await service.putInstance(instance('c1', SERIES_A, true));
    await service.markSaved(STUDY, undefined, { holder: 'job-1' });
    await service.markSaved(STUDY, undefined, { holder: 'job-2' });
    await service.cacheViewerInstance(report('sr1'));

    await service.markSession(STUDY, 'job-1');
    await service.removeSessionInstances(STUDY);
    expect(service.isInstanceCachedSync('sr1')).toBe(true);
    expect(service.getSeriesCopyStateSync(SR_SERIES)).toBe('saved');

    expect(await service.markSession(STUDY, 'job-2')).toEqual(expect.arrayContaining(['c1', 'sr1']));
  });

  it('keeps a report confirmed when the study already holds a confirmed copy', async () => {
    await service.putInstance(instance('c1'));
    await service.cacheViewerInstance(report('sr1'));
    expect(await service.markSession(STUDY, 'job')).toEqual([]);
    expect(records().get('sr1').session).toBeUndefined();
  });

  it('does not let a write made while a clear is failing demote a copy another context saved', async () => {
    await service.putInstance(instance('x', SERIES_A, true));
    const other = await fresh();
    await other.markSaved(STUDY, SERIES_A, { confirm: true });

    const idb = require('idb-keyval');
    let failClear;
    const clearSpy = jest.spyOn(idb, 'clear').mockImplementationOnce(
      () => new Promise((resolve, reject) => { failClear = reject; })
    );
    const clearing = service.clearAll();
    await flush();
    // This context still remembers the instance as temporary
    const write = service.putInstance(instance('x', SERIES_A, true));
    await flush();
    failClear(new Error('clear failed'));
    await expect(clearing).rejects.toThrow('clear failed');
    await write;
    clearSpy.mockRestore();

    const reader = await fresh();
    expect(reader.isSeriesSavedSync(SERIES_A)).toBe(true);
    expect(records().get('x').session).toBeUndefined();
    await service.removeSessionInstances(STUDY);
    expect(records().has('x')).toBe(true);
  });

  describe('when the index write of a save fails', () => {
    const failNextIndexWrite = () => {
      const idb = require('idb-keyval');
      const original = idb.set;
      const spy = jest.spyOn(idb, 'set').mockImplementation((key, value, store) => {
        if (store && store.name === 'sonador-local-cache-index/index') {
          spy.mockRestore();
          return Promise.reject(new Error('QuotaExceededError'));
        }
        return original(key, value, store);
      });
    };

    it('takes back a first report entirely', async () => {
      await service.putInstance(instance('c1'));
      await service.putStudyMetadataPayload(STUDY, payload());
      failNextIndexWrite();
      await expect(service.cacheViewerInstance(report('sr1'))).rejects.toThrow('QuotaExceededError');

      expect(records().has('sr1')).toBe(false);
      expect(records().has(ADDS)).toBe(false);
      expect(service.isInstanceCachedSync('sr1')).toBe(false);
      const other = await fresh();
      await other.putStudyMetadataPayload(STUDY, payload());
      expect(sopsOf(await other.getStudyMetadataPayload(STUDY), SR_SERIES)).toEqual([]);
    });

    it('takes back a later report and keeps the earlier one, in every context', async () => {
      await service.putInstance(instance('c1'));
      await service.putStudyMetadataPayload(STUDY, payload());
      await service.cacheViewerInstance(report('sr1'));
      failNextIndexWrite();
      await expect(service.cacheViewerInstance(report('sr2'))).rejects.toThrow('QuotaExceededError');

      expect(records().has('sr2')).toBe(false);
      expect(Object.keys(records().get(ADDS))).toEqual(['sr1']);
      expect(service.isInstanceCachedSync('sr2')).toBe(false);

      // Another context writes a payload and evicts selectively: the earlier report alone is listed,
      // and goes with its series
      const other = await fresh();
      await other.putStudyMetadataPayload(STUDY, payload());
      expect(sopsOf(await other.getStudyMetadataPayload(STUDY), SR_SERIES)).toEqual(['sr1']);
      await other.removeSeries(STUDY, SR_SERIES);
      expect(records().has('sr1')).toBe(false);
      expect(records().has(ADDS)).toBe(false);
      expect(sopsOf(await other.getStudyMetadataPayload(STUDY), SR_SERIES)).toEqual([]);
    });
  });
});


describe('LocalCacheService: a clear landing inside adoption, a sweep repair, and a rollback', () => {
  const SR_SERIES = `${STUDY}.9`;
  const ADDS = `__studyadds__::${STUDY}`;
  const INDEX_STORE = 'sonador-local-cache-index/index';
  const idb = require('idb-keyval');
  const report = sop => ({
    StudyInstanceUID: STUDY,
    bytes: new ArrayBuffer(4),
    metadata: { StudyInstanceUID: STUDY, SeriesInstanceUID: SR_SERIES, SOPInstanceUID: sop, Modality: 'SR', ...IDENTIFIERS },
    instance: { '0020000E': { vr: 'UI', Value: [SR_SERIES] }, '00080018': { vr: 'UI', Value: [sop] } },
    series: { '0020000E': { vr: 'UI', Value: [SR_SERIES] }, '00080060': { vr: 'CS', Value: ['SR'] } },
  });
  const payload = () => ({
    series: [{ '0020000E': { Value: [SERIES_A] } }],
    instancesBySeries: { [SERIES_A]: [{ '00080018': { Value: ['c1'] } }] },
  });
  const sopsOf = (stored, series) => ((stored && stored.instancesBySeries[series]) || []).map(e => e['00080018'].Value[0]);
  const fresh = async () => {
    const context = new LocalCacheServiceClass({ locks });
    await context.ready();
    return context;
  };
  const until = async (predicate, what) => {
    for (let i = 0; i < 200; i += 1) {
      if (predicate()) return;
      await flush();
    }
    throw new Error(`timed out waiting for ${what}`);
  };
  // Holds the next read of the stored index once it has captured the index as it was
  const holdNextIndexRead = () => {
    const original = idb.get;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const held = { release, isHeld: false };
    const spy = jest.spyOn(idb, 'get').mockImplementation(async (key, store) => {
      if (store && store.name === INDEX_STORE) {
        spy.mockRestore();
        const value = await original(key, store);
        held.isHeld = true;
        await gate;
        return value;
      }
      return original(key, store);
    });
    return held;
  };
  // Holds the next write of the stored index; settled by the test (resolve to write, reject to fail)
  const holdNextIndexWrite = () => {
    const original = idb.set;
    const held = { isHeld: false };
    const spy = jest.spyOn(idb, 'set').mockImplementation((key, value, store) => {
      if (store && store.name === INDEX_STORE) {
        spy.mockRestore();
        held.isHeld = true;
        return new Promise((resolve, reject) => {
          held.release = () => original(key, value, store).then(resolve, reject);
          held.fail = error => reject(error);
        });
      }
      return original(key, value, store);
    });
    return held;
  };

  afterEach(() => jest.restoreAllMocks());

  describe('a clear that starts while a mutation reads the stored index', () => {
    const arrange = async () => {
      await service.putInstance(instance('c1'));
      await service.putStudyMetadataPayload(STUDY, payload());
    };

    it('voids the read of a save, which then abandons, and nothing comes back', async () => {
      await arrange();
      const read = holdNextIndexRead();
      const save = service.cacheViewerInstance(report('sr1'));
      await until(() => read.isHeld, 'the adoption read');
      const write = holdNextIndexWrite();
      const clearing = service.clearAll();
      await until(() => write.isHeld, "the clear's index write");
      read.release();
      await flush();
      write.release();
      await clearing;
      await expect(save).resolves.toBe(false);

      expect(service.isStudyCachedSync(STUDY)).toBe(false);
      expect(records().size).toBe(0);
      expect((await fresh()).isStudyCachedSync(STUDY)).toBe(false);
    });

    it('voids the read of a write without a clear token, which adopts the emptied index after the clear', async () => {
      await arrange();
      const read = holdNextIndexRead();
      const late = service.putInstance(instance('c2'));
      await until(() => read.isHeld, 'the adoption read');
      const write = holdNextIndexWrite();
      const clearing = service.clearAll();
      await until(() => write.isHeld, "the clear's index write");
      read.release();
      await flush();
      write.release();
      await clearing;
      await late;

      // The write lands after the clear, in an emptied cache: the cleared instance does not return
      expect(service.isInstanceCachedSync('c1')).toBe(false);
      const reader = await fresh();
      expect(reader.isInstanceCachedSync('c1')).toBe(false);
      expect(reader.getStudySummary(STUDY).instanceCount).toBe(1);
      expect(records().has('c1')).toBe(false);
    });

    it('voids the read when the clear then fails, and the write adopts the saved copy another context made', async () => {
      await service.putInstance(instance('x', SERIES_A, true));
      const other = await fresh();
      await other.markSaved(STUDY, SERIES_A, { confirm: true });

      const read = holdNextIndexRead();
      const late = service.putInstance(instance('x', SERIES_A, true));
      await until(() => read.isHeld, 'the adoption read');
      let failClear;
      jest.spyOn(idb, 'clear').mockImplementationOnce(() => new Promise((resolve, reject) => { failClear = reject; }));
      const clearing = service.clearAll();
      await flush();
      read.release();
      await flush();
      failClear(new Error('clear failed'));
      await expect(clearing).rejects.toThrow('clear failed');
      await late;

      expect((await fresh()).isSeriesSavedSync(SERIES_A)).toBe(true);
      expect(records().get('x').session).toBeUndefined();
    });
  });

  it('publishes a missing-record repair, so another context does not advertise the missing report', async () => {
    await service.putInstance(instance('c1'));
    await service.putStudyMetadataPayload(STUDY, payload());
    await service.cacheViewerInstance(report('sr1'));
    await service.cacheViewerInstance(report('sr2'));
    records().delete('sr1');

    // The prune of the missing report's addition fails, leaving it in the document
    const original = idb.get;
    jest.spyOn(idb, 'get').mockImplementation((key, store) => (
      key === ADDS ? Promise.reject(new Error('read failed')) : original(key, store)
    ));
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await service.removeSessionInstances(STUDY);
    idb.get.mockRestore();
    expect(Object.keys(records().get(ADDS)).sort()).toEqual(['sr1', 'sr2']);

    const other = await fresh();
    expect(other.isInstanceCachedSync('sr1')).toBe(false);
    await other.putStudyMetadataPayload(STUDY, payload());
    expect(sopsOf(await other.getStudyMetadataPayload(STUDY), SR_SERIES)).toEqual(['sr2']);
  });

  describe('a save whose index write fails while the cache is cleared', () => {
    const arrange = async () => {
      await service.putInstance(instance('c1'));
      await service.putStudyMetadataPayload(STUDY, payload());
      await service.cacheViewerInstance(report('sr1'));
    };
    const expectEmptied = async () => {
      expect(records().size).toBe(0);
      expect(service.isStudyCachedSync(STUDY)).toBe(false);
      expect(service.isInstanceCachedSync('sr1')).toBe(false);
      const reader = await fresh();
      expect(reader.isStudyCachedSync(STUDY)).toBe(false);
      expect(await reader.getStudyMetadataPayload(STUDY)).toBeNull();
    };

    it('restores nothing from before a clear that started while the index write was pending', async () => {
      await arrange();
      const write = holdNextIndexWrite();
      const save = service.cacheViewerInstance(report('sr2'));
      await until(() => write.isHeld, "the save's index write");
      const clearing = service.clearAll();
      await flush();
      write.fail(new Error('QuotaExceededError'));
      await expect(save).rejects.toThrow('QuotaExceededError');
      await clearing;
      await expectEmptied();
    });

    it('restores nothing from before a clear that started while the rollback was deleting', async () => {
      await arrange();
      const write = holdNextIndexWrite();
      const save = service.cacheViewerInstance(report('sr2'));
      await until(() => write.isHeld, "the save's index write");
      const releaseDelete = hold('sr2');
      write.fail(new Error('QuotaExceededError'));
      await flush();
      const clearing = service.clearAll();
      await flush();
      releaseDelete();
      await expect(save).rejects.toThrow('QuotaExceededError');
      await clearing;
      await expectEmptied();
    });
  });
});
