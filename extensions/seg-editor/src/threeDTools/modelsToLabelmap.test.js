// 3D models -> labelmap on a source series' image grid (ohif-viewers#143)

import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import {
  modelsToLabelmap,
  surfaceFromTriangleSoup,
  volumeAxesFromProps,
  voxelizeModels,
} from './modelsToLabelmap';
import { insideMesh, uvSphere, voxelizeByParity } from './testing/meshes';
import { polysToTriangles } from './meshCut';

// virtual: jest's resolver does not follow the Cornerstone3D packages' `exports` maps
jest.mock('@cornerstonejs/core', () => ({ cache: {}, utilities: {} }), { virtual: true });
jest.mock('@cornerstonejs/tools', () => ({ segmentation: { state: {} } }), { virtual: true });
jest.mock('@ohif/extension-viewerm3d', () => ({
  acquireGeometry: jest.fn(() => Promise.resolve()),
  releaseGeometry: jest.fn(),
  getM3DSegmentationId: uid => `m3dseg:${uid}`,
}), { virtual: true });
jest.mock('./segmentEdits.js', () => ({ voxelizeSurfaceInWorker: jest.fn() }));


// A triangle soup (non-indexed, as THREE's STLLoader produces) from an indexed sphere
function soup(sphere) {
  const triangles = polysToTriangles(sphere.polys);
  const positions = new Float32Array(triangles.length * 3);
  triangles.forEach((v, i) => positions.set(sphere.points.subarray(3 * v, 3 * v + 3), 3 * i));
  return positions;
}

// An oblique image grid: rows along a rotated axis, 1.5 x 1 mm pixels, 2 mm slices
const angle = Math.PI / 7;
const row = [Math.cos(angle), Math.sin(angle), 0];
const column = [-Math.sin(angle), Math.cos(angle), 0];
const normal = [0, 0, 1];
const PROPS = {
  dimensions: [24, 30, 14],
  spacing: [1.5, 1, 2],
  origin: [-14, -12, -13],
  direction: [...row, ...column, ...normal],
};

describe('surfaceFromTriangleSoup', () => {
  it('welds shared vertices into an indexed, closed surface', () => {
    const sphere = uvSphere({ segments: 12, rings: 8 });

    const surface = surfaceFromTriangleSoup(soup(sphere));

    expect(surface.points.length).toBe(sphere.points.length);
    expect(surface.polys.length).toBe(sphere.polys.length);
  });
});

describe('volumeAxesFromProps', () => {
  it('maps index to world as the volume\'s vtkImageData does', () => {
    const axes = volumeAxesFromProps(PROPS);
    const imageData = vtkImageData.newInstance();
    imageData.setDimensions(PROPS.dimensions);
    imageData.setSpacing(PROPS.spacing);
    imageData.setDirection(PROPS.direction);
    imageData.setOrigin(PROPS.origin);

    [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [7, 11, 5], [23, 29, 13]].forEach(ijk => {
      const expected = imageData.indexToWorld(ijk);
      const actual = [0, 1, 2].map(d =>
        axes.origin[d] + ijk[0] * axes.di[d] + ijk[1] * axes.dj[d] + ijk[2] * axes.dk[d]);
      actual.forEach((value, d) => expect(value).toBeCloseTo(expected[d], 9));
    });
  });
});

