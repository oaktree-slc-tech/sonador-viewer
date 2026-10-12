// Mesh conditioning, diagnostics and repair for the 3D Selection tool (ohif-viewers#142, §12):
// what makes a cut-and-patch more likely to give back a closed, manifold surface.
//
// - conditionSurface: weld vertices within a tolerance, drop degenerate and duplicate triangles.
// - surfaceDiagnostics: open (boundary) and non-manifold edges of a triangle set.
// - cleanRim: remove ear triangles and small islands after a cut, so the rim has no pinches.
// - growSelection / shrinkSelection / largestConnectedSelection: shape a vertex selection.
// - triangleTopology, growTriangles / shrinkTriangles / largestConnectedTriangles: the same for the
//   triangle selection the 3D tools keep (ohif-viewers#142, §13).
// - earClipLoop: a flat triangulation of a boundary loop (the fallback and the small-hole closure).
// - orientPatchToRim: a patch's winding made consistent with the surface it closes.
//
// Everything is plain arrays: triangles are flat vertex-index triples.


const _key = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);

/**
 * Triangle indices from a VTK cell array (polygons with more than three points are fanned).
 */
export function polysToTriangles(polys) {
  const indices = [];
  let i = 0;
  while (i < polys.length) {
    const count = polys[i];
    if (!(count > 0) || i + count >= polys.length) {
      break;
    }
    for (let k = 2; k < count; k++) {
      indices.push(polys[i + 1], polys[i + k], polys[i + k + 1]);
    }
    i += count + 1;
  }
  return Int32Array.from(indices);
}

/**
 * Canonical vertex index for each vertex, merging vertices within `tolerance` of each other
 * (exactly equal positions when the tolerance is 0).
 *
 * @param {ArrayLike<number>} points - flat xyz
 * @param {number} [tolerance] - world units
 * @returns {Int32Array}
 */
export function weldVerticesWithin(points, tolerance = 0) {
  const count = Math.floor(points.length / 3);
  const canonical = new Int32Array(count);
  if (!(tolerance > 0)) {
    const seen = new Map();
    for (let v = 0; v < count; v++) {
      const key = `${points[3 * v]},${points[3 * v + 1]},${points[3 * v + 2]}`;
      const first = seen.get(key);
      if (first === undefined) {
        seen.set(key, v);
        canonical[v] = v;
      } else {
        canonical[v] = first;
      }
    }
    return canonical;
  }

  // Cells of the tolerance's size: a vertex within the tolerance of another lies in the same cell
  // or one of its 26 neighbours
  const cells = new Map();
  const cell = value => Math.floor(value / tolerance);
  const toleranceSquared = tolerance * tolerance;
  for (let v = 0; v < count; v++) {
    const x = points[3 * v];
    const y = points[3 * v + 1];
    const z = points[3 * v + 2];
    const cx = cell(x);
    const cy = cell(y);
    const cz = cell(z);
    let found = -1;
    for (let dx = -1; dx <= 1 && found < 0; dx++) {
      for (let dy = -1; dy <= 1 && found < 0; dy++) {
        for (let dz = -1; dz <= 1 && found < 0; dz++) {
          const bucket = cells.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!bucket) {
            continue;
          }
          for (const u of bucket) {
            const ex = points[3 * u] - x;
            const ey = points[3 * u + 1] - y;
            const ez = points[3 * u + 2] - z;
            if (ex * ex + ey * ey + ez * ez <= toleranceSquared) {
              found = u;
              break;
            }
          }
        }
      }
    }
    if (found >= 0) {
      canonical[v] = found;
    } else {
      canonical[v] = v;
      const key = `${cx},${cy},${cz}`;
      (cells.get(key) || cells.set(key, []).get(key)).push(v);
    }
  }
  return canonical;
}

/**
 * Weld a surface's vertices and drop the triangles that are degenerate or duplicates after the
 * weld.
 *
 * @param {{ points: ArrayLike<number>, polys: ArrayLike<number> }} surface
 * @param {Object} [options]
 * @param {number} [options.weldTolerance] - world units (0: exact positions)
 * @returns {{ canonical: Int32Array, triangles: Int32Array, source: Int32Array, degenerate: number,
 *   duplicate: number }} triangles in canonical vertex indices, and for each the index of the
 *   surface's triangle it came from
 */
