// The 3D Selection tool's delete pipeline, with the hole-filling worker replaced by fan caps and
// the carve run in this thread.

import { isClosedManifold, uvSphere, verticesWhere } from './testing/meshes';
import {
  cutAndPatch,
  DELETE_STEPS,
  DeleteCancelledError,
  deleteSelection,
  editIndexBox,
  repairSurface,
  RIM_CLEANUPS,
} from './deleteSelection';
import { carveLabelmap } from './labelmapCarve';
import { fanCap } from './meshCut';
import { orientPatchToRim } from './meshRepair';


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

// A fan cap wound against the rim, as the hole-filling worker's patches are
const cap = loop => {
  const patch = fanCap(loop);
  return { points: patch.points, triangles: orientPatchToRim(patch.triangles, loop.length / 3).triangles };
};
const patchHoles = async loops => loops.map(loop => ({ patch: cap(loop), method: 'fitted' }));
// No patch at all: the hole stays open
const leaveOpen = async loops => loops.map(() => ({ patch: { points: new Float64Array(0), triangles: new Int32Array(0) }, method: 'flat' }));

function run({ surface, selected, labelmap, segmentIndex = 1, depth = 0 }) {
  const removed = [];
  const steps = [];
  const deps = {
    patchHoles: jest.fn(patchHoles),
    carve: jest.fn(args => carveLabelmap(args)),
    removeVoxels: jest.fn(indices => removed.push(...indices)),
  };
  return deleteSelection({
    surface, selected, segmentIndex, depth, labelmap, deps, onStep: step => steps.push(step),
  })
    .then(result => ({ result, removed, steps, deps }));
}

// Segment 1: a 10 mm ball. Its surface: a sphere a little smaller than the voxels' extent, as a
// smoothed marching-cubes surface is. Segment 2 sits right above the ball.
const ball = ([x, y, z]) => Math.hypot(x, y, z) <= 10;
const labelmap = () => labelmapWith(p => (ball(p) ? 1 : p[2] > 10 && p[2] < 13 ? 2 : 0));
const surface = uvSphere({ radius: 9.6, segments: 16, rings: 16 });

