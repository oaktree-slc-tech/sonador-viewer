// The drawing and the hover of landmark markers, for the classic viewport (a canvas) and the
// Cornerstone3D views, the MPR panes and the 3D volume view (an SVG layer). The markers' shapes,
// ghosts, brackets and name plates are primitives in CSS pixels (@ohif/core DICOMSR
// landmarks.markers); this draws them, and keeps, for each viewport element, the markers it draws and
// the one the pointer is on. The markers take no input: a press over one reaches the active tool as
// anywhere else on the image.

const SVG_NS = 'http://www.w3.org/2000/svg';

const stateByElement = new WeakMap();

// The width of a text in the name plate's font, from a canvas kept for measuring
let measuringContext;
function measurePlateText(text, font) {
  if (measuringContext === undefined) {
    try {
      // jsdom has no canvas rendering: an estimate stands in
      const jsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '');
      measuringContext = typeof document !== 'undefined' && !jsdom ? document.createElement('canvas').getContext('2d') : null;
    } catch (error) {
      measuringContext = null;
    }
  }
  if (!measuringContext || typeof measuringContext.measureText !== 'function') {
    return String(text).length * 7;
  }
  measuringContext.font = font;
  return measuringContext.measureText(String(text)).width;
}


// Hover

// The marker under the pointer, from the markers as last placed; the pointer in client pixels
function hitUnderPointer(state) {
  if (!state.pointer || !state.markerAt) {
    return null;
  }
  const rect = state.canvas && state.canvas.getBoundingClientRect ? state.canvas.getBoundingClientRect() : { left: 0, top: 0 };
  const hit = state.markerAt(state.markers, state.pointer.clientX - rect.left, state.pointer.clientY - rect.top);
  return hit ? hit.key : null;
}

function listen(element, state) {
  const update = (pointer) => {
    state.pointer = pointer;
    const key = hitUnderPointer(state);
    if (key !== state.hovered) {
      state.hovered = key;
      state.refresh(element);
    }
  };
  element.addEventListener('mousemove', evt => update({ clientX: evt.clientX, clientY: evt.clientY }));
  element.addEventListener('mouseleave', () => update(null));
  // Scrolling through the slices: no plate follows the pointer until it moves again
  element.addEventListener('wheel', () => update(null));
}

/**
 * Record the markers an element is about to draw, for hover, and choose the hovered one again
 * against their new places (the view may have panned, zoomed or moved under a still pointer).
 * Called before drawing: the drawing reads `hoveredLandmarkMarker` after it.
 *
 * @param {HTMLElement} element - the viewport element (it receives the pointer events)
 * @param {HTMLElement} canvas - the canvas the markers' coordinates are measured from
 * @param {object[]} markers - { key, x, y } in CSS pixels from the canvas's top left
 * @param {object} options - { markerAt(markers, x, y), refresh(element) }
 * @returns {string|null} the key of the hovered marker
 */
function setLandmarkMarkers(element, canvas, markers, { markerAt, refresh }) {
  if (!element) {
    return null;
  }
  let state = stateByElement.get(element);
  if (!state) {
    state = { hovered: null, pointer: null };
    stateByElement.set(element, state);
    listen(element, state);
  }
  Object.assign(state, { canvas, markers: markers || [], markerAt, refresh });
  state.hovered = hitUnderPointer(state);
  return state.hovered;
}

/** The key of the marker the pointer is on, on an element, or null */
const hoveredLandmarkMarker = element => ((element && stateByElement.get(element)) || {}).hovered || null;

/** Forget an element's markers and its hover: its viewport is disabled or gone */
function clearLandmarkMarkers(element) {
  const state = element && stateByElement.get(element);
  if (state) {
    Object.assign(state, { markers: [], hovered: null, pointer: null });
  }
}


// Drawing

const scaledFont = (font, scale) => String(font).replace(/(\d+(?:\.\d+)?)px/, (_, size) => `${Number(size) * scale}px`);

