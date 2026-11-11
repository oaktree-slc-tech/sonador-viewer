// The Inspector opens on its MPR pane's view: the pane's camera (plane, up, centre, eye, zoom) is
// read by orientation; the plane and slice are applied, then the image is fitted to the viewport
// keeping them; nothing is applied without a pane or a plane.

const mockViewports = {};
const mockPlanes = {};
jest.mock('@cornerstonejs/core', () => ({
  getRenderingEngine: id => (id === 'vtk-mprslice' ? { getViewport: viewportId => mockViewports[viewportId] } : undefined),
  metaData: { get: (type, imageId) => (type === 'imagePlaneModule' ? mockPlanes[imageId] : undefined) },
}), { virtual: true });
jest.mock('../enums', () => ({ MPR: { VTK_MPRSLICE_RENDER_ID: 'vtk-mprslice' } }));

import {
  applyCameraPlacement, cameraPlacement, FIT_IN_PLANE, mprPaneCamera, mprPaneViewportId, nearestSliceCamera, snapToNearestSlice, viewName,
} from './inspectionCamera';

const OBLIQUE = {
  viewPlaneNormal: [-0.9983, 0.0576, -0.0122], viewUp: [0, 0, 1], focalPoint: [10, -4, 32.5], position: [-489, 24.8, 26.4],
  parallelScale: 118.25, clippingRange: [0.1, 1000], flipHorizontal: false,
};

beforeEach(() => Object.keys(mockViewports).forEach(key => delete mockViewports[key]));

it("reads the camera of the orientation's MPR pane, as a copy of its placement", () => {
  mockViewports['vtk-mprslice-sagittal'] = { getCamera: () => OBLIQUE };
  const camera = mprPaneCamera('sagittal');
  expect(camera).toEqual({
    viewPlaneNormal: OBLIQUE.viewPlaneNormal, viewUp: OBLIQUE.viewUp, focalPoint: OBLIQUE.focalPoint,
    position: OBLIQUE.position, parallelScale: 118.25,
  });
  expect(camera.focalPoint).not.toBe(OBLIQUE.focalPoint);
  expect(mprPaneViewportId('axial')).toBe('vtk-mprslice-axial');
});

it('reads nothing without the pane, or from a camera without a plane', () => {
  expect(mprPaneCamera('coronal')).toBeUndefined();
  expect(cameraPlacement({ focalPoint: [0, 0, 0] })).toBeUndefined();
  expect(cameraPlacement(undefined)).toBeUndefined();
});

it("places a viewport on the camera's plane and slice, then fits the image keeping them", () => {
  const order = [];
  const viewport = {
    setCamera: jest.fn(() => order.push('setCamera')),
    resetCamera: jest.fn(() => order.push('resetCamera')),
  };
  expect(applyCameraPlacement(viewport, OBLIQUE)).toBe(true);
  expect(order).toEqual(['setCamera', 'resetCamera']);
  // The pane's zoom is not carried over
  expect(viewport.setCamera).toHaveBeenCalledWith({
    viewPlaneNormal: OBLIQUE.viewPlaneNormal, viewUp: OBLIQUE.viewUp, focalPoint: OBLIQUE.focalPoint, position: OBLIQUE.position,
  });
  // Centred and zoomed to fit, on the same slice, plane and up
  expect(viewport.resetCamera).toHaveBeenCalledWith(FIT_IN_PLANE);
  expect(FIT_IN_PLANE).toEqual({
    resetPan: true, resetZoom: true, resetToCenter: false, resetOrientation: false, resetRotation: false,
  });
});

it("keeps the camera's centre and zoom when not fitting, and places nothing without a placement", () => {
  const viewport = { setCamera: jest.fn(), resetCamera: jest.fn() };
  expect(applyCameraPlacement(viewport, OBLIQUE, { fit: false })).toBe(true);
  expect(viewport.setCamera).toHaveBeenCalledWith(expect.objectContaining({ parallelScale: 118.25 }));
  expect(viewport.setCamera.mock.calls[0][0]).not.toHaveProperty('clippingRange');
  expect(viewport.resetCamera).not.toHaveBeenCalled();

  expect(applyCameraPlacement(viewport, {})).toBe(false);
  expect(applyCameraPlacement(undefined, OBLIQUE)).toBe(false);
});

