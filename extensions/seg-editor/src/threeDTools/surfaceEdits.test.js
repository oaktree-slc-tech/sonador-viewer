// Showing an edited surface, and the queue of labelmap writes behind surface edits

const mockGeometries = {};
const mockHistory = { push: jest.fn() };
const mockRender = jest.fn();
const mockSegmentation = { segments: { 1: {}, 2: {} } };
const mockLocked = new Set();

// virtual: jest's resolver does not follow the Cornerstone3D packages' `exports` maps
jest.mock('@cornerstonejs/core', () => ({
  cache: { getGeometry: id => mockGeometries[id] },
  getWebWorkerManager: () => ({}),
  utilities: { HistoryMemo: { DefaultHistoryMemo: mockHistory } },
}), { virtual: true });
jest.mock('@cornerstonejs/tools', () => ({
  segmentation: {
    state: { getSegmentation: () => mockSegmentation },
    segmentLocking: { isSegmentIndexLocked: (_id, index) => mockLocked.has(index) },
    triggerSegmentationEvents: {},
  },
  utilities: { segmentation: { triggerSegmentationRenderBySegmentationId: mockRender } },
}), { virtual: true });
jest.mock('@cornerstonejs/polymorphic-segmentation', () => ({ init: () => {} }), { virtual: true });
jest.mock('./registerHoleFillingWorker', () => ({ registerHoleFillingWorker: () => {} }));
jest.mock('./registerLabelmapCarveWorker', () => ({ registerLabelmapCarveWorker: () => {} }));
jest.mock('./surfaceActors', () => ({ refreshSurfaceActors: jest.fn(() => 0) }));
jest.mock('./segmentEdits', () => ({
  getLabelmapForEdit: jest.fn(),
  carveInWorker: jest.fn(),
  deltaInWorker: jest.fn(),
  applyLabelmapEdit: jest.fn(),
}));

const { applyLabelmapEdit, carveInWorker, deltaInWorker, getLabelmapForEdit } = require('./segmentEdits');
const { createSurfaceEditMemo } = require('./surfaceEditMemo');
const {
  cancelSurfaceEditWrites,
  pendingSurfaceEditWrites,
  queueSurfaceEditWrite,
  recordSurfaceEdit,
  runSurfaceEditWrite,
  setCachedSurface,
  SURFACE_CHANGED_REQUEST,
  WriteRefusedError,
} = require('./surfaceEdits');
const { get3DToolState, handle3DToolRequest, reset3DToolState } = require('./threeDToolState');

const EDIT_SEG = 'seg::edit';
const VOL3D = 'vol3d:seg::edit';
const volume = { id: 'labelmap' };

// A 1 mm, 8^3 labelmap at the origin, all segment 1
function labelmapForEdit() {
  return {
    volume,
    scalarData: new Uint8Array(512).fill(1),
    dimensions: [8, 8, 8],
    indexToWorld: ([i, j, k]) => [i, j, k],
  };
}

function memoFor({ editBox = { min: [2, 2, 2], max: [4, 4, 4] }, deps = {} } = {}) {
  return createSurfaceEditMemo({
    geometryId: 'g1',
    segmentIndex: 1,
    before: { points: Float32Array.from([1, 1, 1, 5, 1, 1, 1, 5, 1]), polys: Int32Array.from([3, 0, 1, 2]) },
    after: { points: Float32Array.from([1, 1, 1, 4, 1, 1, 1, 4, 1]), polys: Int32Array.from([3, 0, 1, 2]) },
    editBox,
    selectedPoints: [5, 1, 1],
    depth: 0,
    labelmapVolume: volume,
    deps: { setSurface: jest.fn(), queueWrite: jest.fn(), ...deps },
  });
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
  jest.clearAllMocks();
  cancelSurfaceEditWrites();
  reset3DToolState();
  mockLocked.clear();
  getLabelmapForEdit.mockImplementation(labelmapForEdit);
  carveInWorker.mockResolvedValue(Int32Array.from([3, 4]));
  applyLabelmapEdit.mockReturnValue({ changed: true, memo: { restoreMemo: jest.fn() } });
});

