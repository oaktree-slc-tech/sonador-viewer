// Importing segments into the working segmentation: numbering, rasterizing and the merge

import { volumeAxes } from '../threeDTools/labelmapCarve';

import { resetPolySegInFlight } from '@ohif/core/src/utils/polySegSingleFlight';

import {
  _resetImportChains,
  allocateSegmentIndices, ImportCancelledError, importIntoSegmentation, labelmapWorldBounds, MAX_SEGMENT_INDEX,
  payloadWorldBounds,
} from './labelmapImport';

jest.mock('@ohif/core/src/log.js', () => ({ debug: jest.fn(), error: jest.fn() }));

// virtual: jest's resolver does not follow the Cornerstone3D packages' `exports` maps
jest.mock('@cornerstonejs/core', () => ({ cache: {}, utilities: {}, getWebWorkerManager: () => ({}) }), { virtual: true });
jest.mock('@cornerstonejs/tools', () => ({
  segmentation: { state: {}, segmentLocking: { isSegmentIndexLocked: () => false }, triggerSegmentationEvents: {} },
  utilities: { segmentation: {} },
}), { virtual: true });
jest.mock('@cornerstonejs/polymorphic-segmentation', () => ({ init: () => {} }), { virtual: true });
jest.mock('@ohif/extension-viewerm3d', () => ({}), { virtual: true });
jest.mock('../threeDTools/registerHoleFillingWorker', () => ({ registerHoleFillingWorker: () => {} }));


// A 4 x 4 x 4 unit labelmap, with segment 1 painted at the first two voxels
function makeLabelmap() {
  const scalarData = new Uint8Array(64);
  scalarData[0] = 1;
  scalarData[1] = 1;
  return { volume: { id: 'vol' }, scalarData, dimensions: [4, 4, 4], indexToWorld: ijk => ijk };
}

function makeDeps(labelmap, segments = { 1: { segmentIndex: 1 } }, extra = {}) {
  // `segments` is live: the service mocks mutate it as the real service mutates the segmentation
  const writes = [];
  const deps = {
    getLabelmap: jest.fn(() => labelmap),
    getSegmentation: jest.fn(() => ({ segments })),
    addSegment: jest.fn((id, { segmentIndex, label }) => { segments[segmentIndex] = { segmentIndex, label }; }),
    removeSegment: jest.fn((id, segmentIndex) => { delete segments[segmentIndex]; }),
    getActiveSegmentIndex: jest.fn(() => 1),
    setActiveSegmentIndex: jest.fn(),
    isSegmentLocked: jest.fn(() => false),
    restoreVoxels: jest.fn(),
    writeVoxels: jest.fn(({ edit }) => edit((index, value) => writes.push([index, value]))),
    ...extra,
  };
  return { deps, writes, segments };
}

const unitGrid = (data = new Uint8Array(64)) => ({ data, dimensions: [4, 4, 4], origin: [0, 0, 0], spacing: [1, 1, 1] });

afterEach(() => _resetImportChains());

describe('allocateSegmentIndices', () => {
  it('numbers on from the highest existing segment', () => {
    expect(allocateSegmentIndices({ segments: {} }, 2)).toEqual([1, 2]);
    expect(allocateSegmentIndices({ segments: { 1: {}, 3: {} } }, 2)).toEqual([4, 5]);
    expect(allocateSegmentIndices(undefined, 1)).toEqual([1]);
  });

  it('refuses to go past the labelmap\'s 8-bit range', () => {
    const segments = { [MAX_SEGMENT_INDEX - 1]: {} };
    expect(allocateSegmentIndices({ segments }, 1)).toEqual([MAX_SEGMENT_INDEX]);
    expect(() => allocateSegmentIndices({ segments }, 2)).toThrow(/at most 255/);
  });
});

