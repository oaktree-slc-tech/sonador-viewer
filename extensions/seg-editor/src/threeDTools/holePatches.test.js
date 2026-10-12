// Choosing a patch per hole: a fitted patch when one behaves, else a flat triangulation; the
// patch wound with the surface around the hole

import { isClosedManifold } from './testing/meshes';
import { CLOSURES, CONSTRAINT_COUNTS, constraintCountsUpTo, PATCH_METHODS,patchHole, patchWithinBounds } from './holePatches';
import { fillBoundary } from './occFill';

jest.mock('./occFill', () => ({ fillBoundary: jest.fn() }));

// A planar ring of `count` vertices, radius 10
function ring(count) {
  const points = new Float64Array(count * 3);
  for (let i = 0; i < count; i++) {
    const angle = (2 * Math.PI * i) / count;
    points.set([10 * Math.cos(angle), 10 * Math.sin(angle), 0], 3 * i);
  }
  return points;
}

// A disc patch through the given boundary positions, with a centre node at height `z`
function disc(constraintPoints, z = 0) {
  const count = constraintPoints.length / 3;
  const points = new Float64Array((count + 1) * 3);
  points.set(constraintPoints);
  points.set([0, 0, z], count * 3);
  const triangles = [];
  for (let i = 0; i < count; i++) {
    triangles.push(i, (i + 1) % count, count);
  }
  return { points, triangles: Int32Array.from(triangles), fitError: 0 };
}

const OC = {};

beforeEach(() => fillBoundary.mockReset());

describe('patchWithinBounds', () => {
  it('accepts a patch close to the boundary and rejects one that strays', () => {
    const loop = ring(8);
    expect(patchWithinBounds(loop, disc(loop, 1).points)).toBe(true);
    expect(patchWithinBounds(loop, disc(loop, 8).points)).toBe(false);
  });
});

describe('patchHole', () => {
  it('fits the patch to a few spread-out boundary vertices', () => {
    fillBoundary.mockImplementation((_oc, points) => disc(points));

    const result = patchHole(OC, ring(40));

    expect(result.method).toBe(PATCH_METHODS.fitted);
    expect(fillBoundary).toHaveBeenCalledTimes(1);
    expect(fillBoundary.mock.calls[0][1].length / 3).toBe(CONSTRAINT_COUNTS[0]);
    // Boundary vertices first, then the patch's own nodes
    expect(Array.from(result.patch.points.slice(0, 120))).toEqual(Array.from(ring(40)));
  });

  it('retries with fewer constraints when a fitted patch strays from the boundary', () => {
    fillBoundary
      .mockImplementationOnce((_oc, points) => disc(points, 30))
      .mockImplementation((_oc, points) => disc(points));

    const result = patchHole(OC, ring(40));

    expect(result.method).toBe(PATCH_METHODS.fitted);
    expect(fillBoundary.mock.calls.map(([, points]) => points.length / 3)).toEqual([12, 8]);
  });

  it('closes the hole flat when no fit succeeds, and says why', () => {
    fillBoundary.mockImplementation(() => {
      throw new Error('No surface could be fitted to the boundary');
    });

    const result = patchHole(OC, ring(40));

    expect(result.method).toBe(PATCH_METHODS.flat);
    expect(result.error).toBe('No surface could be fitted to the boundary');
    // An ear-clipped ring: n - 2 triangles over the ring's own vertices
    expect(result.patch.triangles).toHaveLength(38 * 3);
    expect(result.patch.points).toHaveLength(40 * 3);
  });

  it('closes every hole flat without OpenCascade', () => {
    const result = patchHole(null, ring(10));

    expect(result.method).toBe(PATCH_METHODS.flat);
    expect(result.error).toBeDefined();
    expect(fillBoundary).not.toHaveBeenCalled();
  });

  it('closes a three-vertex hole with one triangle wound against the rim', () => {
    const result = patchHole(OC, ring(3));

    // The rim runs 0 -> 1 -> 2, so the triangle runs the other way
    expect(Array.from(result.patch.triangles)).toEqual([0, 2, 1]);
    expect(result.method).toBe(PATCH_METHODS.flat);
    expect(fillBoundary).not.toHaveBeenCalled();
  });

  it('closes small holes flat and larger ones smooth under the automatic closure', () => {
    fillBoundary.mockImplementation((_oc, points) => disc(points));

    expect(patchHole(OC, ring(8)).method).toBe(PATCH_METHODS.flat);
    expect(fillBoundary).not.toHaveBeenCalled();
    expect(patchHole(OC, ring(9)).method).toBe(PATCH_METHODS.fitted);
  });

  it('follows the closure setting', () => {
    fillBoundary.mockImplementation((_oc, points) => disc(points));

    expect(patchHole(OC, ring(40), { closure: CLOSURES.flat }).method).toBe(PATCH_METHODS.flat);
    expect(fillBoundary).not.toHaveBeenCalled();
    expect(patchHole(OC, ring(5), { closure: CLOSURES.smooth }).method).toBe(PATCH_METHODS.fitted);
  });

  it('fits a short boundary once through all of its vertices', () => {
    fillBoundary.mockImplementation((_oc, points) => disc(points, 30));

    patchHole(OC, ring(5), { closure: CLOSURES.smooth });

    expect(fillBoundary.mock.calls.map(([, points]) => points.length / 3)).toEqual([5]);
  });

  it('caps the constraint counts at the maximum asked for', () => {
    expect(constraintCountsUpTo(8)).toEqual([8, 6]);
    expect(constraintCountsUpTo(10)).toEqual([10, 8, 6]);
    expect(constraintCountsUpTo(undefined)).toEqual(CONSTRAINT_COUNTS);
  });

  it('winds every patch against the rim, so the closed surface is consistent', () => {
    fillBoundary.mockImplementation((_oc, points) => disc(points));
    const loop = ring(20);

    [patchHole(OC, loop, { closure: CLOSURES.smooth }), patchHole(OC, loop, { closure: CLOSURES.flat })]
      .forEach(({ patch }) => {
        // A rim triangle fan wound with the loop (0 -> 1 -> 2 ...) plus the patch: closed manifold
        const rimFan = [];
        for (let i = 0; i < 20; i++) {
          rimFan.push(3, i, (i + 1) % 20, patch.points.length / 3); // an apex beyond the patch's nodes
        }
        const polys = [...rimFan];
        for (let t = 0; t < patch.triangles.length; t += 3) {
          polys.push(3, patch.triangles[t], patch.triangles[t + 1], patch.triangles[t + 2]);
        }
        expect(isClosedManifold(polys)).toBe(true);
      });
  });
});
