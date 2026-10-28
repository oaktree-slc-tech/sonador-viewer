// The session-scoped ledger of surface edits the 2D views have not received

jest.mock('@cornerstonejs/core', () => ({ cache: { getGeometry: () => null } }), { virtual: true });

import { createSurfaceEditMemo } from './surfaceEditMemo';
import {
  configureSyncLedger,
  isUnsynchronizedMemo,
  memosInForce,
  publishSyncLedger,
  resetSyncLedger,
  trackSurfaceEditMemo,
  unsynchronizedEdits,
  unsynchronizedPredecessors,
} from './syncLedger';
import { get3DToolState, reset3DToolState, set3DToolTarget } from './threeDToolState';

const surface = n => ({ points: Float32Array.from([n, 0, 0, 0, n, 0, 0, 0, n]), polys: Int32Array.from([3, 0, 1, 2]) });

describe('syncLedger', () => {
  const cache = { g: null };
  const setSurface = jest.fn((geometryId, next) => { cache[geometryId] = next.points; });
  const queueWrite = jest.fn();
  const memo = (before, after, { surfaceOnly = false, segmentIndex = 1 } = {}) => {
    const m = createSurfaceEditMemo({
      geometryId: 'g', segmentIndex, before, after, editBox: { min: [0, 0, 0], max: [1, 1, 1] },
      write: { kind: 'delete', selectedPoints: new Float64Array(0), depth: 0 }, labelmapVolume: {},
      deps: { setSurface, queueWrite },
    });
    m.surfaceOnly = surfaceOnly;
    return trackSurfaceEditMemo(m);
  };

  beforeEach(() => {
    reset3DToolState();
    resetSyncLedger();
    configureSyncLedger({ getPoints: geometryId => cache[geometryId] });
    set3DToolTarget({ segmentIndex: 1, label: 'Liver' });
    cache.g = null;
    jest.clearAllMocks();
  });
  afterAll(() => configureSyncLedger());

  it('follows memos through apply, undo and redo, and publishes the count for the target', () => {
    const s0 = surface(0);
    const s1 = surface(1);
    const s2 = surface(2);
    cache.g = s0.points;
    const a = memo(s0, s1, { surfaceOnly: true });
    const b = memo(s1, s2);

    a.restoreMemo(false);
    expect(memosInForce('g')).toEqual([a]);
    expect(unsynchronizedEdits('g')).toBe(1);
    expect(get3DToolState().unsynchronizedEdits).toBe(1);
    b.restoreMemo(false);
    expect(queueWrite).toHaveBeenCalledWith(b);
    expect(memosInForce('g')).toEqual([a, b]);
    expect(unsynchronizedPredecessors(b)).toEqual([a]);
    expect(unsynchronizedPredecessors(a)).toEqual([]);
    expect(unsynchronizedEdits('g')).toBe(1);

    b.restoreMemo(true);
    expect(memosInForce('g')).toEqual([a]);
    a.restoreMemo(true);
    expect(memosInForce('g')).toEqual([]);
    expect(get3DToolState().unsynchronizedEdits).toBe(0);
    a.restoreMemo(false);
    expect(get3DToolState().unsynchronizedEdits).toBe(1);
    // Tracking twice wraps once
    expect(trackSurfaceEditMemo(a)).toBe(a);
    a.restoreMemo(true);
    expect(memosInForce('g')).toEqual([]);
  });

  it('drops a surface the labelmap rebuilt, counts refused writes, and not writes that changed nothing', () => {
    const s0 = surface(0);
    const s1 = surface(1);
    cache.g = s0.points;
    const a = memo(s0, s1);
    a.restoreMemo(false);
    expect(isUnsynchronizedMemo(a)).toBe(false);
    a.surfaceOnly = true;
    a.writeReport = { status: 'refused', reason: 'domain' };
    expect(isUnsynchronizedMemo(a)).toBe(true);
    publishSyncLedger();
    expect(get3DToolState().unsynchronizedEdits).toBe(1);
    a.writeReport = { status: 'nothing' };
    expect(isUnsynchronizedMemo(a)).toBe(false);
    publishSyncLedger();
    expect(get3DToolState().unsynchronizedEdits).toBe(0);

    // A slice edit rebuilt the surface: the ledger of that surface goes
    a.writeReport = { status: 'failed' };
    cache.g = surface(9).points;
    expect(memosInForce('g')).toEqual([]);
    expect(unsynchronizedPredecessors(a)).toEqual([]);
    publishSyncLedger();
    expect(get3DToolState().unsynchronizedEdits).toBe(0);
  });

  it('publishes for the target segment only, and resets with the session', () => {
    const s0 = surface(0);
    const s1 = surface(1);
    cache.g = s0.points;
    const a = memo(s0, s1, { surfaceOnly: true, segmentIndex: 2 });
    a.restoreMemo(false);
    expect(get3DToolState().unsynchronizedEdits).toBe(0);
    set3DToolTarget({ segmentIndex: 2, label: 'Spleen' });
    publishSyncLedger();
    expect(get3DToolState().unsynchronizedEdits).toBe(1);
    set3DToolTarget(null);
    publishSyncLedger();
    expect(get3DToolState().unsynchronizedEdits).toBe(0);

    set3DToolTarget({ segmentIndex: 2, label: 'Spleen' });
    publishSyncLedger();
    resetSyncLedger();
    expect(memosInForce('g')).toEqual([]);
    expect(get3DToolState().unsynchronizedEdits).toBe(0);
  });
});

