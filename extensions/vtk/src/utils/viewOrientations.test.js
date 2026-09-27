// View orientation presets for the 3D views: geometry of the table and the Cornerstone3D driver.

import { VIEW_ORIENTATIONS, applyViewOrientationToViewport, getViewOrientation } from './viewOrientations';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

describe('VIEW_ORIENTATIONS', () => {
  it('offers Top, Bottom, Front and Back', () => {
    expect(VIEW_ORIENTATIONS.map(o => o.id)).toEqual(['top', 'bottom', 'front', 'back']);
  });

  it.each(VIEW_ORIENTATIONS.map(o => [o.id, o]))('%s has unit, orthogonal axes', (id, o) => {
    expect(dot(o.viewPlaneNormal, o.viewPlaneNormal)).toBe(1);
    expect(dot(o.viewUp, o.viewUp)).toBe(1);
    expect(dot(o.viewPlaneNormal, o.viewUp)).toBe(0);
  });

  it('places the camera on the named side of the patient (LPS)', () => {
    expect(getViewOrientation('top').viewPlaneNormal[2]).toBe(1);      // superior
    expect(getViewOrientation('bottom').viewPlaneNormal[2]).toBe(-1);  // inferior
    expect(getViewOrientation('front').viewPlaneNormal[1]).toBe(-1);   // anterior
    expect(getViewOrientation('back').viewPlaneNormal[1]).toBe(1);     // posterior
  });

  it('keeps anterior up from above and below, superior up from front and back', () => {
    expect(getViewOrientation('top').viewUp).toEqual([0, -1, 0]);
    expect(getViewOrientation('bottom').viewUp).toEqual([0, -1, 0]);
    expect(getViewOrientation('front').viewUp).toEqual([0, 0, 1]);
    expect(getViewOrientation('back').viewUp).toEqual([0, 0, 1]);
  });

  it("puts the patient's left on screen right when facing them, and the right from behind", () => {
    // screen right = direction of projection x viewUp, with direction = -viewPlaneNormal
    const screenRight = ({ viewPlaneNormal: n, viewUp }) => cross(n.map(v => -v), viewUp).map(v => v + 0);
    expect(screenRight(getViewOrientation('front'))).toEqual([1, 0, 0]);   // +x = patient left
    expect(screenRight(getViewOrientation('back'))).toEqual([-1, 0, 0]);
    expect(screenRight(getViewOrientation('bottom'))).toEqual([1, 0, 0]);  // radiological axial
  });
});

describe('applyViewOrientationToViewport', () => {
  const makeViewport = () => ({ setCamera: jest.fn(), resetCamera: jest.fn(), render: jest.fn() });

  it('sets the direction, refits the camera and renders', () => {
    const viewport = makeViewport();
    expect(applyViewOrientationToViewport(viewport, 'front')).toBe(true);

    expect(viewport.setCamera).toHaveBeenCalledWith({ viewPlaneNormal: [0, -1, 0], viewUp: [0, 0, 1] });
    expect(viewport.resetCamera).toHaveBeenCalledTimes(1);
    expect(viewport.render).toHaveBeenCalledTimes(1);
    expect(viewport.setCamera.mock.invocationCallOrder[0])
      .toBeLessThan(viewport.resetCamera.mock.invocationCallOrder[0]);
  });

  it('hands the viewport copies of the preset vectors', () => {
    const viewport = makeViewport();
    applyViewOrientationToViewport(viewport, 'top');
    const { viewPlaneNormal } = viewport.setCamera.mock.calls[0][0];
    viewPlaneNormal[0] = 99;
    expect(getViewOrientation('top').viewPlaneNormal).toEqual([0, 0, 1]);
  });

  it('does nothing without a viewport or for an unknown preset', () => {
    const viewport = makeViewport();
    expect(applyViewOrientationToViewport(undefined, 'top')).toBe(false);
    expect(applyViewOrientationToViewport(viewport, 'sideways')).toBe(false);
    expect(viewport.setCamera).not.toHaveBeenCalled();
  });
});
