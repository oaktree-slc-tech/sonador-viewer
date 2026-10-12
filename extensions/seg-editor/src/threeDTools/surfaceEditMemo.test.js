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
