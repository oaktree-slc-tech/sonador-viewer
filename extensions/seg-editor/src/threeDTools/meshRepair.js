// Mesh conditioning, diagnostics and repair for the 3D Selection tool (ohif-viewers#142, §12):
// what makes a cut-and-patch more likely to give back a closed, manifold surface.
//
// - conditionSurface: weld vertices within a tolerance, drop degenerate and duplicate triangles.
//   A positive tolerance is kept only when it preserves the surface (ohif-viewers#149, FR-2);
//   otherwise the exact weld is used and the fallback reported.
// - surfaceDiagnostics: open (boundary), non-manifold and inconsistently wound edges of a
//   triangle set (ohif-viewers#149, FR-3).
// - writtenSurfaceDiagnostics: the same for a surface exactly as the voxelizer receives it (every
//   face, duplicates included, coincident positions as one vertex, no tolerance), which decides
//   whether an edit that keeps its input's faces may be written (FR-4).
// - edgeStatistics: the length percentiles the weld cap and relative settings are derived from.
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

function _condition(points, raw, weldTolerance) {
  const canonical = weldVerticesWithin(points, weldTolerance);
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

/** The number of vertex-connected components of a triangle set. */
export function triangleComponentCount(triangles) {
  const parent = new Map();
  const find = v => {
    let root = v;
    while (parent.get(root) !== root) {
      root = parent.get(root);
    }
    while (parent.get(v) !== root) {
      const next = parent.get(v);
      parent.set(v, root);
      v = next;
    }
    return root;
  };
  const union = (a, b) => {
    if (!parent.has(a)) {
      parent.set(a, a);
    }
    if (!parent.has(b)) {
      parent.set(b, b);
    }
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      parent.set(ra, rb);
    }
  };
  for (let t = 0; t < triangles.length; t += 3) {
    union(triangles[t], triangles[t + 1]);
    union(triangles[t + 1], triangles[t + 2]);
  }
  let count = 0;
  parent.forEach((_, v) => {
    if (find(v) === v) {
      count++;
    }
  });
  return count;
}

