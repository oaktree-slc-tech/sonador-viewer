// How a face selection (Lasso, Paint) is drawn on the 3D canvas (owner's reviews of 2026-10-27:
// a selected face must look lit up, and its vertices must stand out from the fill AND from the
// edit-mode mesh; design specs of the same day). Three roles share the segment's hue:
// - the edit-mode mesh over the whole surface (threeDTools/editModeOverlay): a tint, mixed
//   toward white (a dark segment) or black (a light one);
// - the selected FACES: a flat, unlit, pastel fill, the hue at full saturation and high
//   lightness, nearly opaque, so the shading gradient disappears under it;
// - the selected EDGES and VERTICES (the wire): the hue at full saturation and a lightness
//   solved for contrast, at least 2.1:1 against the fill and 1.8:1 against the mesh (WCAG ratio
//   on linear luminance), so the wire is the one saturation peak on screen: full-chroma ink
//   bounding a pastel field, which is what reads as "selected, about to be acted upon". The
//   selection's boundary edges are heavier than its interior ones, so a group of faces reads as
//   one patch from any angle; the vertices are dots twice the mesh's. The wire is drawn after
//   the fill (the canvas orders the parts), so the fill never paints over it.
// Nothing here depends on the preview colour: a pending edit's preview is a translucent fill
// in the user's colour with 3px edges and dark-rimmed vertices.

import { Color } from 'three';

import { meshColorFor } from './editModeOverlay';


const FALLBACK_SEGMENT_COLOR = '#ffd600';
// Below this saturation the segment is grey-ish and keeps its own saturation
const MIN_SATURATION_TO_BOOST = 0.15;
// The split between a dark segment and a light one (sRGB-weighted luma, as the mesh uses)
const LUMA_SPLIT = 0.4;
const FILL_LIGHTNESS = { dark: 0.85, light: 0.92 };
// The wire's lightness is searched from the top of this range down
const WIRE_LIGHTNESS = { min: 0.2, max: 0.7, step: 0.01 };
// The contrast the wire must have against the fill, then against the mesh (WCAG ratios). The
// owner backed these off from 3.5 / 3.0 in two rounds on 2026-10-27 (2.8 / 2.4, then this): the
// wire read too dark, and less contrast against the pastel fill leaves the selected / unselected
// difference to the wire's weight and saturation rather than to darkness
const WIRE_CONTRAST = { fill: 2.1, mesh: 1.8 };

/** The fill opacity, the edge widths (px: the patch's outline, its interior) and the point size (px). */
export const SELECTION_FILL_OPACITY = { lasso: 0.8, paint: 0.9 };
export const SELECTION_EDGE_WIDTH = { boundary: 3, interior: 2 };
export const SELECTION_POINT_SIZE = 6;
/** The Paint brush footprint: the fill colour at this opacity, a ghost of the selection to come */
export const BRUSH_FOOTPRINT_OPACITY = 0.45;

// The colour's sRGB components (0..1), whatever form it was given in
function _srgb(color) {
  if (Array.isArray(color) || ArrayBuffer.isView(color)) {
    return [color[0], color[1], color[2]].map(byte => Math.min(255, Math.max(0, Number(byte) || 0)) / 255);
  }
  const hex = new Color(color).getHex();
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map(byte => byte / 255);
}

const _hex = srgb => `#${srgb.map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('')}`;

