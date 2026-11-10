// The Inspector opens on what its MPR pane shows: the same view (the pane's orientation, turned
// with the pane when it was aligned to an oblique measurement) and the same reconstructed slice.
// Its viewport is larger than the pane, so the image is then fitted to it: centred in the plane
// and zoomed to fill the view, rather than kept at the pane's zoom. The pane's camera is read when
// the Inspector is opened and applied once the Inspector's volume is set (setVolumes resets the
// camera).

import _ from 'lodash';
import { getRenderingEngine as c3dGetRenderingEngine } from '@cornerstonejs/core';

import { MPR } from '../enums';

const CAMERA_FIELDS = ['viewPlaneNormal', 'viewUp', 'focalPoint', 'position', 'parallelScale'];

const VIEW_NAMES = { axial: 'Axial', sagittal: 'Sagittal', coronal: 'Coronal' };

/** The MPR pane's Cornerstone3D viewport id (Cornerstone3DSliceView.getViewportId) */
const mprPaneViewportId = (orientation, sep = '-') => `${MPR.VTK_MPRSLICE_RENDER_ID}${sep}${orientation}`;

/** A copy of a camera's placement: plane, up, centre, eye and zoom; undefined without a plane */
function cameraPlacement(camera) {
  if (!camera || !Array.isArray(camera.viewPlaneNormal) || !Array.isArray(camera.focalPoint)) {
    return undefined;
  }
  const placement = {};
  CAMERA_FIELDS.forEach((field) => {
    const value = camera[field];
    if (Array.isArray(value)) {
      placement[field] = [...value];
    } else if (Number.isFinite(value)) {
      placement[field] = value;
    }
  });
  return placement;
}

/** The camera of the MPR pane of an orientation, or undefined when the pane is not rendered */
function mprPaneCamera(orientation) {
  const engine = c3dGetRenderingEngine(MPR.VTK_MPRSLICE_RENDER_ID);
  const viewport = engine && engine.getViewport(mprPaneViewportId(orientation));
  return viewport && typeof viewport.getCamera === 'function' ? cameraPlacement(viewport.getCamera()) : undefined;
}

// Cornerstone3D's reset, keeping the plane, its up and the slice: it centres the image in the
// plane and zooms it to fit the canvas. The orientation and rotation resets would put the
// viewport back on its own axis
const FIT_IN_PLANE = { resetPan: true, resetZoom: true, resetToCenter: false, resetOrientation: false, resetRotation: false };

/**
 * Place a viewport on a camera's plane and slice, then fit the image to the viewport (or keep the
 * camera's centre and zoom with { fit: false }); returns whether it was placed.
 */
function applyCameraPlacement(viewport, placement, { fit = true } = {}) {
  const camera = cameraPlacement(placement);
  if (!viewport || typeof viewport.setCamera !== 'function' || !camera) {
    return false;
  }
  if (!fit) {
    viewport.setCamera(camera);
    return true;
  }
  const { viewPlaneNormal, viewUp, focalPoint, position } = camera;
  viewport.setCamera(_.omitBy({ viewPlaneNormal, viewUp, focalPoint, position }, _.isUndefined));
  if (typeof viewport.resetCamera === 'function') {
    viewport.resetCamera(FIT_IN_PLANE);
  }
  return true;
}

/** The name of an MPR view, for the controls that open it */
const viewName = orientation => VIEW_NAMES[orientation] || 'MPR';

export { applyCameraPlacement, cameraPlacement, FIT_IN_PLANE, mprPaneCamera, mprPaneViewportId, viewName };
