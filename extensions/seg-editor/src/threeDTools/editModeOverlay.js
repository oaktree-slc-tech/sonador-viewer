// The edit-mode display of the segment being edited (user feedback on the 3D toolbox, 2026-10-24):
// its mesh drawn the way Blender's edit mode draws the active object, every edge as a thin line
// and every vertex as a small dot over the shaded surface, so the topology a Lasso, Paint,
// Remove or Smooth acts on can be seen and aimed at. Only the target segment is drawn this way;
// the other segments keep their presentation look. The colour is a shade of the segment's own
// by default (meshColorFor: black read as ink and a fixed grey as mud, owner's review of
// 2026-10-27), or one the user picked for every segment (utils/meshColor).
//
// The lines and dots are depth-tested against the surface, which SegEditorSurfaceView pushes back
// with a polygon offset while the overlay is shown, so the far side's mesh stays hidden and the
// near side's reads as drawn on the surface. One-pixel WebGL lines are enough here: the point is
// the topology, not emphasis (the preview overlay is the emphasis).

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  LineBasicMaterial,
  LineSegments,
  Points,
  PointsMaterial,
} from 'three';


/** The preference value that makes the mesh follow the segment's colour (the default). */
export const MESH_COLOR_AUTO = 'auto';
/** The mesh colour when neither a segment colour nor a preference is known: a mid grey. */
export const EDIT_MODE_COLOR_FALLBACK = '#8f8f8f';
export const EDIT_MODE_COLOR = new Color(EDIT_MODE_COLOR_FALLBACK);
// How far the derived colour moves from the segment's: a strong step, so the mesh is clearly the
// segment's own shade and clearly not its surface (owner's review of 2026-10-27: subtle will not
// do; black reads as ink, grey as mud). A light segment's mesh goes further toward black, which
// leaves room for the selection's wire between the mesh and the pastel fill (selectionStyle)
const DERIVED_MIX = 0.6;
const DERIVED_MIX_LIGHT = 0.8;
// A segment lighter than this (sRGB-weighted luma) gets a darker mesh, the rest a lighter one.
// Either step moves the luma by at least 0.32 (0.6 of the way to white from at most 0.4, or 0.8
// of the way to black from above 0.4), so no segment needs a further push
const DERIVED_LUMINANCE_SPLIT = 0.4;

const _luminance = srgb => 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];

/**
 * The mesh colour for a segment: the user's pick when one is set, otherwise the segment's own
 * colour moved well toward white (a dark segment) or black (a light one), so the mesh reads as
 * the segment's shade and stands out from its shaded surface. Falls back to grey without a
 * segment colour.
 *
 * @param {string|number|Color|number[]|null|undefined} segmentColor - the segment's colour (any
 *   form three's Color reads: 'rgb(r, g, b)', '#rrggbb', a number; or a colour LUT entry's bytes)
 * @param {string} [preference] - MESH_COLOR_AUTO, or a colour the user picked
 * @returns {Color}
 */
// The colour's sRGB components (0..1), whatever form it was given in; three keeps its own in
// linear light, and the mixes below are made in sRGB so the segment's hue survives them
function _srgb(color) {
  if (Array.isArray(color) || ArrayBuffer.isView(color)) {
    // A colour LUT entry: bytes
    return [color[0], color[1], color[2]].map(byte => Math.min(255, Math.max(0, Number(byte) || 0)) / 255);
  }
  const hex = new Color(color).getHex();
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map(byte => byte / 255);
}