export function conditionSurface({ points, polys }, { weldTolerance = 0 } = {}) {
  const canonical = weldVerticesWithin(points, weldTolerance);
  const raw = polysToTriangles(polys);
  const kept = [];
  const source = [];
  const seen = new Set();
  let degenerate = 0;
  let duplicate = 0;
  for (let t = 0; t < raw.length; t += 3) {
    const a = canonical[raw[t]];
    const b = canonical[raw[t + 1]];
    const c = canonical[raw[t + 2]];
    if (a === b || b === c || a === c) {
      degenerate++;
      continue;
    }
    const key = [a, b, c].sort((x, y) => x - y).join('_');
    if (seen.has(key)) {
      duplicate++;
      continue;
    }
    seen.add(key);
    kept.push(a, b, c);
    source.push(t / 3);
  }
  return { canonical, triangles: Int32Array.from(kept), source: Int32Array.from(source), degenerate, duplicate };
}

/**
 * Edge use counts of a triangle set: an edge of a closed manifold is used by exactly two
 * triangles.
 *
 * @param {ArrayLike<number>} triangles
 * @returns {Map<string, number>} keyed by the edge's sorted vertex pair
 */
export function edgeUseCounts(triangles) {
  const counts = new Map();
  for (let t = 0; t < triangles.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const key = _key(triangles[t + e], triangles[t + ((e + 1) % 3)]);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}

/**
 * The open and non-manifold edges of a triangle set.
 *
 * @param {ArrayLike<number>} triangles
 * @returns {{ boundaryEdges: Int32Array, nonManifoldEdges: Int32Array, boundaryEdgeCount: number,
 *   nonManifoldEdgeCount: number, closed: boolean }} the edge arrays are flat vertex pairs
 */
export function surfaceDiagnostics(triangles) {
  const counts = edgeUseCounts(triangles);
  const boundary = [];
  const nonManifold = [];
  counts.forEach((count, key) => {
    if (count === 2) {
      return;
    }
    const [a, b] = key.split('_').map(Number);
    (count === 1 ? boundary : nonManifold).push(a, b);
  });
  return {
    boundaryEdges: Int32Array.from(boundary),
    nonManifoldEdges: Int32Array.from(nonManifold),
    boundaryEdgeCount: boundary.length / 2,
    nonManifoldEdgeCount: nonManifold.length / 2,
    closed: !boundary.length && !nonManifold.length,
  };
}

/**
 * Remove the rim's ear triangles (two or more open edges) for a number of passes, and the islands
 * (edge-connected components of at most `islandMaxTriangles` triangles) that are not the largest
 * component. With `touching` (canonical vertex indices of the cut's rim), only triangles and
 * components that touch the rim are candidates, so cleanup never removes geometry away from the
 * edit; the vertices of removed ears join the rim for the next pass.
 *
 * @param {ArrayLike<number>} triangles
 * @param {Object} [options]
 * @param {number} [options.passes] - ear removal passes (0: none)
 * @param {number} [options.islandMaxTriangles] - largest island removed (0: none)
 * @param {Set<number>} [options.touching] - the rim; without it the whole surface is a candidate
 * @returns {{ triangles: Int32Array, removed: Int32Array, earsRemoved: number, islandsRemoved: number }}
 *   the kept triangles, and the removed ones (flat triples)
 */
export function cleanRim(triangles, { passes = 0, islandMaxTriangles = 0, touching = null } = {}) {
  let current = Int32Array.from(triangles);
  const rim = touching ? new Set(touching) : null;
  const touches = (a, b, c) => !rim || rim.has(a) || rim.has(b) || rim.has(c);
  const removedTriangles = [];
  let earsRemoved = 0;
  for (let pass = 0; pass < passes; pass++) {
    const counts = edgeUseCounts(current);
    const kept = [];
    let removed = 0;
    for (let t = 0; t < current.length; t += 3) {
      let open = 0;
      for (let e = 0; e < 3; e++) {
        if (counts.get(_key(current[t + e], current[t + ((e + 1) % 3)])) === 1) {
          open++;
        }
      }
      if (open >= 2 && touches(current[t], current[t + 1], current[t + 2])) {
        removed++;
        removedTriangles.push(current[t], current[t + 1], current[t + 2]);
        if (rim) {
          rim.add(current[t]);
          rim.add(current[t + 1]);
          rim.add(current[t + 2]);
        }
      } else {
        kept.push(current[t], current[t + 1], current[t + 2]);
      }
    }
    if (!removed) {
      break;
    }
    earsRemoved += removed;
    current = Int32Array.from(kept);
  }

  let islandsRemoved = 0;
  if (islandMaxTriangles > 0 && current.length) {
    const triangleCount = current.length / 3;
    // Triangles sharing an edge are in one component
    const byEdge = new Map();
    for (let t = 0; t < triangleCount; t++) {
      for (let e = 0; e < 3; e++) {
        const key = _key(current[3 * t + e], current[3 * t + ((e + 1) % 3)]);
        (byEdge.get(key) || byEdge.set(key, []).get(key)).push(t);
      }
    }
    const component = new Int32Array(triangleCount).fill(-1);
    const sizes = [];
    const touchesRim = [];
    for (let seed = 0; seed < triangleCount; seed++) {
      if (component[seed] >= 0) {
        continue;
      }
      const id = sizes.length;
      const stack = [seed];
      component[seed] = id;
      let size = 0;
      let touched = false;
      while (stack.length) {
        const t = stack.pop();
        size++;
        touched = touched || touches(current[3 * t], current[3 * t + 1], current[3 * t + 2]);
        for (let e = 0; e < 3; e++) {
          const key = _key(current[3 * t + e], current[3 * t + ((e + 1) % 3)]);
          byEdge.get(key).forEach(u => {
            if (component[u] < 0) {
              component[u] = id;
              stack.push(u);
            }
          });
        }
      }
      sizes.push(size);
      touchesRim.push(touched);
    }
    const largest = sizes.indexOf(Math.max(...sizes));
    const kept = [];
    const dropped = new Set();
    for (let t = 0; t < triangleCount; t++) {
      const id = component[t];
      if (id !== largest && sizes[id] <= islandMaxTriangles && touchesRim[id]) {
        dropped.add(id);
        removedTriangles.push(current[3 * t], current[3 * t + 1], current[3 * t + 2]);
      } else {
        kept.push(current[3 * t], current[3 * t + 1], current[3 * t + 2]);
      }
    }
    islandsRemoved = dropped.size;
    current = Int32Array.from(kept);
  }

  return { triangles: current, removed: Int32Array.from(removedTriangles), earsRemoved, islandsRemoved };
}

/**
 * Vertex adjacency of a triangle set.
 *
 * @param {ArrayLike<number>} triangles
 * @returns {Map<number, Set<number>>}
 */
export function vertexAdjacency(triangles) {
  const adjacency = new Map();
  const link = (a, b) => {
    (adjacency.get(a) || adjacency.set(a, new Set()).get(a)).add(b);
  };
  for (let t = 0; t < triangles.length; t += 3) {
    const [a, b, c] = [triangles[t], triangles[t + 1], triangles[t + 2]];
    link(a, b); link(b, a); link(b, c); link(c, b); link(c, a); link(a, c);
  }
  return adjacency;
}

/**
 * Topology of a surface for selection shaping: canonical vertex indices, triangles, adjacency,
 * and the raw vertices behind each canonical one.
 */
export function selectionTopology({ points, polys }) {
  const { canonical, triangles } = conditionSurface({ points, polys });
  const adjacency = vertexAdjacency(triangles);
  const members = new Map();
  for (let v = 0; v < canonical.length; v++) {
    (members.get(canonical[v]) || members.set(canonical[v], []).get(canonical[v])).push(v);
  }
  return { canonical, triangles, adjacency, members };
}

const _canonicalSet = (selected, topology) => {
  const set = new Set();
  for (const v of selected) {
    set.add(topology.canonical[v]);
  }
  return set;
};

const _rawSet = (canonicalSet, topology) => {
  const out = new Set();
  canonicalSet.forEach(c => (topology.members.get(c) || []).forEach(v => out.add(v)));
  return out;
};

/** The selection plus every vertex adjacent to it. */
export function growSelection(selected, topology) {
  const set = _canonicalSet(selected, topology);
  const grown = new Set(set);
  set.forEach(c => topology.adjacency.get(c)?.forEach(n => grown.add(n)));
  return _rawSet(grown, topology);
}

/** The selection without the vertices that have an unselected neighbour. */
export function shrinkSelection(selected, topology) {
  const set = _canonicalSet(selected, topology);
  const shrunk = new Set();
  set.forEach(c => {
    const neighbours = topology.adjacency.get(c);
    let interior = true;
    neighbours?.forEach(n => {
      if (!set.has(n)) {
        interior = false;
      }
    });
    if (interior && neighbours?.size) {
      shrunk.add(c);
    }
  });
  return _rawSet(shrunk, topology);
}

/** The connected parts of the selection (by adjacency within the selection), largest first. */
export function selectionComponents(selected, topology) {
  const set = _canonicalSet(selected, topology);
  const seen = new Set();
  const components = [];
  set.forEach(seed => {
    if (seen.has(seed)) {
      return;
    }
    const component = new Set([seed]);
    const stack = [seed];
    seen.add(seed);
    while (stack.length) {
      const c = stack.pop();
      topology.adjacency.get(c)?.forEach(n => {
        if (set.has(n) && !seen.has(n)) {
          seen.add(n);
          component.add(n);
          stack.push(n);
        }
      });
    }
    components.push(component);
  });
  return components.sort((a, b) => b.size - a.size);
}

/** The largest connected part of the selection (by adjacency within the selection). */
export function largestConnectedSelection(selected, topology) {
  const [best] = selectionComponents(selected, topology);
  return _rawSet(best || new Set(), topology);
}

/**
 * Flat triangulation of a boundary loop by ear clipping on its best-fit plane. Falls back to a fan
 * around the centroid when no ear can be found (a loop that folds over itself in projection).
 *
 * @param {ArrayLike<number>} positions - flat xyz of the loop, in order
 * @returns {{ triangles: Int32Array, method: 'flat'|'cap' }} loop-local indices, with node
 *   `count` (the centroid) appended by the fan fallback only
 */
export function earClipLoop(positions) {
  const count = positions.length / 3;
  const at = i => [positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]];
  if (count < 3) {
    return { triangles: new Int32Array(0), method: 'flat' };
  }
  if (count === 3) {
    return { triangles: Int32Array.from([0, 1, 2]), method: 'flat' };
  }

  // Newell normal and a planar frame
  const normal = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    const p = at(i);
    const q = at((i + 1) % count);
    normal[0] += (p[1] - q[1]) * (p[2] + q[2]);
    normal[1] += (p[2] - q[2]) * (p[0] + q[0]);
    normal[2] += (p[0] - q[0]) * (p[1] + q[1]);
  }
  const length = Math.hypot(normal[0], normal[1], normal[2]);
  if (!(length > 0)) {
    return _fan(count);
  }
  normal.forEach((v, d) => { normal[d] = v / length; });
  const helper = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = [
    helper[1] * normal[2] - helper[2] * normal[1],
    helper[2] * normal[0] - helper[0] * normal[2],
    helper[0] * normal[1] - helper[1] * normal[0],
  ];
  const ul = Math.hypot(u[0], u[1], u[2]);
  u.forEach((v, d) => { u[d] = v / ul; });
  const w = [
    normal[1] * u[2] - normal[2] * u[1],
    normal[2] * u[0] - normal[0] * u[2],
    normal[0] * u[1] - normal[1] * u[0],
  ];
  const x = new Float64Array(count);
  const y = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const p = at(i);
    x[i] = p[0] * u[0] + p[1] * u[1] + p[2] * u[2];
    y[i] = p[0] * w[0] + p[1] * w[1] + p[2] * w[2];
  }

  // The polygon's orientation in the frame (the Newell normal makes it counter-clockwise, but a
  // degenerate frame can flip it)
  let area = 0;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    area += x[i] * y[j] - x[j] * y[i];
  }
  const sign = area >= 0 ? 1 : -1;
  const cross = (a, b, c) => sign * ((x[b] - x[a]) * (y[c] - y[a]) - (y[b] - y[a]) * (x[c] - x[a]));
  const inside = (p, a, b, c) =>
    cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;

  const remaining = Array.from({ length: count }, (_, i) => i);
  const triangles = [];
  let guard = 0;
  while (remaining.length > 3 && guard < count * count) {
    guard++;
    let clipped = false;
    for (let k = 0; k < remaining.length; k++) {
      const a = remaining[(k + remaining.length - 1) % remaining.length];
      const b = remaining[k];
      const c = remaining[(k + 1) % remaining.length];
      if (cross(a, b, c) <= 0) {
        continue; // reflex or flat corner
      }
      let empty = true;
      for (const p of remaining) {
        if (p !== a && p !== b && p !== c && inside(p, a, b, c)) {
          empty = false;
          break;
        }
      }
      if (!empty) {
        continue;
      }
      triangles.push(a, b, c);
      remaining.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      return _fan(count);
    }
  }
  if (remaining.length === 3) {
    triangles.push(remaining[0], remaining[1], remaining[2]);
  }
  return { triangles: Int32Array.from(triangles), method: 'flat' };
}