/** Draw primitives on a canvas context whose pixels are `scale` CSS pixels each */
function drawOnCanvas(context, primitives, scale = 1) {
  primitives.forEach((p) => {
    context.save();
    const opacity = p.opacity === undefined ? 1 : p.opacity;
    context.lineJoin = p.round ? 'round' : 'miter';
    context.lineCap = p.round ? 'round' : 'butt';
    const stroke = () => {
      if (!p.stroke) {
        return;
      }
      context.globalAlpha = opacity * (p.strokeOpacity === undefined ? 1 : p.strokeOpacity);
      context.strokeStyle = p.stroke;
      context.lineWidth = p.width * scale;
      context.stroke();
    };
    const fill = (color, alpha) => {
      context.globalAlpha = opacity * alpha;
      context.fillStyle = color;
      context.fill();
    };
    context.beginPath();
    if (p.type === 'lines') {
      p.segments.forEach(([x1, y1, x2, y2]) => {
        context.moveTo(x1 * scale, y1 * scale);
        context.lineTo(x2 * scale, y2 * scale);
      });
      stroke();
    } else if (p.type === 'polyline' || p.type === 'polygon') {
      p.points.forEach(([x, y], i) => (i ? context.lineTo(x * scale, y * scale) : context.moveTo(x * scale, y * scale)));
      if (p.type === 'polygon') {
        context.closePath();
      }
      stroke();
    } else if (p.type === 'circle') {
      context.arc(p.cx * scale, p.cy * scale, p.r * scale, 0, 2 * Math.PI);
      if (p.fill) {
        fill(p.fill, 1);
      }
      stroke();
    } else if (p.type === 'rect') {
      const [x, y, w, h, r] = [p.x, p.y, p.width, p.height, p.rx || 0].map(value => value * scale);
      context.moveTo(x + r, y);
      context.arcTo(x + w, y, x + w, y + h, r);
      context.arcTo(x + w, y + h, x, y + h, r);
      context.arcTo(x, y + h, x, y, r);
      context.arcTo(x, y, x + w, y, r);
      context.closePath();
      fill(p.fill, p.fillOpacity === undefined ? 1 : p.fillOpacity);
    } else if (p.type === 'text') {
      context.globalAlpha = opacity;
      context.font = scaledFont(p.font, scale);
      context.fillStyle = p.fill;
      context.textBaseline = 'alphabetic';
      context.fillText(p.text, p.x * scale, p.y * scale);
    }
    context.restore();
  });
}

const svgAttributes = (p) => {
  const opacity = p.opacity === undefined ? 1 : p.opacity;
  const common = { opacity };
  if (p.stroke) {
    Object.assign(common, {
      stroke: p.stroke, 'stroke-width': p.width, 'stroke-opacity': p.strokeOpacity === undefined ? 1 : p.strokeOpacity,
      'stroke-linejoin': p.round ? 'round' : 'miter', 'stroke-linecap': p.round ? 'round' : 'butt',
    });
  }
  if (p.type === 'lines') {
    return ['path', { ...common, fill: 'none', d: p.segments.map(([x1, y1, x2, y2]) => `M${x1} ${y1}L${x2} ${y2}`).join('') }];
  }
  if (p.type === 'polyline' || p.type === 'polygon') {
    const d = p.points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('') + (p.type === 'polygon' ? 'Z' : '');
    return ['path', { ...common, fill: 'none', d }];
  }
  if (p.type === 'circle') {
    return ['circle', { ...common, cx: p.cx, cy: p.cy, r: p.r, fill: p.fill || 'none' }];
  }
  if (p.type === 'rect') {
    return ['rect', {
      opacity, x: p.x, y: p.y, width: p.width, height: p.height, rx: p.rx || 0, fill: p.fill,
      'fill-opacity': p.fillOpacity === undefined ? 1 : p.fillOpacity, stroke: 'none',
    }];
  }
  if (p.type === 'text') {
    return ['text', { opacity, x: p.x, y: p.y, fill: p.fill, style: `font: ${p.font}`, stroke: 'none' }];
  }
  return [null, {}];
};

/**
 * Draw primitives in a Cornerstone3D annotation SVG layer, each node kept by its place in `owner`'s
 * list so that it is updated in place on the next render and removed when no longer drawn. SVG paints
 * in document order: each node is kept right after `after` (the node drawn before it), so a node
 * drawn on an earlier render stays below what is drawn after it on this one.
 *
 * @param {object} svgDrawingHelper - the layer's helper (getSvgNode, appendNode, setNodeTouched)
 * @param {string} owner - a key unique to what draws the primitives (a landmark)
 * @param {object[]} primitives
 * @param {Element} [after] - the node the first primitive follows
 * @returns {Element|undefined} the last node drawn, else `after`
 */