// A colour mixed toward white (mix > 0) or black (mix < 0) by |mix|, in sRGB
function _mixed(srgb, mix) {
  const target = mix > 0 ? 1 : 0;
  const amount = Math.abs(mix);
  const bytes = srgb.map(value => Math.round((value + (target - value) * amount) * 255));
  return `#${bytes.map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function meshColorFor(segmentColor, preference = MESH_COLOR_AUTO) {
  if (preference && preference !== MESH_COLOR_AUTO) {
    return new Color(preference);
  }
  if (segmentColor === undefined || segmentColor === null || segmentColor === '') {
    return new Color(EDIT_MODE_COLOR_FALLBACK);
  }
  const srgb = _srgb(segmentColor);
  const luminance = _luminance(srgb);
  const sign = luminance > DERIVED_LUMINANCE_SPLIT ? -1 : 1;
  return new Color(_mixed(srgb, sign * (sign < 0 ? DERIVED_MIX_LIGHT : DERIVED_MIX)));
}
// Lines at full strength read as drawn with a pen; a little transparency keeps the shading
// legible where the mesh is dense
const EDGE_OPACITY = 0.8;
// Vertex dots in CSS pixels, a touch larger than the line so they read as nodes
const VERTEX_SIZE = 3;
// Drawn over the surface and under the selection highlight (1) and the preview overlay (2)
const RENDER_ORDER = 0.5;

/**
 * Every edge of a Cornerstone3D polys array ([n, a, b, c, ...]) once, as pairs of vertex
 * indices. Non-triangle cells contribute their perimeter edges.
 *
 * @param {ArrayLike<number>} polys
 * @returns {Uint32Array}
 */
export function uniqueEdges(polys) {
  const seen = new Set();
  const edges = [];
  const edge = (a, b) => {
    const key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
    if (!seen.has(key)) {
      seen.add(key);
      edges.push(a, b);
    }
  };
  for (let i = 0; i < polys.length;) {
    const count = polys[i];
    if (!(count > 1) || i + count >= polys.length) {
      break;
    }
    for (let k = 1; k <= count; k++) {
      edge(polys[i + k], polys[i + (k % count) + 1]);
    }
    i += count + 1;
  }
  return Uint32Array.from(edges);
}

function _geometries({ points, polys }) {
  const position = new BufferAttribute(Float32Array.from(points), 3);
  const edges = new BufferGeometry();
  edges.setAttribute('position', position);
  edges.setIndex(new BufferAttribute(uniqueEdges(polys), 1));
  const vertices = new BufferGeometry();
  vertices.setAttribute('position', position);
  return { edges, vertices };
}

/**
 * The edit-mode overlay of a surface: its parts are named 'edges' and 'vertices'. Null for an
 * empty surface.
 *
 * @param {{ points: ArrayLike<number>, polys: ArrayLike<number> }} surface
 * @param {{ color?: string|number|Color }} [options] - the mesh colour (the user's preference)
 * @returns {Group|null}
 */
export function createEditModeOverlay(surface, { color = EDIT_MODE_COLOR } = {}) {
  if (!surface?.points?.length || !surface?.polys?.length) {
    return null;
  }
  const geometries = _geometries(surface);
  const edges = new LineSegments(geometries.edges, new LineBasicMaterial({
    color: new Color(color), transparent: true, opacity: EDGE_OPACITY, depthWrite: false,
  }));
  const vertices = new Points(geometries.vertices, new PointsMaterial({
    color: new Color(color), size: VERTEX_SIZE, sizeAttenuation: false, depthWrite: false,
  }));
  edges.name = 'edges';
  vertices.name = 'vertices';
  const group = new Group();
  [edges, vertices].forEach(part => {
    part.renderOrder = RENDER_ORDER;
    group.add(part);
  });
  return group;
}

/** Replace the overlay's geometry (the surface changed, or a preview is shown in its place). */
export function updateEditModeOverlay(group, surface) {
  const geometries = _geometries(surface);
  group.children.forEach(part => {
    part.geometry.dispose();
    part.geometry = geometries[part.name];
  });
}

// The shades the palette offers, as mixes of the segment colour toward white (negative: toward
// black); the derived default sits among them
const PALETTE_MIXES = [0.85, 0.6, 0.35, -0.35, -0.6, -0.85];

/**
 * A small palette of the segment's own shades, lighter to darker, as '#rrggbb' strings, for the
 * mesh colour menu; grey shades without a segment colour.
 *
 * @param {string|number|Color|null|undefined} segmentColor
 * @returns {string[]}
 */
export function meshColorPalette(segmentColor) {
  const srgb = _srgb(segmentColor === undefined || segmentColor === null || segmentColor === '' ? EDIT_MODE_COLOR_FALLBACK : segmentColor);
  return PALETTE_MIXES.map(mix => _mixed(srgb, mix));
}

/** Recolour the overlay (the user changed the mesh colour). */
export function setEditModeOverlayColor(group, color) {
  group.children.forEach(part => {
    part.material.color.set(color);
    part.material.needsUpdate = true;
  });
}

export function disposeEditModeOverlay(group) {
  group.parent?.remove(group);
  group.children.forEach(part => {
    part.geometry.dispose();
    part.material.dispose();
  });
}
