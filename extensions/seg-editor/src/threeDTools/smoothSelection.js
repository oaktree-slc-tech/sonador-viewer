// Smooth of the 3D selection (ohif-viewers#148, FR-7..FR-9): Taubin smoothing of the selected
// region of a segment's surface, with the region's boundary pinned so the result blends into its
// neighbours. The topology is unchanged (the same vertices, order and triangles), so the selection
// survives the edit and the labelmap write is a plain inside / outside delta of the two surfaces.
//
// The pass runs on the welded vertex set: coincident vertices (a marching-cubes surface repeats
// them) move together, so no triangle tears open. Plain data in and out, so it runs in the carve
// worker.

import { selectionTopology, trianglesAt, triangleTopology } from './meshRepair.js';


export const SMOOTH_OPTION_DEFAULTS = Object.freeze({
  // Laplacian step (lambda); the shrinking step that follows it is -(lambda + MU_OFFSET)
  strength: 0.5,
  passes: 3,
  // The boundary ring moves at half weight, so the transition is not creased
  feather: true,
});

const MU_OFFSET = 0.03;

function _bounds(points, indices, into) {
  indices.forEach(v => {
    for (let d = 0; d < 3; d++) {
      into.min[d] = Math.min(into.min[d], points[3 * v + d]);
      into.max[d] = Math.max(into.max[d], points[3 * v + d]);
    }
  });
  return into;
}

function _normal(points, a, b, c, out) {
  const ax = points[3 * a];
  const ay = points[3 * a + 1];
  const az = points[3 * a + 2];
  const ux = points[3 * b] - ax;
  const uy = points[3 * b + 1] - ay;
  const uz = points[3 * b + 2] - az;
  const vx = points[3 * c] - ax;
  const vy = points[3 * c + 1] - ay;
  const vz = points[3 * c + 2] - az;
  out[0] = uy * vz - uz * vy;
  out[1] = uz * vx - ux * vz;
  out[2] = ux * vy - uy * vx;
  return out;
}

/**
 * Which canonical vertices a smooth of the selection moves, and at what weight. A vertex
 * selection's interior is the vertices with no unselected neighbour; a triangle selection's
 * interior is the vertices all of whose triangles are selected. The rest of the selected vertices
 * are the boundary ring.
 *
 * @param {Iterable<number>} selected - raw vertex indices (ignored with `selectedTriangles`)
 * @param {{ canonical, adjacency }} topology - selectionTopology
 * @param {boolean} feather - the boundary ring moves at half weight (else it is pinned)
 * @param {Object} [faces]
 * @param {Iterable<number>} [faces.selectedTriangles] - selected triangles (cells of `polys`)
 * @param {Object} [faces.triangleTopology] - triangleTopology of the surface
 * @returns {{ interior: Set<number>, boundary: Set<number>, weights: Map<number, number> }}
 */
export function smoothRegion(selected, topology, feather = true, faces = null) {
  const interior = new Set();
  const boundary = new Set();
  if (faces?.selectedTriangles) {
    const { canonicalTriangles } = faces.triangleTopology;
    const cells = new Set(faces.selectedTriangles);
    const vertices = new Set();
    cells.forEach(t => {
      vertices.add(canonicalTriangles[3 * t]);
      vertices.add(canonicalTriangles[3 * t + 1]);
      vertices.add(canonicalTriangles[3 * t + 2]);
    });
    vertices.forEach(c => {
      const around = trianglesAt(faces.triangleTopology, c);
      if (!around.length || !topology.adjacency.get(c)?.size) {
        return;
      }
      (around.every(t => cells.has(t)) ? interior : boundary).add(c);
    });
  } else {
    const set = new Set();
    for (const v of selected) {
      set.add(topology.canonical[v]);
    }
    set.forEach(c => {
      const neighbours = topology.adjacency.get(c);
      if (!neighbours?.size) {
        return;
      }
      let inside = true;
      neighbours.forEach(n => {
        if (!set.has(n)) {
          inside = false;
        }
      });
      (inside ? interior : boundary).add(c);
    });
  }
  const weights = new Map();
  interior.forEach(c => weights.set(c, 1));
  if (feather) {
    boundary.forEach(c => weights.set(c, 0.5));
  }
  return { interior, boundary, weights };
}

