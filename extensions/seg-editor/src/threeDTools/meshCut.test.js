// Cutting surfaces, finding their holes and stitching patches into them (3D Selection tool delete)

import {
  assembleSurface,
  cutSurface,
  fanCap,
  findBoundaryLoops,
  loopPositions,
  polysToTriangles,
  sampleLoop,
  stitchPatch,
  weldVertices,
} from './meshCut';
import { edgeUse, isClosedManifold, uvSphere, verticesWhere } from './testing/meshes';


describe('polysToTriangles / weldVertices', () => {
  it('fans polygons into triangles', () => {
    expect(Array.from(polysToTriangles([4, 0, 1, 2, 3, 3, 4, 5, 6])))
      .toEqual([0, 1, 2, 0, 2, 3, 4, 5, 6]);
  });

  it('maps vertices that share a position to one index', () => {
    expect(Array.from(weldVertices([0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0]))).toEqual([0, 1, 0, 1]);
  });
});

describe('cutSurface / findBoundaryLoops', () => {
  it('finds no holes in a closed surface', () => {
    const sphere = uvSphere();
    const { triangles, removedCount } = cutSurface({ ...sphere, selected: [] });

    expect(removedCount).toBe(0);
    expect(findBoundaryLoops(triangles)).toEqual([]);
  });

  it('removes the triangles touching the selection and finds the hole they leave', () => {
    const sphere = uvSphere({ segments: 16, rings: 10 });
    const cap = verticesWhere(sphere.points, ([, , z]) => z > 9); // north pole + first ring

    const { triangles, removedCount } = cutSurface({ ...sphere, selected: cap });
    const loops = findBoundaryLoops(triangles);

    expect(removedCount).toBe(16 + 32); // pole fan + the band below the first ring
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(16); // the second ring
  });

  it('finds one loop per hole', () => {
    const sphere = uvSphere({ segments: 16, rings: 10 });
    const poles = verticesWhere(sphere.points, ([, , z]) => Math.abs(z) > 9.9);

    const loops = findBoundaryLoops(cutSurface({ ...sphere, selected: poles }).triangles);

    expect(loops.map(loop => loop.length)).toEqual([16, 16]);
  });

  it('cuts a surface whose triangles do not share vertices (unwelded)', () => {
    const sphere = uvSphere({ segments: 8, rings: 6 });
    // Give every triangle its own copies of its vertices
    const points = [];
    const polys = [];
    const triangles = polysToTriangles(sphere.polys);
    for (let t = 0; t < triangles.length; t++) {
      const v = triangles[t];
      points.push(sphere.points[3 * v], sphere.points[3 * v + 1], sphere.points[3 * v + 2]);
      if (t % 3 === 0) {
        polys.push(3, t, t + 1, t + 2);
      }
    }
    const pole = verticesWhere(points, ([, , z]) => z > 9.9);

    const loops = findBoundaryLoops(cutSurface({ points, polys, selected: pole }).triangles);

    expect(loops.map(loop => loop.length)).toEqual([8]);
  });
});

describe('sampleLoop', () => {
  it('keeps every vertex of a short loop', () => {
    expect(sampleLoop(new Float64Array(12 * 3), 32)).toHaveLength(12);
  });

  it('spreads the samples of a long loop along its length, starting at the first vertex', () => {
    const count = 100;
    const positions = new Float64Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions.set([Math.cos((2 * Math.PI * i) / count), Math.sin((2 * Math.PI * i) / count), 0], 3 * i);
    }

    const picked = sampleLoop(positions, 20);

    expect(picked[0]).toBe(0);
    expect(picked).toHaveLength(20);
    const gaps = picked.slice(1).map((index, i) => index - picked[i]);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
  });
});

