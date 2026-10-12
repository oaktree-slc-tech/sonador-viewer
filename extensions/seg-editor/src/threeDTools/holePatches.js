// One patch per hole (ohif-viewers#142, FR-20 / §12): a smooth OpenCascade patch fitted to the
// hole's boundary and stitched to it, or a flat triangulation of the boundary, as the closure
// setting asks; the patch is oriented with the surface it closes. Used by the hole-filling
// worker; `oc` may be null when OpenCascade could not be loaded, in which case every hole is
// closed flat.

import { sampleLoop, stitchPatch } from './meshCut.js';
import { earClipLoop, orientPatchToRim } from './meshRepair.js';
import { fillBoundary } from './occFill.js';


export const PATCH_METHODS = {
  fitted: 'fitted',
  flat: 'flat',
  cap: 'cap',
};

export const CLOSURES = {
  auto: 'auto',
  smooth: 'smooth',
  flat: 'flat',
};

// Numbers of boundary vertices a patch is fitted to, tried in turn. The fit is fast and well
// behaved with few constraint edges, but becomes ill-conditioned with many short ones: on the
// staircase-shaped rim of a hole in a marching-cubes surface, 16 to 32 constraints produced
// patches bulging 5 to 20 mm away from a rim less than 1 mm deep, while 6 to 12 gave flat,
// faithful patches in about 0.1 s. The boundary vertices in between are stitched to the patch
// (stitchPatch).
export const CONSTRAINT_COUNTS = [12, 8, 6];

// Holes with at most this many boundary vertices are closed flat by the automatic closure: a
// fitted patch cannot improve on a flat one at that size
export const AUTO_FLAT_MAX_VERTICES = 8;

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

/** Constraint counts no larger than `maxConstraints`, with that count first when it is new. */
export function constraintCountsUpTo(maxConstraints, counts = CONSTRAINT_COUNTS) {
  if (!(maxConstraints > 0)) {
    return counts;
  }
  const within = counts.filter(count => count <= maxConstraints);
  return within.includes(maxConstraints) ? within : [maxConstraints, ...within];
}

function _flat(loopPoints) {
  const count = loopPoints.length / 3;
  const { triangles, method } = earClipLoop(loopPoints);
  const points = method === PATCH_METHODS.cap
    ? _withCentroid(loopPoints, count)
    : Float64Array.from(loopPoints);
  return { patch: { points, triangles: orientPatchToRim(triangles, count).triangles }, method };
}

function _withCentroid(loopPoints, count) {
  const points = new Float64Array((count + 1) * 3);
  points.set(loopPoints);
  const centroid = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    for (let d = 0; d < 3; d++) {
      centroid[d] += loopPoints[3 * i + d] / count;
    }
  }
  points.set(centroid, count * 3);
  return points;
}

/**
 * @param {Object|null} oc - OpenCascade.js instance
 * @param {Float64Array} loopPoints - flat xyz of the hole's boundary, in order
 * @param {Object} [options]
 * @param {string} [options.closure] - CLOSURES: auto (flat for small holes, else smooth),
 *   smooth (fitted, flat when the fit fails) or flat
 * @param {number[]} [options.constraintCounts] - constraint vertex counts to try, in order
 * @param {number} [options.maxConstraints] - cap on the constraint counts
 * @returns {{ patch: { points: Float64Array, triangles: Int32Array }, method: string, error?: string }}
 *   the patch in loop-local indices (nodes 0..n-1 are the boundary vertices), wound with the
 *   surface around the hole
 */
export function patchHole(oc, loopPoints, {
  closure = CLOSURES.auto, constraintCounts = CONSTRAINT_COUNTS, maxConstraints,
} = {}) {
  const count = loopPoints.length / 3;
  if (count === 3) {
    const { triangles } = orientPatchToRim([0, 1, 2], 3);
    return { patch: { points: Float64Array.from(loopPoints), triangles }, method: PATCH_METHODS.flat };
  }
  if (closure === CLOSURES.flat || (closure === CLOSURES.auto && count <= AUTO_FLAT_MAX_VERTICES)) {
    return _flat(loopPoints);
  }

  let error = 'OpenCascade is not available';
  if (oc) {
    const tried = new Set();
    for (const maxCount of constraintCountsUpTo(maxConstraints, constraintCounts)) {
      const constraintIndices = sampleLoop(loopPoints, maxCount);
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
          const { triangles } = orientPatchToRim(patch.triangles, count);
          return { patch: { points: patch.points, triangles }, method: PATCH_METHODS.fitted };
        }
        error = 'The fitted patch does not match the hole boundary';
      } catch (err) {
        error = String(err?.message || err);
      }
    }
  }

  return { ..._flat(loopPoints), error };
}
