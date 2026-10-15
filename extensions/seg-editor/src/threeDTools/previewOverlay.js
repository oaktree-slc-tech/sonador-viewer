// The overlay a 3D edit is previewed with (ohif-viewers#142 §12, #148 FR-2): the faces the edit
// changes, drawn the way Blender's edit mode draws a selection, so a pending change and its shape
// stand out from any segment colour. Faces are a strong fill in the preview colour (Blender orange
// by default, a user preference), edges thick lines in a lighter variant, and vertices large pale
// dots: while a preview is up it is the most prominent thing on the canvas, and the original faces
// (SegEditorSurfaceView's ghost) recede behind it.
//
// Only what Apply would change is drawn: the new patch faces of a Remove or Repair, and every face
// a Smooth moves. The rest of the previewed surface keeps the segment's colour.

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
} from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';


export const PREVIEW_COLOR_FALLBACK = '#ff8500';

// The variants of the preview colour: edges lifted in lightness, vertices most of the way to white
const EDGE_LIGHTNESS_LIFT = 0.15;
const VERTEX_TOWARD_WHITE = 0.6;
const FACE_OPACITY = 0.7;
// In CSS pixels. WebGL draws plain lines one pixel wide, so the edges are screen-space quads
// (three's LineSegments2), which is what lets them be thicker than the segment's own wireframe.
const EDGE_WIDTH = 2.5;
const VERTEX_SIZE = 8;
// Drawn over the preview mesh and the ghost
const OVERLAY_RENDER_ORDER = 2;

/**
 * The face, edge and vertex colours of the overlay, from the preview colour.
 *
 * @param {string} cssColor - '#rrggbb'
 * @returns {{ face: Color, edge: Color, vertex: Color }}
 */
export function previewShades(cssColor) {
  const face = new Color();
  try {
    face.set(cssColor || PREVIEW_COLOR_FALLBACK);
  } catch (error) {
    face.set(PREVIEW_COLOR_FALLBACK);
  }
  return {
    face,
    edge: face.clone().offsetHSL(0, 0, EDGE_LIGHTNESS_LIFT),
    vertex: face.clone().lerp(new Color(1, 1, 1), VERTEX_TOWARD_WHITE),
  };
}

/** Fan the cells of a Cornerstone3D polys array ([n, a, b, c, ...]) into triangles. */
function _cellTriangles(polys, from, keep) {
  const triangles = [];
  for (let i = from; i < polys.length;) {
    const count = polys[i];
    if (!(count > 0) || i + count >= polys.length) {
      break;
    }
    if (!keep || keep(i, count)) {
      for (let k = 2; k < count; k++) {
        triangles.push(polys[i + 1], polys[i + k], polys[i + k + 1]);
      }
    }
    i += count + 1;
  }
  return Uint32Array.from(triangles);
}

/** Which points moved between two point arrays of the same surface (one flag per point). */
export function movedPoints(before, after) {
  const moved = new Uint8Array(after.length / 3);
  for (let v = 0; v < moved.length; v++) {
    const i = 3 * v;
    moved[v] = before[i] !== after[i] || before[i + 1] !== after[i + 1] || before[i + 2] !== after[i + 2] ? 1 : 0;
  }
  return moved;
}

/**
 * The triangles a previewed edit changes, as vertex indices into its edited surface
 * (`edit.after`):
 *
 * - a cut (Remove, Repair): its patch faces, from `patchPolysOffset`;
 * - a smooth: every face with a point that moved, read from the before and after positions. That
 *   is more than the selection: with Soft edge on, the selection's boundary points move at half
 *   weight and take their unselected neighbours with them, and the coincident copies of a welded
 *   point move together. A smooth keeps the topology, so before and after points correspond; if
 *   they do not, the selection is the fallback.
 *
 * @param {Object} edit - the pending edit ({ kind, cut, selected, before, after })
 * @returns {Uint32Array} three indices per triangle
 */
export function changedTriangles(edit) {
  const polys = edit?.after?.polys;
  if (!polys) {
    return new Uint32Array(0);
  }
  if (edit.kind === 'smooth') {
    const before = edit.before?.points;
    const after = edit.after.points;
    if (before && after && before.length === after.length) {
      const moved = movedPoints(before, after);
      return _cellTriangles(polys, 0, (i, count) => {
        for (let k = 1; k <= count; k++) {
          if (moved[polys[i + k]]) {
            return true;
          }
        }
        return false;
      });
    }
    const cells = edit.selected || [];
    const triangles = new Uint32Array(3 * cells.length);
    cells.forEach((cell, i) => {
      triangles[3 * i] = polys[4 * cell + 1];
      triangles[3 * i + 1] = polys[4 * cell + 2];
      triangles[3 * i + 2] = polys[4 * cell + 3];
    });
    return triangles;
  }
  const offset = edit.after.patchPolysOffset;
  if (!(offset < polys.length)) {
    return new Uint32Array(0);
  }
  return _cellTriangles(polys, offset);
}

