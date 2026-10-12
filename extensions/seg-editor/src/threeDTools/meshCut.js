// Mesh operations behind the 3D Selection tool's delete (ohif-viewers#142, FR-20): remove the
// triangles touching the selected vertices, find the holes this opens, and stitch patches into
// those holes so the result is closed again.
//
// Surfaces are Cornerstone3D surface data: `points` is a flat [x, y, z, ...] array and `polys` a
// VTK cell array. Everything here is plain arrays and runs on the main thread; only fitting the
// patch surfaces (OpenCascade) runs in a worker.

/**
 * Triangle indices from a VTK cell array (polygons with more than three points are fanned). The
 * same conversion as the M3D viewer's polysToTriangleIndices, kept local so the geometry here has
 * no dependencies.
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
 * Merge vertices that share a position, so triangles that meet along an edge share its vertex
 * indices. Marching cubes output is normally welded already; this makes the edge bookkeeping
 * independent of that.
 *
 * @param {ArrayLike<number>} points - flat xyz
 * @returns {Int32Array} canonical vertex index for each vertex
 */
export function weldVertices(points) {
  const count = Math.floor(points.length / 3);
  const canonical = new Int32Array(count);
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

/**
 * Remove every triangle that touches a selected vertex.
 *
 * @param {Object} params
 * @param {ArrayLike<number>} params.points - flat xyz
 * @param {ArrayLike<number>} params.polys - VTK cell array
 * @param {Iterable<number>} params.selected - selected vertex indices
 * @returns {{ triangles: Int32Array, removedCount: number }} kept triangles (welded indices)
 */
export function cutSurface({ points, polys, selected }) {
  const canonical = weldVertices(points);
  const selectedCanonical = new Set();
  for (const v of selected) {
    selectedCanonical.add(canonical[v]);
  }

  const source = polysToTriangles(polys);
  const kept = [];
  let removedCount = 0;
  for (let t = 0; t < source.length; t += 3) {
    const a = canonical[source[t]];
    const b = canonical[source[t + 1]];
    const c = canonical[source[t + 2]];
    if (a === b || b === c || a === c) {
      continue; // degenerate after welding
    }
    if (selectedCanonical.has(a) || selectedCanonical.has(b) || selectedCanonical.has(c)) {
      removedCount++;
    } else {
      kept.push(a, b, c);
    }
  }

  return { triangles: Int32Array.from(kept), removedCount };
}

/**
 * The boundary loops of a triangle mesh, with the open edges no loop could use.
 *
 * Each loop follows the rim edges (edges used by one triangle) in the winding of the triangles
 * around it. Where the rim touches itself (a vertex with several rim edges leaving it) the next
 * edge is the one reached by rotating around the vertex through the kept triangles, so two holes
 * that share a vertex give two loops. A loop that still comes back to a vertex it holds (a
 * non-manifold junction) is split there. A rim edge whose walk reaches a dead end (non-manifold
 * input) is reported as open and left out.
 *
 * @param {ArrayLike<number>} triangles - flat triangle vertex indices
 * @returns {{ loops: number[][], openEdges: number }} loops of vertex indices (first vertex not
 *   repeated)
 */
export function findBoundaryLoopsDetailed(triangles) {
  const halfEdges = new Map(); // "a>b" -> triangle index (first one, for non-manifold input)
  const triangleCount = triangles.length / 3;
  for (let t = 0; t < triangleCount; t++) {
    for (let e = 0; e < 3; e++) {
      const key = `${triangles[3 * t + e]}>${triangles[3 * t + ((e + 1) % 3)]}`;
      if (!halfEdges.has(key)) {
        halfEdges.set(key, t);
      }
    }
  }
  const vertexAfter = (t, v) => {
    for (let e = 0; e < 3; e++) {
      if (triangles[3 * t + e] === v) {
        return triangles[3 * t + ((e + 1) % 3)];
      }
    }
    return -1;
  };

  // Rim half-edges, keyed by their start vertex
  const rim = new Set();
  halfEdges.forEach((t, key) => {
    const [a, b] = key.split('>');
    if (!halfEdges.has(`${b}>${a}`)) {
      rim.add(key);
    }
  });

  // The rim half-edge leaving `v` in the fan of triangles that contains the arrival triangle `t`
  const nextAround = (v, t) => {
    const visited = new Set();
    let current = t;
    while (current !== undefined && !visited.has(current)) {
      visited.add(current);
      const w = vertexAfter(current, v);
      if (w < 0) {
        return null;
      }
      const twin = halfEdges.get(`${w}>${v}`);
      if (twin === undefined) {
        const key = `${v}>${w}`;
        return rim.has(key) ? key : null;
      }
      current = twin;
    }
    return null;
  };

  const loops = [];
  const used = new Set();
  let openEdges = 0;
  rim.forEach(startKey => {
    if (used.has(startKey)) {
      return;
    }
    const chain = [];
    let key = startKey;
    let closed = false;
    while (key && !used.has(key)) {
      used.add(key);
      const [a, b] = key.split('>').map(Number);
      chain.push(a);
      const next = nextAround(b, halfEdges.get(key));
      if (next === startKey) {
        closed = true;
        break;
      }
      key = next;
    }
    if (!closed) {
      openEdges += chain.length;
      return;
    }
    // Split at repeated vertices
    const seen = new Map();
    let loop = [];
    for (const v of chain) {
      if (seen.has(v)) {
        const at = seen.get(v);
        const inner = loop.slice(at);
        if (inner.length >= 3) {
          loops.push(inner);
        }
        loop = loop.slice(0, at);
        seen.clear();
        loop.forEach((u, i) => seen.set(u, i));
      }
      seen.set(v, loop.length);
      loop.push(v);
    }
    if (loop.length >= 3) {
      loops.push(loop);
    }
  });
  return { loops, openEdges };
}

/**
 * The boundary loops of a triangle mesh (findBoundaryLoopsDetailed without the open edge count).
 *
 * @param {ArrayLike<number>} triangles
 * @returns {number[][]}
 */
export function findBoundaryLoops(triangles) {
  return findBoundaryLoopsDetailed(triangles).loops;
}

const _position = (points, v) => [points[3 * v], points[3 * v + 1], points[3 * v + 2]];
const _distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Positions of a loop as a flat xyz array.
 *
 * @param {ArrayLike<number>} points
 * @param {number[]} loop
 * @returns {Float64Array}
 */
export function loopPositions(points, loop) {
  const flat = new Float64Array(loop.length * 3);
  loop.forEach((v, i) => flat.set(_position(points, v), 3 * i));
  return flat;
}

/**
 * Pick at most `maxCount` loop positions, spread evenly along the loop's length: the constraint
 * vertices the patch surface is fitted to. Fitting cost grows quickly with the number of boundary
 * edges; the vertices in between are stitched to the patch afterwards (stitchPatch).
 *
 * @param {Float64Array} positions - flat xyz of the loop
 * @param {number} maxCount
 * @returns {number[]} indices into the loop, ascending, starting at 0
 */
export function sampleLoop(positions, maxCount) {
  const count = positions.length / 3;
  if (count <= maxCount) {
    return Array.from({ length: count }, (_, i) => i);
  }

  const cumulative = new Float64Array(count + 1);
  for (let i = 0; i < count; i++) {
    const a = [positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]];
    const j = (i + 1) % count;
    const b = [positions[3 * j], positions[3 * j + 1], positions[3 * j + 2]];
    cumulative[i + 1] = cumulative[i] + _distance(a, b);
  }
  const total = cumulative[count];

  const picked = [0];
  let i = 0;
  for (let k = 1; k < maxCount; k++) {
    const target = (total * k) / maxCount;
    while (i < count && cumulative[i] < target) {
      i++;
    }
    if (i < count && i > picked[picked.length - 1]) {
      picked.push(i);
    }
  }
  return picked;
}

