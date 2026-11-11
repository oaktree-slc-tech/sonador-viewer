// The plane of a patient-domain measurement.
//
// `Sonador-Measurement.Drawing-Plane` holds the orientation of the view a measurement was drawn in:
// six direction cosines in the layout of Image Orientation (Patient), the view's width direction
// followed by its height direction. The text is six decimals separated by commas, at most six
// decimal places, no exponent, no spaces; a reader trims spaces around each number. The plane
// passes through the measurement's first point; no position is stored.
//
// A value is valid when it holds six finite numbers, each direction is of unit length and the two
// are perpendicular (within DIRECTION_TOLERANCE), and every point of the measurement lies within
// PLANE_TOLERANCE of the plane. A malformed value is treated as absent and carried through a
// re-save unchanged.
//
// Without a valid value, the plane a measurement is navigated to is: the plane of points that are
// not collinear and lie in one plane; for collinear points, the plane containing the line nearest
// a standard view; none for points in no common plane.

import { MEASUREMENT_VIEW_AXIAL, MEASUREMENT_VIEW_CORONAL, MEASUREMENT_VIEW_SAGITTAL } from '../enums';

// Unit length and perpendicularity of the two directions
const DIRECTION_TOLERANCE = 1e-4;
// Distance (mm) a point may lie from the plane
const PLANE_TOLERANCE = 1;
// Decimal places written
const DECIMALS = 6;
// Points closer than this (mm) to the line through the others are collinear with it
const COLLINEAR_TOLERANCE = 1e-6;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => Math.hypot(a[0], a[1], a[2]);
const scale = (a, s) => a.map(value => value * s);
const unit = a => (norm(a) > 0 ? scale(a, 1 / norm(a)) : undefined);

// Patient axes, in the order a tie between standard views is decided (axial, coronal, sagittal)
const AXES = [
  { view: MEASUREMENT_VIEW_AXIAL, axis: [0, 0, 1], width: [1, 0, 0], height: [0, 1, 0] },
  { view: MEASUREMENT_VIEW_CORONAL, axis: [0, 1, 0], width: [1, 0, 0], height: [0, 0, -1] },
  { view: MEASUREMENT_VIEW_SAGITTAL, axis: [1, 0, 0], width: [0, 1, 0], height: [0, 0, -1] },
];


/**
 * Read a Drawing-Plane text: { width, height } of six finite numbers, or undefined when the text
 * does not hold six numbers. Says nothing of the directions' lengths or angle (see validate).
 */
function parseDrawingPlane(text) {
  if (typeof text !== 'string') {
    return undefined;
  }
  const parts = text.split(',').map(part => part.trim());
  if (parts.length !== 6 || parts.some(part => !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(part))) {
    return undefined;
  }
  const values = parts.map(Number);
  if (!values.every(Number.isFinite)) {
    return undefined;
  }
  return { width: values.slice(0, 3), height: values.slice(3, 6) };
}

/** A decimal without an exponent, at most DECIMALS places, without trailing zeros or a negative zero */
function formatNumber(value) {
  const fixed = Number(value).toFixed(DECIMALS);
  const trimmed = fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
  return trimmed === '-0' ? '0' : trimmed;
}

/** The Drawing-Plane text of a view's width and height directions */
function formatDrawingPlane({ width, height }) {
  return [...width, ...height].map(formatNumber).join(',');
}

/**
 * Why a Drawing-Plane text is not valid for a measurement's points, or undefined when it is valid.
 *
 * @param {string} text
 * @param {number[][]} points - the measurement's patient points
 */
function drawingPlaneProblem(text, points = []) {
  const plane = parseDrawingPlane(text);
  if (!plane) {
    return 'not six numbers';
  }
  const { width, height } = plane;
  if (Math.abs(norm(width) - 1) > DIRECTION_TOLERANCE || Math.abs(norm(height) - 1) > DIRECTION_TOLERANCE) {
    return 'a direction is not of unit length';
  }
  if (Math.abs(dot(width, height)) > DIRECTION_TOLERANCE) {
    return 'the directions are not perpendicular';
  }
  if (points.length) {
    const normal = unit(cross(width, height));
    const origin = points[0];
    if (points.some(point => Math.abs(dot(sub(point, origin), normal)) > PLANE_TOLERANCE)) {
      return 'a point lies off the plane';
    }
  }
  return undefined;
}

