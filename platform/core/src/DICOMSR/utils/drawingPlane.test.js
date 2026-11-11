// Sonador-Measurement.Drawing-Plane: six comma-separated decimals (width then height direction),
// valid when unit, perpendicular and holding every point within 1 mm; and the plane a measurement
// is navigated to without one.

jest.mock('@cornerstonejs/adapters', () => ({
  adaptersSR: { Cornerstone3D: { CodeScheme: { CodingSchemeDesignator: 'CORNERSTONEJS', codeValues: {} } } },
}), { virtual: true });

import {
  drawingPlaneOf, drawingPlaneOfView, drawingPlaneProblem, formatDrawingPlane, navigationPlaneOf, parseDrawingPlane,
} from './drawingPlane';

const close = (actual, expected, digits = 9) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], digits));
};
// Equal up to sign (a plane's normal)
const parallel = (actual, expected) => {
  const sign = Math.sign(actual.reduce((sum, value, i) => sum + value * expected[i], 0)) || 1;
  close(actual.map(value => value * sign), expected);
};


describe('the Drawing-Plane text', () => {
  it('is written as six decimals, at most six places, no exponent, no spaces', () => {
    expect(formatDrawingPlane({ width: [0, 1, 0], height: [0, 0, -1] })).toBe('0,1,0,0,0,-1');
    const tilted = { width: [Math.cos(0.3), 0, Math.sin(0.3)], height: [0, -1, 0] };
    expect(formatDrawingPlane(tilted)).toBe('0.955336,0,0.29552,0,-1,0');
    expect(formatDrawingPlane({ width: [1e-9, 1, -1e-9], height: [0, 0, 1] })).toBe('0,1,0,0,0,1');
  });

  it('is read with spaces around each number trimmed', () => {
    expect(parseDrawingPlane(' 0, 1 ,0,0,0 , -1 ')).toEqual({ width: [0, 1, 0], height: [0, 0, -1] });
    expect(parseDrawingPlane('0,1,0,0,0')).toBeUndefined();
    expect(parseDrawingPlane('0,1,0,0,0,-1,0')).toBeUndefined();
    expect(parseDrawingPlane('0,1,0,0,0,1e0')).toBeUndefined();
    expect(parseDrawingPlane('0,1,0,0,0,NaN')).toBeUndefined();
    expect(parseDrawingPlane(undefined)).toBeUndefined();
  });

  it('is valid with unit, perpendicular directions and every point within 1 mm of the plane', () => {
    const sagittal = '0,1,0,0,0,-1';
    const points = [[10, -5, 20], [10.9, 30, -4]];
    expect(drawingPlaneProblem(sagittal, points)).toBeUndefined();
    expect(drawingPlaneProblem('0,1,0,0,0', points)).toBe('not six numbers');
    expect(drawingPlaneProblem('0,1.001,0,0,0,-1', points)).toBe('a direction is not of unit length');
    expect(drawingPlaneProblem('0,1,0,0,0,-1.001', points)).toBe('a direction is not of unit length');
    expect(drawingPlaneProblem('0,1,0,0,0.001,-1', points)).toBe('the directions are not perpendicular');
    expect(drawingPlaneProblem('0,1,0,0,0.7071068,-0.7071068', points)).toBe('the directions are not perpendicular');
    expect(drawingPlaneProblem(sagittal, [[10, -5, 20], [11.5, 30, -4]])).toBe('a point lies off the plane');
  });

  it('gives the plane through the first point, or nothing for an absent or malformed value', () => {
    const plane = drawingPlaneOf('0,1,0,0,0,-1', [[10, -5, 20], [10, 30, -4]]);
    expect(plane.origin).toEqual([10, -5, 20]);
    parallel(plane.normal, [1, 0, 0]);
    expect(drawingPlaneOf(undefined, [[0, 0, 0]])).toBeUndefined();
    expect(drawingPlaneOf('', [[0, 0, 0]])).toBeUndefined();
    expect(drawingPlaneOf('0,2,0,0,0,-1', [[0, 0, 0]])).toBeUndefined();
  });

  it("is the Cornerstone3D view's right and down directions", () => {
    expect(formatDrawingPlane(drawingPlaneOfView([0, 0, -1], [0, -1, 0]))).toBe('1,0,0,0,1,0');
    expect(formatDrawingPlane(drawingPlaneOfView([1, 0, 0], [0, 0, 1]))).toBe('0,1,0,0,0,-1');
    expect(formatDrawingPlane(drawingPlaneOfView([0, -1, 0], [0, 0, 1]))).toBe('1,0,0,0,0,-1');
    expect(drawingPlaneOfView([0, 0, 1], [0, 0, 1])).toBeUndefined();
    expect(drawingPlaneOfView(undefined, [0, 1, 0])).toBeUndefined();
  });
});