// sRGB-weighted luma (the mesh's light / dark switch)
const _luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// Linear relative luminance (WCAG), for contrast
function _luminance(srgb) {
  const linear = srgb.map(value => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** The WCAG contrast ratio of two '#rrggbb' (or sRGB triple) colours, ≥ 1. */
export function contrastRatio(a, b) {
  const ya = _luminance(typeof a === 'string' ? _srgb(a) : a);
  const yb = _luminance(typeof b === 'string' ? _srgb(b) : b);
  return (Math.max(ya, yb) + 0.05) / (Math.min(ya, yb) + 0.05);
}

// sRGB (0..1) to HSL (0..1), and back; the colours are built in sRGB so the hue survives
function _toHsl([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) {
    return { h: 0, s: 0, l };
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) {
    h = (g - b) / d + (g < b ? 6 : 0);
  } else if (max === g) {
    h = (b - r) / d + 2;
  } else {
    h = (r - g) / d + 4;
  }
  return { h: h / 6, s, l };
}

function _fromHsl({ h, s, l }) {
  if (s === 0) {
    return [l, l, l];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = t => {
    let x = t;
    if (x < 0) {
      x += 1;
    }
    if (x > 1) {
      x -= 1;
    }
    if (x < 1 / 6) {
      return p + (q - p) * 6 * x;
    }
    if (x < 1 / 2) {
      return q;
    }
    if (x < 2 / 3) {
      return p + (q - p) * (2 / 3 - x) * 6;
    }
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

function _segmentSrgb(segmentColor) {
  try {
    return _srgb(segmentColor === undefined || segmentColor === null || segmentColor === '' ? FALLBACK_SEGMENT_COLOR : segmentColor);
  } catch (error) {
    return _srgb(FALLBACK_SEGMENT_COLOR);
  }
}

/**
 * The colours a selection of a segment is drawn in.
 *
 * @param {string|number|number[]|Color|null|undefined} segmentColor - the segment's colour (a
 *   CSS string, a hex number, a colour LUT entry's bytes); the fallback yellow when unknown
 * @param {{ meshColor?: string }} [options] - the edit-mode mesh colour in effect (the user's
 *   pick); the derived one when left out
 * @returns {{ fill: string, wire: string, mesh: string, light: boolean }} '#rrggbb' colours:
 *   the fill, the selected edges and vertices, the mesh the wire was solved against, and whether
 *   the segment counted as light
 */
export function selectionColors(segmentColor, { meshColor } = {}) {
  const srgb = _segmentSrgb(segmentColor);
  const light = _luma(srgb) >= LUMA_SPLIT;
  const tone = light ? 'light' : 'dark';
  const { h, s } = _toHsl(srgb);
  const saturation = s < MIN_SATURATION_TO_BOOST ? s : 1;
  const fill = _hex(_fromHsl({ h, s: saturation, l: FILL_LIGHTNESS[tone] }));
  const mesh = meshColor || `#${meshColorFor(srgb.map(value => Math.round(value * 255))).getHexString()}`;
  // The wire: the highest lightness in range that clears both the fill and the mesh; when no
  // lightness does (a mesh colour the user picked near the wire), the one that comes closest
  // to both targets at once
  const wireAt = l => _hex(_fromHsl({ h, s: saturation, l }));
  const steps = Math.round((WIRE_LIGHTNESS.max - WIRE_LIGHTNESS.min) / WIRE_LIGHTNESS.step);
  let best = { lightness: WIRE_LIGHTNESS.max, score: -Infinity };
  for (let i = 0; i <= steps; i++) {
    const lightness = Math.round((WIRE_LIGHTNESS.max - i * WIRE_LIGHTNESS.step) * 100) / 100;
    const candidate = wireAt(lightness);
    const againstFill = contrastRatio(candidate, fill) / WIRE_CONTRAST.fill;
    const againstMesh = contrastRatio(candidate, mesh) / WIRE_CONTRAST.mesh;
    if (againstFill >= 1 && againstMesh >= 1) {
      best = { lightness, score: Infinity };
      break;
    }
    const score = Math.min(againstFill, againstMesh);
    if (score > best.score) {
      best = { lightness, score };
    }
  }
  return { fill, wire: wireAt(best.lightness), mesh, light };
}

/**
 * The whole style of a selection: colours, fill opacity, edge widths and point size.
 *
 * @param {*} segmentColor
 * @param {{ painting?: boolean, meshColor?: string }} [options] - a Paint stroke in progress
 *   fills more strongly; the mesh colour in effect
 * @returns {{ fill: Color, wire: Color, fillOpacity: number, boundaryWidth: number,
 *   interiorWidth: number, pointSize: number, light: boolean }}
 */
export function selectionStyle(segmentColor, { painting = false, meshColor } = {}) {
  const colors = selectionColors(segmentColor, { meshColor });
  return {
    fill: new Color(colors.fill),
    wire: new Color(colors.wire),
    fillOpacity: painting ? SELECTION_FILL_OPACITY.paint : SELECTION_FILL_OPACITY.lasso,
    boundaryWidth: SELECTION_EDGE_WIDTH.boundary,
    interiorWidth: SELECTION_EDGE_WIDTH.interior,
    pointSize: SELECTION_POINT_SIZE,
    light: colors.light,
  };
}

export default selectionStyle;
