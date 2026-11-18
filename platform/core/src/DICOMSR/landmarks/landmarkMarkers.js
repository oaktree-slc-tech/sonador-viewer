// The markers of landmark sets in the slice views (the classic viewport and the MPR panes), as both
// renderers draw them: which landmarks a view shows, where each falls against the displayed plane,
// and the shapes, ghosts, brackets and name plates, as primitives in CSS pixels around the marker's
// centre. Nothing here draws: a renderer turns the primitives into canvas calls or SVG.
//
// A landmark is drawn in full when the displayed plane passes within half a slice spacing of it, as
// a ghost when it is up to two slice spacings off and the displayed stack can reach it (one of its
// images is within half a spacing of the landmark), and not at all otherwise. A ghost is 70 % of the
// marker's size, at 65 % strength one slice away and 40 % two slices away, with a caret above it for
// a landmark on a later slice of the stack and below it for one on an earlier slice. Image-domain
// sets are drawn on their own image only, and have no ghosts.

import { getCurrentLandmark, getLandmarkSets, isLandmarkSetVisible, subscribe, EVENTS } from './landmarkSetStore';
import { landmarkColors } from './landmarkColors';
import { markerShapeOf } from './landmarkText';
import { placementOf } from './landmarkPlacement';

// A set or landmark that stores no colour is drawn in the Viewer's default
const DEFAULT_COLOR = '#FFFF00';

const MARKER = Object.freeze({
  // The pointer answers within this distance of a marker's centre (CSS pixels)
  HIT_RADIUS: 11,
  STROKE: 1.5,
  CASING: 3.5,
  HOVER_STROKE: 2,
  CASING_COLOR: '#000000',
  CASING_OPACITY: 0.85,
  GHOST_SCALE: 0.7,
  GHOST_STROKE: 1.25,
  GHOST_CASING: 2.65,
  GHOST_OPACITY: Object.freeze({ 1: 0.65, 2: 0.4 }),
});

const BRACKET = Object.freeze({ SIZE: 26, FROM: 38, ARM: 6, STROKE: 2, CASING: 4, COLOR: '#FFFFFF', DURATION: 300 });
const CARET = Object.freeze({ HALF_WIDTH: 3, BASE: 7.55, APEX: 10.55, STROKE: 1.25, CASING: 3.25 });
const PLATE = Object.freeze({
  FONT_SIZE: 12, FONT_WEIGHT: 600, FONT_FAMILY: 'Inter, system-ui, sans-serif', PADDING: 6, HEIGHT: 15, RADIUS: 2.5,
  // The plate's top left corner, from the marker's centre: up and to the right
  OFFSET_X: 10.5, OFFSET_Y: -22, BASELINE: 11, OPACITY: 0.78, DARK: '#000000', LIGHT: '#FFFFFF', MIN_CONTRAST: 4.5,
});

// A point at exactly half a spacing, or two, belongs to the nearer class whatever the rounding (mm)
const TOLERANCE = 1e-6;


// The slice rule

/**
 * Where a landmark falls against the displayed plane.
 *
 * @param {number} distance - the landmark's distance from the displayed plane along the stack's
 *   order (positive towards its later slices), in mm
 * @param {number} spacing - the stack's slice spacing, in mm
 * @param {boolean} reachable - whether an image of the displayed stack is within half a spacing of it
 * @returns {{ kind: 'full' } | { kind: 'ghost', steps: 1 | 2, direction: 'later' | 'earlier' } | { kind: 'none' }}
 */
function sliceClass(distance, spacing, reachable) {
  const step = Number(spacing);
  if (!Number.isFinite(distance) || !(step > 0)) {
    return { kind: 'none' };
  }
  const away = Math.abs(distance);
  if (away <= step / 2 + TOLERANCE) {
    return { kind: 'full' };
  }
  if (reachable && away <= 2 * step + TOLERANCE) {
    return { kind: 'ghost', steps: away <= 1.5 * step + TOLERANCE ? 1 : 2, direction: distance > 0 ? 'later' : 'earlier' };
  }
  return { kind: 'none' };
}


// Which landmarks a view shows

/**
 * The landmarks of the visible sets a slice view can show: the patient-domain sets of its Frame of
 * Reference, and, when `image` is given (the classic viewport), the image-domain sets placed on that
 * exact instance and frame.
 *
 * @param {object} view
 * @param {string} view.frameOfReferenceUID - the Frame of Reference of the displayed image or volume
 * @param {object} [view.image] - { sopInstanceUID, frameNumber } of the displayed image
 * @param {object} [view.store] - the metadata store the exact-image placement reads
 * @param {object[]} [view.displaySets] - the active display sets
 * @returns {object[]} { key, index, domain, point, shape, name, line, text, current }
 */