describe('voxelizeModels', () => {
  const axes = volumeAxesFromProps(PROPS);
  const [nx, ny] = PROPS.dimensions;
  const worldOf = index => {
    const i = index % nx;
    const j = Math.floor(index / nx) % ny;
    const k = Math.floor(index / (nx * ny));
    return [0, 1, 2].map(d => axes.origin[d] + i * axes.di[d] + j * axes.dj[d] + k * axes.dk[d]);
  };

  it('fills the voxels whose centres are inside each model, on an oblique grid', async () => {
    const surface = surfaceFromTriangleSoup(soup(uvSphere({ radius: 6, segments: 24, rings: 16 })));

    const { labelmap, emptySegments } = await voxelizeModels({
      models: [{ segmentIndex: 1, surface }],
      dimensions: PROPS.dimensions,
      axes,
      voxelize: async s => voxelizeByParity(s, 40),
    });

    let mismatches = 0;
    let filled = 0;
    labelmap.forEach((value, index) => {
      const p = worldOf(index);
      const r = Math.hypot(...p);
      filled += value === 1;
      // Away from the surface, the result must agree with the mesh exactly
      if (r < 5.2 && value !== 1) {
        mismatches++;
      }
      if (r > 6.8 && value !== 0) {
        mismatches++;
      }
    });
    expect(mismatches).toBe(0);
    expect(filled).toBeGreaterThan(0);
    expect(emptySegments).toEqual([]);
  });

  it('gives overlapping voxels to the later model and counts them', async () => {
    const a = surfaceFromTriangleSoup(soup(uvSphere({ radius: 5, center: [-2, 0, 0] })));
    const b = surfaceFromTriangleSoup(soup(uvSphere({ radius: 5, center: [2, 0, 0] })));

    const { labelmap, overlapVoxels } = await voxelizeModels({
      models: [{ segmentIndex: 1, surface: a }, { segmentIndex: 2, surface: b }],
      dimensions: PROPS.dimensions,
      axes,
      voxelize: async s => voxelizeByParity(s, 30),
    });

    expect(overlapVoxels).toBeGreaterThan(0);
    labelmap.forEach((value, index) => {
      const p = worldOf(index);
      if (insideMesh(b, p) && Math.hypot(p[0] - 2, p[1], p[2]) < 4) {
        expect(value).toBe(2);
      }
    });
  });

  it('keeps converting when one model\'s voxelization fails, and reports it', async () => {
    const valid = surfaceFromTriangleSoup(soup(uvSphere({ radius: 3, center: [-6, 0, 0] })));
    const invalid = surfaceFromTriangleSoup(soup(uvSphere({ radius: 3, center: [0, 0, 0] })));
    const later = surfaceFromTriangleSoup(soup(uvSphere({ radius: 3, center: [6, 0, 0] })));
    const failure = new Error('invalid surface');
    const voxelize = jest.fn(async s => {
      if (s === invalid) {
        throw failure;
      }
      return voxelizeByParity(s, 12);
    });

    const { labelmap, emptySegments, failures } = await voxelizeModels({
      models: [
        { segmentIndex: 1, surface: valid },
        { segmentIndex: 2, surface: invalid },
        { segmentIndex: 3, surface: later },
      ],
      dimensions: PROPS.dimensions,
      axes,
      voxelize,
    });

    expect(voxelize).toHaveBeenCalledTimes(3);
    expect(labelmap.some(v => v === 1)).toBe(true);
    expect(labelmap.some(v => v === 3)).toBe(true);
    expect(labelmap.some(v => v === 2)).toBe(false);
    expect(emptySegments).toEqual([2]);
    expect(failures).toEqual([{ segmentIndex: 2, error: failure }]);
  });

  it('reports models outside the grid or without a surface as empty', async () => {
    const far = surfaceFromTriangleSoup(soup(uvSphere({ radius: 3, center: [500, 0, 0] })));

    const { emptySegments } = await voxelizeModels({
      models: [{ segmentIndex: 1, surface: far }, { segmentIndex: 2, surface: null }],
      dimensions: PROPS.dimensions,
      axes,
      voxelize: async s => voxelizeByParity(s, 10),
    });

    expect(emptySegments).toEqual([1, 2]);
  });
});