describe('setCachedSurface', () => {
  it('writes the surface to the cache, tells the canvas, and re-renders the segmentation', () => {
    mockGeometries.g1 = { data: { points: [0], polys: [0] } };
    const canvas = jest.fn();
    handle3DToolRequest(SURFACE_CHANGED_REQUEST, canvas);
    const surface = { points: Float32Array.from([1, 2, 3]), polys: Int32Array.from([3, 0, 0, 0]) };

    expect(setCachedSurface(VOL3D, 'g1', surface)).toBe(true);

    expect(mockGeometries.g1.data.points).toBe(surface.points);
    expect(mockGeometries.g1.data.polys).toBe(surface.polys);
    expect(canvas).toHaveBeenCalledWith({ geometryId: 'g1', keepSelection: false });
    expect(mockRender).toHaveBeenCalledWith(VOL3D);
  });

  it('pushes the surface into the VTK actors that show it', () => {
    mockGeometries.g1 = { data: { points: new Float32Array(3), polys: new Int32Array(0) } };
    const refreshActors = jest.fn();
    const surface = { points: Float32Array.from([1, 2, 3]), polys: new Int32Array(0) };

    setCachedSurface(VOL3D, 'g1', surface, { refreshActors });

    expect(refreshActors).toHaveBeenCalledWith(VOL3D, 'g1', surface);
  });

  it('does nothing without the geometry', () => {
    expect(setCachedSurface(VOL3D, 'missing', { points: [], polys: [] })).toBe(false);
    expect(mockRender).not.toHaveBeenCalled();
  });
});

describe('recordSurfaceEdit', () => {
  it('pushes the edit to the history and applies it: the surface shown, the write queued', () => {
    const setSurface = jest.fn();
    const queueWrite = jest.fn();
    const memo = memoFor({ deps: { setSurface, queueWrite } });

    recordSurfaceEdit(memo);

    expect(mockHistory.push).toHaveBeenCalledWith(memo);
    expect(setSurface).toHaveBeenCalledWith('g1', memo.after, { keepSelection: false });
    expect(queueWrite).toHaveBeenCalledWith(memo);
  });
});