/**
 * The overlay's geometry in its own compacted vertex set: the changed triangles' vertices, the
 * triangles, and their edges (each shared edge once).
 *
 * @param {ArrayLike<number>} points - the edited surface's points (x, y, z, ...)
 * @param {Uint32Array} triangles - three vertex indices per triangle, into `points`
 * @returns {{ positions: Float32Array, faces: Uint32Array, edges: Uint32Array }}
 */
export function overlayGeometry(points, triangles) {
  const local = new Map();
  const positions = [];
  const at = vertex => {
    let index = local.get(vertex);
    if (index === undefined) {
      index = local.size;
      local.set(vertex, index);
      positions.push(points[3 * vertex], points[3 * vertex + 1], points[3 * vertex + 2]);
    }
    return index;
  };
  const faces = new Uint32Array(triangles.length);
  const seen = new Set();
  const edges = [];
  const edge = (a, b) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (!seen.has(key)) {
      seen.add(key);
      edges.push(a, b);
    }
  };
  for (let t = 0; t + 2 < triangles.length; t += 3) {
    const a = at(triangles[t]);
    const b = at(triangles[t + 1]);
    const c = at(triangles[t + 2]);
    faces[t] = a;
    faces[t + 1] = b;
    faces[t + 2] = c;
    edge(a, b);
    edge(b, c);
    edge(c, a);
  }
  return { positions: Float32Array.from(positions), faces, edges: Uint32Array.from(edges) };
}

function _geometries(points, triangles) {
  const { positions, faces, edges } = overlayGeometry(points, triangles);
  const make = index => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    if (index) {
      geometry.setIndex(new BufferAttribute(index, 1));
    }
    return geometry;
  };
  // Thick lines take each segment's two end points, unindexed
  const segments = new Float32Array(3 * edges.length);
  edges.forEach((vertex, i) => {
    segments.set(positions.subarray(3 * vertex, 3 * vertex + 3), 3 * i);
  });
  const lines = new LineSegmentsGeometry();
  lines.setPositions(segments);
  return { faces: make(faces), edges: lines, vertices: make(null) };
}

function _syncLineResolution(renderer) {
  // A thick line's width is in pixels of the canvas it is drawn on
  renderer.getSize(this.material.resolution);
}

/**
 * The overlay for a previewed edit, or null when it changes no faces. Its parts are named
 * 'faces', 'edges' and 'vertices'.
 *
 * The edges and vertices are depth-tested against the preview mesh, which is pushed back with a
 * polygon offset (see SegEditorSurfaceView), so the ones on the near side show and those behind
 * the surface do not; the face fill is pulled forward over it and writes no depth.
 *
 * @param {Object} params
 * @param {ArrayLike<number>} params.points - the edited surface's points
 * @param {Uint32Array} params.triangles - the changed triangles (changedTriangles)
 * @param {string} params.color - the preview colour
 * @returns {Group|null}
 */
export function createChangeOverlay({ points, triangles, color }) {
  if (!triangles?.length) {
    return null;
  }
  const shades = previewShades(color);
  const geometries = _geometries(points, triangles);
  const faces = new Mesh(geometries.faces, new MeshBasicMaterial({
    color: shades.face, transparent: true, opacity: FACE_OPACITY, side: DoubleSide, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  const edges = new LineSegments2(geometries.edges, new LineMaterial({
    color: shades.edge, linewidth: EDGE_WIDTH, worldUnits: false,
  }));
  edges.onBeforeRender = _syncLineResolution;
  const vertices = new Points(geometries.vertices, new PointsMaterial({
    color: shades.vertex, size: VERTEX_SIZE, sizeAttenuation: false,
  }));
  faces.name = 'faces';
  edges.name = 'edges';
  vertices.name = 'vertices';
  const group = new Group();
  [faces, edges, vertices].forEach(part => {
    part.renderOrder = OVERLAY_RENDER_ORDER;
    group.add(part);
  });
  return group;
}

/** Replace the overlay's geometry (a recomputed smooth moves the faces it draws). */
export function updateChangeOverlay(group, { points, triangles }) {
  const geometries = _geometries(points, triangles);
  group.children.forEach(part => {
    part.geometry.dispose();
    part.geometry = geometries[part.name];
  });
}

/** Recolour the overlay (the preview colour changed while it is shown). */
export function setChangeOverlayColor(group, color) {
  const shades = previewShades(color);
  group.children.forEach(part => {
    const shade = { faces: shades.face, edges: shades.edge, vertices: shades.vertex }[part.name];
    part.material.color.copy(shade);
  });
}

export function disposeChangeOverlay(group) {
  group.parent?.remove(group);
  group.children.forEach(part => {
    part.geometry.dispose();
    part.material.dispose();
  });
}