describe('importIntoSegmentation', () => {
  it('imports a grid: adds the segments in order, writes their voxels and counts the overlap', async () => {
    const labelmap = makeLabelmap();
    const { deps, writes } = makeDeps(labelmap, { 1: {}, 4: {} });
    const data = new Uint8Array(64);
    data[0] = 5;   // over the existing segment 1
    data[2] = 5;
    data[9] = 9;
    const payload = {
      grid: { data, dimensions: [4, 4, 4], origin: [0, 0, 0], spacing: [1, 1, 1] },
      segments: [{ value: 5, label: 'liver', color: [10, 20, 30] }, { value: 9, label: 'segment-9' }],
    };

    const result = await importIntoSegmentation({ segmentationId: 'work', payload, deps });

    expect(deps.addSegment.mock.calls).toEqual([
      ['work', { segmentIndex: 5, label: 'liver', color: [10, 20, 30, 255] }],
      ['work', { segmentIndex: 6, label: 'segment-9' }],
    ]);
    expect(writes).toEqual([[0, 5], [2, 5], [9, 6]]);
    expect(deps.writeVoxels).toHaveBeenCalledWith(expect.objectContaining({ segmentationId: 'work', volume: labelmap.volume }));
    expect(result).toEqual({
      segments: [
        { segmentIndex: 5, label: 'liver', voxels: 2 },
        { segmentIndex: 6, label: 'segment-9', voxels: 1 },
      ],
      emptySegments: [],
      overlapVoxels: 1,
      lockedVoxels: 0,
      writtenVoxels: 3,
      sourceBounds: { min: [0, 0, 0], max: [3, 3, 3] },
      targetBounds: { min: [0, 0, 0], max: [3, 3, 3] },
    });
  });

  it('imports models through the voxelizer, and leaves out one that fails instead of adding it empty', async () => {
    const labelmap = makeLabelmap();
    const failure = new Error('bad surface');
    const voxelize = jest.fn(async surface => {
      if (surface.points[0] === 99) {
        throw failure;
      }
      // Everything inside the labelmap's box
      return { data: new Uint8Array(64).fill(1), dimensions: [4, 4, 4], origin: [0, 0, 0], spacing: [1, 1, 1] };
    });
    // Segments 1..3 exist, so the models become 4 and 5 (over the painted segment 1 at two voxels)
    const { deps, writes } = makeDeps(labelmap, { 1: {}, 3: {} }, { voxelize });
    const surface = points => ({ points: Float32Array.from(points), polys: Int32Array.from([3, 0, 1, 2]) });
    const payload = {
      models: [
        { label: 'femur', surface: surface([0, 0, 0, 3, 3, 3, 0, 3, 3]) },
        { label: 'broken', surface: surface([99, 0, 0, 3, 3, 3, 0, 3, 3]) },
      ],
    };
    const onProgress = jest.fn();

    const result = await importIntoSegmentation({ segmentationId: 'work', payload, onProgress, deps });

    expect(voxelize).toHaveBeenCalledTimes(2);
    expect(deps.addSegment.mock.calls.map(([, config]) => config)).toEqual([{ segmentIndex: 4, label: 'femur' }]);
    expect(writes).toHaveLength(64);
    expect(writes.every(([, value]) => value === 4)).toBe(true);
    expect(result.segments).toEqual([{ segmentIndex: 4, label: 'femur', voxels: 64 }]);
    expect(result.emptySegments).toEqual([{ label: 'broken', error: failure }]);
    expect(result.overlapVoxels).toBe(2);
    expect(result.sourceBounds).toEqual({ min: [0, 0, 0], max: [99, 3, 3] });
    expect(onProgress).toHaveBeenLastCalledWith(1);
  });

  it('numbers the added segments consecutively, closing the gap an empty one would leave', async () => {
    const labelmap = makeLabelmap();
    const { deps, writes } = makeDeps(labelmap, { 1: {}, 2: {} });
    const data = new Uint8Array(64);
    data[5] = 9;
    const payload = {
      grid: { data, dimensions: [4, 4, 4], origin: [0, 0, 0], spacing: [1, 1, 1] },
      // value 1 is nowhere in the grid, so 'missing' is left out and 'present' takes segment 3
      segments: [{ value: 1, label: 'missing' }, { value: 9, label: 'present' }],
    };

    const result = await importIntoSegmentation({ segmentationId: 'work', payload, deps });

    expect(deps.addSegment.mock.calls).toEqual([['work', { segmentIndex: 3, label: 'present' }]]);
    expect(writes).toEqual([[5, 3]]);
    expect(result.segments).toEqual([{ segmentIndex: 3, label: 'present', voxels: 1 }]);
    expect(result.emptySegments).toEqual([{ label: 'missing', error: undefined }]);
  });

  it('adds nothing and writes nothing when every segment is empty, but still says where things are', async () => {
    const labelmap = { ...makeLabelmap(), indexToWorld: ijk => ijk.map(v => 100 + 2 * v) };
    const { deps, writes } = makeDeps(labelmap);
    const payload = {
      grid: { data: new Uint8Array(64).fill(1), dimensions: [4, 4, 4], origin: [0, 0, 0], spacing: [1, 1, 1] },
      segments: [{ value: 1, label: 'far away' }],
    };

    const result = await importIntoSegmentation({ segmentationId: 'work', payload, deps });

    expect(deps.addSegment).not.toHaveBeenCalled();
    expect(deps.writeVoxels).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    expect(result).toEqual({
      segments: [],
      emptySegments: [{ label: 'far away', error: undefined }],
      overlapVoxels: 0,
      lockedVoxels: 0,
      writtenVoxels: 0,
      sourceBounds: { min: [0, 0, 0], max: [3, 3, 3] },
      targetBounds: { min: [100, 100, 100], max: [106, 106, 106] },
    });
  });

  it('adds the segments through the segmentation service when no override is given', async () => {
    const labelmap = makeLabelmap();
    const segmentationService = {
      getSegmentation: jest.fn(() => ({ segments: { 2: {} } })),
      addSegment: jest.fn(),
    };
    const { deps } = makeDeps(labelmap);
    delete deps.getSegmentation;
    delete deps.addSegment;
    const payload = {
      grid: { data: new Uint8Array(64), dimensions: [4, 4, 4], origin: [0, 0, 0], spacing: [1, 1, 1] },
      segments: [{ value: 1, label: 'empty' }],
    };

    payload.grid.data[7] = 1;

    const result = await importIntoSegmentation({ segmentationId: 'work', payload, segmentationService, deps });

    expect(segmentationService.getSegmentation).toHaveBeenCalledWith('work');
    expect(segmentationService.addSegment).toHaveBeenCalledWith('work', { segmentIndex: 3, label: 'empty' });
    expect(result.segments).toEqual([{ segmentIndex: 3, label: 'empty', voxels: 1 }]);
  });

  it('refuses an empty import and a segmentation without a labelmap', async () => {
    const { deps } = makeDeps(makeLabelmap());
    await expect(importIntoSegmentation({ segmentationId: 'work', payload: { segments: [] }, deps }))
      .rejects.toThrow('There is nothing to import');

    const { deps: noLabelmap } = makeDeps(null);
    const payload = { grid: {}, segments: [{ value: 1, label: 'a' }] };
    await expect(importIntoSegmentation({ segmentationId: 'work', payload, deps: noLabelmap }))
      .rejects.toThrow('labelmap is not available');
    expect(noLabelmap.addSegment).not.toHaveBeenCalled();
  });

  it('uses the labelmap\'s own index -> world mapping for the target grid', async () => {
    // The labelmap is 2 mm voxels at (10, 10, 10); the source is a 1 mm grid at the same place
    const labelmap = { ...makeLabelmap(), indexToWorld: ijk => ijk.map(v => 10 + 2 * v) };
    labelmap.scalarData = new Uint8Array(64);
    const { deps, writes } = makeDeps(labelmap, {});
    const data = new Uint8Array(4 * 4 * 4);
    data[2 + 4 * (2 + 4 * 2)] = 1;   // world (12, 12, 12) -> labelmap voxel (1, 1, 1)
    const payload = {
      grid: { data, dimensions: [4, 4, 4], origin: [10, 10, 10], spacing: [1, 1, 1] },
      segments: [{ value: 1, label: 'a' }],
    };

    await importIntoSegmentation({ segmentationId: 'work', payload, deps });

    expect(writes).toEqual([[1 + 4 * (1 + 4 * 1), 1]]);
    expect(volumeAxes(labelmap.indexToWorld).di).toEqual([2, 0, 0]);
  });
});

