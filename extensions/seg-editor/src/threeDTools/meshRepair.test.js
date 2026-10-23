// Conditioning, diagnostics, rim cleanup, selection shaping and flat closure

import { isClosedManifold, uvSphere, verticesWhere } from './testing/meshes';
import { polysToTriangles } from './meshCut';
import {
  cleanRim,
  conditionSurface,
  earClipLoop,
  edgeStatistics,
  growSelection,
  largestConnectedSelection,
  orientPatchToRim,
  selectionTopology,
  shrinkSelection,
  surfaceDiagnostics,
  triangleComponentCount,
  weldVerticesWithin,
  writtenSurfaceDiagnostics,
} from './meshRepair';


const tri = (...t) => Int32Array.from(t);

// A closed tetrahedron of edge length about `size` at `at`, as a Cornerstone3D surface
function tetrahedron(size = 1, at = [0, 0, 0]) {
  const [x, y, z] = at;
  return {
    points: Float32Array.from([x, y, z, x + size, y, z, x, y + size, z, x, y, z + size]),
    polys: Int32Array.from([3, 0, 2, 1, 3, 0, 1, 3, 3, 1, 2, 3, 3, 0, 3, 2]),
  };
}

// Several surfaces joined as one, with their vertex indices offset
function joined(...surfaces) {
  const points = [];
  const polys = [];
  surfaces.forEach(surface => {
    const offset = points.length / 3;
    points.push(...surface.points);
    for (let p = 0; p < surface.polys.length; p += 4) {
      polys.push(3, surface.polys[p + 1] + offset, surface.polys[p + 2] + offset, surface.polys[p + 3] + offset);
    }
  });
  return { points: Float32Array.from(points), polys: Int32Array.from(polys) };
}

describe('weldVerticesWithin', () => {
  it('merges vertices within the tolerance, and only exact positions without one', () => {
    const points = [0, 0, 0, 0.0004, 0, 0, 1, 0, 0, 0, 0, 0];
    expect(Array.from(weldVerticesWithin(points))).toEqual([0, 1, 2, 0]);
    expect(Array.from(weldVerticesWithin(points, 0.001))).toEqual([0, 0, 2, 0]);
  });
});