/**
 * Close a hole with a fan of triangles around its centroid: the fallback when no smooth patch
 * could be fitted.
 *
 * @param {Float64Array} positions - flat xyz of the loop
 * @returns {{ points: Float64Array, triangles: Int32Array }} patch in local indices; nodes
 *   0..n-1 are the loop vertices, node n is the centroid
 */
export function fanCap(positions) {
  const count = positions.length / 3;
  const points = new Float64Array((count + 1) * 3);
  points.set(positions);
  const centroid = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    for (let d = 0; d < 3; d++) {
      centroid[d] += positions[3 * i + d] / count;
    }
  }
  points.set(centroid, count * 3);

  const triangles = new Int32Array(count * 3);
  for (let i = 0; i < count; i++) {
    triangles.set([i, (i + 1) % count, count], 3 * i);
  }
  return { points, triangles };
}

/** Boundary loop of a patch mesh as an ordered list of its node indices. */
function _patchBoundary(triangles) {
  const loops = findBoundaryLoops(triangles);
  if (loops.length !== 1) {
    return null;
  }
  return loops[0];
}

/**
 * Join a fitted patch to the hole it closes.
 *
 * The patch was fitted to a subset of the loop's vertices (`constraintIndices`), so its boundary
 * runs through those vertices along straight chords, possibly with extra nodes on the chords. The
 * loop vertices in between lie off the chords. Each span between two constraint vertices is
 * closed with a strip of triangles zipping the loop's vertices to the chord's nodes, ordered by
 * their position along the span, so the result has no gaps along the seam.
 *
 * @param {Object} params
 * @param {Float64Array} params.loopPoints - flat xyz of the hole's loop
 * @param {number[]} params.constraintIndices - loop indices the patch was fitted to (ascending)
 * @param {Float64Array} params.patchPoints - flat xyz of the patch nodes
 * @param {Int32Array} params.patchTriangles - patch triangles (patch node indices)
 * @param {number} [params.tolerance] - distance within which a patch node is a constraint vertex
 * @returns {{ points: Float64Array, triangles: Int32Array }|null} the joined patch in loop-local
 *   indices: nodes 0..n-1 are the loop vertices, later nodes are the patch's own; null when the
 *   patch boundary does not match the loop (the caller falls back to a fan cap)
 */
