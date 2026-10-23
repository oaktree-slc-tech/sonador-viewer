// Data-integrity checks on edit geometry: not mesh quality, only numbers and indices

import {
  INVALID_REASONS,
  validateBox,
  validateEditGeometry,
  validatePatch,
  validatePolys,
  validateSurface,
} from './surfaceValidity';

const triangle = () => ({ points: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]), polys: Int32Array.from([3, 0, 1, 2]) });

describe('surfaceValidity', () => {
  it('passes a plain triangle, an open surface and an empty surface alike', () => {
    expect(validateSurface(triangle())).toBeNull();
    expect(validateSurface({ points: new Float32Array(0), polys: new Int32Array(0) })).toBeNull();
    expect(validateEditGeometry({ after: triangle(), editBox: { min: [0, 0, 0], max: [1, 1, 0] } })).toBeNull();
    // An emptied result (whole-surface removal) carries no box to check
    expect(validateEditGeometry({ after: { points: new Float32Array(0), polys: new Int32Array(0) }, editBox: null })).toBeNull();
  });

  it('counts non-finite coordinates', () => {
    const surface = triangle();
    surface.points[4] = NaN;
    expect(validateSurface(surface)).toEqual({ reason: INVALID_REASONS.nonFinitePoints, count: 1 });
    surface.points[0] = Infinity;
    expect(validateSurface(surface)).toEqual({ reason: INVALID_REASONS.nonFinitePoints, count: 2 });
    expect(validateEditGeometry({ after: surface, editBox: { min: [0, 0, 0], max: [1, 1, 0] } }))
      .toEqual({ reason: INVALID_REASONS.nonFinitePoints, count: 2, where: 'after' });
  });

  it('rejects malformed point arrays and cells, and indices out of range', () => {
    expect(validateSurface({ points: [0, 0], polys: [] })).toEqual({ reason: INVALID_REASONS.malformedPoints, count: 2 });
    expect(validatePolys([3, 0, 1], 3)).toEqual({ reason: INVALID_REASONS.malformedCells, count: 3 });
    expect(validatePolys([4, 0, 1, 2], 3)).toEqual({ reason: INVALID_REASONS.malformedCells, count: 1 });
    expect(validatePolys([3, 0, 1, 3, 3, 0, -1, 2.5], 3)).toEqual({ reason: INVALID_REASONS.invalidIndices, count: 3 });
    expect(validatePatch({ points: [0, 0, 0, 1, 0, 0, 0, 1, 0], triangles: [0, 1, 7] }))
      .toEqual({ reason: INVALID_REASONS.invalidIndices, count: 1 });
    expect(validatePatch({ points: [0, 0, 0], triangles: [0, 0] })).toEqual({ reason: INVALID_REASONS.malformedCells, count: 2 });
    expect(validatePatch(null)).toEqual({ reason: INVALID_REASONS.malformedPoints, count: 0 });
  });

  it('rejects an unbounded or inverted box', () => {
    expect(validateBox({ min: [0, 0, 0], max: [1, 1, 1] })).toBeNull();
    expect(validateBox({ min: [0, NaN, 0], max: [1, 1, 1] })).toEqual({ reason: INVALID_REASONS.nonFiniteBox, count: 1 });
    expect(validateBox({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] })).not.toBeNull();
    expect(validateBox({ min: [2, 0, 0], max: [1, 1, 1] })).not.toBeNull();
    expect(validateBox(null)).not.toBeNull();
    expect(validateEditGeometry({ after: triangle(), editBox: { min: [0, 0, NaN], max: [1, 1, 0] } }))
      .toEqual({ reason: INVALID_REASONS.nonFiniteBox, count: 1, where: 'editBox' });
  });
});