describe('conditionSurface', () => {
  it('drops degenerate and duplicate triangles after the weld', () => {
    const points = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0];
    // (0, 1, 2), its duplicate through the welded vertex 3, and a sliver (0, 1, 3)
    const polys = [3, 0, 1, 2, 3, 0, 3, 2, 3, 0, 1, 3];
    const result = conditionSurface({ points, polys });
    expect(Array.from(result.triangles)).toEqual([0, 1, 2]);
    expect(result).toMatchObject({ degenerate: 1, duplicate: 1, effectiveWeldTolerance: 0, preserved: true, fellBack: false });
  });

  it('keeps a tolerance that only joins seams', () => {
    // Two triangles of one piece meeting along an edge whose far vertex is duplicated a hair
    // away: the weld closes the seam and loses nothing
    const points = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1.0004, 0, 0, 1, 1, 0];
    const polys = [3, 0, 1, 2, 3, 0, 3, 4];
    const result = conditionSurface({ points, polys }, { weldTolerance: 0.001 });
    expect(result).toMatchObject({ effectiveWeldTolerance: 0.001, preserved: true, fellBack: false, degenerate: 0, duplicate: 0 });
    expect(surfaceDiagnostics(result.triangles).boundaryEdgeCount).toBe(4);
    expect(result.preservation).toMatchObject({ flipped: 0, componentsBefore: 1, componentsAfter: 1 });
  });

  it('falls back to the exact weld when a tolerance would erase a tiny valid component', () => {
    // The October 17 counterexample: unit tetrahedra and one much smaller one. The first
    // percentile of the edge lengths is 1, so a p1 / 10 cap allows 0.1, which collapses the
    // small tetrahedron while the output still looks closed.
    const big = Array.from({ length: 100 }, (_, i) => tetrahedron(1, [3 * i, 0, 0]));
    const surface = joined(...big, tetrahedron(0.05, [0, 10, 0]));
    const stats = edgeStatistics(surface.points, polysToTriangles(surface.polys));
    expect(stats.p1).toBeCloseTo(1, 6);

    const result = conditionSurface(surface, { weldTolerance: stats.p1 / 10 });

    expect(result.fellBack).toBe(true);
    expect(result.preserved).toBe(false);
    expect(result).toMatchObject({ effectiveWeldTolerance: 0, requestedWeldTolerance: 0.1, degenerate: 0, duplicate: 0 });
    expect(result.triangles).toHaveLength(101 * 4 * 3);
    expect(result.preservation).toMatchObject({ extraDegenerate: 4 });
    expect(triangleComponentCount(result.triangles)).toBe(101);
    // The collapsed result would have looked closed: the counts alone cannot see the loss
    expect(surfaceDiagnostics(result.triangles).closed).toBe(true);
  });

  it('falls back when a tolerance merges two components or turns a triangle over', () => {
    // Two tetrahedra a hair apart: a tolerance wide enough to join them merges components
    const close = joined(tetrahedron(1, [0, 0, 0]), tetrahedron(1, [1.0005, 0, 0]));
    const merged = conditionSurface(close, { weldTolerance: 0.001 });
    expect(merged.fellBack).toBe(true);
    expect(merged.preservation.componentsBefore).toBe(2);
    expect(merged.preservation.componentsAfter).toBeLessThan(2);

    // Two slivers back to back whose apexes weld together: the second turns over (and doubles
    // the first), which the exact weld never does
    const sliver = {
      points: [0, 0, 0, 2, 0, 0, 1, 0.0005, 0, 1, -0.0004, 0],
      polys: [3, 0, 1, 2, 3, 3, 1, 0],
    };
    const turned = conditionSurface(sliver, { weldTolerance: 0.001 });
    expect(turned.fellBack).toBe(true);
  });

  it('falls back when a tolerance flattens a sound triangle onto a line', () => {
    // Three distinct canonical vertices that end up collinear are not an index degeneracy, and
    // a vanished normal has no sign to turn over: the area check has to see the collapse. The
    // weld is below p1 / 10 (p1 is 5), and the tolerance joins vertex 4 to vertex 2.
    const points = [0, 0, 0, 10, 0, 0, 5, 0, 0, 0, 10, 0, 5, 0.05, 0];
    const polys = [3, 0, 1, 4, 3, 2, 0, 3];
    expect(edgeStatistics(points, polysToTriangles(polys)).p1).toBeCloseTo(5, 6);

    const result = conditionSurface({ points, polys }, { weldTolerance: 0.1 });

    expect(result.fellBack).toBe(true);
    expect(result.preserved).toBe(false);
    expect(result.preservation).toMatchObject({ collapsed: 1, flipped: 0, extraDegenerate: 0, extraDuplicate: 0 });
    expect(result).toMatchObject({ effectiveWeldTolerance: 0, requestedWeldTolerance: 0.1 });
    expect(result.triangles).toHaveLength(6);
  });
});

describe('surfaceDiagnostics', () => {
  it('finds a closed sphere closed', () => {
    const sphere = uvSphere({ radius: 5, segments: 8, rings: 6 });
    const result = surfaceDiagnostics(polysToTriangles(sphere.polys));
    expect(result.closed).toBe(true);
    expect(result.boundaryEdgeCount).toBe(0);
    expect(result.inconsistentEdgeCount).toBe(0);
  });

  it('reports open and non-manifold edges', () => {
    // Two triangles sharing an edge, plus a third on the same edge (a fin)
    const triangles = tri(0, 1, 2, 1, 0, 3, 0, 1, 4);
    const result = surfaceDiagnostics(triangles);
    expect(result.nonManifoldEdgeCount).toBe(1);
    expect(Array.from(result.nonManifoldEdges)).toEqual([0, 1]);
    expect(result.boundaryEdgeCount).toBe(6);
    expect(result.closed).toBe(false);
  });

  it('sees a reversed face through its inconsistently wound edges', () => {
    // A tetrahedron with one face turned over: every edge is still used twice, but the three
    // edges of that face are traversed the same way by both faces
    const polys = tetrahedron().polys.slice();
    [polys[2], polys[3]] = [polys[3], polys[2]];
    const result = surfaceDiagnostics(polysToTriangles(polys));
    expect(result.boundaryEdgeCount).toBe(0);
    expect(result.nonManifoldEdgeCount).toBe(0);
    expect(result.inconsistentEdgeCount).toBe(3);
    expect(result.inconsistentEdges).toHaveLength(6);
    expect(result.closed).toBe(false);
    // The untouched tetrahedron is consistent
    expect(surfaceDiagnostics(polysToTriangles(tetrahedron().polys))).toMatchObject({ inconsistentEdgeCount: 0, closed: true });
  });
});

