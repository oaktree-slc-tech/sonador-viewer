// The undo record of a surface edit

import { createSurfaceEditMemo, WRITE_KINDS } from './surfaceEditMemo';


function setup() {
  const deps = { setSurface: jest.fn(), queueWrite: jest.fn(), withOwnEdit: jest.fn(fn => fn()) };
  const before = { points: Float32Array.from([1, 2, 3]), polys: Int32Array.from([3, 0, 0, 0]) };
  const after = { points: Float32Array.from([4, 5, 6]), polys: Int32Array.from([3, 0, 0, 0]) };
  const memo = createSurfaceEditMemo({
    geometryId: 'g1', segmentIndex: 1, before, after,
    editBox: { min: [0, 0, 0], max: [1, 1, 1] }, selectedPoints: [1, 2, 3], depth: 2,
    labelmapVolume: { id: 'vol' }, deps,
  });
  return { deps, before, after, memo };
}

describe('createSurfaceEditMemo', () => {
  it('is a history item of its own kind', () => {
    const { memo } = setup();
    expect(memo.operationType).toBe('surface');
    expect(memo.id).toMatch(/^surface-edit-/);
  });

  it('describes the write it asks for: a delete with its points and depth unless told otherwise', () => {
    const { memo, deps } = setup();
    expect(memo.write).toEqual({ kind: WRITE_KINDS.delete, selectedPoints: [1, 2, 3], depth: 2 });
    expect(memo.keepSelection).toBe(false);

    const smooth = createSurfaceEditMemo({
      geometryId: 'g1', segmentIndex: 1, before: memo.before, after: memo.after, editBox: memo.editBox,
      write: { kind: WRITE_KINDS.smooth }, keepSelection: true, labelmapVolume: { id: 'vol' }, deps,
    });
    expect(smooth.write).toEqual({ kind: WRITE_KINDS.smooth });
    smooth.restoreMemo(true);
    expect(deps.setSurface).toHaveBeenCalledWith('g1', memo.before, { keepSelection: true });
  });

  it('applies the edit on redo: shows the surface and queues the write', () => {
    const { deps, after, memo } = setup();

    memo.restoreMemo(false);

    expect(deps.setSurface).toHaveBeenCalledWith('g1', after, { keepSelection: false });
    expect(deps.queueWrite).toHaveBeenCalledWith(memo);
  });

  it('drops a pending write on undo, and queues it again on redo', () => {
    const { deps, before, memo } = setup();
    const job = { cancelled: false };
    memo.job = job;

    memo.restoreMemo(true);

    expect(deps.setSurface).toHaveBeenCalledWith('g1', before, { keepSelection: false });
    expect(job.cancelled).toBe(true);
    expect(memo.job).toBeNull();

    memo.restoreMemo(false);
    expect(deps.queueWrite).toHaveBeenCalledWith(memo);
  });

  it('reverts and re-applies a made write through its labelmap memo, as its own edit', () => {
    const { deps, memo } = setup();
    const labelmapMemo = { restoreMemo: jest.fn() };
    memo.labelmapMemo = labelmapMemo;

    memo.restoreMemo(true);
    expect(labelmapMemo.restoreMemo).toHaveBeenCalledWith(true);
    expect(deps.withOwnEdit).toHaveBeenCalledTimes(1);
    expect(deps.queueWrite).not.toHaveBeenCalled();

    memo.restoreMemo(false);
    expect(labelmapMemo.restoreMemo).toHaveBeenLastCalledWith(false);
    expect(deps.queueWrite).not.toHaveBeenCalled();
  });

  it('does not queue a write again for an edit the labelmap has nothing for', () => {
    const { deps, memo } = setup();
    memo.surfaceOnly = true;

    memo.restoreMemo(true);
    memo.restoreMemo(false);

    expect(deps.queueWrite).not.toHaveBeenCalled();
    expect(deps.setSurface).toHaveBeenCalledTimes(2);
  });
});

