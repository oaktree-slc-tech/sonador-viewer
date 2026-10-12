// Conditioning, diagnostics, rim cleanup, selection shaping and flat closure

import { isClosedManifold, uvSphere, verticesWhere } from './testing/meshes';
import { polysToTriangles } from './meshCut';
import {
  cleanRim,
  conditionSurface,
  earClipLoop,
  growSelection,
  largestConnectedSelection,
  orientPatchToRim,
  selectionTopology,
  shrinkSelection,
  surfaceDiagnostics,
  weldVerticesWithin,
} from './meshRepair';


const tri = (...t) => Int32Array.from(t);

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
    expect(result).toMatchObject({ degenerate: 1, duplicate: 1 });
  });
});

describe('surfaceDiagnostics', () => {
  it('finds a closed sphere closed', () => {
    const sphere = uvSphere({ radius: 5, segments: 8, rings: 6 });
    const result = surfaceDiagnostics(polysToTriangles(sphere.polys));
    expect(result.closed).toBe(true);
    expect(result.boundaryEdgeCount).toBe(0);
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