describe('writtenSurfaceDiagnostics', () => {
  // The review's reproductions (ohif-viewers!104, round 3): the conditioned copy the health
  // diagnoses hides a defect the written faces keep
  it('counts a duplicate face the conditioned diagnosis drops, at the default weld', () => {
    const points = [0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10];
    const polys = [3, 0, 2, 1, 3, 0, 1, 3, 3, 0, 3, 2, 3, 1, 2, 3, 3, 0, 2, 1];
    const conditioned = conditionSurface({ points, polys });
    expect(conditioned).toMatchObject({ duplicate: 1, degenerate: 0 });
    expect(surfaceDiagnostics(conditioned.triangles).closed).toBe(true);

    const written = writtenSurfaceDiagnostics({ points, polys });
    expect(written).toMatchObject({ closed: false, boundaryEdgeCount: 0, nonManifoldEdgeCount: 3, inconsistentEdgeCount: 0, degenerate: 0, triangles: 5 });
  });

  it('counts a seam a developer weld would close', () => {
    // Vertex 0 replaced by a fifth point a hair away in the first face only: four open edges
    const points = [0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10, 0.001, 0, 0];
    const polys = [3, 4, 2, 1, 3, 0, 1, 3, 3, 0, 3, 2, 3, 1, 2, 3];
    const conditioned = conditionSurface({ points, polys }, { weldTolerance: 0.009999 });
    expect(conditioned).toMatchObject({ effectiveWeldTolerance: 0.009999, fellBack: false });
    expect(surfaceDiagnostics(conditioned.triangles).closed).toBe(true);

    const written = writtenSurfaceDiagnostics({ points, polys });
    expect(written).toMatchObject({ closed: false, boundaryEdgeCount: 4, nonManifoldEdgeCount: 0, triangles: 4 });
  });

  it('takes coincident positions as one vertex and leaves zero-area faces out, counted', () => {
    // The voxelizer sees positions: a face through an exact copy of vertex 1 closes the
    // tetrahedron like the original would, and a face with two coincident corners is no face
    const points = [0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10, 10, 0, 0];
    const polys = [3, 0, 2, 4, 3, 0, 1, 3, 3, 0, 3, 2, 3, 1, 2, 3, 3, 0, 1, 4];
    expect(writtenSurfaceDiagnostics({ points, polys })).toMatchObject({
      closed: true, boundaryEdgeCount: 0, nonManifoldEdgeCount: 0, inconsistentEdgeCount: 0, degenerate: 1, triangles: 4,
    });
    expect(writtenSurfaceDiagnostics(tetrahedron())).toMatchObject({ closed: true, degenerate: 0, triangles: 4 });
  });
});

describe('edgeStatistics', () => {
  it('measures the unique edges once, with the percentiles asked for', () => {
    const { points, polys } = tetrahedron(2);
    const stats = edgeStatistics(points, polysToTriangles(polys));
    expect(stats).toMatchObject({ edgeCount: 6, sampleSize: 6, sampled: false });
    expect(stats.p1).toBeCloseTo(2, 6);
    expect(stats.p50).toBeCloseTo(2, 6);
    expect(stats.mean).toBeCloseTo((3 * 2 + 3 * Math.SQRT2 * 2) / 6, 6);
  });

  it('samples a large surface and says so', () => {
    const sphere = uvSphere({ radius: 5, segments: 24, rings: 16 });
    const triangles = polysToTriangles(sphere.polys);
    const full = edgeStatistics(sphere.points, triangles);
    const sampled = edgeStatistics(sphere.points, triangles, { sampleLimit: 200 });
    expect(full.sampled).toBe(false);
    expect(sampled).toMatchObject({ edgeCount: full.edgeCount, sampleSize: 200, sampled: true });
    expect(sampled.p50).toBeCloseTo(full.p50, 0);
  });

  it('has no statistics without edges', () => {
    expect(edgeStatistics([], new Int32Array(0))).toMatchObject({ edgeCount: 0, p1: null, mean: null });
  });
});