describe('runSurfaceEditWrite', () => {
  it('carves the edit box in the worker and clears the voxels as an edit of its own', async () => {
    const memo = memoFor();
    memo.job = { cancelled: false };
    const withOwnEdit = jest.fn(fn => fn());

    expect(await runSurfaceEditWrite(memo, { editSegmentationId: EDIT_SEG, withOwnEdit })).toBe(true);

    const args = carveInWorker.mock.calls[0][0];
    expect(args).toMatchObject({ segmentIndex: 1, original: memo.before, edited: memo.after, dimensions: [8, 8, 8] });
    expect(args.indexBox).toEqual({ min: [0, 0, 0], max: [7, 7, 7] }); // the box padded by 3 voxels, clamped
    expect(args.boxData).toHaveLength(512);
    expect(withOwnEdit).toHaveBeenCalledTimes(1);
    const edit = applyLabelmapEdit.mock.calls[0][0];
    expect(edit).toMatchObject({ segmentationId: EDIT_SEG, volume });
    const set = jest.fn();
    edit.edit(set);
    expect(set.mock.calls).toEqual([[3, 0], [4, 0]]);
    expect(memo.labelmapMemo).toBe(applyLabelmapEdit.mock.results[0].value.memo);
    expect(memo.surfaceOnly).toBe(false);
    expect(memo.job).toBeNull();
  });

  it('takes the delta of a smooth in the worker and writes both its sides', async () => {
    const memo = memoFor();
    memo.write = { kind: 'smooth' };
    memo.job = { cancelled: false };
    const labelmap = labelmapForEdit();
    labelmap.scalarData[9] = 0;
    labelmap.scalarData[10] = 0;
    getLabelmapForEdit.mockReturnValue(labelmap);
    deltaInWorker.mockResolvedValue({ remove: Int32Array.from([3]), add: Int32Array.from([9, 10]) });

    expect(await runSurfaceEditWrite(memo, { editSegmentationId: EDIT_SEG })).toBe(true);

    expect(carveInWorker).not.toHaveBeenCalled();
    const args = deltaInWorker.mock.calls[0][0];
    expect(args).toMatchObject({ segmentIndex: 1, original: memo.before, edited: memo.after });
    expect(args.selectedPoints).toBeUndefined();
    const set = jest.fn();
    applyLabelmapEdit.mock.calls[0][0].edit(set);
    expect(set.mock.calls).toEqual([[3, 0], [9, 1], [10, 1]]);
  });

  it('writes only the voxels that still belong to the edit once the worker is done', async () => {
    // A slice edit lands while the worker runs: one removal candidate is now segment 2, one
    // addition candidate is no longer background. Neither is written; the others are.
    const memo = memoFor();
    memo.write = { kind: 'smooth' };
    memo.job = { cancelled: false };
    const labelmap = labelmapForEdit();
    labelmap.scalarData[9] = 0;
    labelmap.scalarData[10] = 0;
    getLabelmapForEdit.mockReturnValue(labelmap);
    deltaInWorker.mockImplementation(async () => {
      labelmap.scalarData[3] = 2;
      labelmap.scalarData[10] = 2;
      return { remove: Int32Array.from([3, 4]), add: Int32Array.from([9, 10]) };
    });

    expect(await runSurfaceEditWrite(memo, { editSegmentationId: EDIT_SEG })).toBe(true);

    const set = jest.fn();
    applyLabelmapEdit.mock.calls[0][0].edit(set);
    expect(set.mock.calls).toEqual([[4, 0], [9, 1]]);
    expect(memo.droppedVoxels).toBe(2);
  });

  it('writes nothing when every voxel changed hands meanwhile', async () => {
    const memo = memoFor();
    memo.job = { cancelled: false };
    const labelmap = labelmapForEdit();
    getLabelmapForEdit.mockReturnValue(labelmap);
    carveInWorker.mockImplementation(async () => {
      labelmap.scalarData.fill(2);
      return Int32Array.from([3, 4]);
    });

    expect(await runSurfaceEditWrite(memo, { editSegmentationId: EDIT_SEG })).toBe(false);

    expect(applyLabelmapEdit).not.toHaveBeenCalled();
    expect(memo.surfaceOnly).toBe(true);
  });

  it('refuses the write when the working volume was replaced while the worker ran', async () => {
    const memo = memoFor();
    memo.job = { cancelled: false };
    const replaced = { ...labelmapForEdit(), volume: { id: 'another labelmap' } };
    getLabelmapForEdit.mockReturnValueOnce(labelmapForEdit()).mockReturnValue(replaced);
    carveInWorker.mockResolvedValue(Int32Array.from([3]));

    await expect(runSurfaceEditWrite(memo, { editSegmentationId: EDIT_SEG })).rejects.toBeInstanceOf(WriteRefusedError);

    expect(applyLabelmapEdit).not.toHaveBeenCalled();
  });

  it('tells the canvas when a surface keeps its vertices', () => {
    const handler = jest.fn();
    handle3DToolRequest(SURFACE_CHANGED_REQUEST, handler);
    mockGeometries.g2 = { data: { points: new Float32Array(0), polys: new Int32Array(0) } };

    setCachedSurface(VOL3D, 'g2', { points: Float32Array.from([1, 1, 1]), polys: new Int32Array(0) }, { keepSelection: true });

    expect(handler).toHaveBeenCalledWith({ geometryId: 'g2', keepSelection: true });
  });

  it('voxelizes an emptied surface as having no inside', async () => {
    const memo = memoFor();
    memo.after = { points: new Float32Array(0), polys: new Int32Array(0) };
    memo.job = { cancelled: false };

    await runSurfaceEditWrite(memo, { editSegmentationId: EDIT_SEG });

    expect(carveInWorker.mock.calls[0][0].edited).toBeNull();
  });

  it('refuses the write when the segment is locked, gone, or edited in another labelmap', async () => {
    const run = memo => runSurfaceEditWrite(Object.assign(memo, { job: { cancelled: false } }), { editSegmentationId: EDIT_SEG });

    mockLocked.add(1);
    await expect(run(memoFor())).rejects.toBeInstanceOf(WriteRefusedError);
    mockLocked.clear();

    delete mockSegmentation.segments[1];
    await expect(run(memoFor())).rejects.toBeInstanceOf(WriteRefusedError);
    mockSegmentation.segments[1] = {};

    getLabelmapForEdit.mockReturnValue({ ...labelmapForEdit(), volume: { id: 'another' } });
    await expect(run(memoFor())).rejects.toBeInstanceOf(WriteRefusedError);

    expect(carveInWorker).not.toHaveBeenCalled();
    expect(applyLabelmapEdit).not.toHaveBeenCalled();
  });

  it('refuses the write when the target changed while the worker ran', async () => {
    const memo = memoFor();
    memo.job = { cancelled: false };
    carveInWorker.mockImplementation(async () => {
      mockLocked.add(1);
      return Int32Array.from([1]);
    });

    await expect(runSurfaceEditWrite(memo, { editSegmentationId: EDIT_SEG })).rejects.toBeInstanceOf(WriteRefusedError);
    expect(applyLabelmapEdit).not.toHaveBeenCalled();
  });

  it('does nothing for a write dropped by an undo, before or during the worker stage', async () => {
    const dropped = memoFor();
    dropped.job = { cancelled: true };
    expect(await runSurfaceEditWrite(dropped, { editSegmentationId: EDIT_SEG })).toBe(false);
    expect(carveInWorker).not.toHaveBeenCalled();

    const memo = memoFor();
    memo.job = { cancelled: false };
    carveInWorker.mockImplementation(async () => {
      memo.job.cancelled = true;
      return Int32Array.from([1]);
    });
    expect(await runSurfaceEditWrite(memo, { editSegmentationId: EDIT_SEG })).toBe(false);
    expect(applyLabelmapEdit).not.toHaveBeenCalled();
  });

  it('has nothing to write for an edit outside the labelmap, or that cleared no voxel', async () => {
    const outside = memoFor({ editBox: { min: [50, 50, 50], max: [52, 52, 52] } });
    outside.job = { cancelled: false };
    expect(await runSurfaceEditWrite(outside, { editSegmentationId: EDIT_SEG })).toBe(false);
    expect(outside.surfaceOnly).toBe(true);
    expect(carveInWorker).not.toHaveBeenCalled();

    carveInWorker.mockResolvedValue(new Int32Array(0));
    const unchanged = memoFor();
    unchanged.job = { cancelled: false };
    expect(await runSurfaceEditWrite(unchanged, { editSegmentationId: EDIT_SEG })).toBe(false);
    expect(unchanged.surfaceOnly).toBe(true);
    expect(applyLabelmapEdit).not.toHaveBeenCalled();
  });
});