describe('cutAndPatch', () => {
  it('cuts the selected points out and closes the hole, returning a closed surface', async () => {
    const selected = verticesWhere(surface.points, ([, , z]) => z > 6);
    const steps = [];

    const result = await cutAndPatch({ surface, selected, deps: { patchHoles }, onStep: step => steps.push(step) });

    expect(steps).toEqual([DELETE_STEPS.cut, DELETE_STEPS.patch]);
    expect(result).toMatchObject({ changed: true, holes: 1, cappedHoles: 0, patchErrors: [] });
    expect(isClosedManifold(result.edited.polys)).toBe(true);
    expect(result.edited.points.length).toBeLessThan(surface.points.length);
    expect(result.diagnostics).toMatchObject({
      input: { closed: true, inconsistentEdgeCount: 0 },
      output: { closed: true, inconsistentEdgeCount: 0 },
      openEdges: 0,
      methods: { fitted: 1 },
      introduced: { total: 0 },
      acceptable: true,
      emptied: false,
      preexistingLoops: { count: 0 },
      conditioning: { effectiveWeldTolerance: 0, fellBack: false },
      fits: [[]],
    });
    expect(result.diagnostics.removedTriangles).toBeGreaterThan(0);
    expect(result.edited.patchPolysOffset).toBeLessThan(result.edited.polys.length);
    // The edit box covers the removed points and the hole's rim (the ring at z = 5.33)
    expect(result.editBox.max[2]).toBeGreaterThanOrEqual(9.6);
    expect(result.editBox.min[2]).toBeCloseTo(5.33, 1);
    expect(result.selectedPoints).toHaveLength(selected.length * 3);
  });

  it('removes exactly the selected triangles, and counts their vertices as the removed points', async () => {
    // The cap's triangles: every triangle whose vertices all lie above z = 6
    const cells = [];
    for (let t = 0; t < surface.polys.length / 4; t++) {
      const above = [1, 2, 3].every(k => surface.points[3 * surface.polys[4 * t + k] + 2] > 6);
      if (above) {
        cells.push(t);
      }
    }

    const result = await cutAndPatch({ surface, selectedTriangles: cells, deps: { patchHoles } });

    expect(result.changed).toBe(true);
    expect(result.holes).toBe(1);
    expect(isClosedManifold(result.edited.polys)).toBe(true);
    expect(result.edited.polys.length / 4).toBe(surface.polys.length / 4 - cells.length + result.edited.polys.subarray(result.edited.patchPolysOffset).length / 4);
    const vertices = new Set();
    cells.forEach(t => [1, 2, 3].forEach(k => vertices.add(surface.polys[4 * t + k])));
    expect(result.selectedPoints).toHaveLength(vertices.size * 3);
  });

  it('leaves a piece far from the cut alone, and counts whatever the cleanup removed in the edit', async () => {
    // The sphere plus a tetrahedron at x = 100, one surface. Removing one sphere triangle must
    // not drop the tetrahedron as an island: the voxels of anything removed must lie in the edit
    // box, and the tetrahedron's do not.
    const tetra = { points: [100, 0, 0, 101, 0, 0, 100, 1, 0, 100, 0, 1], polys: [3, 0, 1, 2, 3, 0, 3, 1, 3, 1, 3, 2, 3, 0, 2, 3] };
    const offset = surface.points.length / 3;
    const two = {
      points: Float32Array.from([...surface.points, ...tetra.points]),
      polys: Int32Array.from([...surface.polys, ...tetra.polys.map((v, i) => (i % 4 === 0 ? v : v + offset))]),
    };

    const result = await cutAndPatch({ surface: two, selectedTriangles: [0], deps: { patchHoles } });

    expect(result.changed).toBe(true);
    expect(result.edited.polys.length / 4).toBe(two.polys.length / 4 - 1 + result.edited.polys.subarray(result.edited.patchPolysOffset).length / 4);
    expect(result.diagnostics.islandsRemoved).toBe(0);
    expect(result.editBox.max[0]).toBeLessThan(50);

    // An island hanging off the rim is removed by the cleanup, and its vertices count as removed
    // points, so the edit box reaches them
    const island = {
      points: Float32Array.from([...surface.points, 30, 0, 0, 30, 1, 0]),
      polys: Int32Array.from([...surface.polys, 3, surface.polys[1], offset, offset + 1]),
    };
    const cleaned = await cutAndPatch({ surface: island, selectedTriangles: [0], options: { islandMaxTriangles: 1 }, deps: { patchHoles } });
    // Three open edges: the ear pass takes it before the island pass would
    expect(cleaned.diagnostics.earsRemoved + cleaned.diagnostics.islandsRemoved).toBe(1);
    expect(cleaned.editBox.max[0]).toBeGreaterThanOrEqual(30);
    expect(cleaned.selectedPoints.length / 3).toBeGreaterThanOrEqual(3 + 2);
  });

  it('runs the whole-mesh stages through the injected preparers', async () => {
    const prepareCut = jest.fn(args => jest.requireActual('./deleteSelection').prepareCut(args));
    const assembleCut = jest.fn(args => jest.requireActual('./deleteSelection').assembleCut(args));
    const cells = [];
    for (let t = 0; t < surface.polys.length / 4; t++) {
      if ([1, 2, 3].every(k => surface.points[3 * surface.polys[4 * t + k] + 2] > 6)) {
        cells.push(t);
      }
    }

    const result = await cutAndPatch({ surface, selectedTriangles: cells, deps: { patchHoles, prepareCut, assembleCut } });

    expect(prepareCut).toHaveBeenCalledTimes(1);
    expect(assembleCut).toHaveBeenCalledTimes(1);
    expect(result.changed).toBe(true);
    expect(isClosedManifold(result.edited.polys)).toBe(true);
  });

  it('changes nothing for an empty selection', async () => {
    const patch = jest.fn(patchHoles);
    const result = await cutAndPatch({ surface, selected: [], deps: { patchHoles: patch } });

    expect(result.changed).toBe(false);
    expect(result.edited).toBeNull();
    expect(patch).not.toHaveBeenCalled();
  });

  it('removes a whole surface the selection covers completely, without a patch', async () => {
    const result = await cutAndPatch({
      surface, selected: verticesWhere(surface.points, () => true), deps: { patchHoles },
    });

    // A valid deletion of everything, not a failed closure: nothing is left to diagnose
    expect(result).toMatchObject({ changed: true, holes: 0, edited: null });
    expect(result.diagnostics).toMatchObject({ output: null, introduced: null, acceptable: true, emptied: true });
  });

  it('closes only the loops the cut opened, and reports the openings it did not touch', async () => {
    // A surface with its top cap already missing; a second cut on its side opens one more loop
    const open = await cutAndPatch({
      surface, selected: verticesWhere(surface.points, ([, , z]) => z > 6), deps: { patchHoles: leaveOpen },
    });
    const topRim = open.diagnostics.output.boundaryEdgeCount;
    expect(topRim).toBe(16);
    const side = verticesWhere(open.edited.points, ([x, y, z]) => x > 8 && Math.abs(y) < 3 && Math.abs(z) < 3);
    const patch = jest.fn(patchHoles);

    const result = await cutAndPatch({ surface: open.edited, selected: side, deps: { patchHoles: patch } });

    expect(result.holes).toBe(1);
    expect(patch.mock.calls[0][0]).toHaveLength(1);
    expect(result.diagnostics.preexistingLoops).toEqual({ count: 1, vertexCounts: [16] });
    // The top opening is retained as it was: nothing new is open, which the report tells apart
    // from an opening the cut made. The result still has open edges, so it is not acceptable for
    // a labelmap write without the user's acknowledgement (FR-4).
    expect(result.diagnostics.output).toMatchObject({ closed: false, boundaryEdgeCount: topRim });
    expect(result.diagnostics.introduced).toMatchObject({ total: 0, boundaryEdgeCount: 0, retained: { boundaryEdgeCount: topRim } });
    expect(result.diagnostics.acceptable).toBe(false);
    // The edit box does not grow towards the untouched opening
    expect(result.editBox.max[2]).toBeLessThan(5);
  });

  it('refuses a patch or result with non-finite coordinates, unassembled', async () => {
    // A fitted cap with one NaN coordinate: its connectivity still closes the hole, so the edge
    // diagnostics would call the result closed; the integrity check refuses it first
    const selected = verticesWhere(surface.points, ([, , z]) => z > 6);
    const poisoned = async loops => loops.map(loop => {
      const patch = cap(loop);
      patch.points[0] = NaN;
      return { patch, method: 'fitted' };
    });

    const result = await cutAndPatch({ surface, selected, deps: { patchHoles: poisoned } });

    expect(result).toMatchObject({
      changed: false, edited: null, editBox: null, holes: 1,
      invalid: { reason: 'nonFinitePoints', count: 1, where: 'patch', loop: 0 },
    });
    expect(result.diagnostics.output).toBeUndefined();
    expect(result.diagnostics.acceptable).toBeUndefined();

    // A patch indexing past its own points is refused the same way
    const dangling = async loops => loops.map(loop => {
      const patch = cap(loop);
      patch.triangles[0] = patch.points.length;
      return { patch, method: 'fitted' };
    });
    const bad = await cutAndPatch({ surface, selected, deps: { patchHoles: dangling } });
    expect(bad.invalid).toMatchObject({ reason: 'invalidIndices', where: 'patch' });
  });

  it('refuses a source surface with a non-finite coordinate before cutting it', async () => {
    const points = Float32Array.from(surface.points);
    points[7] = Infinity;
    const patch = jest.fn(patchHoles);

    const result = await cutAndPatch({
      surface: { points, polys: surface.polys }, selected: verticesWhere(surface.points, ([, , z]) => z > 6), deps: { patchHoles: patch },
    });

    expect(result).toMatchObject({ changed: false, invalid: { reason: 'nonFinitePoints', count: 1, where: 'before' } });
    expect(patch).not.toHaveBeenCalled();
    const repaired = await repairSurface({ surface: { points, polys: surface.polys }, deps: { patchHoles: patch } });
    expect(repaired.invalid).toMatchObject({ where: 'before' });
  });

  it('counts the defects an edit introduces, apart from the ones it retained', async () => {
    const selected = verticesWhere(surface.points, ([, , z]) => z > 6);
    const result = await cutAndPatch({ surface, selected, deps: { patchHoles: leaveOpen } });

    expect(result.diagnostics.output.closed).toBe(false);
    expect(result.diagnostics.introduced).toMatchObject({ boundaryEdgeCount: 16, nonManifoldEdgeCount: 0, inconsistentEdgeCount: 0, total: 16 });
    expect(result.diagnostics.acceptable).toBe(false);

    // A patch wound the wrong way introduces inconsistent edges, not open ones
    const inverted = async loops => loops.map(loop => ({ patch: fanCap(loop), method: 'fitted' }));
    const turned = await cutAndPatch({ surface, selected, deps: { patchHoles: inverted } });
    expect(turned.diagnostics.output).toMatchObject({ boundaryEdgeCount: 0, closed: false });
    expect(turned.diagnostics.introduced.inconsistentEdgeCount).toBe(16);
    expect(turned.diagnostics.acceptable).toBe(false);
  });

  it('reports a weld it could not keep, and still cuts with the exact one', async () => {
    // A tiny tetrahedron beside the sphere: a tolerance wider than its edges would erase it
    const tetra = { points: [100, 0, 0, 100.05, 0, 0, 100, 0.05, 0, 100, 0, 0.05], polys: [3, 0, 2, 1, 3, 0, 1, 3, 3, 1, 2, 3, 3, 0, 3, 2] };
    const offset = surface.points.length / 3;
    const two = {
      points: Float32Array.from([...surface.points, ...tetra.points]),
      polys: Int32Array.from([...surface.polys, ...tetra.polys.map((v, i) => (i % 4 === 0 ? v : v + offset))]),
    };

    const result = await cutAndPatch({ surface: two, selectedTriangles: [0], options: { weldTolerance: 0.1 }, deps: { patchHoles } });

    expect(result.diagnostics.conditioning).toMatchObject({ requestedWeldTolerance: 0.1, effectiveWeldTolerance: 0, fellBack: true });
    expect(result.diagnostics.conditioning.preservation.extraDegenerate).toBe(4);
    // The tetrahedron survives in the result
    expect(result.edited.points.length / 3).toBeGreaterThanOrEqual(offset - 3 + 4);
  });

  it('stops after the patch once cancelled', async () => {
    let cancelled = false;
    const deps = {
      patchHoles: async loops => {
        cancelled = true;
        return patchHoles(loops);
      },
      isCancelled: () => cancelled,
    };

    await expect(cutAndPatch({
      surface, selected: verticesWhere(surface.points, ([, , z]) => z > 6), deps,
    })).rejects.toBeInstanceOf(DeleteCancelledError);
  });

  it('reports holes that could only be capped', async () => {
    const result = await cutAndPatch({
      surface,
      selected: verticesWhere(surface.points, ([, , z]) => z > 6),
      deps: { patchHoles: async loops => loops.map(loop => ({ patch: fanCap(loop), method: 'cap', error: 'no fit' })) },
    });

    expect(result).toMatchObject({ holes: 1, cappedHoles: 1, patchErrors: ['no fit'] });
  });
});