// A planar disc patch over a loop, meshed like a fitted patch: boundary through the constraint
// vertices, straight chords (optionally split) in between, and a centre node
function discPatch(loopPoints, constraintIndices, { splitChords = false } = {}) {
  const at = i => Array.from(loopPoints.slice(3 * i, 3 * i + 3));
  const boundary = [];
  constraintIndices.forEach((loopIndex, k) => {
    const a = at(loopIndex);
    boundary.push(a);
    if (splitChords) {
      const b = at(constraintIndices[(k + 1) % constraintIndices.length]);
      boundary.push(a.map((value, d) => (value + b[d]) / 2));
    }
  });
  const centre = [0, 0, 0];
  boundary.forEach(p => p.forEach((value, d) => { centre[d] += value / boundary.length; }));
  const points = Float64Array.from([...boundary.flat(), ...centre]);
  const triangles = [];
  boundary.forEach((_p, i) => triangles.push(i, (i + 1) % boundary.length, boundary.length));
  return { points, triangles: Int32Array.from(triangles) };
}

describe('stitchPatch / assembleSurface', () => {
  function cutSphere({ segments, rings = 12 }) {
    const sphere = uvSphere({ segments, rings });
    const cap = verticesWhere(sphere.points, ([, , z]) => z > 9);
    const { triangles } = cutSurface({ ...sphere, selected: cap });
    const [loop] = findBoundaryLoops(triangles);
    return { sphere, triangles, loop, loopPoints: loopPositions(sphere.points, loop) };
  }

  it('closes a hole with a fan cap', () => {
    const { sphere, triangles, loop, loopPoints } = cutSphere({ segments: 16 });

    const closed = assembleSurface({
      points: sphere.points, triangles, patches: [{ loop, patch: fanCap(loopPoints) }],
    });

    expect(isClosedManifold(closed.polys)).toBe(true);
  });

  it.each([
    ['every boundary vertex a constraint', 16, 32, false],
    ['a subset of the boundary as constraints', 48, 12, false],
    ['split chords', 48, 12, true],
  ])('stitches a fitted patch into the hole without gaps (%s)', (_case, segments, maxConstraints, splitChords) => {
    const { sphere, triangles, loop, loopPoints } = cutSphere({ segments });
    const constraintIndices = sampleLoop(loopPoints, maxConstraints);
    const fitted = discPatch(loopPoints, constraintIndices, { splitChords });

    const patch = stitchPatch({
      loopPoints, constraintIndices, patchPoints: fitted.points, patchTriangles: fitted.triangles,
    });
    const closed = assembleSurface({ points: sphere.points, triangles, patches: [{ loop, patch }] });

    expect(patch).not.toBeNull();
    expect(isClosedManifold(closed.polys)).toBe(true);
  });

  it('stitches a patch whose boundary runs the other way round', () => {
    const { sphere, triangles, loop, loopPoints } = cutSphere({ segments: 32 });
    const constraintIndices = sampleLoop(loopPoints, 8);
    const fitted = discPatch(loopPoints, constraintIndices);
    // Reverse every patch triangle (its boundary is then walked in the opposite direction)
    const reversed = Int32Array.from(fitted.triangles);
    for (let t = 0; t < reversed.length; t += 3) {
      [reversed[t + 1], reversed[t + 2]] = [reversed[t + 2], reversed[t + 1]];
    }

    const patch = stitchPatch({
      loopPoints, constraintIndices, patchPoints: fitted.points, patchTriangles: reversed,
    });
    const closed = assembleSurface({ points: sphere.points, triangles, patches: [{ loop, patch }] });

    expect(isClosedManifold(closed.polys)).toBe(true);
  });

  it('rejects a patch that does not run through the constraint vertices', () => {
    const { loopPoints } = cutSphere({ segments: 16 });
    const constraintIndices = sampleLoop(loopPoints, 8);
    const fitted = discPatch(loopPoints, constraintIndices);
    fitted.points[0] += 1; // move a boundary node off its constraint vertex

    expect(stitchPatch({
      loopPoints, constraintIndices, patchPoints: fitted.points, patchTriangles: fitted.triangles,
    })).toBeNull();
  });

  it('drops the points no triangle uses', () => {
    const sphere = uvSphere({ segments: 8, rings: 6 });
    const cap = verticesWhere(sphere.points, ([, , z]) => z > 9.9);
    const { triangles } = cutSurface({ ...sphere, selected: cap });

    const open = assembleSurface({ points: sphere.points, triangles, patches: [] });

    expect(open.points.length / 3).toBe(sphere.points.length / 3 - 1);
    expect([...edgeUse(open.polys).values()].filter(count => count === 1)).toHaveLength(8);
  });
});