describe('importIntoSegmentation: the commit', () => {
  it('allocates the segment numbers from the segmentation as it is when the import commits', async () => {
    // A segment is added (by another import, or Add Segment) while the models are voxelized
    const labelmap = makeLabelmap();
    let segments = { 1: {} };
    const voxelize = jest.fn(async () => {
      segments = { 1: {}, 2: {} };
      return unitGrid(new Uint8Array(64).fill(1));
    });
    const { deps, writes } = makeDeps(labelmap, {}, { voxelize, getSegmentation: jest.fn(() => ({ segments })) });
    const payload = { models: [{ label: 'late', surface: { points: Float32Array.from([0, 0, 0, 3, 3, 3, 0, 3, 3]), polys: Int32Array.from([3, 0, 1, 2]) } }] };

    const result = await importIntoSegmentation({ segmentationId: 'work', payload, deps });

    expect(deps.addSegment).toHaveBeenCalledWith('work', { segmentIndex: 3, label: 'late' });
    expect(writes.every(([, value]) => value === 3)).toBe(true);
    expect(result.segments).toEqual([{ segmentIndex: 3, label: 'late', voxels: 64 }]);
  });

  it('runs imports into one segmentation one after another', async () => {
    const labelmap = makeLabelmap();
    let segments = { 1: {} };
    let releaseFirst;
    const held = new Promise(resolve => { releaseFirst = resolve; });
    const voxelize = jest.fn(() => held.then(() => unitGrid(new Uint8Array(64).fill(1))));
    const { deps } = makeDeps(labelmap, {}, {
      voxelize,
      getSegmentation: jest.fn(() => ({ segments })),
      addSegment: jest.fn((id, { segmentIndex }) => { segments = { ...segments, [segmentIndex]: {} }; }),
    });
    const model = label => ({ label, surface: { points: Float32Array.from([0, 0, 0, 3, 3, 3, 0, 3, 3]), polys: Int32Array.from([3, 0, 1, 2]) } });
    const gridPayload = { grid: unitGrid(new Uint8Array(64).fill(7)), segments: [{ value: 7, label: 'second' }] };

    const first = importIntoSegmentation({ segmentationId: 'work', payload: { models: [model('first')] }, deps });
    const second = importIntoSegmentation({ segmentationId: 'work', payload: gridPayload, deps });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(deps.addSegment).not.toHaveBeenCalled();   // the second waits for the first

    releaseFirst();
    const [a, b] = await Promise.all([first, second]);
    expect(a.segments).toEqual([{ segmentIndex: 2, label: 'first', voxels: 64 }]);
    expect(b.segments).toEqual([{ segmentIndex: 3, label: 'second', voxels: 64 }]);
  });

  it('refuses to commit into a segmentation that closed while it rasterized', async () => {
    const labelmap = makeLabelmap();
    let open = true;
    const voxelize = jest.fn(async () => { open = false; return unitGrid(new Uint8Array(64).fill(1)); });
    const { deps } = makeDeps(labelmap, {}, {
      voxelize,
      getSegmentation: jest.fn(() => (open ? { segments: {} } : undefined)),
      getLabelmap: jest.fn(() => (open ? labelmap : null)),
    });
    const payload = { models: [{ label: 'a', surface: { points: Float32Array.from([0, 0, 0, 3, 3, 3, 0, 3, 3]), polys: Int32Array.from([3, 0, 1, 2]) } }] };

    await expect(importIntoSegmentation({ segmentationId: 'work', payload, deps })).rejects.toThrow('no longer open');
    expect(deps.addSegment).not.toHaveBeenCalled();
    expect(deps.writeVoxels).not.toHaveBeenCalled();
  });

  it('leaves the voxels of locked segments as they are, and counts them', async () => {
    const labelmap = makeLabelmap();   // segment 1 at voxels 0 and 1
    labelmap.scalarData[2] = 3;        // segment 3, not locked
    const { deps, writes } = makeDeps(labelmap, { 1: {}, 3: {} }, { isSegmentLocked: jest.fn((id, index) => index === 1) });
    const data = new Uint8Array(64);
    data[0] = 5; data[1] = 5; data[2] = 5; data[3] = 5;
    const payload = { grid: unitGrid(data), segments: [{ value: 5, label: 'new' }] };

    const result = await importIntoSegmentation({ segmentationId: 'work', payload, deps });

    expect(writes).toEqual([[2, 4], [3, 4]]);
    expect(result.lockedVoxels).toBe(2);
    expect(result.overlapVoxels).toBe(1);
    expect(result.writtenVoxels).toBe(2);
    expect(deps.isSegmentLocked).toHaveBeenCalledWith('work', 1);
  });

  it('puts the segmentation back when adding a segment fails, including a segment the service added before throwing', async () => {
    const labelmap = makeLabelmap();
    const failure = new Error('a panel listener threw');
    const segments = { 1: {} };
    const { deps, writes } = makeDeps(labelmap, segments, {
      // The second add mutates the segmentation and the active segment, as the service does
      // before it broadcasts, and then throws from a listener
      addSegment: jest.fn((id, { segmentIndex, label }) => {
        segments[segmentIndex] = { segmentIndex, label };
        if (segmentIndex === 3) {
          throw failure;
        }
      }),
    });
    const data = new Uint8Array(64);
    data[4] = 1; data[5] = 2;
    const payload = { grid: unitGrid(data), segments: [{ value: 1, label: 'a' }, { value: 2, label: 'b' }] };

    await expect(importIntoSegmentation({ segmentationId: 'work', payload, deps })).rejects.toBe(failure);

    expect(deps.removeSegment.mock.calls).toEqual([['work', 2], ['work', 3]]);
    expect(Object.keys(segments)).toEqual(['1']);
    expect(deps.setActiveSegmentIndex).toHaveBeenCalledWith('work', 1);
    expect(writes).toEqual([]);
    expect(deps.restoreVoxels).not.toHaveBeenCalled();
  });

  it('does not remove a segment the service never added, and carries on when a removal fails', async () => {
    const labelmap = makeLabelmap();
    const segments = { 1: {} };
    const { deps } = makeDeps(labelmap, segments, {
      addSegment: jest.fn((id, { segmentIndex }) => {
        if (segmentIndex === 2) {
          segments[2] = {};
          return;
        }
        throw new Error('rejected before touching anything');   // segment 3 never exists
      }),
      removeSegment: jest.fn(() => { throw new Error('removal listener threw'); }),
    });
    const data = new Uint8Array(64);
    data[4] = 1; data[5] = 2;
    const payload = { grid: unitGrid(data), segments: [{ value: 1, label: 'a' }, { value: 2, label: 'b' }] };

    await expect(importIntoSegmentation({ segmentationId: 'work', payload, deps })).rejects.toThrow('rejected before');

    expect(deps.removeSegment.mock.calls).toEqual([['work', 2]]);
    // The failing removal did not stop the active segment from being restored
    expect(deps.setActiveSegmentIndex).toHaveBeenCalledWith('work', 1);
  });

  it('puts back the voxels written and removes the segments added when the write fails midway', async () => {
    const labelmap = makeLabelmap();   // segment 1 at voxels 0 and 1
    const failure = new Error('voxel manager gone');
    const { deps } = makeDeps(labelmap, {}, {
      writeVoxels: jest.fn(({ edit }) => edit((index) => { if (index === 5) throw failure; })),
    });
    const data = new Uint8Array(64);
    data[1] = 1; data[4] = 1; data[5] = 1;
    const payload = { grid: unitGrid(data), segments: [{ value: 1, label: 'a' }] };

    await expect(importIntoSegmentation({ segmentationId: 'work', payload, deps })).rejects.toBe(failure);

    expect(deps.restoreVoxels).toHaveBeenCalledWith({
      segmentationId: 'work', volume: labelmap.volume, indices: [1, 4], values: [1, 0],
    });
    expect(deps.removeSegment).toHaveBeenCalledWith('work', 1);
    expect(deps.setActiveSegmentIndex).toHaveBeenCalledWith('work', 1);
  });
});