function _fan(count) {
  const triangles = new Int32Array(count * 3);
  for (let i = 0; i < count; i++) {
    triangles.set([i, (i + 1) % count, count], 3 * i);
  }
  return { triangles, method: 'cap' };
}

/**
 * Make a patch's winding consistent with the surface around the hole it closes. A loop runs in
 * the kept triangles' winding (vertex i to i + 1), so a consistent patch must traverse each rim
 * edge the other way round; the patch is flipped when most of its rim edges run with the loop.
 *
 * @param {ArrayLike<number>} triangles - patch triangles in loop-local indices (0..n-1 the loop)
 * @param {number} loopCount
 * @returns {{ triangles: Int32Array, flipped: boolean }}
 */
export function orientPatchToRim(triangles, loopCount) {
  let along = 0;
  let against = 0;
  for (let t = 0; t < triangles.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = triangles[t + e];
      const b = triangles[t + ((e + 1) % 3)];
      if (a >= loopCount || b >= loopCount) {
        continue;
      }
      if (b === (a + 1) % loopCount) {
        along++;
      } else if (a === (b + 1) % loopCount) {
        against++;
      }
    }
  }
  if (along <= against) {
    return { triangles: Int32Array.from(triangles), flipped: false };
  }
  const flipped = new Int32Array(triangles.length);
  for (let t = 0; t < triangles.length; t += 3) {
    flipped[t] = triangles[t];
    flipped[t + 1] = triangles[t + 2];
    flipped[t + 2] = triangles[t + 1];
  }
  return { triangles: flipped, flipped: true };
}