describe('modelsToLabelmap', () => {
  it('converts the series\' models in panel order, with their labels and colours', async () => {
    const geometryAt = x => ({
      parsed: { getAttribute: () => ({ array: soup(uvSphere({ radius: 4, center: [x, 0, 0] })) }) },
    });
    const geometries = { 'm3d:1': geometryAt(-5), 'm3d:3': geometryAt(5) };
    const acquire = jest.fn(() => Promise.resolve());
    const release = jest.fn();

    const result = await modelsToLabelmap({
      m3dSeriesInstanceUID: '1.2.3',
      imageIds: ['a', 'b'],
      deps: {
        getSegmentation: id => (id === 'm3dseg:1.2.3' ? {
          segments: {
            3: { segmentIndex: 3, label: 'tibia', color: '#00ff00', geometryId: 'm3d:3' },
            1: { segmentIndex: 1, label: 'femur', color: '#ff0000', geometryId: 'm3d:1' },
            2: { segmentIndex: 2, label: 'missing', color: '#0000ff', geometryId: 'm3d:2' },
          },
        } : undefined),
        getGeometry: id => geometries[id],
        acquire,
        release,
        volumeProps: () => ({ ...PROPS, imageIds: ['sorted-b', 'sorted-a'] }),
        voxelize: async s => voxelizeByParity(s, 20),
      },
    });

    expect(result.segments).toEqual([
      { label: 'femur', color: '#ff0000' },
      { label: 'missing', color: '#0000ff' },
      { label: 'tibia', color: '#00ff00' },
    ]);
    expect(result.bufferImageIds).toEqual(['sorted-b', 'sorted-a']);
    expect(result.emptySegments).toEqual([{ segmentIndex: 2, label: 'missing' }]);
    expect(result.labelmapBuffer.some(v => v === 1)).toBe(true);
    expect(result.labelmapBuffer.some(v => v === 3)).toBe(true);
    expect(result.overlapVoxels).toBe(0);
    expect(acquire.mock.calls.map(([id]) => id)).toEqual(['m3d:1', 'm3d:3']);
    expect(release.mock.calls.map(([id]) => id)).toEqual(['m3d:1', 'm3d:3']);
  });

  it('converts a valid-invalid-valid series, names the failed model, and releases all geometry', async () => {
    const geometryAt = x => ({
      parsed: { getAttribute: () => ({ array: soup(uvSphere({ radius: 3, center: [x, 0, 0] })) }) },
    });
    const geometries = { 'm3d:1': geometryAt(-6), 'm3d:2': geometryAt(0), 'm3d:3': geometryAt(6) };
    const release = jest.fn();
    let calls = 0;

    const result = await modelsToLabelmap({
      m3dSeriesInstanceUID: '1.2.3',
      imageIds: ['a'],
      deps: {
        getSegmentation: () => ({
          segments: {
            1: { segmentIndex: 1, label: 'femur', color: '#ff0000', geometryId: 'm3d:1' },
            2: { segmentIndex: 2, label: 'broken', color: '#00ff00', geometryId: 'm3d:2' },
            3: { segmentIndex: 3, label: 'tibia', color: '#0000ff', geometryId: 'm3d:3' },
          },
        }),
        getGeometry: id => geometries[id],
        acquire: () => Promise.resolve(),
        release,
        volumeProps: () => ({ ...PROPS, imageIds: ['a'] }),
        voxelize: async s => {
          calls += 1;
          if (calls === 2) {
            throw new Error('invalid surface');
          }
          return voxelizeByParity(s, 12);
        },
      },
    });

    expect(result.segments.map(segment => segment.label)).toEqual(['femur', 'broken', 'tibia']);
    expect(result.labelmapBuffer.some(v => v === 1)).toBe(true);
    expect(result.labelmapBuffer.some(v => v === 3)).toBe(true);
    expect(result.emptySegments).toEqual([
      { segmentIndex: 2, label: 'broken', error: expect.objectContaining({ message: 'invalid surface' }) },
    ]);
    expect(release.mock.calls.map(([id]) => id)).toEqual(['m3d:1', 'm3d:2', 'm3d:3']);
  });

  it('refuses a series without models', async () => {
    await expect(modelsToLabelmap({
      m3dSeriesInstanceUID: 'x', imageIds: [], deps: { getSegmentation: () => undefined },
    })).rejects.toThrow('no models');
  });
});