describe('editIndexBox', () => {
  it('pads the edit box by the removal depth in world units and two index cells', () => {
    const editBox = { min: [0, 0, 0], max: [2, 2, 2] };
    const map = labelmap();

    expect(editIndexBox({ editBox, labelmap: map }).indexBox)
      .toEqual({ min: [16 - 2, 16 - 2, 16 - 2], max: [16 + 2 + 2, 16 + 2 + 2, 16 + 2 + 2] });
    expect(editIndexBox({ editBox, depth: 2, labelmap: map }).indexBox)
      .toEqual({ min: [16 - 4, 16 - 4, 16 - 4], max: [16 + 2 + 4, 16 + 2 + 4, 16 + 2 + 4] });
  });

  it('adds index cells, not a world distance, on an anisotropic rotated grid', () => {
    // 0.5 x 0.5 x 3 mm voxels, the slice axis along world x: two cells are 6 mm along x and
    // 1 mm along y and z
    const anisotropic = {
      dimensions: [20, 60, 60],
      indexToWorld: ([i, j, k]) => [3 * i, 0.5 * j, 0.5 * k],
    };
    const editBox = { min: [30, 15, 15], max: [33, 16, 16] };

    const { indexBox } = editIndexBox({ editBox, labelmap: anisotropic });

    expect(indexBox).toEqual({ min: [10 - 2, 30 - 2, 30 - 2], max: [11 + 2, 32 + 2, 32 + 2] });
  });

  it('is empty for an edit outside the labelmap', () => {
    const editBox = { min: [100, 100, 100], max: [102, 102, 102] };
    expect(editIndexBox({ editBox, labelmap: labelmap() }).indexBox).toBeNull();
  });
});

