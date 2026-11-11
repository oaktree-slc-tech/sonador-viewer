// The Inspector opens on what its MPR pane shows: the same view (the pane's orientation, turned
// with the pane when it was aligned to an oblique measurement) and the same reconstructed slice.
// Its viewport is larger than the pane, so the image is then fitted to it: centred in the plane
// and zoomed to fill the view, rather than kept at the pane's zoom. The pane's camera is read when
// the Inspector is opened and applied once the Inspector's volume is set (setVolumes resets the
// camera). A view parallel to the acquisition is then moved onto the nearest acquired slice, so
// that a measurement drawn there lies on an image.

import _ from 'lodash';
import { getRenderingEngine as c3dGetRenderingEngine, metaData as c3dMetaData } from '@cornerstonejs/core';

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

// A view is parallel to an image when their normals differ by no more than the tolerance
// Cornerstone3D matches a view to an acquired image with (getClosestImageId)
const PARALLEL_TOLERANCE = 1e-3;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v) => {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length > 0 ? v.map(value => value / length) : undefined;
};
const vectorOf = value => (value && value.length >= 3 && Array.from(value).slice(0, 3).every(Number.isFinite)
  ? Array.from(value).slice(0, 3) : undefined);

/**
 * The camera moved along its normal onto the nearest of the image planes, when the view is parallel
 * to them; undefined when it is not, or there is no plane to move to. The plane, up and zoom are
 * kept.
 *
 * @param {object} camera - { viewPlaneNormal, focalPoint, position, ... }
 * @param {object[]} imagePlanes - { imagePositionPatient, rowCosines, columnCosines } of the acquired images
 */
function nearestSliceCamera(camera, imagePlanes) {
  const normal = unit(vectorOf(camera && camera.viewPlaneNormal) || [0, 0, 0]);
  const focalPoint = vectorOf(camera && camera.focalPoint);
  if (!normal || !focalPoint) {
    return undefined;
  }
  const offsets = (imagePlanes || []).map((plane) => {
    const position = vectorOf(plane && plane.imagePositionPatient);
    const [row, column] = [vectorOf(plane && plane.rowCosines), vectorOf(plane && plane.columnCosines)];
    const imageNormal = row && column && unit(cross(row, column));
    if (!position || !imageNormal || Math.abs(dot(imageNormal, normal)) < 1 - PARALLEL_TOLERANCE) {
      return undefined;
    }
    return dot(position.map((value, i) => value - focalPoint[i]), normal);
  }).filter(offset => offset !== undefined);
  if (!offsets.length) {
    return undefined;
  }
  const offset = _.minBy(offsets, Math.abs);
  const move = point => point.map((value, i) => value + offset * normal[i]);
  const position = vectorOf(camera.position);
  return { ...cameraPlacement(camera), focalPoint: move(focalPoint), ...(position ? { position: move(position) } : {}) };
}

/**
 * Move a viewport parallel to the acquisition onto the nearest acquired slice of `imageIds`; returns
 * whether it was moved.
 */
function snapToNearestSlice(viewport, imageIds) {
  if (!viewport || typeof viewport.getCamera !== 'function' || typeof viewport.setCamera !== 'function') {
    return false;
  }
  const planes = (imageIds || []).map((imageId) => {
    try {
      return c3dMetaData.get('imagePlaneModule', imageId);
    } catch (error) {
      return undefined;
    }
  });
  const camera = nearestSliceCamera(viewport.getCamera(), planes);
  if (!camera) {
    return false;
  }
  viewport.setCamera({ focalPoint: camera.focalPoint, ...(camera.position ? { position: camera.position } : {}) });
  return true;
}

/** The name of an MPR view, for the controls that open it */
const viewName = orientation => VIEW_NAMES[orientation] || 'MPR';

export {
  applyCameraPlacement, cameraPlacement, FIT_IN_PLANE, mprPaneCamera, mprPaneViewportId, nearestSliceCamera,
  PARALLEL_TOLERANCE, snapToNearestSlice, viewName,
};
