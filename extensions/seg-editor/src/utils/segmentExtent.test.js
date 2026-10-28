// Where a segment is: the centroid of a surface's vertices or a labelmap's voxels, snapped onto a
// slice that holds the segment, with a radius that covers it; the lookup through the surface
// first and the labelmap after, cached per segment until the data changes

const dataModifiedListeners = [];
jest.mock('@cornerstonejs/core', () => ({
  cache: { getGeometry: jest.fn(), getVolume: jest.fn() },
  eventTarget: { addEventListener: (type, listener) => dataModifiedListeners.push({ type, listener }) },
}), { virtual: true });
jest.mock('@cornerstonejs/tools', () => ({
  Enums: { Events: { SEGMENTATION_DATA_MODIFIED: 'SEGMENTATION_DATA_MODIFIED' } },
  segmentation: { state: { getSegmentation: jest.fn() } },
}), { virtual: true });

import {
  invalidateSegmentExtents, labelmapExtent, lookupSegmentExtent, pointsExtent, snapAxes,
} from './segmentExtent';

// A 1 mm volume at the origin
const indexToWorld = ([i, j, k]) => [i, j, k];
const axes = snapAxes(indexToWorld);

describe('snapAxes', () => {
  it('reads the volume axes as unit vectors with their spacing', () => {
    expect(axes).toEqual([
      { unit: [1, 0, 0], spacing: 1 }, { unit: [0, 1, 0], spacing: 1 }, { unit: [0, 0, 1], spacing: 1 },
    ]);
    const anisotropic = snapAxes(([i, j, k]) => [10 + i * 0.5, 20 + j * 0.5, 30 + k * 3]);
    expect(anisotropic[0]).toEqual({ unit: [1, 0, 0], spacing: 0.5 });
    expect(anisotropic[2]).toEqual({ unit: [0, 0, 1], spacing: 3 });
  });
});

describe('pointsExtent', () => {
  it('returns null without points, and the centroid, bounds and half-diagonal with them', () => {
    expect(pointsExtent(null)).toBeNull();
    expect(pointsExtent(new Float32Array(0))).toBeNull();
    const cube = new Float32Array([0, 0, 0, 2, 0, 0, 0, 4, 0, 2, 4, 0, 0, 0, 6, 2, 0, 6, 0, 4, 6, 2, 4, 6]);
    const extent = pointsExtent(cube);
    expect(extent.center).toEqual([1, 2, 3]);
    expect(extent.bounds).toEqual({ min: [0, 0, 0], max: [2, 4, 6] });
    expect(extent.radius).toBeCloseTo(Math.hypot(2, 4, 6) / 2);
    // The frame is the bounding sphere: here the centre is the box's centre already
    expect(extent.frame.center).toEqual([1, 2, 3]);
    expect(extent.frame.radius).toBeCloseTo(extent.radius);
    expect(extent.count).toBe(8);
  });

  it('keeps the centroid when every axis slab through it holds a vertex, and snaps it when one does not', () => {
    // Two walls at x = 0 and x = 10, each a grid over y and z: the centroid's x slab (x = 5) is empty
    const walls = new Float32Array([0, 10].flatMap(x => [0, 1, 2, 3, 4].flatMap(y => [0, 1, 2, 3, 4].flatMap(z => [x, y, z]))));
    expect(pointsExtent(walls).center).toEqual([5, 2, 2]);
    const snapped = pointsExtent(walls, { axes });
    expect(snapped.center[0]).toBe(0);
    expect(snapped.center.slice(1)).toEqual([2, 2]);
    // The radius covers the far wall from the moved centre; the frame stays the bounding sphere
    expect(snapped.radius).toBeCloseTo(Math.hypot(10, 2, 2));
    expect(snapped.frame.center).toEqual([5, 2, 2]);
    expect(snapped.frame.radius).toBeCloseTo(Math.hypot(10, 4, 4) / 2);
    // A ring in the xy plane around the centroid: its z slab holds the ring, its x and y slabs
    // hold the ring's far sides, so nothing moves
    const ring = [];
    for (let a = 0; a < 16; a++) {
      ring.push(5 + 3 * Math.cos((a / 16) * 2 * Math.PI), 5 + 3 * Math.sin((a / 16) * 2 * Math.PI), 1);
    }
    const ringExtent = pointsExtent(new Float32Array(ring), { axes });
    expect(ringExtent.center[0]).toBeCloseTo(5);
    expect(ringExtent.center[1]).toBeCloseTo(5);
    expect(ringExtent.center[2]).toBeCloseTo(1);
  });

  it('judges a slice by the faces crossing it when the surface has them, not by its vertices', () => {
    // A closed 10 mm cube as eight corners and twelve triangles: no vertex lies on the central
    // planes, but every one of them cuts faces, so the centroid stays where the segment is
    const corners = [0, 10].flatMap(x => [0, 10].flatMap(y => [0, 10].map(z => [x, y, z])));
    const points = new Float32Array(corners.flat());
    const quad = (a, b, c, d) => [3, a, b, c, 3, a, c, d];
    const polys = Int32Array.from([
      ...quad(0, 1, 3, 2), ...quad(4, 6, 7, 5), // x = 0, x = 10
      ...quad(0, 4, 5, 1), ...quad(2, 3, 7, 6), // y = 0, y = 10
      ...quad(0, 2, 6, 4), ...quad(1, 5, 7, 3), // z = 0, z = 10
    ]);
    const byVertices = pointsExtent(points, { axes });
    expect(byVertices.center).toEqual([0, 0, 0]);
    const byFaces = pointsExtent(points, { axes, polys });
    expect(byFaces.center).toEqual([5, 5, 5]);
    expect(byFaces.radius).toBeCloseTo(Math.hypot(10, 10, 10) / 2);
    expect(byFaces.frame).toEqual(expect.objectContaining({ center: [5, 5, 5] }));
    // The same cube's far half removed: the centroid's x slab holds no face, so x moves to the
    // nearest vertex (a face of the remaining wall)
    const wall = Int32Array.from([...quad(0, 1, 3, 2)]);
    expect(pointsExtent(points, { axes, polys: wall }).center).toEqual([0, 5, 5]);
  });
});