describe('deleteSelection', () => {
  it('removes the cut-away cap of the segment and nothing else', async () => {
    const map = labelmap();
    const before = map.scalarData.slice();
    const selected = verticesWhere(surface.points, ([, , z]) => z > 6);

    const { result, removed, steps, deps } = await run({ surface, selected, labelmap: map });

    expect(steps).toEqual([DELETE_STEPS.cut, DELETE_STEPS.patch, DELETE_STEPS.voxelize, DELETE_STEPS.write]);
    expect(result).toMatchObject({ holes: 1, cappedHoles: 0, removedVoxels: removed.length });
    expect(removed.length).toBeGreaterThan(0);
    removed.forEach(i => {
      expect(before[i]).toBe(1); // only segment 1 voxels
      const [, , z] = indexToWorld([i % N, Math.floor(i / N) % N, Math.floor(i / (N * N))]);
      expect(z).toBeGreaterThan(3); // only near the removed cap (the hole's rim is at z = 4.6)
    });
    // Only the neighbourhood of the edit was examined
    const { indexBox } = deps.carve.mock.calls[0][0];
    expect(indexBox.min[2]).toBeGreaterThan(16);
    expect(deps.carve.mock.calls[0][0].boxData.length).toBeLessThan(N * N * N / 2);
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
        return patchHoles(loops);
      },
      carve: jest.fn(args => carveLabelmap(args)),
      removeVoxels,
      isCancelled: () => cancelled,
    };

    await expect(deleteSelection({
      surface, selected: verticesWhere(surface.points, ([, , z]) => z > 6), segmentIndex: 1,
      labelmap: labelmap(), deps,
    })).rejects.toBeInstanceOf(DeleteCancelledError);
    expect(deps.carve).not.toHaveBeenCalled();
    expect(removeVoxels).not.toHaveBeenCalled();
  });

  it('leaves the segment alone when the selection changes nothing', async () => {
    const { result, deps } = await run({ surface, selected: [], labelmap: labelmap() });

    expect(result.removedVoxels).toBe(0);
    expect(deps.patchHoles).not.toHaveBeenCalled();
    expect(deps.carve).not.toHaveBeenCalled();
    expect(deps.removeVoxels).not.toHaveBeenCalled();
  });

  it('removes a whole piece that the selection covers completely', async () => {
    const { result, removed } = await run({
      surface, selected: verticesWhere(surface.points, () => true), labelmap: labelmap(),
    });

    expect(result.holes).toBe(0);
    expect(result.edited).toBeNull();
    // Everything of the segment near the surface's bounds goes
    expect(removed.length).toBeGreaterThan(3500);
  });

  it('writes nothing for an edit outside the labelmap', async () => {
    const far = uvSphere({ radius: 5, segments: 12, rings: 8, center: [200, 200, 200] });
    const { result, deps } = await run({
      surface: far, selected: verticesWhere(far.points, ([, , z]) => z > 203), labelmap: labelmap(),
    });

    expect(result.removedVoxels).toBe(0);
    expect(deps.carve).not.toHaveBeenCalled();
  });
});

