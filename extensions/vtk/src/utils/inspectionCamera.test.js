// The Inspector opens on its MPR pane's view: the pane's camera (plane, up, centre, eye, zoom) is
// read by orientation; the plane and slice are applied, then the image is fitted to the viewport
// keeping them; nothing is applied without a pane or a plane.

const mockViewports = {};
jest.mock('@cornerstonejs/core', () => ({
  getRenderingEngine: id => (id === 'vtk-mprslice' ? { getViewport: viewportId => mockViewports[viewportId] } : undefined),
}), { virtual: true });
jest.mock('../enums', () => ({ MPR: { VTK_MPRSLICE_RENDER_ID: 'vtk-mprslice' } }));

import { applyCameraPlacement, cameraPlacement, FIT_IN_PLANE, mprPaneCamera, mprPaneViewportId, viewName } from './inspectionCamera';

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