describe('syncLedger: checkpoints and synchronizations (ohif-viewers#152)', () => {
  const { createSurfaceSyncMemo } = require('./surfaceEditMemo');
  const { isFailedWriteMemo, surfaceCheckpoint, unionBoxes } = require('./syncLedger');
  const cache = { g: null };
  const setSurface = jest.fn((geometryId, next) => { cache[geometryId] = next.points; });
  const queueWrite = jest.fn();
  const box = (lo, hi) => ({ min: [lo, lo, lo], max: [hi, hi, hi] });
  const edit = (before, after, editBox, { surfaceOnly = true } = {}) => {
    const m = createSurfaceEditMemo({
      geometryId: 'g', segmentIndex: 1, before, after, editBox,
      write: { kind: 'delete', selectedPoints: new Float64Array(0), depth: 0 }, labelmapVolume: {},
      deps: { setSurface, queueWrite },
    });
    m.surfaceOnly = surfaceOnly;
    return trackSurfaceEditMemo(m);
  };
  const sync = (before, after, covers, editBox = unionBoxes(covers.map(c => c.editBox))) => trackSurfaceEditMemo(createSurfaceSyncMemo({
    geometryId: 'g', segmentIndex: 1, before, after, editBox, covers, acknowledged: null, labelmapVolume: {},
    deps: { queueWrite },
  }));

  beforeEach(() => {
    reset3DToolState();
    resetSyncLedger();
    configureSyncLedger({ getPoints: geometryId => cache[geometryId] });
    set3DToolTarget({ segmentIndex: 1, label: 'Liver' });
    cache.g = null;
    jest.clearAllMocks();
  });
  afterAll(() => configureSyncLedger());

  it('unites boxes, and has none for none', () => {
    expect(unionBoxes([box(2, 4), box(0, 3), null])).toEqual({ min: [0, 0, 0], max: [4, 4, 4] });
    expect(unionBoxes([])).toBeNull();
    expect(unionBoxes([undefined])).toBeNull();
  });

  it('names the checkpoint: the surface before the first unsynchronized edit, the edits since and their region', () => {
    const [s0, s1, s2, s3] = [0, 1, 2, 3].map(surface);
    cache.g = s0.points;
    const a = edit(s0, s1, box(0, 1), { surfaceOnly: false });
    a.restoreMemo(false);
    a.writeReport = { status: 'written' };
    expect(surfaceCheckpoint('g')).toBeNull();

    const b = edit(s1, s2, box(2, 4));
    const c = edit(s2, s3, box(3, 6));
    b.restoreMemo(false);
    c.restoreMemo(false);
    const checkpoint = surfaceCheckpoint('g');
    expect(checkpoint.surface).toBe(s1);
    expect(checkpoint.memos).toEqual([b, c]);
    expect(checkpoint.editBox).toEqual({ min: [2, 2, 2], max: [6, 6, 6] });
    expect(checkpoint.failed).toBe(0);

    // A write that failed is counted apart from one never asked for
    c.writeReport = { status: 'failed', message: 'worker lost' };
    expect(isFailedWriteMemo(c)).toBe(true);
    expect(isFailedWriteMemo(b)).toBe(false);
    expect(surfaceCheckpoint('g').failed).toBe(1);
    publishSyncLedger();
    expect(get3DToolState()).toMatchObject({ unsynchronizedEdits: 2, failedWrites: 1 });

    // The surface rebuilt from the labelmap: no checkpoint, the labelmap is the authority
    cache.g = surface(9).points;
    expect(surfaceCheckpoint('g')).toBeNull();
  });

  it('lets a synchronization in force cover the edits before it, and not once its write failed', () => {
    const [s0, s1, s2, s3] = [0, 1, 2, 3].map(surface);
    cache.g = s0.points;
    const a = edit(s0, s1, box(0, 2));
    const b = edit(s1, s2, box(1, 3));
    a.restoreMemo(false);
    b.restoreMemo(false);
    expect(unsynchronizedEdits('g')).toBe(2);

    const s = sync(s0, s2, [a, b]);
    s.restoreMemo(false);
    expect(queueWrite).toHaveBeenCalledWith(s);
    expect(s.editBox).toEqual({ min: [0, 0, 0], max: [3, 3, 3] });
    // Pending: the covered edits no longer count, and nothing blocks the synchronization
    expect(unsynchronizedEdits('g')).toBe(0);
    expect(unsynchronizedPredecessors(s)).toEqual([]);
    expect(surfaceCheckpoint('g')).toBeNull();
    expect(memosInForce('g')).toEqual([a, b, s]);

    // Refused or failed: it covers nothing and is itself unsynchronized
    s.surfaceOnly = true;
    s.writeReport = { status: 'failed', message: 'worker lost' };
    expect(unsynchronizedEdits('g')).toBe(3);
    expect(surfaceCheckpoint('g')).toMatchObject({ surface: s0, memos: [a, b, s], failed: 1 });
    publishSyncLedger();
    expect(get3DToolState()).toMatchObject({ unsynchronizedEdits: 3, failedWrites: 1 });

    // Undone, it leaves the edits as they were; redone after a write that was made, it covers again
    s.restoreMemo(true);
    expect(memosInForce('g')).toEqual([a, b]);
    expect(unsynchronizedEdits('g')).toBe(2);
    s.surfaceOnly = false;
    s.writeReport = { status: 'written' };
    s.labelmapMemo = { restoreMemo: jest.fn() };
    s.restoreMemo(false);
    expect(s.labelmapMemo.restoreMemo).toHaveBeenCalledWith(false);
    expect(unsynchronizedEdits('g')).toBe(0);

    // A later surface-only edit starts a new checkpoint at the synchronized surface
    const c = edit(s2, s3, box(5, 6));
    c.restoreMemo(false);
    expect(unsynchronizedEdits('g')).toBe(1);
    expect(surfaceCheckpoint('g')).toMatchObject({ surface: s2, memos: [c], editBox: box(5, 6) });
    expect(unsynchronizedPredecessors(c)).toEqual([]);
  });

  it('blocks a synchronization on an unsynchronized predecessor it was not made to cover', () => {
    const [s0, s1, s2] = [0, 1, 2].map(surface);
    cache.g = s0.points;
    const a = edit(s0, s1, box(0, 1));
    const pending = edit(s1, s2, box(1, 2), { surfaceOnly: false });
    a.restoreMemo(false);
    pending.restoreMemo(false);
    const s = sync(s0, s2, [a]);
    s.restoreMemo(false);
    expect(unsynchronizedPredecessors(s)).toEqual([]);

    // The pending write fails after the synchronization was prepared: it blocks the write
    pending.surfaceOnly = true;
    pending.writeReport = { status: 'refused', reason: 'target' };
    expect(unsynchronizedPredecessors(s)).toEqual([pending]);
    // ... but not an ordinary memo's view of its own predecessors
    expect(unsynchronizedPredecessors(pending)).toEqual([a]);
  });
});