describe('cutAndPatch options', () => {
  const selected = verticesWhere(surface.points, ([, , z]) => z > 6);

  it('passes the closure and constraint cap to the patcher', async () => {
    const patch = jest.fn(patchHoles);
    await cutAndPatch({ surface, selected, deps: { patchHoles: patch }, options: { closure: 'flat', maxConstraints: 8 } });
    expect(patch).toHaveBeenCalledWith(expect.any(Array), { closure: 'flat', maxConstraints: 8 });
  });

  it('cleans the rim as the cleanup level asks', async () => {
    const jagged = verticesWhere(surface.points, ([x, y, z]) => z > 3 && z < 7 && x > 0 && Math.abs(y) < 2);
    const off = await cutAndPatch({ surface, selected: jagged, deps: { patchHoles }, options: { rimCleanup: RIM_CLEANUPS.off } });
    const full = await cutAndPatch({ surface, selected: jagged, deps: { patchHoles }, options: { rimCleanup: RIM_CLEANUPS.full } });
    expect(off.diagnostics.earsRemoved).toBe(0);
    expect(full.diagnostics.earsRemoved).toBeGreaterThanOrEqual(0);
    expect(isClosedManifold(off.edited.polys)).toBe(true);
    expect(isClosedManifold(full.edited.polys)).toBe(true);
  });

  it('welds within the tolerance before cutting', async () => {
    // Every vertex duplicated a hair away and each triangle given one duplicate: without a
    // tolerance the triangles do not share vertices and every edge is open
    const points = new Float32Array(surface.points.length * 2);
    points.set(surface.points);
    for (let i = 0; i < surface.points.length; i++) {
      points[surface.points.length + i] = surface.points[i] + 1e-4;
    }
    const n = surface.points.length / 3;
    const polys = [];
    for (let p = 0; p < surface.polys.length; p += 4) {
      const [a, b, c] = [surface.polys[p + 1], surface.polys[p + 2], surface.polys[p + 3]];
      polys.push(3, a, b + n, c);
    }
    const shifted = { points, polys: Int32Array.from(polys) };
    const loose = await cutAndPatch({ surface: shifted, selected, deps: { patchHoles }, options: { weldTolerance: 0 } });
    const welded = await cutAndPatch({ surface: shifted, selected, deps: { patchHoles }, options: { weldTolerance: 0.01 } });
    expect(loose.diagnostics.input.closed).toBe(false);
    expect(welded.diagnostics.input.closed).toBe(true);
  });
});