describe('importIntoSegmentation: cancellation', () => {
  const model = label => ({ label, surface: { points: Float32Array.from([0, 0, 0, 3, 3, 3, 0, 3, 3]), polys: Int32Array.from([3, 0, 1, 2]) } });
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));

  it('cancels the import in flight and those queued behind it when the polySeg worker is reset, and lets a fresh import through', async () => {
    const labelmap = makeLabelmap();
    let releaseOld;
    const dead = new Promise(resolve => { releaseOld = resolve; });   // the killed worker's job
    const voxelize = jest.fn(() => dead.then(() => unitGrid(new Uint8Array(64).fill(1))));
    const { deps, writes } = makeDeps(labelmap, {}, { voxelize });
    const grid = { grid: unitGrid(new Uint8Array(64).fill(7)), segments: [{ value: 7, label: 'grid' }] };
    const onProgress = jest.fn();

    // Two models: the second must never be sent once the first is cancelled
    const held = importIntoSegmentation({
      segmentationId: 'work', payload: { models: [model('held'), model('never sent')] }, onProgress, deps,
    });
    const queued = importIntoSegmentation({ segmentationId: 'work', payload: grid, deps });
    await tick();
    expect(deps.addSegment).not.toHaveBeenCalled();
    expect(voxelize).toHaveBeenCalledTimes(1);

    // Surface turned off / editor closed: terminateWorkerComputeJobs resets the wrapper
    resetPolySegInFlight();

    await expect(held).rejects.toBeInstanceOf(ImportCancelledError);
    await expect(queued).rejects.toMatchObject({ cancelled: true });
    expect(deps.addSegment).not.toHaveBeenCalled();

    // A fresh import into the still-open segmentation goes through at once
    const fresh = await importIntoSegmentation({ segmentationId: 'work', payload: grid, deps });
    expect(fresh.segments).toEqual([{ segmentIndex: 1, label: 'grid', voxels: 64 }]);

    // The old job's late result cannot commit, sends no further model, and reports no progress
    releaseOld();
    await tick();
    await tick();
    expect(voxelize).toHaveBeenCalledTimes(1);
    expect(onProgress).not.toHaveBeenCalled();
    expect(deps.addSegment).toHaveBeenCalledTimes(1);
    expect(writes.every(([, value]) => value === 1)).toBe(true);
  });
});

describe('payloadWorldBounds / labelmapWorldBounds', () => {
  it('measures models by their points, grids by their voxel centres, and a labelmap by its corners', () => {
    const surface = points => ({ points: Float32Array.from(points), polys: Int32Array.from([]) });
    expect(payloadWorldBounds({ models: [{ surface: surface([1, 2, 3, -1, 5, 0]) }, { surface: null }] }))
      .toEqual({ min: [-1, 2, 0], max: [1, 5, 3] });
    expect(payloadWorldBounds({ models: [{ surface: null }] })).toBeNull();
    expect(payloadWorldBounds({ grid: { dimensions: [2, 2, 2], origin: [1, 1, 1], spacing: [2, 2, 2] } }))
      .toEqual({ min: [1, 1, 1], max: [3, 3, 3] });
    expect(labelmapWorldBounds({ dimensions: [3, 2, 2], axes: volumeAxes(([i, j, k]) => [10 - i, j * 2, k]) }))
      .toEqual({ min: [8, 0, 0], max: [10, 2, 1] });
  });
});
