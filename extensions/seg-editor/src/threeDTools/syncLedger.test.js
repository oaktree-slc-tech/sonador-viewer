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
