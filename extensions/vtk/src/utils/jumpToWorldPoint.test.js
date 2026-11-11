// Bringing a measurement into view in an MPR pane: the camera moves along its normal onto the
// point's slice, keeps its framing when the point is in view, and recentres when it is not.

import jumpToWorldPoint from './jumpToWorldPoint';

// An axial pane: looking along +z, 100 x 100 canvas, 1 mm per canvas pixel around the focal point
const pane = ({ focalPoint = [0, 0, 0], normal = [0, 0, 1] } = {}) => {
  const viewport = {
    camera: { focalPoint, position: [focalPoint[0], focalPoint[1], focalPoint[2] - 500], viewPlaneNormal: normal },
    canvas: { clientWidth: 100, clientHeight: 100 },
    getCamera() { return { ...this.camera }; },
    setCamera(camera) { this.camera = { ...this.camera, ...camera }; },
    worldToCanvas([x, y]) { return [50 + x - this.camera.focalPoint[0], 50 + y - this.camera.focalPoint[1]]; },
  };
  return viewport;
};

it('moves onto the slice of the point along the normal, keeping the framing when the point is in view', () => {
  const viewport = pane();
  expect(jumpToWorldPoint(viewport, [10, -20, 37.5])).toBe(true);
  expect(viewport.camera.focalPoint).toEqual([0, 0, 37.5]);
  expect(viewport.camera.position).toEqual([0, 0, -462.5]);
});

it('recentres on the point when the slice move leaves it out of view', () => {
  const viewport = pane();
  jumpToWorldPoint(viewport, [120, 5, 12]);
  expect(viewport.camera.focalPoint).toEqual([120, 5, 12]);
  expect(viewport.camera.position).toEqual([120, 5, -488]);
});

it('moves a pane whose plane already holds the point only when the point is out of view', () => {
  const viewport = pane({ focalPoint: [0, 0, 12] });
  expect(jumpToWorldPoint(viewport, [10, 10, 12])).toBe(false);
  expect(viewport.camera.focalPoint).toEqual([0, 0, 12]);
});

it('works for any view-plane normal (a sagittal pane moves along x)', () => {
  const viewport = pane({ normal: [1, 0, 0] });
  viewport.worldToCanvas = () => [50, 50];
  jumpToWorldPoint(viewport, [42, 3, 4]);
  expect(viewport.camera.focalPoint).toEqual([42, 0, 0]);
});

it('ignores a viewport without a camera and a point that is not finite', () => {
  expect(jumpToWorldPoint(undefined, [0, 0, 0])).toBe(false);
  expect(jumpToWorldPoint(pane(), [0, NaN, 0])).toBe(false);
});


describe('turning a pane onto an oblique measurement plane', () => {
  const { alignToPlane, planeAlignment } = jest.requireActual('./jumpToWorldPoint');
  // The sagittal MR of the test knee: 3.38 degrees off the patient's left-right axis
  const OBLIQUE_SAGITTAL = [-0.9983, 0.0576, -0.0122];
  const sagittalPane = () => {
    const viewport = pane({ normal: [1, 0, 0] });
    viewport.camera.position = [500, 0, 0];
    viewport.camera.viewUp = [0, 0, 1];
    return viewport;
  };
  const unitOf = v => { const n = Math.hypot(...v); return v.map(x => x / n); };

  it('turns the pane onto the plane, on its own side, keeping focal point, distance and screen up', () => {
    const viewport = sagittalPane();
    expect(alignToPlane(viewport, OBLIQUE_SAGITTAL)).toBe(true);
    const { viewPlaneNormal, viewUp, focalPoint, position } = viewport.camera;

    unitOf(OBLIQUE_SAGITTAL).map(x => -x).forEach((value, i) => expect(viewPlaneNormal[i]).toBeCloseTo(value, 6));
    expect(planeAlignment(viewport, OBLIQUE_SAGITTAL)).toBeCloseTo(1, 9);
    expect(focalPoint).toEqual([0, 0, 0]);
    expect(Math.hypot(...position)).toBeCloseTo(500, 6);
    expect(viewUp[2]).toBeGreaterThan(0.999);
    expect(Math.abs(viewUp.reduce((sum, value, i) => sum + value * viewPlaneNormal[i], 0))).toBeLessThan(1e-9);
  });

  it('leaves a parallel pane, and a pane far from the plane, as they are', () => {
    const parallel = sagittalPane();
    expect(alignToPlane(parallel, [1, 0, 0])).toBe(false);
    const axial = pane();
    expect(alignToPlane(axial, OBLIQUE_SAGITTAL)).toBe(false);
    expect(axial.camera.viewPlaneNormal).toEqual([0, 0, 1]);
  });

  it('turns onto a plane at any angle for an out-of-plane measurement', () => {
    // An oblique plane 45 degrees between axial and sagittal
    const oblique = unitOf([1, 0, 1]);
    const axial = pane();
    axial.camera.position = [0, 0, 500];
    axial.camera.viewUp = [0, -1, 0];
    expect(alignToPlane(axial, oblique, { anyAngle: true })).toBe(true);
    expect(planeAlignment(axial, oblique)).toBeCloseTo(1, 9);
    expect(Math.hypot(...axial.camera.position)).toBeCloseTo(500, 6);
  });
});