describe('repairSurface', () => {
  it('closes the open rims of a cut surface without a selection', async () => {
    const open = await cutAndPatch({
      surface, selected: verticesWhere(surface.points, ([, , z]) => z > 6), deps: { patchHoles: leaveOpen },
    });
    expect(open.diagnostics.output.closed).toBe(false);

    const repaired = await repairSurface({ surface: open.edited, deps: { patchHoles } });
    expect(repaired.changed).toBe(true);
    expect(repaired.holes).toBe(1);
    expect(repaired.diagnostics.input).toMatchObject({ closed: false, boundaryEdgeCount: 16 });
    expect(repaired.diagnostics.output.closed).toBe(true);
    expect(repaired.diagnostics).toMatchObject({ introduced: { total: 0 }, acceptable: true });
    expect(isClosedManifold(repaired.edited.polys)).toBe(true);
  });

  it('changes nothing on a closed surface', async () => {
    const result = await repairSurface({ surface, deps: { patchHoles } });
    expect(result.changed).toBe(false);
    expect(result.diagnostics.input.closed).toBe(true);
  });

  it('reports what it cannot close: non-manifold and inconsistent edges leave no loop to patch', async () => {
    // One face of the sphere turned over: every edge is still used twice, so there is no rim
    const polys = surface.polys.slice();
    [polys[2], polys[3]] = [polys[3], polys[2]];
    const result = await repairSurface({ surface: { points: surface.points, polys }, deps: { patchHoles } });
    expect(result.changed).toBe(false);
    expect(result.diagnostics.input).toMatchObject({ closed: false, boundaryEdgeCount: 0, inconsistentEdgeCount: 3 });
  });
});