/**
 * The plane of a valid Drawing-Plane: { width, height, normal, origin }; undefined when the text is
 * absent or not valid for the points.
 */
function drawingPlaneOf(text, points = []) {
  if (text === undefined || text === null || text === '' || drawingPlaneProblem(text, points)) {
    return undefined;
  }
  const { width, height } = parseDrawingPlane(text);
  return { width, height, normal: unit(cross(width, height)), origin: points[0] };
}

/** The Drawing-Plane of a Cornerstone3D view: width = up x normal, height = -up */
function drawingPlaneOfView(viewPlaneNormal, viewUp) {
  const normal = unit(Array.from(viewPlaneNormal || [], Number));
  const up = unit(Array.from(viewUp || [], Number));
  if (!normal || !up || normal.length < 3 || up.length < 3) {
    return undefined;
  }
  const width = unit(cross(up, normal));
  if (!width) {
    return undefined;
  }
  return { width, height: scale(up, -1) };
}


function _centroid(points) {
  return [0, 1, 2].map(i => points.reduce((sum, point) => sum + point[i], 0) / points.length);
}

function _farthestFrom(points, from) {
  return points.reduce((best, point) => (norm(sub(point, from)) > norm(sub(best, from)) ? point : best), from);
}

/**
 * The plane a measurement is navigated to, from its points and Drawing-Plane text:
 * { kind, normal, width, height, view?, centroid }. `kind` is 'drawing-plane', 'points',
 * 'collinear' or 'none' (points in no common plane: centred on, no plane), and undefined without
 * points.
 */
function navigationPlaneOf(points, drawingPlaneText) {
  const vectors = (points || []).filter(point => point && point.length >= 3).map(point => Array.from(point, Number).slice(0, 3));
  if (!vectors.length) {
    return undefined;
  }
  const centroid = _centroid(vectors);

  const stored = drawingPlaneOf(drawingPlaneText, vectors);
  if (stored) {
    return { kind: 'drawing-plane', normal: stored.normal, width: stored.width, height: stored.height, centroid };
  }

  // The line through the two points farthest apart
  const a = _farthestFrom(vectors, vectors[0]);
  const b = _farthestFrom(vectors, a);
  const direction = unit(sub(b, a));
  if (!direction) {
    return { kind: 'none', centroid };
  }
  const offLine = vectors.map(point => {
    const offset = sub(point, a);
    return sub(offset, scale(direction, dot(offset, direction)));
  });
  const farthestOff = offLine.reduce((best, offset) => (norm(offset) > norm(best) ? offset : best), [0, 0, 0]);

  if (norm(farthestOff) <= COLLINEAR_TOLERANCE) {
    // Collinear: the containing plane nearest a standard view, the axis least along the line
    const nearest = AXES.reduce((best, candidate) =>
      (Math.abs(dot(direction, candidate.axis)) < Math.abs(dot(direction, best.axis)) - 1e-12 ? candidate : best));
    // The normal: the axis made perpendicular to the line
    const normal = unit(sub(nearest.axis, scale(direction, dot(nearest.axis, direction))));
    const height = unit(cross(normal, direction));
    return { kind: 'collinear', normal, width: direction, height, view: nearest.view, centroid };
  }

  const normal = unit(cross(direction, farthestOff));
  if (vectors.some(point => Math.abs(dot(sub(point, a), normal)) > PLANE_TOLERANCE)) {
    return { kind: 'none', centroid };
  }
  return { kind: 'points', normal, width: direction, height: unit(cross(normal, direction)), centroid };
}


export {
  DIRECTION_TOLERANCE,
  PLANE_TOLERANCE,
  drawingPlaneOf,
  drawingPlaneOfView,
  drawingPlaneProblem,
  formatDrawingPlane,
  navigationPlaneOf,
  parseDrawingPlane,
};
