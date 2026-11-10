// Bring a world (patient, mm) point into view in a Cornerstone3D slice viewport: the camera moves
// along its view-plane normal until the slice it shows holds the point, and is recentred on the
// point only when the point would otherwise fall outside the viewport. In an MPR view, the pane
// parallel to a measurement's plane then shows the measurement, and the other panes move through
// its slice, keeping their framing where they can.
//
// The MPR panes look along the patient axes, while a measurement lies in the plane of the image it
// was drawn on, which may be oblique (a sagittal MR a few degrees off the axis). Cornerstone3D
// draws an annotation only in a viewport whose plane is parallel to it, so the pane closest to the
// measurement's plane is first turned onto that plane (alignToPlane).

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = a => Math.sqrt(dot(a, a));
const unit = a => scale(a, 1 / norm(a));

// A pane is turned onto a measurement's plane when their normals are within this angle
const ALIGN_LIMIT_DEGREES = 15;
const ALIGN_LIMIT = Math.cos((ALIGN_LIMIT_DEGREES * Math.PI) / 180);
// Normals this close are parallel already
const PARALLEL = 1 - 1e-9;
// Cornerstone3D draws an annotation in a volume viewport whose normal is this close to its own
// (filterAnnotationsWithinSlice: 1 - EPSILON, EPSILON 1e-3)
const DRAWN_ALIGNMENT = 1 - 1e-3;

/**
 * How close a viewport's plane is to a plane with the given normal: |cos| of the angle between
 * their normals (1 when parallel).
 */
function planeAlignment(viewport, normal) {
  const camera = viewport && typeof viewport.getCamera === 'function' ? viewport.getCamera() : undefined;
  if (!camera || !camera.viewPlaneNormal || !Array.isArray(normal) || !norm(normal)) {
    return 0;
  }
  return Math.abs(dot(unit(camera.viewPlaneNormal), unit(normal)));
}

/**
 * Turn a viewport onto the plane with the given normal, keeping its side of the plane (the sign
 * of its normal), its focal point, its distance, and its screen up as near as the plane allows.
 * Turns nothing when the planes are parallel already or more than ALIGN_LIMIT_DEGREES apart.
 *
 * @returns {boolean} whether the viewport turned
 */
function alignToPlane(viewport, normal) {
  const alignment = planeAlignment(viewport, normal);
  if (alignment >= PARALLEL || alignment < ALIGN_LIMIT) {
    return false;
  }
  const { focalPoint, position, viewPlaneNormal, viewUp } = viewport.getCamera();
  const side = dot(viewPlaneNormal, normal) < 0 ? -1 : 1;
  const nextNormal = scale(unit(normal), side);
  const up = sub(viewUp || [0, 0, 1], scale(nextNormal, dot(viewUp || [0, 0, 1], nextNormal)));
  if (!norm(up)) {
    return false;
  }
  const distance = norm(sub(position, focalPoint));
  viewport.setCamera({
    viewPlaneNormal: nextNormal,
    viewUp: unit(up),
    focalPoint,
    position: add(focalPoint, scale(nextNormal, distance)),
  });
  return true;
}

function isInside(viewport, point) {
  // Whether a world point projects inside the viewport's canvas
  const canvas = viewport.canvas || (viewport.element && viewport.element.querySelector && viewport.element.querySelector('canvas'));
  const width = canvas ? canvas.clientWidth || canvas.width : 0;
  const height = canvas ? canvas.clientHeight || canvas.height : 0;
  if (!width || !height || typeof viewport.worldToCanvas !== 'function') {
    return true;
  }
  const [x, y] = viewport.worldToCanvas(point);
  return x >= 0 && y >= 0 && x <= width && y <= height;
}

/**
 * Move a slice viewport's camera so that it shows a world point.
 *
 * @param {object} viewport - a Cornerstone3D volume (orthographic) viewport
 * @param {number[]} point - world point [x, y, z]
 * @returns {boolean} whether the camera moved
 */
export default function jumpToWorldPoint(viewport, point) {
  if (!viewport || typeof viewport.getCamera !== 'function' || !Array.isArray(point) || point.length !== 3
      || !point.every(Number.isFinite)) {
    return false;
  }
  const { focalPoint, position, viewPlaneNormal } = viewport.getCamera();
  if (!focalPoint || !position || !viewPlaneNormal) {
    return false;
  }

  // Along the normal, onto the point's slice
  const depth = dot(sub(point, focalPoint), viewPlaneNormal);
  let nextFocalPoint = add(focalPoint, scale(viewPlaneNormal, depth));
  let nextPosition = add(position, scale(viewPlaneNormal, depth));
  viewport.setCamera({ focalPoint: nextFocalPoint, position: nextPosition });

  // Within the slice, onto the point, only when it is out of view
  if (!isInside(viewport, point)) {
    const offset = sub(point, nextFocalPoint);
    nextFocalPoint = point;
    nextPosition = add(nextPosition, offset);
    viewport.setCamera({ focalPoint: nextFocalPoint, position: nextPosition });
  }

  const moved = Math.abs(depth) > 1e-6 || nextFocalPoint === point;
  return moved;
}

export { ALIGN_LIMIT_DEGREES, alignToPlane, DRAWN_ALIGNMENT, jumpToWorldPoint, planeAlignment };