describe('createSurfaceSyncMemo', () => {
  const { createSurfaceSyncMemo } = require('./surfaceEditMemo');
  function setupSync() {
    const deps = { queueWrite: jest.fn(), withOwnEdit: jest.fn(fn => fn()) };
    const before = { points: Float32Array.from([1, 2, 3]), polys: Int32Array.from([3, 0, 0, 0]) };
    const after = { points: Float32Array.from([4, 5, 6]), polys: Int32Array.from([3, 0, 0, 0]) };
    const covers = [{ id: 'a' }, { id: 'b' }];
    const acknowledged = { defects: { boundaryEdgeCount: 2 }, reason: 'labelmap' };
    const memo = createSurfaceSyncMemo({
      geometryId: 'g1', segmentIndex: 1, before, after, editBox: { min: [0, 0, 0], max: [1, 1, 1] },
      covers, acknowledged, labelmapVolume: { id: 'vol' }, deps,
    });
    return { deps, before, after, covers, acknowledged, memo };
  }

  it('is a synchronization record of the surface kind, asking for the sync write', () => {
    const { memo, covers, acknowledged, before, after } = setupSync();
    expect(memo).toMatchObject({
      operationType: 'surface', sync: true, write: { kind: WRITE_KINDS.sync }, covers, acknowledged, before, after,
      surfaceOnly: false, inForce: false, labelmapMemo: null, job: null,
    });
    expect(memo.id).toMatch(/^surface-sync-\d+$/);
  });

  it('queues its write once when applied, drops it on undo, and queues it again on redo, never touching the surface', () => {
    const { deps, memo } = setupSync();
    memo.restoreMemo(false);
    memo.restoreMemo(false);
    expect(deps.queueWrite).toHaveBeenCalledTimes(1);
    expect(memo.inForce).toBe(true);

    const job = { cancelled: false };
    memo.job = job;
    memo.restoreMemo(true);
    expect(job.cancelled).toBe(true);
    expect(memo.job).toBeNull();
    expect(memo.inForce).toBe(false);

    memo.restoreMemo(false);
    expect(deps.queueWrite).toHaveBeenCalledTimes(2);
  });

  it('reverts and re-applies made voxels through its labelmap memo, as its own edit', () => {
    const { deps, memo } = setupSync();
    memo.restoreMemo(false);
    const labelmapMemo = { restoreMemo: jest.fn() };
    memo.labelmapMemo = labelmapMemo;

    memo.restoreMemo(true);
    expect(labelmapMemo.restoreMemo).toHaveBeenCalledWith(true);
    expect(deps.withOwnEdit).toHaveBeenCalledTimes(1);
    memo.restoreMemo(false);
    expect(labelmapMemo.restoreMemo).toHaveBeenLastCalledWith(false);
    expect(deps.queueWrite).toHaveBeenCalledTimes(1);
  });

  it('does not queue the write again after it was refused or failed', () => {
    const { deps, memo } = setupSync();
    memo.restoreMemo(false);
    memo.surfaceOnly = true;
    memo.restoreMemo(true);
    memo.restoreMemo(false);
    expect(deps.queueWrite).toHaveBeenCalledTimes(1);
  });
});

describe('createSurfaceSyncMemo: one transaction over surface and voxels', () => {
  const { createSurfaceSyncMemo } = require('./surfaceEditMemo');
  const before = { points: Float32Array.from([1, 2, 3]), polys: Int32Array.from([3, 0, 0, 0]) };
  const middle = { points: Float32Array.from([2, 2, 3]), polys: Int32Array.from([3, 0, 0, 0]) };
  const after = { points: Float32Array.from([4, 5, 6]), polys: Int32Array.from([3, 0, 0, 0]) };

  it('restores the checkpoint surface with the voxels on undo, the synchronized surface on redo, and absorbs the edits it covers', () => {
    const editDeps = { setSurface: jest.fn(), queueWrite: jest.fn() };
    const covered = [
      createSurfaceEditMemo({ geometryId: 'g1', segmentIndex: 1, before, after: middle, editBox: { min: [0, 0, 0], max: [1, 1, 1] }, labelmapVolume: {}, deps: editDeps }),
      createSurfaceEditMemo({ geometryId: 'g1', segmentIndex: 1, before: middle, after, editBox: { min: [0, 0, 0], max: [1, 1, 1] }, labelmapVolume: {}, deps: editDeps }),
    ];
    covered.forEach(memo => { memo.surfaceOnly = true; });
    const deps = { setSurface: jest.fn(), queueWrite: jest.fn(), withOwnEdit: jest.fn(fn => fn()) };
    const memo = createSurfaceSyncMemo({
      geometryId: 'g1', segmentIndex: 1, before, after, editBox: { min: [0, 0, 0], max: [1, 1, 1] },
      covers: covered, labelmapVolume: { id: 'vol' }, deps,
    });
    expect(covered.map(c => c.absorbedBy)).toEqual([memo, memo]);

    memo.restoreMemo(false);
    expect(deps.setSurface).toHaveBeenLastCalledWith('g1', after, { keepSelection: true });
    memo.labelmapMemo = { restoreMemo: jest.fn() };
    memo.restoreMemo(true);
    expect(deps.setSurface).toHaveBeenLastCalledWith('g1', before, { keepSelection: false });
    expect(memo.labelmapMemo.restoreMemo).toHaveBeenCalledWith(true);

    // Below the record, the covered edits no longer move the surface either way
    editDeps.setSurface.mockClear();
    covered[1].restoreMemo(true);
    covered[0].restoreMemo(true);
    covered[0].restoreMemo(false);
    covered[1].restoreMemo(false);
    expect(editDeps.setSurface).not.toHaveBeenCalled();
    expect(editDeps.queueWrite).not.toHaveBeenCalled();

    memo.restoreMemo(false);
    expect(deps.setSurface).toHaveBeenLastCalledWith('g1', after, { keepSelection: true });
    expect(memo.labelmapMemo.restoreMemo).toHaveBeenLastCalledWith(false);
  });
});