// ---------------------------------------------------------------------------------------------------
// Triangle selections (the 3D tools' selection model)

function _csr(count, lists) {
  // Compressed rows: `lists[i]` becomes items[offsets[i] .. offsets[i + 1])
  const offsets = new Int32Array(count + 1);
  for (let i = 0; i < count; i++) {
    offsets[i + 1] = offsets[i] + (lists[i] ? lists[i].length : 0);
  }
  const items = new Int32Array(offsets[count]);
  for (let i = 0; i < count; i++) {
    if (lists[i]) {
      items.set(lists[i], offsets[i]);
    }
  }
  return { offsets, items };
}

/**
 * Topology of a surface for a triangle selection, in the surface's own triangle order (triangle t
 * is cell t of `polys`): canonical vertex indices, each triangle's canonical vertices, the
 * triangles sharing an edge with each triangle, the triangles at each canonical vertex, and the
 * raw vertices behind each canonical one. Degenerate triangles have no neighbours. Everything is
 * typed arrays (compressed rows), so it is built in a worker and handed over as it is; read it
 * with neighboursOf, trianglesAt and membersOf.
 *
 * @param {{ points, polys }} surface
 * @returns {{ canonical: Int32Array, canonicalTriangles: Int32Array, count: number,
 *   adjacency: { offsets, items }, vertexTriangles: { offsets, items }, members: { offsets, items } }}
 */