function drawAsSvg(svgDrawingHelper, owner, primitives, after) {
  let previous = after;
  primitives.forEach((p, index) => {
    const [tag, attributes] = svgAttributes(p);
    if (!tag) {
      return;
    }
    const hash = `landmarkMarker::${owner}::${index}::${tag}`;
    let node = svgDrawingHelper.getSvgNode(hash);
    if (!node) {
      node = document.createElementNS(SVG_NS, tag);
      svgDrawingHelper.appendNode(node, hash);
    }
    if (previous && previous.parentNode && node.previousSibling !== previous) {
      previous.parentNode.insertBefore(node, previous.nextSibling);
    }
    Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, String(value)));
    if (tag === 'text') {
      node.textContent = p.text;
    }
    svgDrawingHelper.setNodeTouched(hash);
    previous = node;
  });
  return previous;
}

/**
 * Draw a view's layers (`landmarkLayers`) in an SVG layer, in their order.
 *
 * @param {object} svgDrawingHelper
 * @param {string} prefix - unique to the view (its viewport id)
 * @param {Array<[string, object[]]>} layers - [owner, primitives]
 */
function drawLayersAsSvg(svgDrawingHelper, prefix, layers) {
  layers.reduce((after, [owner, primitives]) => drawAsSvg(svgDrawingHelper, `${prefix}::${owner}`, primitives, after), undefined);
}


// What a view draws

/** The records of the landmarks placed on a view, for hover: { key, x, y }, with their depth in the 3D view */
const markerRecords = placed => placed.map(({ landmark, x, y, depth }) => (
  Number.isFinite(depth) ? { key: landmark.key, x, y, depth } : { key: landmark.key, x, y }));

/**
 * The layers a view draws for the landmarks placed on it, in drawing order: every marker, then the
 * chosen landmark's brackets, then the hovered landmark's name plate, on top; and the markers' records
 * for hover. A marker at a strength below 1 (the 3D view's depth fade) is drawn at full strength while
 * hovered or chosen; brackets and plates are never faded. `marks` (the 3D view's edge mark) are drawn
 * after the brackets and below the plate.
 *
 * @param {object[]} placed - { landmark (a viewLandmarks entry), x, y (CSS pixels), slice (sliceClass: full or ghost),
 *   strength?, depth? }
 * @param {object} options - { markers (@ohif/core landmarks.markers), hovered (key), bracketSize (px),
 *   marks: Array<[owner, primitives]> }
 * @returns {{ layers: Array<[string, object[]]>, records: object[] }} layers as [owner, primitives]
 */
function landmarkLayers(placed, { markers, hovered, bracketSize, marks = [] }) {
  const layers = [];
  placed.forEach(({ landmark, x, y, slice, strength = 1 }) => {
    const ghost = slice.kind === 'ghost' ? slice : null;
    const isHovered = landmark.key === hovered;
    layers.push([landmark.key, markers.markerPrimitives({ x, y, shape: landmark.shape, line: landmark.line }, {
      hovered: isHovered, ghost, strength: isHovered || landmark.current ? 1 : strength,
    })]);
  });
  placed.forEach(({ landmark, x, y, slice }) => {
    if (landmark.current && slice.kind === 'full') {
      layers.push([`${landmark.key}::brackets`, markers.bracketPrimitives({ x, y }, bracketSize)]);
    }
  });
  layers.push(...marks);
  const pointed = placed.find(({ landmark }) => landmark.key === hovered && landmark.name);
  if (pointed) {
    const { landmark, x, y, slice } = pointed;
    const text = slice.kind === 'ghost' ? markers.ghostLabel(landmark.name, slice) : landmark.name;
    const { FONT_WEIGHT, FONT_SIZE, FONT_FAMILY } = markers.PLATE;
    const font = `${FONT_WEIGHT} ${FONT_SIZE}px ${FONT_FAMILY}`;
    layers.push([`${landmark.key}::plate`, markers.platePrimitives({ x, y }, text, landmark.text, value => measurePlateText(value, font))]);
  }
  return { layers, records: markerRecords(placed) };
}


export {
  clearLandmarkMarkers, drawAsSvg, drawLayersAsSvg, drawOnCanvas, hoveredLandmarkMarker, landmarkLayers, markerRecords,
  measurePlateText, setLandmarkMarkers,
};
export default {
  clearLandmarkMarkers, drawAsSvg, drawLayersAsSvg, drawOnCanvas, hoveredLandmarkMarker, landmarkLayers, markerRecords,
  measurePlateText, setLandmarkMarkers,
};
