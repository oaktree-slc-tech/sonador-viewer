// Choosing a patch per hole: a fitted patch when one behaves, else a fan cap

import { CONSTRAINT_COUNTS, patchHole, patchWithinBounds, PATCH_METHODS } from './holePatches';
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

  it('caps the hole when no fit succeeds, and says why', () => {
    fillBoundary.mockImplementation(() => {
      throw new Error('No surface could be fitted to the boundary');
    });

    const result = patchHole(OC, ring(40));

    expect(result.method).toBe(PATCH_METHODS.cap);
    expect(result.error).toBe('No surface could be fitted to the boundary');
    expect(result.patch.triangles).toHaveLength(40 * 3);
  });

  it('caps every hole without OpenCascade', () => {
    const result = patchHole(null, ring(10));

    expect(result.method).toBe(PATCH_METHODS.cap);
    expect(fillBoundary).not.toHaveBeenCalled();
  });

  it('closes a three-vertex hole with one triangle', () => {
    const result = patchHole(OC, ring(3));

    expect(Array.from(result.patch.triangles)).toEqual([0, 1, 2]);
    expect(fillBoundary).not.toHaveBeenCalled();
  });

  it('fits a short boundary once through all of its vertices', () => {
    fillBoundary.mockImplementation((_oc, points) => disc(points, 30));

    patchHole(OC, ring(5));

    expect(fillBoundary.mock.calls.map(([, points]) => points.length / 3)).toEqual([5]);
  });
});