function viewLandmarks({ frameOfReferenceUID, image, store, displaySets } = {}) {
  const current = getCurrentLandmark();
  const shown = [];
  getLandmarkSets().forEach(({ key, set }) => {
    if (!isLandmarkSetVisible(key)) {
      return;
    }
    if (set.domain === 'patient') {
      if (!frameOfReferenceUID || set.frameOfReferenceUID !== frameOfReferenceUID) {
        return;
      }
    } else if (set.domain === 'image') {
      const onImage = image && set.image && image.sopInstanceUID === set.image.sopInstanceUID
        && (Number(set.image.frameNumber) || 1) === (Number(image.frameNumber) || 1)
        && placementOf(set, store, displaySets).placed;
      if (!onImage) {
        return;
      }
    } else {
      return;
    }
    set.landmarks.forEach((landmark, index) => {
      const colors = landmarkColors(set, landmark);
      shown.push({
        key: `${key}::${index}`,
        setKey: key,
        index,
        domain: set.domain,
        point: landmark.point,
        shape: markerShapeOf(landmark),
        name: landmark.name || null,
        line: colors.Line || DEFAULT_COLOR,
        text: colors.Text || DEFAULT_COLOR,
        current: Boolean(current && current.key === key && current.index === index),
      });
    });
  });
  return shown;
}


// Primitives, in CSS pixels: { type: 'lines' | 'polyline' | 'polygon' | 'circle' | 'rect' | 'text', ... }

const casing = (width, opacity = 1) => ({ stroke: MARKER.CASING_COLOR, width, strokeOpacity: MARKER.CASING_OPACITY, opacity });
const colour = (color, width, opacity = 1) => ({ stroke: color, width, strokeOpacity: 1, opacity });

/** The parts of a shape around a centre, at a scale: [{ type, ... }] without stroke */
function shapeParts(shape, x, y, scale) {
  const s = value => value * scale;
  const arms = (outer, inner) => [
    [x - s(outer), y, x - s(inner), y], [x + s(inner), y, x + s(outer), y],
    [x, y - s(outer), x, y - s(inner)], [x, y + s(inner), x, y + s(outer)],
  ];
  if (shape === 'Anatomic') {
    return [{ type: 'polygon', points: [[x, y - s(6.5)], [x + s(6.5), y], [x, y + s(6.5)], [x - s(6.5), y]] }];
  }
  if (shape === 'Registration') {
    return [{ type: 'circle', cx: x, cy: y, r: s(4.5) }, { type: 'lines', segments: arms(8, 4.5) }];
  }
  return [{ type: 'lines', segments: arms(6.5, 2.5) }];
}

/**
 * The primitives of a marker: its shape over a black casing, in its Line colour; thicker while
 * hovered, a ghost too; smaller, fainter and with a caret as a ghost.
 *
 * @param {object} marker - { x, y, shape, line }
 * @param {object} [state] - { hovered, ghost: { steps, direction } }
 */
function markerPrimitives({ x, y, shape, line }, { hovered = false, ghost = null } = {}) {
  const scale = ghost ? MARKER.GHOST_SCALE : 1;
  const opacity = ghost ? MARKER.GHOST_OPACITY[ghost.steps] || MARKER.GHOST_OPACITY[2] : 1;
  let stroke = ghost ? MARKER.GHOST_STROKE : MARKER.STROKE;
  let under = ghost ? MARKER.GHOST_CASING : MARKER.CASING;
  if (hovered) {
    // The hover stroke, its casing as much wider than the stroke as at rest
    under = MARKER.HOVER_STROKE + (under - stroke);
    stroke = MARKER.HOVER_STROKE;
  }
  const parts = shapeParts(shape, x, y, scale);
  const primitives = [
    ...parts.map(part => ({ ...part, ...casing(under, opacity) })),
    ...parts.map(part => ({ ...part, ...colour(line, stroke, opacity) })),
  ];
  // The Anatomic shape's centre dot
  if (shape === 'Anatomic') {
    primitives.push({ type: 'circle', cx: x, cy: y, r: 1.8 * scale, fill: line, ...casing(1, opacity) });
  }
  if (ghost) {
    // Above for a later slice of the stack, below for an earlier one
    const sign = ghost.direction === 'later' ? -1 : 1;
    const points = [[x - CARET.HALF_WIDTH, y + sign * CARET.BASE], [x, y + sign * CARET.APEX], [x + CARET.HALF_WIDTH, y + sign * CARET.BASE]];
    primitives.push(
      { type: 'polyline', points, round: true, ...casing(CARET.CASING, opacity) },
      { type: 'polyline', points, round: true, ...colour(line, CARET.STROKE, opacity) },
    );
  }
  return primitives;
}

/** The size of the brackets `elapsed` ms after the landmark was chosen: drawn in from 38 px to 26 px */
function bracketSize(elapsed) {
  const t = Math.min(1, Math.max(0, Number(elapsed) / BRACKET.DURATION));
  const eased = 1 - (1 - t) ** 3;
  return BRACKET.FROM + (BRACKET.SIZE - BRACKET.FROM) * (Number.isFinite(eased) ? eased : 1);
}