it('names the MPR views', () => {
  expect(['axial', 'sagittal', 'coronal', 'other'].map(viewName)).toEqual(['Axial', 'Sagittal', 'Coronal', 'MPR']);
});


describe('opening parallel to the acquisition', () => {
  // The synthetic axial series: slices 3 mm apart at z = 0 to 33
  const AXIAL = Array.from({ length: 12 }, (_unused, index) => ({
    imagePositionPatient: [-38.4, -19.2, index * 3], rowCosines: [1, 0, 0], columnCosines: [0, 1, 0],
  }));
  const degrees = angle => (angle * Math.PI) / 180;
  const camera = (viewPlaneNormal, focalPoint) => ({
    viewPlaneNormal, viewUp: [0, -1, 0], focalPoint, position: focalPoint.map((value, i) => value + 500 * viewPlaneNormal[i]),
    parallelScale: 40,
  });
  const close = (actual, expected) => actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 9));

  it('moves the focal point and the eye along the normal onto the nearest slice, keeping plane, up and zoom', () => {
    const snapped = nearestSliceCamera(camera([0, 0, 1], [2, 3, 10.4]), AXIAL);
    close(snapped.focalPoint, [2, 3, 9]);
    close(snapped.position, [2, 3, 509]);
    expect(snapped).toMatchObject({ viewPlaneNormal: [0, 0, 1], viewUp: [0, -1, 0], parallelScale: 40 });

    // Either way along the axis, and to the slice above when it is nearer
    close(nearestSliceCamera(camera([0, 0, -1], [0, 0, 10.6]), AXIAL).focalPoint, [0, 0, 12]);
    close(nearestSliceCamera(camera([0, 0, 1], [0, 0, 16.5]), AXIAL).focalPoint, [0, 0, 15]);
    // On a slice already: unchanged
    close(nearestSliceCamera(camera([0, 0, 1], [0, 0, 21]), AXIAL).focalPoint, [0, 0, 21]);
    // Beyond the series: the end slice
    close(nearestSliceCamera(camera([0, 0, 1], [0, 0, 50]), AXIAL).focalPoint, [0, 0, 33]);
  });

  it("uses Cornerstone3D's tolerance for a parallel view, and leaves any other view where it is", () => {
    const tilted = angle => [Math.sin(degrees(angle)), 0, Math.cos(degrees(angle))];
    expect(nearestSliceCamera(camera(tilted(2.5), [0, 0, 10.4]), AXIAL)).toBeDefined();
    expect(nearestSliceCamera(camera(tilted(3), [0, 0, 10.4]), AXIAL)).toBeUndefined();
    expect(nearestSliceCamera(camera([1, 0, 0], [0, 0, 10.4]), AXIAL)).toBeUndefined();
    expect(nearestSliceCamera(camera([0, 0, 1], [0, 0, 10.4]), [])).toBeUndefined();
    expect(nearestSliceCamera(camera([0, 0, 1], [0, 0, 10.4]), [undefined, { imagePositionPatient: [0, 0, 9] }])).toBeUndefined();
    expect(nearestSliceCamera(undefined, AXIAL)).toBeUndefined();
  });

  it("moves a viewport onto the nearest slice of the series' images", () => {
    AXIAL.forEach((plane, index) => { mockPlanes[`synthetic:${index}`] = plane; });
    const imageIds = AXIAL.map((plane, index) => `synthetic:${index}`);
    const viewport = { getCamera: () => camera([0, 0, 1], [0, 0, 16.4]), setCamera: jest.fn() };

    expect(snapToNearestSlice(viewport, imageIds)).toBe(true);
    const [[placed]] = viewport.setCamera.mock.calls;
    expect(Object.keys(placed)).toEqual(['focalPoint', 'position']);
    close(placed.focalPoint, [0, 0, 15]);

    const sagittal = { getCamera: () => camera([1, 0, 0], [0, 0, 16.4]), setCamera: jest.fn() };
    expect(snapToNearestSlice(sagittal, imageIds)).toBe(false);
    expect(sagittal.setCamera).not.toHaveBeenCalled();
    expect(snapToNearestSlice(undefined, imageIds)).toBe(false);
  });
});