describe('labelmapExtent', () => {
  const dimensions = [8, 6, 4];
  const voxels = (fill) => {
    const data = new Uint8Array(8 * 6 * 4);
    for (let k = 0; k < 4; k++) {
      for (let j = 0; j < 6; j++) {
        for (let i = 0; i < 8; i++) {
          data[i + j * 8 + k * 48] = fill(i, j, k);
        }
      }
    }
    return data;
  };

  it('returns null for a segment with no voxels', () => {
    expect(labelmapExtent({ scalarData: voxels(() => 0), dimensions, segmentIndex: 1, indexToWorld })).toBeNull();
    expect(labelmapExtent({ scalarData: voxels(() => 2), dimensions, segmentIndex: 1, indexToWorld })).toBeNull();
  });

  it('centres a solid block on its centroid, with a radius covering the whole voxels', () => {
    const scalarData = voxels((i, j, k) => (i >= 2 && i <= 5 && j >= 1 && j <= 3 && k === 2 ? 1 : 0));
    const extent = labelmapExtent({ scalarData, dimensions, segmentIndex: 1, indexToWorld });
    expect(extent.center).toEqual([3.5, 2, 2]);
    expect(extent.count).toBe(12);
    expect(extent.bounds).toEqual({ min: [1.5, 0.5, 1.5], max: [5.5, 3.5, 2.5] });
    expect(extent.radius).toBeCloseTo(Math.hypot(4, 3, 1) / 2);
  });

  it('snaps the centroid of a hollow segment onto the nearest slice that holds it', () => {
    // Two slabs at k = 0 and k = 3 of segment 1, with segment 2 between them
    const scalarData = voxels((i, j, k) => (k === 0 || k === 3 ? 1 : 2));
    const extent = labelmapExtent({ scalarData, dimensions, segmentIndex: 1, indexToWorld });
    expect(extent.center[2] === 0 || extent.center[2] === 3).toBe(true);
    expect(extent.center.slice(0, 2)).toEqual([3.5, 2.5]);
    expect(extent.count).toBe(96);
    // The radius covers the far slab from the moved centre; the frame is the whole box's sphere
    expect(extent.radius).toBeCloseTo(Math.hypot(4, 3, 3.5));
    expect(extent.frame.center).toEqual([3.5, 2.5, 1.5]);
    expect(extent.frame.radius).toBeCloseTo(Math.hypot(8, 6, 4) / 2);
  });

  it('maps the centre and bounds through the volume geometry', () => {
    const scalarData = voxels((i, j, k) => (i === 4 && j === 2 && k === 1 ? 7 : 0));
    const extent = labelmapExtent({
      scalarData, dimensions, segmentIndex: 7, indexToWorld: ([i, j, k]) => [100 + i * 2, 200 - j * 2, 300 + k * 5],
    });
    expect(extent.center).toEqual([108, 196, 305]);
    expect(extent.bounds).toEqual({ min: [107, 195, 302.5], max: [109, 197, 307.5] });
    expect(extent.radius).toBeCloseTo(Math.hypot(2, 2, 5) / 2);
  });
});