export function stitchPatch({ loopPoints, constraintIndices, patchPoints, patchTriangles, tolerance }) {
  const loopCount = loopPoints.length / 3;
  const patchCount = patchPoints.length / 3;
  const loopAt = i => [loopPoints[3 * i], loopPoints[3 * i + 1], loopPoints[3 * i + 2]];
  const patchAt = i => [patchPoints[3 * i], patchPoints[3 * i + 1], patchPoints[3 * i + 2]];

  const boundary = _patchBoundary(patchTriangles);
  if (!boundary) {
    return null;
  }

  if (tolerance === undefined) {
    let extent = 0;
    for (let i = 0; i < loopCount; i++) {
      extent = Math.max(extent, _distance(loopAt(i), loopAt(0)));
    }
    tolerance = Math.max(extent * 1e-6, 1e-9);
  }

  // Patch node -> constraint (loop index)
  const nodeToLoop = new Map();
  for (const node of boundary) {
    const p = patchAt(node);
    for (const loopIndex of constraintIndices) {
      if (_distance(p, loopAt(loopIndex)) <= tolerance) {
        nodeToLoop.set(node, loopIndex);
        break;
      }
    }
  }
  if (nodeToLoop.size !== constraintIndices.length) {
    return null;
  }

  // Walk the patch boundary in the loop's direction, starting at the first constraint vertex
  let order = boundary.slice();
  const rotate = order.findIndex(node => nodeToLoop.get(node) === constraintIndices[0]);
  order = order.slice(rotate).concat(order.slice(0, rotate));
  let reversed = false;
  if (constraintIndices.length > 2) {
    const next = order.slice(1).find(node => nodeToLoop.has(node));
    if (nodeToLoop.get(next) !== constraintIndices[1]) {
      order = [order[0], ...order.slice(1).reverse()];
      reversed = true;
    }
  }
  // The strips below traverse the chords in the loop's direction, so the patch must traverse
  // them the other way: its winding runs with the loop unless the boundary had to be reversed
  const flipCore = !reversed;

  // Output nodes: loop vertices first, then patch nodes that are not constraint vertices
  const patchToOut = new Int32Array(patchCount).fill(-1);
  nodeToLoop.forEach((loopIndex, node) => {
    patchToOut[node] = loopIndex;
  });
  const extra = [];
  for (let node = 0; node < patchCount; node++) {
    if (patchToOut[node] < 0) {
      patchToOut[node] = loopCount + extra.length;
      extra.push(node);
    }
  }
  const points = new Float64Array((loopCount + extra.length) * 3);
  points.set(loopPoints);
  extra.forEach((node, i) => points.set(patchAt(node), (loopCount + i) * 3));
  const out = i => [points[3 * i], points[3 * i + 1], points[3 * i + 2]];

  const triangles = [];
  for (let t = 0; t < patchTriangles.length; t += 3) {
    const a = patchToOut[patchTriangles[t]];
    const b = patchToOut[patchTriangles[t + 1]];
    const c = patchToOut[patchTriangles[t + 2]];
    if (flipCore) {
      triangles.push(a, c, b);
    } else {
      triangles.push(a, b, c);
    }
  }

  // Zip each span: loop vertices a..b against the patch boundary nodes a..b
  const pushTriangle = (a, b, c) => {
    if (a !== b && b !== c && a !== c) {
      triangles.push(a, b, c);
    }
  };
  const spanParameters = chain => {
    const lengths = [0];
    for (let i = 1; i < chain.length; i++) {
      lengths.push(lengths[i - 1] + _distance(out(chain[i - 1]), out(chain[i])));
    }
    const total = lengths[lengths.length - 1] || 1;
    return lengths.map(length => length / total);
  };

  const boundaryOut = order.map(node => patchToOut[node]);
  let cursor = 0;
  for (let k = 0; k < constraintIndices.length; k++) {
    const from = constraintIndices[k];
    const to = constraintIndices[(k + 1) % constraintIndices.length];

    const loopChain = [from];
    for (let i = (from + 1) % loopCount; i !== to; i = (i + 1) % loopCount) {
      loopChain.push(i);
    }
    loopChain.push(to);

    const chordChain = [boundaryOut[cursor]];
    cursor++;
    while (cursor < boundaryOut.length && boundaryOut[cursor] !== to) {
      chordChain.push(boundaryOut[cursor]);
      cursor++;
    }
    chordChain.push(to);

    const s = spanParameters(loopChain);
    const u = spanParameters(chordChain);
    let i = 0;
    let j = 0;
    while (i < loopChain.length - 1 || j < chordChain.length - 1) {
      const advanceLoop = j >= chordChain.length - 1
        || (i < loopChain.length - 1 && s[i + 1] < u[j + 1]);
      if (advanceLoop) {
        pushTriangle(loopChain[i], chordChain[j], loopChain[i + 1]);
        i++;
      } else {
        pushTriangle(loopChain[i], chordChain[j], chordChain[j + 1]);
        j++;
      }
    }
  }

  return { points, triangles: Int32Array.from(triangles) };
}

