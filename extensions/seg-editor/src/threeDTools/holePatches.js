// One patch per hole (ohif-viewers#142, FR-20): a smooth OpenCascade patch fitted to the hole's
// boundary and stitched to it, or, when that fails, a simple fan cap. Used by the hole-filling
// worker; `oc` may be null when OpenCascade could not be loaded, in which case every hole is
// capped.

import { fanCap, sampleLoop, stitchPatch } from './meshCut.js';
import { fillBoundary } from './occFill.js';


export const PATCH_METHODS = {
  fitted: 'fitted',
  cap: 'cap',
};

// Numbers of boundary vertices a patch is fitted to, tried in turn. The fit is fast and well
// behaved with few constraint edges, but becomes ill-conditioned with many short ones: on the
// staircase-shaped rim of a hole in a marching-cubes surface, 16 to 32 constraints produced
// patches bulging 5 to 20 mm away from a rim less than 1 mm deep, while 6 to 12 gave flat,
// faithful patches in about 0.1 s. The boundary vertices in between are stitched to the patch
// (stitchPatch).
export const CONSTRAINT_COUNTS = [12, 8, 6];

// A patch fitted to a boundary with position-only (C0) constraints stays close to that boundary.
// A patch reaching further than this fraction of the boundary's extent beyond its bounding box is
// a failed fit.
const BOUNDS_MARGIN = 0.15;

/** The patch's nodes stay within the boundary's bounding box, grown by BOUNDS_MARGIN. */
export function patchWithinBounds(loopPoints, patchPoints) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < loopPoints.length; i += 3) {
    for (let d = 0; d < 3; d++) {
      min[d] = Math.min(min[d], loopPoints[i + d]);
      max[d] = Math.max(max[d], loopPoints[i + d]);
    }
  }
  const margin = BOUNDS_MARGIN * Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  for (let i = 0; i < patchPoints.length; i += 3) {
    for (let d = 0; d < 3; d++) {
      const value = patchPoints[i + d];
      if (value < min[d] - margin || value > max[d] + margin) {
        return false;
      }
    }
  }
  return true;
}

/**
 * @param {Object|null} oc - OpenCascade.js instance
 * @param {Float64Array} loopPoints - flat xyz of the hole's boundary, in order
 * @param {Object} [options]
 * @param {number[]} [options.constraintCounts] - constraint vertex counts to try, in order
 * @returns {{ patch: { points: Float64Array, triangles: Int32Array }, method: string, error?: string }}
 *   the patch in loop-local indices (nodes 0..n-1 are the boundary vertices)
 */
export function patchHole(oc, loopPoints, { constraintCounts = CONSTRAINT_COUNTS } = {}) {
  const count = loopPoints.length / 3;
  if (count === 3) {
    return {
      patch: { points: Float64Array.from(loopPoints), triangles: Int32Array.from([0, 1, 2]) },
      method: PATCH_METHODS.fitted,
    };
  }

  let error = 'OpenCascade is not available';
  if (oc) {
    const tried = new Set();
    for (const maxConstraints of constraintCounts) {
      const constraintIndices = sampleLoop(loopPoints, maxConstraints);
      if (constraintIndices.length < 3 || tried.has(constraintIndices.length)) {
        continue;
      }
      tried.add(constraintIndices.length);

      try {
        const constraintPoints = new Float64Array(constraintIndices.length * 3);
        constraintIndices.forEach((loopIndex, i) =>
          constraintPoints.set(loopPoints.subarray(3 * loopIndex, 3 * loopIndex + 3), 3 * i));

        const fitted = fillBoundary(oc, constraintPoints);
        if (!patchWithinBounds(loopPoints, fitted.points)) {
          error = 'The fitted patch strays from the hole boundary';
          continue;
        }
        const patch = stitchPatch({
          loopPoints,
          constraintIndices,
          patchPoints: fitted.points,
          patchTriangles: fitted.triangles,
        });
        if (patch) {
          return { patch, method: PATCH_METHODS.fitted };
        }
        error = 'The fitted patch does not match the hole boundary';
      } catch (err) {
        error = String(err?.message || err);
      }
    }
  }

  return { patch: fanCap(loopPoints), method: PATCH_METHODS.cap, error };
}