describe('createSurfaceSyncMemo: a failed record covered by a later one', () => {
  const { createSurfaceSyncMemo } = require('./surfaceEditMemo');
  const before = { points: Float32Array.from([1, 2, 3]), polys: Int32Array.from([3, 0, 0, 0]) };
  const after = { points: Float32Array.from([4, 5, 6]), polys: Int32Array.from([3, 0, 0, 0]) };

  it('moves nothing on undo or redo once a retry absorbed it, and still drops its pending job', () => {
    const deps = { setSurface: jest.fn(), queueWrite: jest.fn(), withOwnEdit: jest.fn(fn => fn()) };
    const failed = createSurfaceSyncMemo({ geometryId: 'g1', segmentIndex: 1, before, after, editBox: { min: [0, 0, 0], max: [1, 1, 1] }, labelmapVolume: {}, deps });
    failed.restoreMemo(false);
    failed.surfaceOnly = true;
    failed.writeReport = { status: 'failed', message: 'worker lost' };
    const retry = createSurfaceSyncMemo({ geometryId: 'g1', segmentIndex: 1, before, after, editBox: { min: [0, 0, 0], max: [1, 1, 1] }, covers: [failed], labelmapVolume: {}, deps });
    expect(failed.absorbedBy).toBe(retry);

    deps.setSurface.mockClear();
    deps.queueWrite.mockClear();
    const job = { cancelled: false };
    failed.job = job;
    failed.restoreMemo(true);
    expect(job.cancelled).toBe(true);
    expect(failed.inForce).toBe(false);
    failed.restoreMemo(false);
    expect(failed.inForce).toBe(true);
    expect(deps.setSurface).not.toHaveBeenCalled();
    expect(deps.queueWrite).not.toHaveBeenCalled();
  });
});

describe('replayNeeds3DContext', () => {
  const { createSurfaceSyncMemo, replayNeeds3DContext } = require('./surfaceEditMemo');
  const surfaceMemo = () => createSurfaceEditMemo({
    geometryId: 'g1', segmentIndex: 1,
    before: { points: Float32Array.from([1, 2, 3]), polys: Int32Array.from([3, 0, 0, 0]) },
    after: { points: Float32Array.from([4, 5, 6]), polys: Int32Array.from([3, 0, 0, 0]) },
    editBox: { min: [0, 0, 0], max: [1, 1, 1] }, labelmapVolume: {}, deps: { setSurface: jest.fn(), queueWrite: jest.fn() },
  });

  it('names the replays that restore a surface without its voxels, and only those', () => {
    const surfaceOnly = surfaceMemo();
    surfaceOnly.surfaceOnly = true;
    expect(replayNeeds3DContext(surfaceOnly)).toBe(true);
    const failed = surfaceMemo();
    failed.surfaceOnly = true;
    failed.writeReport = { status: 'failed' };
    expect(replayNeeds3DContext(failed)).toBe(true);
    const dropped = surfaceMemo(); // its write was dropped by an undo; a redo would queue anew
    expect(replayNeeds3DContext(dropped)).toBe(true);

    const written = surfaceMemo();
    written.labelmapMemo = { restoreMemo: jest.fn() };
    expect(replayNeeds3DContext(written)).toBe(false);
    const nothing = surfaceMemo();
    nothing.surfaceOnly = true;
    nothing.writeReport = { status: 'nothing' };
    expect(replayNeeds3DContext(nothing)).toBe(false);
    const sync = createSurfaceSyncMemo({
      geometryId: 'g1', segmentIndex: 1, before: surfaceOnly.before, after: surfaceOnly.after,
      editBox: surfaceOnly.editBox, covers: [surfaceOnly], labelmapVolume: {}, deps: { setSurface: jest.fn(), queueWrite: jest.fn() },
    });
    expect(replayNeeds3DContext(surfaceOnly)).toBe(false); // absorbed
    sync.surfaceOnly = true;
    sync.writeReport = { status: 'failed' };
    expect(replayNeeds3DContext(sync)).toBe(true);
    sync.labelmapMemo = { restoreMemo: jest.fn() };
    expect(replayNeeds3DContext(sync)).toBe(false);

    expect(replayNeeds3DContext({ operationType: 'labelmap' })).toBe(false);
    expect(replayNeeds3DContext([{ operationType: 'labelmap' }, failed])).toBe(true);
    expect(replayNeeds3DContext(null)).toBe(false);
  });
});