describe('cleanRim', () => {
  it('removes ears pass by pass, and leaves the rest', () => {
    // A strip of three triangles: the end ones have two open edges each
    const strip = tri(0, 1, 2, 1, 3, 2, 3, 4, 2);
    const one = cleanRim(strip, { passes: 1 });
    expect(one.earsRemoved).toBe(2);
    expect(Array.from(one.triangles)).toEqual([1, 3, 2]);
    expect(cleanRim(strip, { passes: 0 }).earsRemoved).toBe(0);
  });

  it('removes small islands but never the largest component', () => {
    const sphere = uvSphere({ radius: 5, segments: 8, rings: 6 });
    const main = polysToTriangles(sphere.polys);
    const island = tri(100, 101, 102);
    const triangles = Int32Array.from([...main, ...island]);
    const result = cleanRim(triangles, { islandMaxTriangles: 5 });
    expect(result.islandsRemoved).toBe(1);
    expect(result.triangles).toHaveLength(main.length);
    expect(cleanRim(island, { islandMaxTriangles: 5 }).islandsRemoved).toBe(0);
  });
});

describe('selection shaping', () => {
  const sphere = uvSphere({ radius: 10, segments: 12, rings: 8 });
  const topology = selectionTopology(sphere);
  const north = verticesWhere(sphere.points, ([, , z]) => z > 9.9); // the pole alone

  it('grows by one ring of neighbours and shrinks back', () => {
    const grown = growSelection(north, topology);
    expect(grown.size).toBe(1 + 12);
    expect(shrinkSelection(grown, topology)).toEqual(new Set(north));
    expect(shrinkSelection(north, topology).size).toBe(0);
  });

  it('keeps the largest connected part only', () => {
    const south = verticesWhere(sphere.points, ([, , z]) => z < -9.9);
    const selected = new Set([...growSelection(north, topology), ...south]);
    const connected = largestConnectedSelection(selected, topology);
    expect(connected.size).toBe(13);
    expect(connected.has(south[0])).toBe(false);
  });
});

describe('earClipLoop', () => {
  const closedWithRim = (count, triangles, apex) => {
    const polys = [];
    for (let i = 0; i < count; i++) {
      polys.push(3, i, (i + 1) % count, apex);
    }
    for (let t = 0; t < triangles.length; t += 3) {
      polys.push(3, triangles[t], triangles[t + 1], triangles[t + 2]);
    }
    return polys;
  };

  it('triangulates a concave loop without crossing it, as n - 2 triangles', () => {
    // An L shape in the xy plane
    const loop = Float64Array.from([0, 0, 0, 4, 0, 0, 4, 1, 0, 1, 1, 0, 1, 4, 0, 0, 4, 0]);
    const { triangles, method } = earClipLoop(loop);
    expect(method).toBe('flat');
    expect(triangles).toHaveLength(4 * 3);
    // Oriented against the rim, the rim fan plus the patch is a closed manifold
    const oriented = orientPatchToRim(triangles, 6).triangles;
    expect(isClosedManifold(closedWithRim(6, oriented, 6))).toBe(true);
    // No triangle covers the notch's corner (1, 1) from outside
    const area = (a, b, c) => Math.abs((loop[3 * b] - loop[3 * a]) * (loop[3 * c + 1] - loop[3 * a + 1])
      - (loop[3 * c] - loop[3 * a]) * (loop[3 * b + 1] - loop[3 * a + 1])) / 2;
    let total = 0;
    for (let t = 0; t < triangles.length; t += 3) {
      total += area(triangles[t], triangles[t + 1], triangles[t + 2]);
    }
    expect(total).toBeCloseTo(7, 6); // the L's area
  });

  it('handles a loop that is not planar', () => {
    const loop = Float64Array.from([0, 0, 0, 2, 0, 1, 2, 2, 0, 0, 2, 1, -1, 1, 0.5]);
    const { triangles } = earClipLoop(loop);
    expect(triangles).toHaveLength(3 * 3);
  });

  it('falls back to a fan when no ear can be clipped', () => {
    // A degenerate loop: every vertex on one line
    const loop = Float64Array.from([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0]);
    const { triangles, method } = earClipLoop(loop);
    expect(method).toBe('cap');
    expect(triangles).toHaveLength(4 * 3);
  });
});

describe('orientPatchToRim', () => {
  it('flips a patch that runs with the rim and leaves one that runs against it', () => {
    const with_ = tri(0, 1, 2);
    expect(orientPatchToRim(with_, 3)).toEqual({ triangles: tri(0, 2, 1), flipped: true });
    expect(orientPatchToRim(tri(0, 2, 1), 3)).toEqual({ triangles: tri(0, 2, 1), flipped: false });
  });
});