function _normalOf(points, a, b, c, out) {
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

// A kept triangle whose normal shrinks to this fraction of its source's has lost its area: three
// distinct canonical vertices that became collinear. Relative to the triangle's own area, so the
// test holds at any scale; a source triangle with no area is not sound and is not counted.
const COLLAPSE_RATIO = 1e-9;

/**
 * Whether a toleranced weld preserved the surface's sound geometry (ohif-viewers#149, FR-2): no
 * triangle beyond the exact weld's degenerates and duplicates was dropped, no kept triangle lost
 * its area (three distinct vertices welded onto a line are not an index degeneracy, so the kept
 * count alone misses them) or had its normal turned over against its source cell, and no
 * component was merged into another. A percentile-based cap alone cannot promise this: a tiny
 * valid component below the tolerance collapses while the edge counts still look healthy.
 */
export function checkConditioningPreserved(points, raw, exact, toleranced) {
  const before = [0, 0, 0];
  const after = [0, 0, 0];
  let flipped = 0;
  let collapsed = 0;
  const { triangles, source } = toleranced;
  for (let t = 0; t < triangles.length; t += 3) {
    const cell = 3 * source[t / 3];
    _normalOf(points, raw[cell], raw[cell + 1], raw[cell + 2], before);
    _normalOf(points, triangles[t], triangles[t + 1], triangles[t + 2], after);
    const areaBefore = Math.hypot(before[0], before[1], before[2]);
    const areaAfter = Math.hypot(after[0], after[1], after[2]);
    if (areaBefore > 0 && areaAfter <= COLLAPSE_RATIO * areaBefore) {
      collapsed++;
    } else if (before[0] * after[0] + before[1] * after[1] + before[2] * after[2] < 0) {
      flipped++;
    }
  }
  const componentsBefore = triangleComponentCount(exact.triangles);
  const componentsAfter = triangleComponentCount(triangles);
  const report = {
    extraDegenerate: toleranced.degenerate - exact.degenerate,
    extraDuplicate: toleranced.duplicate - exact.duplicate,
    collapsed,
    flipped,
    componentsBefore,
    componentsAfter,
  };
  const preserved = report.extraDegenerate === 0 && report.extraDuplicate === 0 && collapsed === 0
    && flipped === 0 && componentsAfter === componentsBefore;
  return { preserved, report };
}

/**
 * Weld a surface's vertices and drop the triangles that are degenerate or duplicates after the
 * weld. A positive tolerance is applied only when it preserves the surface
 * (checkConditioningPreserved); otherwise the exact weld's result is returned with `fellBack`
 * set, so a tolerance can never silently decimate the surface. The exact weld's degenerate and
 * duplicate counts are the pre-existing ones, reported apart from anything an action removes.
 *
 * @param {{ points: ArrayLike<number>, polys: ArrayLike<number> }} surface
 * @param {Object} [options]
 * @param {number} [options.weldTolerance] - world units (0: exact positions)
 * @returns {{ canonical: Int32Array, triangles: Int32Array, source: Int32Array, degenerate: number,
 *   duplicate: number, effectiveWeldTolerance: number, requestedWeldTolerance: number,
 *   preserved: boolean, fellBack: boolean, preservation: Object|null }} triangles in canonical
 *   vertex indices, and for each the index of the surface's triangle it came from
 */
export function conditionSurface({ points, polys }, { weldTolerance = 0 } = {}) {
  const raw = polysToTriangles(polys);
  const requested = Number.isFinite(weldTolerance) && weldTolerance > 0 ? weldTolerance : 0;
  const exact = _condition(points, raw, 0);
  if (!requested) {
    return {
      ...exact, effectiveWeldTolerance: 0, requestedWeldTolerance: 0, preserved: true, fellBack: false, preservation: null,
    };
  }
  const toleranced = _condition(points, raw, requested);
  const { preserved, report } = checkConditioningPreserved(points, raw, exact, toleranced);
  if (!preserved) {
    return {
      ...exact, effectiveWeldTolerance: 0, requestedWeldTolerance: requested, preserved: false, fellBack: true, preservation: report,
    };
  }
  return {
    ...toleranced, effectiveWeldTolerance: requested, requestedWeldTolerance: requested, preserved: true, fellBack: false, preservation: report,
  };
}

const _positionKey = (points, v) => `${points[3 * v]},${points[3 * v + 1]},${points[3 * v + 2]}`;

function _edgePositionKeys(points, edges) {
  const keys = new Set();
  for (let e = 0; e < edges.length; e += 2) {
    const a = _positionKey(points, edges[e]);
    const b = _positionKey(points, edges[e + 1]);
    keys.add(a < b ? `${a}|${b}` : `${b}|${a}`);
  }
  return keys;
}

/**
 * The defects of a result that its input did not have (ohif-viewers#149, FR-4/FR-5): the output's
 * boundary, non-manifold and inconsistent edges whose two endpoint positions were not such an
 * edge of the input. Edges are compared by position because the result is renumbered; kept
 * vertices and loop vertices keep their positions exactly. Pre-existing openings an edit left
 * alone are therefore retained, not introduced.
 *
 * @param {{ points: ArrayLike<number>, diagnostics: Object }} input - surfaceDiagnostics of the
 *   input, with the points its edge indices refer to
 * @param {{ points: ArrayLike<number>, diagnostics: Object }} output - likewise for the result
 * @returns {{ boundaryEdgeCount: number, nonManifoldEdgeCount: number, inconsistentEdgeCount: number,
 *   total: number, retained: { boundaryEdgeCount, nonManifoldEdgeCount, inconsistentEdgeCount } }}
 */
export function compareDefects(input, output) {
  const kinds = [
    ['boundaryEdgeCount', 'boundaryEdges'],
    ['nonManifoldEdgeCount', 'nonManifoldEdges'],
    ['inconsistentEdgeCount', 'inconsistentEdges'],
  ];
  const introduced = { total: 0, retained: {} };
  kinds.forEach(([countKey, edgesKey]) => {
    const before = _edgePositionKeys(input.points, input.diagnostics?.[edgesKey] || []);
    const after = _edgePositionKeys(output.points, output.diagnostics?.[edgesKey] || []);
    let count = 0;
    after.forEach(key => {
      if (!before.has(key)) {
        count++;
      }
    });
    introduced[countKey] = count;
    introduced.retained[countKey] = after.size - count;
    introduced.total += count;
  });
  return introduced;
}

// Above this many unique edges the length percentiles are taken from an evenly strided sample
export const EDGE_STATISTICS_SAMPLE_LIMIT = 200000;

/**
 * Length statistics of a triangle set's unique edges (ohif-viewers#149 FR-1, #151 FR-3/FR-4):
 * the first percentile the weld cap is a fraction of, the median, and the mean. Computed once per
 * surface version with the health diagnostics; sampled above EDGE_STATISTICS_SAMPLE_LIMIT edges,
 * which the result says.
 *
 * @param {ArrayLike<number>} points - flat xyz
 * @param {ArrayLike<number>} triangles - flat vertex triples (canonical or raw indices)
 * @param {Object} [options]
 * @param {number} [options.sampleLimit]
 * @returns {{ edgeCount: number, sampleSize: number, sampled: boolean, p1: number|null,
 *   p50: number|null, mean: number|null }} null statistics when there is no edge
 */
export function edgeStatistics(points, triangles, { sampleLimit = EDGE_STATISTICS_SAMPLE_LIMIT } = {}) {
  const seen = new Set();
  const lengths = [];
  for (let t = 0; t < triangles.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = triangles[t + e];
      const b = triangles[t + ((e + 1) % 3)];
      if (a === b) {
        continue;
      }
      const key = _key(a, b);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      lengths.push(Math.hypot(
        points[3 * a] - points[3 * b], points[3 * a + 1] - points[3 * b + 1], points[3 * a + 2] - points[3 * b + 2]));
    }
  }
  const edgeCount = lengths.length;
  if (!edgeCount) {
    return { edgeCount: 0, sampleSize: 0, sampled: false, p1: null, p50: null, mean: null };
  }
  let sample = lengths;
  if (edgeCount > sampleLimit) {
    const stride = edgeCount / sampleLimit;
    sample = [];
    for (let i = 0; i < sampleLimit; i++) {
      sample.push(lengths[Math.floor(i * stride)]);
    }
  }
  const sorted = Float64Array.from(sample).sort();
  const rank = percentile => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1))];
  let total = 0;
  for (let i = 0; i < sorted.length; i++) {
    total += sorted[i];
  }
  return {
    edgeCount,
    sampleSize: sorted.length,
    sampled: sorted.length < edgeCount,
    p1: rank(1),
    p50: rank(50),
    mean: total / sorted.length,
  };
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
 * The open, non-manifold and inconsistently wound edges of a triangle set (ohif-viewers#149,
 * FR-3). The half-edges are counted by direction in the same pass as the edge uses: an edge used
 * by exactly two triangles is inconsistent when both traverse it the same way (one of the two
 * faces is wound the wrong way round). `closed` requires all three counts to be zero. That is
 * necessary for a valid solid, not sufficient: vertex fans, self-intersection and component
 * orientation are not examined here.
 *
 * @param {ArrayLike<number>} triangles
 * @returns {{ boundaryEdges: Int32Array, nonManifoldEdges: Int32Array, inconsistentEdges: Int32Array,
 *   boundaryEdgeCount: number, nonManifoldEdgeCount: number, inconsistentEdgeCount: number,
 *   closed: boolean }} the edge arrays are flat vertex pairs
 */