describe('lookupSegmentExtent', () => {
  const volume = {
    imageData: { indexToWorld },
    dimensions: [4, 4, 4],
    voxelManager: { getCompleteScalarDataArray: jest.fn() },
  };
  const geometryIds = new Map([[1, 'geom-1']]);
  const segmentations = {
    seg: { representationData: { Labelmap: { volumeId: 'labelmap' } } },
    'vol3d:seg': { representationData: { Surface: { geometryIds } } },
  };
  const deps = {
    getSegmentation: id => segmentations[id],
    getGeometry: jest.fn(),
    getVolume: id => (id === 'labelmap' ? volume : undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    invalidateSegmentExtents();
    volume.voxelManager.getCompleteScalarDataArray.mockReturnValue(new Uint8Array(64).fill(0).map((_, n) => (n === 21 ? 1 : 0)));
  });

  it('returns null without a segmentation or segment', () => {
    expect(lookupSegmentExtent({ labelmapSegmentationId: undefined, segmentIndex: 1 }, deps)).toBeNull();
    expect(lookupSegmentExtent({ labelmapSegmentationId: 'seg', segmentIndex: 0 }, deps)).toBeNull();
    expect(lookupSegmentExtent({ labelmapSegmentationId: 'missing', segmentIndex: 1 }, deps)).toBeNull();
  });

  it('prefers the cached surface, snapped along the labelmap axes', () => {
    const walls = new Float32Array([0, 10].flatMap(x => [0, 1, 2, 3, 4].flatMap(y => [0, 1, 2, 3, 4].flatMap(z => [x, y, z]))));
    deps.getGeometry.mockReturnValue({ data: { points: walls } });
    const extent = lookupSegmentExtent({ labelmapSegmentationId: 'seg', surfaceSegmentationId: 'vol3d:seg', segmentIndex: 1 }, deps);
    expect(extent.source).toBe('surface');
    expect(extent.center).toEqual([0, 2, 2]);
    expect(deps.getGeometry).toHaveBeenCalledWith('geom-1');
    expect(volume.voxelManager.getCompleteScalarDataArray).not.toHaveBeenCalled();
    // With faces between the walls (a closed box), the slab through the centroid holds the segment
    const lid = Int32Array.from([3, 0, 25, 29, 3, 0, 29, 4]); // x = 0 and x = 10 corners joined
    deps.getGeometry.mockReturnValue({ data: { points: walls, polys: lid } });
    expect(lookupSegmentExtent({ labelmapSegmentationId: 'seg', surfaceSegmentationId: 'vol3d:seg', segmentIndex: 1 }, deps).center).toEqual([5, 2, 2]);
  });

  it('falls back to the labelmap, caches the scan, and forgets it when the segmentation data changes', () => {
    deps.getGeometry.mockReturnValue(undefined);
    const first = lookupSegmentExtent({ labelmapSegmentationId: 'seg', surfaceSegmentationId: 'vol3d:seg', segmentIndex: 1 }, deps);
    expect(first.source).toBe('labelmap');
    expect(first.center).toEqual([1, 1, 1]); // voxel 21 = i 1, j 1, k 1
    expect(first.count).toBe(1);
    lookupSegmentExtent({ labelmapSegmentationId: 'seg', segmentIndex: 1 }, deps);
    expect(volume.voxelManager.getCompleteScalarDataArray).toHaveBeenCalledTimes(1);

    const modified = dataModifiedListeners.find(entry => entry.type === 'SEGMENTATION_DATA_MODIFIED');
    expect(modified).toBeDefined();
    modified.listener({ detail: { segmentationId: 'other' } });
    lookupSegmentExtent({ labelmapSegmentationId: 'seg', segmentIndex: 1 }, deps);
    expect(volume.voxelManager.getCompleteScalarDataArray).toHaveBeenCalledTimes(1);
    modified.listener({ detail: { segmentationId: 'seg' } });
    lookupSegmentExtent({ labelmapSegmentationId: 'seg', segmentIndex: 1 }, deps);
    expect(volume.voxelManager.getCompleteScalarDataArray).toHaveBeenCalledTimes(2);
  });

  it('returns null, and caches that, for a segment with neither surface nor voxels', () => {
    deps.getGeometry.mockReturnValue(undefined);
    expect(lookupSegmentExtent({ labelmapSegmentationId: 'seg', segmentIndex: 3 }, deps)).toBeNull();
    expect(lookupSegmentExtent({ labelmapSegmentationId: 'seg', segmentIndex: 3 }, deps)).toBeNull();
    expect(volume.voxelManager.getCompleteScalarDataArray).toHaveBeenCalledTimes(1);
  });
});