export function triangleTopology({ points, polys }) {
  const canonical = weldVerticesWithin(points, 0);
  const vertexCount = canonical.length;
  const raw = polysToTriangles(polys);
  const count = raw.length / 3;
  const canonicalTriangles = new Int32Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    canonicalTriangles[i] = canonical[raw[i]];
  }

  const edges = new Map();
  const vertexTriangles = new Array(vertexCount);
  const at = (lists, key, value) => (lists[key] || (lists[key] = [])).push(value);
  for (let t = 0; t < count; t++) {
    const a = canonicalTriangles[3 * t];
    const b = canonicalTriangles[3 * t + 1];
    const c = canonicalTriangles[3 * t + 2];
    if (a === b || b === c || a === c) {
      continue;
    }
    [[a, b], [b, c], [c, a]].forEach(([u, v]) => {
      const key = _key(u, v);
      (edges.get(key) || edges.set(key, []).get(key)).push(t);
    });
    at(vertexTriangles, a, t);
    at(vertexTriangles, b, t);
    at(vertexTriangles, c, t);
  }
  const adjacency = new Array(count);
  edges.forEach(list => {
    for (let i = 0; i < list.length; i++) {
      for (let j = 0; j < list.length; j++) {
        if (i !== j) {
          at(adjacency, list[i], list[j]);
        }
      }
    }
  });
  // A triangle sharing an edge with several others lists each once
  for (let t = 0; t < count; t++) {
    if (adjacency[t]) {
      adjacency[t] = Array.from(new Set(adjacency[t]));
    }
  }

  const members = new Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    at(members, canonical[v], v);
  }
  return {
    canonical,
    canonicalTriangles,
    count,
    adjacency: _csr(count, adjacency),
    vertexTriangles: _csr(vertexCount, vertexTriangles),
    members: _csr(vertexCount, members),
  };
}