/**
 * Smooth the selected region of a surface.
 *
 * @param {Object} params
 * @param {{ points: ArrayLike<number>, polys: ArrayLike<number> }} params.surface
 * @param {Iterable<number>} [params.selected] - raw vertex indices of the surface
 * @param {Iterable<number>} [params.selectedTriangles] - selected triangles (cells of `polys`),
 *   used instead of `selected` when given
 * @param {Object} [params.options] - SMOOTH_OPTION_DEFAULTS
 * @param {Object} [params.topology] - selectionTopology of the surface, when the caller has it
 * @returns {{ changed: boolean, after: { points: Float32Array, polys }|null, editBox: Object|null,
 *   moved: number, maxDisplacement: number, flipped: number, degenerate: number }}
 *   `after` reuses the surface's `polys`; `moved` counts the vertices the pass moves (interior,
 *   plus the boundary ring when feathering); `flipped` and `degenerate` count the triangles of
 *   the region whose normal turned over or vanished, which a caller should treat as a failed pass
 */
export function smoothSurface({ surface, selected = [], selectedTriangles, options = {}, topology }) {
  const opts = { ...SMOOTH_OPTION_DEFAULTS, ...options };
  const lambda = Math.min(0.9, Math.max(0.1, Number(opts.strength) || SMOOTH_OPTION_DEFAULTS.strength));
  const mu = -(lambda + MU_OFFSET);
  const passes = Math.max(1, Math.round(Number(opts.passes) || SMOOTH_OPTION_DEFAULTS.passes));
  const topo = topology || selectionTopology(surface);
  const { adjacency, members, triangles } = topo;
  const faces = selectedTriangles
    ? { selectedTriangles, triangleTopology: triangleTopology(surface) }
    : null;
  const { weights } = smoothRegion(selected, topo, !!opts.feather, faces);

  const none = {
    changed: false, after: null, editBox: null, moved: 0, maxDisplacement: 0, flipped: 0, degenerate: 0,
  };
  if (!weights.size) {
    return none;
  }

  // Positions per canonical vertex (its first raw vertex's), smoothed in place
  const { points } = surface;
  const position = new Float64Array(points.length);
  position.set(points);
  const moving = Array.from(weights.keys());
  const step = factor => {
    const next = new Map();
    moving.forEach(c => {
      const neighbours = adjacency.get(c);
      let mx = 0;
      let my = 0;
      let mz = 0;
      neighbours.forEach(n => {
        mx += position[3 * n];
        my += position[3 * n + 1];
        mz += position[3 * n + 2];
      });
      const k = (factor * weights.get(c)) / neighbours.size;
      next.set(c, [
        position[3 * c] + k * (mx - neighbours.size * position[3 * c]),
        position[3 * c + 1] + k * (my - neighbours.size * position[3 * c + 1]),
        position[3 * c + 2] + k * (mz - neighbours.size * position[3 * c + 2]),
      ]);
    });
    next.forEach(([x, y, z], c) => {
      position[3 * c] = x;
      position[3 * c + 1] = y;
      position[3 * c + 2] = z;
    });
  };
  for (let pass = 0; pass < passes; pass++) {
    step(lambda);
    step(mu);
  }

  // Write the smoothed positions back to every raw vertex of each canonical one
  const after = Float32Array.from(points);
  let maxDisplacement = 0;
  const movedRaw = [];
  moving.forEach(c => {
    const dx = position[3 * c] - points[3 * c];
    const dy = position[3 * c + 1] - points[3 * c + 1];
    const dz = position[3 * c + 2] - points[3 * c + 2];
    maxDisplacement = Math.max(maxDisplacement, Math.hypot(dx, dy, dz));
    (members.get(c) || [c]).forEach(v => {
      after[3 * v] = position[3 * c];
      after[3 * v + 1] = position[3 * c + 1];
      after[3 * v + 2] = position[3 * c + 2];
      movedRaw.push(v);
    });
  });

  // Triangles of the region: a normal turned over or vanished means the pass went wrong
  let flipped = 0;
  let degenerate = 0;
  const before = [0, 0, 0];
  const now = [0, 0, 0];
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t];
    const b = triangles[t + 1];
    const c = triangles[t + 2];
    if (!weights.has(a) && !weights.has(b) && !weights.has(c)) {
      continue;
    }
    _normal(points, a, b, c, before);
    _normal(position, a, b, c, now);
    const length = Math.hypot(now[0], now[1], now[2]);
    if (length < 1e-12 * Math.max(1, Math.hypot(before[0], before[1], before[2]))) {
      degenerate++;
    } else if (before[0] * now[0] + before[1] * now[1] + before[2] * now[2] < 0) {
      flipped++;
    }
  }

  const editBox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  _bounds(points, movedRaw, editBox);
  _bounds(after, movedRaw, editBox);

  return {
    changed: true,
    after: { points: after, polys: surface.polys },
    editBox,
    moved: moving.length,
    maxDisplacement,
    flipped,
    degenerate,
  };
}

export default smoothSurface;
