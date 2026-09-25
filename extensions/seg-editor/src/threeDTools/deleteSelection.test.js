// The 3D Selection tool's delete pipeline, with the workers replaced by in-process equivalents: fan
// caps for the OpenCascade patches and a ray-parity voxelizer for polymorphic segmentation's.

import { DeleteCancelledError, deleteSelection, DELETE_STEPS, withGridCorners } from './deleteSelection';
import { fanCap } from './meshCut';
import { uvSphere, verticesWhere, voxelizeByParity } from './testing/meshes';


// 1 mm labelmap, 32^3, centred on the world origin
const N = 32;
const ORIGIN = -16;
const indexToWorld = ([i, j, k]) => [ORIGIN + i, ORIGIN + j, ORIGIN + k];
const index = (i, j, k) => i + N * (j + N * k);

function labelmapWith(fill) {
  const scalarData = new Uint8Array(N * N * N);
  for (let k = 0; k < N; k++) {
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        scalarData[index(i, j, k)] = fill(indexToWorld([i, j, k]));
      }
    }
  }
  return { scalarData, dimensions: [N, N, N], indexToWorld };
}

function run({ surface, selected, labelmap, segmentIndex = 1, depth = 0 }) {
  const removed = [];
  const steps = [];
  const deps = {
    patchHoles: jest.fn(async loops => loops.map(loop => ({ patch: fanCap(loop), method: 'fitted' }))),
    voxelize: jest.fn(async s => voxelizeByParity(s, 24)),
    removeVoxels: jest.fn(indices => removed.push(...indices)),
  };
  return deleteSelection({
    surface, selected, segmentIndex, depth, labelmap, deps, onStep: step => steps.push(step),
  })
    .then(result => ({ result, removed, steps, deps }));
}

describe('deleteSelection', () => {
  // Segment 1: a 10 mm ball. Its surface: a sphere a little smaller than the voxels' extent, as a
  // smoothed marching-cubes surface is. Segment 2 sits right above the ball.
  const ball = ([x, y, z]) => Math.hypot(x, y, z) <= 10;
  const labelmap = () => labelmapWith(p => (ball(p) ? 1 : p[2] > 10 && p[2] < 13 ? 2 : 0));
  const surface = uvSphere({ radius: 9.6, segments: 16, rings: 16 });

  it('removes the cut-away cap of the segment and nothing else', async () => {
    const map = labelmap();
    const before = map.scalarData.slice();
    const selected = verticesWhere(surface.points, ([, , z]) => z > 6);

    const { result, removed, steps } = await run({ surface, selected, labelmap: map });

    expect(steps).toEqual([DELETE_STEPS.cut, DELETE_STEPS.patch, DELETE_STEPS.voxelize, DELETE_STEPS.write]);
    expect(result).toMatchObject({ holes: 1, cappedHoles: 0, removedVoxels: removed.length });
    expect(removed.length).toBeGreaterThan(0);
    removed.forEach(i => {
      expect(before[i]).toBe(1); // only segment 1 voxels
      const [, , z] = indexToWorld([i % N, Math.floor(i / N) % N, Math.floor(i / (N * N))]);
      expect(z).toBeGreaterThan(3); // only near the removed cap (the hole's rim is at z = 4.6)
    });
  });

  it('removes the segment beneath a small selection down to the removal depth', async () => {
    // A few points on the side of the ball: the patch closes the hole almost where the surface
    // was, so without a depth next to nothing is removed
    const selected = verticesWhere(surface.points, ([x, y, z]) => x > 8 && Math.abs(y) < 3 && Math.abs(z) < 3);
    const shallow = await run({ surface, selected, labelmap: labelmap() });
    const deep = await run({ surface, selected, labelmap: labelmap(), depth: 4 });

    expect(deep.removed.length).toBeGreaterThan(shallow.removed.length + 20);
    deep.removed.forEach(i => {
      const [x] = indexToWorld([i % N, Math.floor(i / N) % N, Math.floor(i / (N * N))]);
      expect(x).toBeGreaterThan(8 - 4 - 1); // within the depth of the selected points
    });
  });

  it('stops before the write once cancelled during a worker stage', async () => {
    let cancelled = false;
    const removeVoxels = jest.fn();
    const deps = {
      patchHoles: async loops => {
        cancelled = true; // e.g. the editor closed while the patches were being fitted
        return loops.map(loop => ({ patch: fanCap(loop), method: 'fitted' }));
      },
      voxelize: jest.fn(async s => voxelizeByParity(s, 12)),
      removeVoxels,
      isCancelled: () => cancelled,
    };

    await expect(deleteSelection({
      surface, selected: verticesWhere(surface.points, ([, , z]) => z > 6), segmentIndex: 1,
      labelmap: labelmap(), deps,
    })).rejects.toBeInstanceOf(DeleteCancelledError);
    expect(deps.voxelize).not.toHaveBeenCalled();
    expect(removeVoxels).not.toHaveBeenCalled();
  });

  it('leaves the segment alone when the selection changes nothing', async () => {
    const { result, deps } = await run({ surface, selected: [], labelmap: labelmap() });

    expect(result.removedVoxels).toBe(0);
    expect(deps.patchHoles).not.toHaveBeenCalled();
    expect(deps.removeVoxels).not.toHaveBeenCalled();
  });

  it('removes a whole piece that the selection covers completely', async () => {
    const { result, removed } = await run({
      surface, selected: verticesWhere(surface.points, () => true), labelmap: labelmap(),
    });

    expect(result.holes).toBe(0);
    // Everything of the segment near the surface's bounds goes
    expect(removed.length).toBeGreaterThan(3500);
  });

  it('reports holes that could only be capped', async () => {
    const deps = {
      patchHoles: async loops => loops.map(loop => ({ patch: fanCap(loop), method: 'cap', error: 'no fit' })),
      voxelize: async s => voxelizeByParity(s, 24),
      removeVoxels: () => {},
    };
    const result = await deleteSelection({
      surface,
      selected: verticesWhere(surface.points, ([, , z]) => z > 6),
      segmentIndex: 1,
      labelmap: labelmap(),
      deps,
    });

    expect(result).toMatchObject({ holes: 1, cappedHoles: 1, patchErrors: ['no fit'] });
  });

  it('voxelizes both surfaces on one grid', async () => {
    const { deps } = await run({
      surface, selected: verticesWhere(surface.points, ([, , z]) => z > 6), labelmap: labelmap(),
    });

    const [original, edited] = deps.voxelize.mock.calls.map(([s]) => s.points);
    const corners = points => Array.from(points.slice(points.length - 6));
    expect(corners(edited)).toEqual(corners(original));
  });
});

describe('withGridCorners', () => {
  it('appends the box corners as unreferenced points', () => {
    const out = withGridCorners({ points: Float32Array.from([1, 2, 3]), polys: [] },
      { min: [0, 0, 0], max: [5, 5, 5] });
    expect(Array.from(out.points)).toEqual([1, 2, 3, 0, 0, 0, 5, 5, 5]);
  });
});