export function surfaceDiagnostics(triangles) {
  const counts = new Map();
  const directed = new Set();
  for (let t = 0; t < triangles.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = triangles[t + e];
      const b = triangles[t + ((e + 1) % 3)];
      const key = _key(a, b);
      counts.set(key, (counts.get(key) || 0) + 1);
      directed.add(`${a}>${b}`);
    }
  }
  const boundary = [];
  const nonManifold = [];
  const inconsistent = [];
  counts.forEach((count, key) => {
    const [a, b] = key.split('_').map(Number);
    if (count === 1) {
      boundary.push(a, b);
    } else if (count > 2) {
      nonManifold.push(a, b);
    } else if (!directed.has(`${a}>${b}`) || !directed.has(`${b}>${a}`)) {
      inconsistent.push(a, b);
    }
  });
  return {
    boundaryEdges: Int32Array.from(boundary),
    nonManifoldEdges: Int32Array.from(nonManifold),
    inconsistentEdges: Int32Array.from(inconsistent),
    boundaryEdgeCount: boundary.length / 2,
    nonManifoldEdgeCount: nonManifold.length / 2,
    inconsistentEdgeCount: inconsistent.length / 2,
    closed: !boundary.length && !nonManifold.length && !inconsistent.length,
  };
}

/**
 * The diagnosis of a surface as the voxelizer receives it (ohif-viewers#149, FR-4): the edge
 * counts of the faces a labelmap write would be computed from, not of a conditioned copy. Vertices
 * at exactly the same position are one vertex (the ray test sees positions, not indices), every
 * face is counted, duplicates included (a ray crosses a duplicated face twice, so the parity, and
 * the voxels, behind it are wrong), and only the faces with two coincident corners are left out,
 * counted as `degenerate` (they have no area in any projection, so no ray crosses them). Nothing
 * is welded within a tolerance and no duplicate is dropped, so a defect that `conditionSurface`
 * followed by `surfaceDiagnostics` hides (a duplicate face, a seam a developer weld closes) is
 * counted here. An edit that writes its input's faces unchanged (a smooth) is gated on this.
 *
 * @param {{ points: ArrayLike<number>, polys: ArrayLike<number> }} surface
 * @returns {Object} surfaceDiagnostics of the written faces (edges in canonical vertex indices),
 *   plus `degenerate` and the `triangles` counted
 */
export function writtenSurfaceDiagnostics({ points, polys }) {
  const raw = polysToTriangles(polys);
  const canonical = weldVerticesWithin(points, 0);
  const kept = [];
  let degenerate = 0;
  for (let t = 0; t < raw.length; t += 3) {
    const a = canonical[raw[t]];
    const b = canonical[raw[t + 1]];
    const c = canonical[raw[t + 2]];
    if (a === b || b === c || a === c) {
      degenerate++;
      continue;
    }
    kept.push(a, b, c);
  }
  return { ...surfaceDiagnostics(kept), degenerate, triangles: kept.length / 3 };
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
