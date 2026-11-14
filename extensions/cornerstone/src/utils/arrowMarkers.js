// Markers of the arrows a view does not draw. An arrow labels a point, and the point exists on every
// plane: a view whose slice passes near an arrow's tip (less than one slice spacing from it) and does
// not draw the arrow (a neighbouring slice, another plane) shows a ring at the tip, projected onto the
// view. Hovering a ring shows the arrow's label (ArrowMarkerTooltip); pressing it (a primary mouse
// press or a one-finger tap) brings the view to the tip (the renderer's `activate`), before the
// active tool takes the press. A viewport's rings and its hover go with it (`clearArrowMarkers`).
//
// The renderers (the classic and the Cornerstone3D arrow marker tools) record the rings they draw on
// an element with `setArrowMarkers`, in CSS pixels from the top-left of the canvas they draw on.

export const MARKER_RADIUS = 4;
export const MARKER_HIT_RADIUS = 12;

const markersByElement = new WeakMap();
const updaters = new WeakMap();
const hoverListeners = new Set();
let hovered = null;

const hoverKey = hover => (hover ? JSON.stringify([hover.label, hover.rect]) : null);

function setHover(next) {
  if (hoverKey(next) === hoverKey(hovered) && (next ? next.element : null) === (hovered ? hovered.element : null)) {
    return;
  }
  hovered = next;
  hoverListeners.forEach(listener => listener(next));
}

/**
 * The marker under a client point on an element: { marker, rect } (rect: the ring's client box), or
 * null. The nearest ring within MARKER_HIT_RADIUS of the point.
 */
export function arrowMarkerAt(element, clientX, clientY) {
  const entry = markersByElement.get(element);
  if (!entry || !entry.canvas || !entry.markers.length || element.isConnected === false) {
    return null;
  }
  const bounds = entry.canvas.getBoundingClientRect();
  const x = clientX - bounds.left;
  const y = clientY - bounds.top;
  let found = null;
  let nearest = MARKER_HIT_RADIUS;
  entry.markers.forEach((marker) => {
    const distance = Math.hypot(marker.x - x, marker.y - y);
    if (distance <= nearest) {
      found = marker;
      nearest = distance;
    }
  });
  if (!found) {
    return null;
  }
  return {
    marker: found,
    rect: {
      left: bounds.left + found.x - MARKER_RADIUS, top: bounds.top + found.y - MARKER_RADIUS,
      width: 2 * MARKER_RADIUS, height: 2 * MARKER_RADIUS,
    },
  };
}

function listen(element) {
  // Hover and press on the element's markers; attached once per element
  let pointer = null;
  const update = () => {
    const hit = pointer && arrowMarkerAt(element, pointer.clientX, pointer.clientY);
    if (hit && hit.marker.label) {
      setHover({ element, label: hit.marker.label, rect: hit.rect });
    } else if (hovered && hovered.element === element) {
      setHover(null);
    }
  };
  updaters.set(element, update);

  element.addEventListener('mousemove', (evt) => {
    pointer = { clientX: evt.clientX, clientY: evt.clientY };
    update();
  });
  const clear = () => {
    pointer = null;
    update();
  };
  element.addEventListener('mouseleave', clear);
  element.addEventListener('wheel', clear);

  // Before the tools (capture): a press on a ring brings the view to its arrow, and no tool starts.
  // A tap's default (the mouse events a browser emulates from it) is prevented, so it acts once.
  const press = (evt, point) => {
    const hit = point && arrowMarkerAt(element, point.clientX, point.clientY);
    if (!hit) {
      return;
    }
    evt.preventDefault();
    evt.stopImmediatePropagation();
    evt.stopPropagation();
    pointer = null;
    update();
    hit.marker.activate();
  };
  element.addEventListener('mousedown', evt => evt.button === 0 && press(evt, evt), true);
  element.addEventListener('touchstart', (evt) => {
    const touches = evt.touches || [];
    if (touches.length === 1) {
      press(evt, touches[0]);
    }
  }, { capture: true, passive: false });
}

/**
 * Record the markers drawn on an element.
 *
 * @param {HTMLElement} element - the viewport element (it receives the pointer events)
 * @param {HTMLElement} canvas - the canvas the markers' coordinates are measured from
 * @param {Array<object>} markers - { x, y (CSS pixels from the canvas's top-left), label, activate() }
 */
export function setArrowMarkers(element, canvas, markers = []) {
  if (!element) {
    return;
  }
  markersByElement.set(element, { canvas, markers });
  if (markers.length && !updaters.has(element)) {
    listen(element);
  }
  const update = updaters.get(element);
  if (update) {
    update();
  }
}

/** Forget an element's markers, and its hover: its viewport is disabled or gone */
export function clearArrowMarkers(element) {
  if (!element) {
    return;
  }
  markersByElement.delete(element);
  if (hovered && hovered.element === element) {
    setHover(null);
  }
}

/** Subscribe to the hovered marker ({ element, label, rect } or null); returns the unsubscribe */
export function subscribeArrowMarkerHover(listener) {
  hoverListeners.add(listener);
  listener(hovered);
  return () => hoverListeners.delete(listener);
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => {
  const length = Math.hypot(a[0], a[1], a[2]);
  return length > 0 ? a.map(value => value / length) : a;
};

// A slice this close to one spacing from a point counts as one spacing away (mm): the neighbours of
// a slice a point lies on are not near it
const NEAR_TOLERANCE = 1e-3;

/** The distance of a point from a plane through `origin` with `normal` (mm, unsigned) */
export const distanceFromPlane = (origin, normal, point) =>
  Math.abs(dot([0, 1, 2].map(axis => Number(point[axis]) - Number(origin[axis])), unit(normal.map(Number))));

/**
 * Whether a point at `distance` from a slice is near it: less than one slice spacing away. A point
 * between two slices is near both; a point on a slice is near that slice only.
 */
export const isNearSlice = (distance, spacing) => Number.isFinite(distance) && distance < (Number(spacing) || 1) - NEAR_TOLERANCE;

/** The signed distance of a point from an image plane module along its normal, or NaN without a complete plane */
export function signedDistanceFromImagePlane(plane, point) {
  const { imagePositionPatient: origin, rowCosines, columnCosines } = plane || {};
  if (!origin || !rowCosines || !columnCosines || !point) {
    return NaN;
  }
  const normal = unit(cross(rowCosines.map(Number), columnCosines.map(Number)));
  return dot([0, 1, 2].map(axis => Number(point[axis]) - Number(origin[axis])), normal);
}

/** The distance of a point from an image plane module, or NaN without a complete plane */
export const distanceFromImagePlane = (plane, point) => Math.abs(signedDistanceFromImagePlane(plane, point));

/**
 * The index of the image plane nearest a patient point (its distance along the plane's normal), or
 * -1 when no plane is complete.
 *
 * @param {Array<object>} planes - image plane modules (imagePositionPatient, rowCosines, columnCosines)
 * @param {number[]} point - patient point
 */
export function nearestImageIndex(planes, point) {
  let index = -1;
  let nearest = Infinity;
  (planes || []).forEach((plane, i) => {
    const distance = distanceFromImagePlane(plane, point);
    if (Number.isFinite(distance) && distance < nearest) {
      nearest = distance;
      index = i;
    }
  });
  return index;
}


export default {
  MARKER_RADIUS, MARKER_HIT_RADIUS, arrowMarkerAt, setArrowMarkers, clearArrowMarkers, subscribeArrowMarkerHover,
  nearestImageIndex, distanceFromPlane, distanceFromImagePlane, signedDistanceFromImagePlane, isNearSlice,
};