const _row = ({ offsets, items }, i) => (i >= 0 && i + 1 < offsets.length
  ? items.subarray(offsets[i], offsets[i + 1])
  : items.subarray(0, 0));

/** The triangles sharing an edge with triangle `t`. */
export const neighboursOf = (topology, t) => _row(topology.adjacency, t);

/** The triangles at canonical vertex `c`. */
export const trianglesAt = (topology, c) => _row(topology.vertexTriangles, c);

/** The raw vertices behind canonical vertex `c`. */
export const membersOf = (topology, c) => _row(topology.members, c);

/** The raw vertex indices of a triangle selection. */
export function trianglesVertices(selectedTriangles, polys) {
  const vertices = new Set();
  for (const t of selectedTriangles) {
    vertices.add(polys[4 * t + 1]);
    vertices.add(polys[4 * t + 2]);
    vertices.add(polys[4 * t + 3]);
  }
  return vertices;
}

/** The triangles touching any of the given raw vertices. */
export function trianglesTouchingVertices(selectedVertices, topology) {
  const out = new Set();
  for (const v of selectedVertices) {
    trianglesAt(topology, topology.canonical[v]).forEach(t => out.add(t));
  }
  return out;
}

/** The selection plus every triangle sharing an edge with it. */
export function growTriangles(selected, topology) {
  const grown = new Set(selected);
  for (const t of selected) {
    neighboursOf(topology, t).forEach(n => grown.add(n));
  }
  return grown;
}

/** The selection without the triangles that have an unselected edge neighbour. */
export function shrinkTriangles(selected, topology) {
  const set = new Set(selected);
  const shrunk = new Set();
  set.forEach(t => {
    const neighbours = neighboursOf(topology, t);
    let interior = neighbours.length > 0;
    neighbours.forEach(n => {
      if (!set.has(n)) {
        interior = false;
      }
    });
    if (interior) {
      shrunk.add(t);
    }
  });
  return shrunk;
}

/** The edge-connected parts of a triangle selection, largest first. */
export function triangleComponents(selected, topology) {
  const set = new Set(selected);
  const seen = new Set();
  const components = [];
  set.forEach(seed => {
    if (seen.has(seed)) {
      return;
    }
    const component = new Set([seed]);
    const stack = [seed];
    seen.add(seed);
    while (stack.length) {
      const t = stack.pop();
      neighboursOf(topology, t).forEach(n => {
        if (set.has(n) && !seen.has(n)) {
          seen.add(n);
          component.add(n);
          stack.push(n);
        }
      });
    }
    components.push(component);
  });
  return components.sort((a, b) => b.size - a.size);
}

/** The largest edge-connected part of a triangle selection. */
export function largestConnectedTriangles(selected, topology) {
  const [best] = triangleComponents(selected, topology);
  return best || new Set();
}
