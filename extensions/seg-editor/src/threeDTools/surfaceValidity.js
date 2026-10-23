// Data-integrity checks on the geometry an edit consumes and produces (ohif-viewers#149 FR-4,
// ohif-viewers#152 "non-overridable invariants"): finite coordinates, well-formed cells, indices
// within range and finite bounds. They are not mesh-quality checks; open or non-manifold
// surfaces pass. The edge diagnostics (meshRepair.surfaceDiagnostics) look at incidence only, so
// a surface with a NaN coordinate can still look closed; these checks run before a result is
// shown, cached, recorded or written.

/** The reasons a surface or an edit fails the checks. */
export const INVALID_REASONS = Object.freeze({
  nonFinitePoints: 'nonFinitePoints',
  malformedPoints: 'malformedPoints',
  malformedCells: 'malformedCells',
  invalidIndices: 'invalidIndices',
  nonFiniteBox: 'nonFiniteBox',
});

const _isArrayLike = value => value != null && typeof value.length === 'number';

/** How many values of an array are not finite numbers. */
export function countNonFinite(values) {
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) {
      count++;
    }
  }
  return count;
}

/**
 * Check a flat xyz array: a multiple of three finite numbers.
 *
 * @returns {{ reason: string, count: number }|null}
 */
export function validatePoints(points) {
  if (!_isArrayLike(points) || points.length % 3 !== 0) {
    return { reason: INVALID_REASONS.malformedPoints, count: _isArrayLike(points) ? points.length : 0 };
  }
  const count = countNonFinite(points);
  return count ? { reason: INVALID_REASONS.nonFinitePoints, count } : null;
}

/**
 * Check a flat triangle index list against a vertex count: integers in [0, vertexCount).
 *
 * @returns {{ reason: string, count: number }|null}
 */
export function validateTriangles(triangles, vertexCount) {
  if (!_isArrayLike(triangles) || triangles.length % 3 !== 0) {
    return { reason: INVALID_REASONS.malformedCells, count: _isArrayLike(triangles) ? triangles.length : 0 };
  }
  let count = 0;
  for (let i = 0; i < triangles.length; i++) {
    const v = triangles[i];
    if (!Number.isInteger(v) || v < 0 || v >= vertexCount) {
      count++;
    }
  }
  return count ? { reason: INVALID_REASONS.invalidIndices, count } : null;
}

/**
 * Check a VTK cell array of triangles (`3, a, b, c, ...`) against a vertex count.
 *
 * @returns {{ reason: string, count: number }|null}
 */
export function validatePolys(polys, vertexCount) {
  if (!_isArrayLike(polys) || polys.length % 4 !== 0) {
    return { reason: INVALID_REASONS.malformedCells, count: _isArrayLike(polys) ? polys.length : 0 };
  }
  let malformed = 0;
  let invalid = 0;
  for (let c = 0; c < polys.length; c += 4) {
    if (polys[c] !== 3) {
      malformed++;
      continue;
    }
    for (let k = 1; k <= 3; k++) {
      const v = polys[c + k];
      if (!Number.isInteger(v) || v < 0 || v >= vertexCount) {
        invalid++;
      }
    }
  }
  if (malformed) {
    return { reason: INVALID_REASONS.malformedCells, count: malformed };
  }
  return invalid ? { reason: INVALID_REASONS.invalidIndices, count: invalid } : null;
}

/**
 * Check a surface ({ points, polys }); an empty surface (no points, no polys) is valid.
 *
 * @returns {{ reason: string, count: number }|null}
 */
export function validateSurface(surface) {
  if (!surface) {
    return { reason: INVALID_REASONS.malformedPoints, count: 0 };
  }
  return validatePoints(surface.points) || validatePolys(surface.polys, surface.points.length / 3);
}

/** Check a patch ({ points, triangles }) as the hole-filling worker returns it. */
export function validatePatch(patch) {
  if (!patch) {
    return { reason: INVALID_REASONS.malformedPoints, count: 0 };
  }
  return validatePoints(patch.points) || validateTriangles(patch.triangles, patch.points.length / 3);
}

/** Check a world or index box ({ min: [3], max: [3] }) for finite bounds. */
export function validateBox(box) {
  const ok = !!box && Array.isArray(box.min) && Array.isArray(box.max)
    && box.min.length === 3 && box.max.length === 3
    && box.min.every(Number.isFinite) && box.max.every(Number.isFinite)
    && box.min.every((v, d) => v <= box.max[d]);
  return ok ? null : { reason: INVALID_REASONS.nonFiniteBox, count: 1 };
}

/**
 * Check what an edit is about to show and record: its result surface and its edit box. An
 * emptied result (whole-surface removal) is valid; it carries no box to check.
 *
 * @param {{ after: { points, polys }|null, editBox: Object|null }} edit
 * @returns {{ reason: string, count: number, where: string }|null}
 */
export function validateEditGeometry({ after, editBox }) {
  const surfaceProblem = validateSurface(after);
  if (surfaceProblem) {
    return { ...surfaceProblem, where: 'after' };
  }
  if (!after.points.length) {
    return null;
  }
  const boxProblem = validateBox(editBox);
  return boxProblem ? { ...boxProblem, where: 'editBox' } : null;
}
