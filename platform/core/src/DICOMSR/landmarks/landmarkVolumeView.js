// The geometry of landmark markers in the 3D volume view, beside the slice views' (landmarkMarkers.js),
// whose shapes, sizes, brackets and name plates carry over unchanged. Nothing here draws.
//
// - Depth is the distance along the camera's viewing direction, so two landmarks on one plane facing
//   the camera are at one depth. A marker's strength falls linearly from 100 % at the nearest
//   landmark drawn to 50 % at the farthest; all at one depth, a single landmark included, are at 100 %.
// - The chosen landmark outside the view is marked at the nearest edge of the viewport: its brackets
//   with a chevron inside, in its Line colour, pointing toward it.
// - "Follow selected landmark" orbits the camera about its focal point until the landmark is on the
//   side of the volume toward the camera: the camera moves onto the line from the focal point through
//   the landmark, at its present distance, so zoom and focal point are unchanged.

import { BRACKET, MARKER } from './landmarkMarkers';

const DEPTH_FADE = Object.freeze({ NEAR: 1, FAR: 0.5 });
const CHEVRON = Object.freeze({ HALF_LENGTH: 3, HALF_HEIGHT: 5, STROKE: 2, CASING: 4 });
// The edge mark's centre stays this far inside the viewport, so its brackets stay in view as they
// are drawn in (CSS pixels)
const EDGE_INSET = BRACKET.FROM / 2 + 2;
// Below this a length is no direction (mm)
const EPSILON = 1e-6;
// The direction of the edge mark for a landmark straight behind the camera, which has none on the
// view plane: the bottom edge, pointing down
const BEHIND = Object.freeze({ dx: 0, dy: 1 });

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = a => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => {
  const l = length(a);
  return l > EPSILON ? scale(a, 1 / l) : null;
};
const vector = value => (Array.isArray(value) && value.length >= 3 ? value.slice(0, 3).map(Number) : null);


// Depth and the fade

/** The camera's viewing direction (from its position toward its focal point), or null */
const viewingDirection = ({ position, focalPoint }) => {
  const from = vector(position);
  const to = vector(focalPoint);
  return from && to ? unit(sub(to, from)) : null;
};

/** A point's depth: its distance from the camera along the viewing direction (mm), or NaN */
function depthAlong(point, camera) {
  const direction = viewingDirection(camera || {});
  const at = vector(point);
  return direction && at ? dot(sub(at, vector(camera.position)), direction) : NaN;
}

/**
 * The strength of each marker from its depth: 1 at the nearest, 0.5 at the farthest, linear between;
 * 1 for all when they are at one depth (or one alone), and for a depth that is not a number.
 *
 * @param {number[]} depths - of every landmark drawn in the viewport
 * @returns {number[]}
 */
function depthStrengths(depths) {
  const finite = depths.filter(Number.isFinite);
  const nearest = Math.min(...finite);
  const span = Math.max(...finite) - nearest;
  return depths.map((depth) => {
    if (!Number.isFinite(depth) || !(span > EPSILON)) {
      return DEPTH_FADE.NEAR;
    }
    return DEPTH_FADE.NEAR - (DEPTH_FADE.NEAR - DEPTH_FADE.FAR) * ((depth - nearest) / span);
  });
}


// The chosen landmark outside the view

/** The camera's screen axes in world space: right (canvas +x) and up (canvas -y), or null */
function screenAxes(camera) {
  const forward = viewingDirection(camera || {});
  const viewUp = vector(camera && camera.viewUp);
  const up = forward && viewUp && unit(sub(viewUp, scale(forward, dot(viewUp, forward))));
  return up ? { right: cross(forward, up), up } : null;
}

/**
 * The direction on screen from the view's centre toward a point, for a point the projection cannot
 * place (behind a perspective camera): { dx, dy } in canvas axes, or null.
 */
function screenDirection(point, camera) {
  const axes = screenAxes(camera);
  const at = vector(point);
  if (!axes || !at) {
    return null;
  }
  const offset = sub(at, vector(camera.focalPoint));
  const dx = dot(offset, axes.right);
  const dy = -dot(offset, axes.up);
  return Math.hypot(dx, dy) > EPSILON ? { dx, dy } : null;
}

/** Whether a canvas point (CSS pixels) is inside a viewport of that size */
const isInView = ({ x, y }, width, height) => Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x <= width && y <= height;