/** The white corner brackets around the chosen landmark's marker, `size` px across */
function bracketPrimitives({ x, y }, size = BRACKET.SIZE) {
  const h = size / 2;
  const a = BRACKET.ARM;
  const corners = [
    [[x - h, y - h + a], [x - h, y - h], [x - h + a, y - h]],
    [[x + h - a, y - h], [x + h, y - h], [x + h, y - h + a]],
    [[x + h, y + h - a], [x + h, y + h], [x + h - a, y + h]],
    [[x - h + a, y + h], [x - h, y + h], [x - h, y + h - a]],
  ];
  return [
    ...corners.map(points => ({ type: 'polyline', points, ...casing(BRACKET.CASING) })),
    ...corners.map(points => ({ type: 'polyline', points, ...colour(BRACKET.COLOR, BRACKET.STROKE) })),
  ];
}


// Name plates

const parseColor = (value) => {
  const text = String(value || '').trim();
  let match = text.match(/^#([0-9a-f]{3})$/i);
  if (match) {
    return match[1].split('').map(c => parseInt(c + c, 16));
  }
  match = text.match(/^#([0-9a-f]{6})$/i);
  if (match) {
    return [0, 2, 4].map(i => parseInt(match[1].slice(i, i + 2), 16));
  }
  match = text.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  return match ? match.slice(1, 4).map(Number) : undefined;
};

const luminance = (rgb) => {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** The WCAG contrast ratio of two colours (hex or rgb()), or undefined for a colour it cannot read */
function contrastRatio(a, b) {
  const first = parseColor(a);
  const second = parseColor(b);
  if (!first || !second) {
    return undefined;
  }
  const [light, dark] = [luminance(first), luminance(second)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * The primitives of a name plate up and to the right of a marker: the text in its Text colour on a
 * black plate at 78 %, white when the Text colour has less than 4.5:1 against black.
 *
 * @param {object} at - { x, y } the marker's centre
 * @param {string} text
 * @param {string} color - the Text colour
 * @param {Function} measure - the width of a text in the plate's font, in CSS pixels
 */
function platePrimitives({ x, y }, text, color, measure) {
  const ratio = contrastRatio(color, PLATE.DARK);
  const fill = ratio !== undefined && ratio < PLATE.MIN_CONTRAST ? PLATE.LIGHT : PLATE.DARK;
  const width = Math.ceil(Number(measure(text)) || text.length * 7) + 2 * PLATE.PADDING;
  const left = x + PLATE.OFFSET_X;
  const top = y + PLATE.OFFSET_Y;
  return [
    { type: 'rect', x: left, y: top, width, height: PLATE.HEIGHT, rx: PLATE.RADIUS, fill, fillOpacity: PLATE.OPACITY },
    {
      type: 'text', x: left + PLATE.PADDING, y: top + PLATE.BASELINE, text, fill: color,
      font: `${PLATE.FONT_WEIGHT} ${PLATE.FONT_SIZE}px ${PLATE.FONT_FAMILY}`,
    },
  ];
}

/** The text a hovered ghost shows: its name and its offset ("Label only · 1 slice earlier") */
const ghostLabel = (name, { steps, direction }) => `${name} · ${steps} ${steps === 1 ? 'slice' : 'slices'} ${direction}`;


// Hover

/**
 * The marker the pointer answers to: the one whose centre is nearest it, within the hit radius.
 *
 * @param {object[]} markers - { x, y, ... } in CSS pixels
 */
function markerAt(markers, x, y, radius = MARKER.HIT_RADIUS) {
  let found;
  let nearest = Infinity;
  (markers || []).forEach((marker) => {
    const distance = Math.hypot(marker.x - x, marker.y - y);
    if (distance <= radius && distance < nearest) {
      nearest = distance;
      found = marker;
    }
  });
  return found;
}


// The brackets' animation: the time the current landmark was chosen, and the frames until they settle

let chosenAt = -Infinity;
const frameListeners = new Set();
let selectionSubscription;
let animating = false;

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
const nextFrame = callback => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(callback) : setTimeout(callback, 16));

function animate() {
  frameListeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      // A renderer that fails does not stop the others
    }
  });
  if (now() - chosenAt < BRACKET.DURATION) {
    nextFrame(animate);
  } else {
    animating = false;
  }
}

/**
 * Listen for the frames of the brackets' animation: called on each frame from the choice of a
 * landmark until its brackets settle. Returns { unsubscribe }.
 */
function subscribeMarkerFrames(listener) {
  frameListeners.add(listener);
  if (!selectionSubscription) {
    selectionSubscription = subscribe(({ type }) => {
      if (type !== EVENTS.SELECTION_CHANGED) {
        return;
      }
      chosenAt = now();
      if (!animating) {
        animating = true;
        nextFrame(animate);
      }
    });
  }
  return { unsubscribe: () => frameListeners.delete(listener) };
}

/** The size of the current landmark's brackets now */
const currentBracketSize = () => bracketSize(now() - chosenAt);


export {
  BRACKET, CARET, DEFAULT_COLOR, MARKER, PLATE, bracketPrimitives, bracketSize, contrastRatio, currentBracketSize, ghostLabel, markerAt,
  markerPrimitives, platePrimitives, sliceClass, subscribeMarkerFrames, viewLandmarks,
};