describe('syncLedger: every unsynchronized surface of the session', () => {
  const { createSurfaceSyncMemo } = require('./surfaceEditMemo');
  const { unsynchronizedSurfaces } = require('./syncLedger');
  const cache = {};
  const setSurface = jest.fn((geometryId, next) => { cache[geometryId] = next.points; });
  const edit = (geometryId, segmentIndex, before, after, surfaceOnly = true) => {
    const m = createSurfaceEditMemo({
      geometryId, segmentIndex, before, after, editBox: { min: [0, 0, 0], max: [1, 1, 1] },
      write: { kind: 'delete', selectedPoints: new Float64Array(0), depth: 0 }, labelmapVolume: {},
      deps: { setSurface, queueWrite: jest.fn() },
    });
    m.surfaceOnly = surfaceOnly;
    return trackSurfaceEditMemo(m);
  };

  beforeEach(() => {
    reset3DToolState();
    resetSyncLedger();
    configureSyncLedger({ getPoints: geometryId => cache[geometryId] });
    Object.keys(cache).forEach(key => delete cache[key]);
  });
  afterAll(() => configureSyncLedger());

  it('lists the surfaces with a checkpoint, whichever segment is the target, and an emptied surface too', () => {
    const [s0, s1, s2] = [0, 1, 2].map(surface);
    const empty = { points: new Float32Array(0), polys: new Int32Array(0) };
    cache.a = s0.points;
    cache.b = s0.points;
    edit('a', 1, s0, s1).restoreMemo(false);
    const written = edit('b', 2, s0, s1, false);
    written.restoreMemo(false);
    written.writeReport = { status: 'written' };
    expect(unsynchronizedSurfaces().map(entry => [entry.geometryId, entry.segmentIndex])).toEqual([['a', 1]]);

    // The whole of b removed, and the removal's write failed: no mesh, still unfinished
    const removal = edit('b', 2, s1, empty, false);
    removal.restoreMemo(false);
    removal.surfaceOnly = true;
    removal.writeReport = { status: 'failed', message: 'worker lost' };
    const found = unsynchronizedSurfaces();
    expect(found.map(entry => entry.geometryId)).toEqual(['a', 'b']);
    expect(found[1].checkpoint).toMatchObject({ surface: s1, memos: [removal], failed: 1 });

    const sync = trackSurfaceEditMemo(createSurfaceSyncMemo({
      geometryId: 'a', segmentIndex: 1, before: s0, after: s1, editBox: { min: [0, 0, 0], max: [1, 1, 1] },
      covers: found[0].checkpoint.memos, labelmapVolume: {}, deps: { setSurface, queueWrite: jest.fn() },
    }));
    sync.restoreMemo(false);
    expect(unsynchronizedSurfaces().map(entry => entry.geometryId)).toEqual(['b']);
    cache.b = s2.points; // rebuilt from the labelmap
    expect(unsynchronizedSurfaces()).toEqual([]);
  });
});
