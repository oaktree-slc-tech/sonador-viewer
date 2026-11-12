// The `Sonador-Measurement.View` a measurement is labelled with, from the view it was drawn in. A
// view whose normal is within VIEW_ALIGN_LIMIT_DEGREES of a patient axis is that axis's view
// (x sagittal, y coronal, z axial); any other is oblique. The limit is the one the MPR turns a pane
// onto a measurement's plane with. View is a label used to navigate to a measurement, never a rule
// for whether it is drawn.

import {
  MEASUREMENT_VIEW_AXIAL,
  MEASUREMENT_VIEW_CORONAL,
  MEASUREMENT_VIEW_OBLIQUE,
  MEASUREMENT_VIEW_SAGITTAL,
} from '../enums';
import { VIEW_ALIGN_LIMIT_DEGREES } from './viewAlignment';
const VIEW_ALIGN_LIMIT = Math.cos((VIEW_ALIGN_LIMIT_DEGREES * Math.PI) / 180);

// The view of each patient axis (index of the normal's component)
const AXIS_VIEWS = [
  [MEASUREMENT_VIEW_AXIAL, 2],
  [MEASUREMENT_VIEW_CORONAL, 1],
  [MEASUREMENT_VIEW_SAGITTAL, 0],
];

/**
 * The view of a drawing view's normal (a 3-vector in patient coordinates), or undefined without a
 * usable normal.
 *
 * @returns {string|undefined} 'axial', 'coronal', 'sagittal' or 'oblique'
 */
function viewOfNormal(normal) {
  if (!Array.isArray(normal) && !ArrayBuffer.isView(normal)) {
    return undefined;
  }
  const n = Array.from(normal, Number);
  const length = Math.hypot(n[0], n[1], n[2]);
  if (n.length < 3 || !Number.isFinite(length) || length === 0) {
    return undefined;
  }
  const aligned = AXIS_VIEWS.find(([, axis]) => Math.abs(n[axis]) / length >= VIEW_ALIGN_LIMIT - 1e-12);
  return aligned ? aligned[0] : MEASUREMENT_VIEW_OBLIQUE;
}

/** The view of an image plane, from its row and column direction cosines */
function viewOfImageOrientation(rowCosines, columnCosines) {
  if (!rowCosines || !columnCosines || rowCosines.length < 3 || columnCosines.length < 3) {
    return undefined;
  }
  const [r, c] = [Array.from(rowCosines, Number), Array.from(columnCosines, Number)];
  return viewOfNormal([r[1] * c[2] - r[2] * c[1], r[2] * c[0] - r[0] * c[2], r[0] * c[1] - r[1] * c[0]]);
}


// The Viewer's own tools that are labelled with the view they were drawn in
const VIEW_TOOLS = ['Length', 'Angle', 'CobbAngle', 'CircleRoi', 'CircleROI'];

/**
 * The view a measurement drawn in this session is labelled with: from the normal of the view it was
 * drawn in (`metadata.viewPlaneNormal`, a Cornerstone3D view), else from the orientation of the image
 * it was drawn on (the classic viewport). Undefined for another tool, or without either.
 *
 * @param {string} toolType
 * @param {object} measurement - the measurement-service record
 * @param {object} [imagePlaneModule] - the image's plane ({ rowCosines, columnCosines })
 */
function drawnViewOf(toolType, measurement, imagePlaneModule) {
  if (!VIEW_TOOLS.includes(toolType)) {
    return undefined;
  }
  const metadata = (measurement && measurement.metadata) || {};
  return viewOfNormal(metadata.viewPlaneNormal)
    || (imagePlaneModule ? viewOfImageOrientation(imagePlaneModule.rowCosines, imagePlaneModule.columnCosines) : undefined);
}


export { VIEW_ALIGN_LIMIT_DEGREES, VIEW_TOOLS, drawnViewOf, viewOfImageOrientation, viewOfNormal };