/**
 * Where the edge mark of the chosen landmark outside the view sits, and the angle its chevron points
 * at (radians, canvas axes): the point of the inset viewport nearest the landmark's projection, or,
 * when it has none, the inset edge along `direction` from the centre; without a direction either
 * (a landmark straight behind the camera), the middle of the bottom edge, pointing down.
 *
 * @param {object} view - { projected: { x, y } | null, direction: { dx, dy } | null, width, height }
 * @returns {{ x: number, y: number, angle: number } | null}
 */
function edgePlacement({ projected, direction, width, height }) {
  if (!(width > 0) || !(height > 0)) {
    return null;
  }
  const insetX = Math.min(EDGE_INSET, width / 2);
  const insetY = Math.min(EDGE_INSET, height / 2);
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  if (projected && Number.isFinite(projected.x) && Number.isFinite(projected.y)) {
    const x = clamp(projected.x, insetX, width - insetX);
    const y = clamp(projected.y, insetY, height - insetY);
    if (Math.hypot(projected.x - x, projected.y - y) > EPSILON) {
      return { x, y, angle: Math.atan2(projected.y - y, projected.x - x) };
    }
  }
  const { dx, dy } = direction || BEHIND;
  const reach = Math.min(
    Math.abs(dx) > EPSILON ? (width / 2 - insetX) / Math.abs(dx) : Infinity,
    Math.abs(dy) > EPSILON ? (height / 2 - insetY) / Math.abs(dy) : Infinity,
  );
  if (!Number.isFinite(reach)) {
    return null;
  }
  return { x: width / 2 + dx * reach, y: height / 2 + dy * reach, angle: Math.atan2(dy, dx) };
}

/** The chevron inside the edge mark's brackets, pointing at `angle`, in the landmark's Line colour */
function chevronPrimitives({ x, y }, angle, line) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const points = [[-CHEVRON.HALF_LENGTH, -CHEVRON.HALF_HEIGHT], [CHEVRON.HALF_LENGTH, 0], [-CHEVRON.HALF_LENGTH, CHEVRON.HALF_HEIGHT]]
    .map(([u, v]) => [x + u * cos - v * sin, y + u * sin + v * cos]);
  return [
    { type: 'polyline', points, round: true, stroke: MARKER.CASING_COLOR, width: CHEVRON.CASING, strokeOpacity: MARKER.CASING_OPACITY, opacity: 1 },
    { type: 'polyline', points, round: true, stroke: line, width: CHEVRON.STROKE, strokeOpacity: 1, opacity: 1 },
  ];
}


// Follow selected landmark

/**
 * The camera that faces a landmark: orbited about its focal point onto the line from the focal point
 * through the landmark, at its present distance, its view up kept as near the present one as the new
 * direction allows. Null when the landmark is at the focal point (no direction), or for a camera
 * without a position and focal point.
 *
 * @param {object} camera - { position, focalPoint, viewUp }
 * @param {number[]} point - the landmark, in patient coordinates (mm)
 * @returns {{ position: number[], focalPoint: number[], viewUp: number[] } | null}
 */
function orbitToward(camera, point) {
  const position = vector(camera && camera.position);
  const focalPoint = vector(camera && camera.focalPoint);
  const at = vector(point);
  if (!position || !focalPoint || !at) {
    return null;
  }
  const distance = length(sub(position, focalPoint));
  const toward = unit(sub(at, focalPoint));
  if (!toward || !(distance > EPSILON)) {
    return null;
  }
  const nextPosition = add(focalPoint, scale(toward, distance));
  const forward = scale(toward, -1);
  const keepUp = candidate => candidate && unit(sub(candidate, scale(forward, dot(candidate, forward))));
  // The present view up, else, when the new viewing direction is parallel to it, the present viewing
  // direction, else any axis across the new direction
  const viewUp = keepUp(vector(camera.viewUp))
    || keepUp(unit(sub(focalPoint, position)))
    || [[0, 0, 1], [0, 1, 0], [1, 0, 0]].map(keepUp).find(Boolean);
  return { position: nextPosition, focalPoint, viewUp };
}


export {
  BEHIND, CHEVRON, DEPTH_FADE, EDGE_INSET, chevronPrimitives, depthAlong, depthStrengths, edgePlacement, isInView, orbitToward, screenAxes,
  screenDirection,
};