describe('the plane a measurement is navigated to', () => {
  it('is a valid Drawing-Plane, centred on the centroid', () => {
    const plane = navigationPlaneOf([[10, 0, 0], [10, 20, 30]], '0,1,0,0,0,-1');
    expect(plane.kind).toBe('drawing-plane');
    parallel(plane.normal, [1, 0, 0]);
    close(plane.centroid, [10, 10, 15]);
  });

  it('is the plane of points not collinear, when the Drawing-Plane is absent or malformed', () => {
    const angle = [[20, 0, 9], [0, 0, 9], [0, 0, 9], [0, 15, 9]];
    const plane = navigationPlaneOf(angle, '0,1,0,0,0');
    expect(plane.kind).toBe('points');
    parallel(plane.normal, [0, 0, 1]);
    close(plane.centroid, [5, 3.75, 9]);
  });

  it('is, for collinear points, the containing plane nearest a standard view', () => {
    // A Length along x: z (axial) and y (coronal) tie at 0; axial first
    const alongX = navigationPlaneOf([[0, 0, 0], [10, 0, 0]]);
    expect(alongX).toMatchObject({ kind: 'collinear', view: 'axial' });
    parallel(alongX.normal, [0, 0, 1]);

    // Along z: x and y tie; coronal before sagittal
    expect(navigationPlaneOf([[0, 0, 0], [0, 0, 10]])).toMatchObject({ kind: 'collinear', view: 'coronal' });
    // Along y: axial before sagittal
    expect(navigationPlaneOf([[0, 0, 0], [0, 10, 0]])).toMatchObject({ kind: 'collinear', view: 'axial' });

    // Tilted mostly along z with some x: y is least along the line -> coronal, normal exactly y
    const tilted = navigationPlaneOf([[0, 0, 0], [3, 0, 10]]);
    expect(tilted.view).toBe('coronal');
    parallel(tilted.normal, [0, 1, 0]);
    // A line with every axis: the plane contains the line, its normal the axis made perpendicular
    const oblique = navigationPlaneOf([[0, 0, 0], [1, 2, 6]]);
    expect(oblique.view).toBe('sagittal');
    expect(Math.abs(oblique.normal[0] * 1 + oblique.normal[1] * 2 + oblique.normal[2] * 6)).toBeLessThan(1e-9);

    // An Angle of 180 degrees is collinear
    expect(navigationPlaneOf([[-10, 0, 5], [0, 0, 5], [0, 0, 5], [10, 0, 5]])).toMatchObject({ kind: 'collinear', view: 'axial' });
  });

  it('is none for points in no common plane, centred on them', () => {
    // A Cobb angle of 90 degrees whose lines are skew
    const plane = navigationPlaneOf([[0, 0, 0], [10, 0, 0], [0, 10, 10], [0, 20, 10]]);
    expect(plane.kind).toBe('none');
    close(plane.centroid, [2.5, 7.5, 5]);
    expect(navigationPlaneOf([[1, 2, 3], [1, 2, 3]])).toMatchObject({ kind: 'none', centroid: [1, 2, 3] });
    expect(navigationPlaneOf([])).toBeUndefined();
  });
});