/**
 * Assemble the edited surface: the kept triangles plus one patch per hole.
 *
 * @param {Object} params
 * @param {ArrayLike<number>} params.points - the original surface points (flat xyz)
 * @param {ArrayLike<number>} params.triangles - kept triangles (original vertex indices)
 * @param {Array<{ loop: number[], patch: { points: Float64Array, triangles: Int32Array } }>} params.patches
 *   patches in loop-local indices (nodes 0..n-1 are the loop's vertices)
 * @returns {{ points: Float32Array, polys: Int32Array, patchPolysOffset: number }} a Cornerstone3D
 *   surface (unused original points are dropped); the patches' cells start at `patchPolysOffset`
 */
export function assembleSurface({ points, triangles, patches }) {
  const remap = new Map();
  const outPoints = [];
  const use = v => {
    let index = remap.get(v);
    if (index === undefined) {
      index = outPoints.length / 3;
      remap.set(v, index);
      outPoints.push(points[3 * v], points[3 * v + 1], points[3 * v + 2]);
    }
    return index;
  };

  const polys = [];
  for (let t = 0; t < triangles.length; t += 3) {
    polys.push(3, use(triangles[t]), use(triangles[t + 1]), use(triangles[t + 2]));
  }
  const patchPolysOffset = polys.length;

  patches.forEach(({ loop, patch }) => {
    const loopCount = loop.length;
    const local = new Int32Array(patch.points.length / 3);
    for (let i = 0; i < local.length; i++) {
      if (i < loopCount) {
        local[i] = use(loop[i]);
      } else {
        local[i] = outPoints.length / 3;
        outPoints.push(patch.points[3 * i], patch.points[3 * i + 1], patch.points[3 * i + 2]);
      }
    }
    for (let t = 0; t < patch.triangles.length; t += 3) {
      polys.push(3, local[patch.triangles[t]], local[patch.triangles[t + 1]],
        local[patch.triangles[t + 2]]);
    }
  });

  return { points: Float32Array.from(outPoints), polys: Int32Array.from(polys), patchPolysOffset };
}