describe('queueSurfaceEditWrite', () => {
  it('tracks a redo queued while the first write still runs as its own job', async () => {
    // Apply, undo while the worker runs, redo: the first job is cancelled, the second runs; the
    // count follows the running job, and closing the editor cancels it
    let finishFirst;
    const first = new Promise(resolve => { finishFirst = resolve; });
    const run = jest.fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => new Promise(() => {}));
    const memo = memoFor();
    const deps = { editSegmentationId: EDIT_SEG, run };

    queueSurfaceEditWrite(memo, deps);
    await flush();
    const firstJob = memo.job;
    memo.restoreMemo(true);      // undo: drops the pending write
    expect(firstJob.cancelled).toBe(true);
    queueSurfaceEditWrite(memo, deps); // redo
    expect(pendingSurfaceEditWrites()).toBe(2); // the cancelled job is still retiring
    expect(get3DToolState().pendingWrites).toBe(2);

    finishFirst(true);
    await flush();
    // Only the first job retired itself; the redo is still queued or running
    expect(pendingSurfaceEditWrites()).toBe(1);
    expect(get3DToolState().pendingWrites).toBe(1);
    expect(memo.job).not.toBe(firstJob);
    expect(memo.job.cancelled).toBe(false);

    cancelSurfaceEditWrites();
    expect(pendingSurfaceEditWrites()).toBe(0);
    expect(get3DToolState().pendingWrites).toBe(0);
    expect(memo.job).toBeNull();
  });

  it('runs the writes one after another, in order, and counts them while they are pending', async () => {
    const order = [];
    const gates = [];
    const run = jest.fn(memo => new Promise(resolve => gates.push(() => {
      order.push(memo.segmentIndex);
      resolve(true);
    })));
    const first = memoFor();
    const second = memoFor();
    second.segmentIndex = 2;

    const writes = [queueSurfaceEditWrite(first, { run }), queueSurfaceEditWrite(second, { run })];
    expect(get3DToolState().pendingWrites).toBe(2);
    expect(pendingSurfaceEditWrites()).toBe(2);
    await flush();
    expect(run).toHaveBeenCalledTimes(1);

    gates[0]();
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
    expect(get3DToolState().pendingWrites).toBe(1);

    gates[1]();
    expect(await Promise.all(writes)).toEqual([true, true]);
    expect(order).toEqual([1, 2]);
    expect(get3DToolState().pendingWrites).toBe(0);
    expect(pendingSurfaceEditWrites()).toBe(0);
  });

  it('keeps going after a write that failed, reporting it and leaving its surface edit standing', async () => {
    const onError = jest.fn();
    const onRefused = jest.fn();
    const failure = new Error('worker died');
    const run = jest.fn()
      .mockRejectedValueOnce(failure)
      .mockRejectedValueOnce(new WriteRefusedError())
      .mockResolvedValueOnce(true);
    const memos = [memoFor(), memoFor(), memoFor()];

    const results = await Promise.all(memos.map(memo => queueSurfaceEditWrite(memo, { run, onError, onRefused })));

    expect(results).toEqual([false, false, true]);
    expect(onError).toHaveBeenCalledWith(failure, memos[0]);
    expect(onRefused).toHaveBeenCalledWith(memos[1]);
    expect(memos[0].surfaceOnly).toBe(true);
    expect(memos[1].surfaceOnly).toBe(true);
    expect(memos[0].job).toBeNull();
    expect(get3DToolState().pendingWrites).toBe(0);
  });

  it('drops the queued writes when the editor closes, without reporting them', async () => {
    const onError = jest.fn();
    let release;
    const run = jest.fn(memo => {
      const job = memo.job;
      return new Promise((resolve, reject) => {
        release = () => (job.cancelled ? reject(new Error('late')) : resolve(true));
      });
    });
    const first = memoFor();
    const second = memoFor();
    const writes = [queueSurfaceEditWrite(first, { run, onError }), queueSurfaceEditWrite(second, { run, onError })];
    await flush();

    cancelSurfaceEditWrites();
    expect(first.job).toBeNull();
    expect(second.job).toBeNull();
    expect(pendingSurfaceEditWrites()).toBe(0);

    release();
    expect(await Promise.all(writes)).toEqual([false, false]);
    expect(run).toHaveBeenCalledTimes(1); // the second never started
    expect(onError).not.toHaveBeenCalled();
    expect(first.surfaceOnly).toBe(false);
  });

  it('runs the write of an edit the memo re-queues on redo', async () => {
    const run = jest.fn().mockResolvedValue(true);
    const memo = memoFor({ deps: { queueWrite: m => queueSurfaceEditWrite(m, { run }) } });

    memo.restoreMemo(false);
    await flush();

    expect(run).toHaveBeenCalledWith(memo, expect.any(Object));
  });
});
