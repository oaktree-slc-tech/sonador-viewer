// Labelmap side of the 3D Selection tool's delete (ohif-viewers#142, FR-21 / FR-27): which voxels
// of the segment the edited surface removes.
//
// The surface is a smoothed approximation of the labelmap: a voxelized copy of the unedited
// surface already differs from the segment along its whole border (about 3% of a small segment's
// voxels). Keeping only the voxels inside the edited surface would therefore erode the whole
// segment on every delete. Instead, the original and the edited surfaces are both voxelized on the
// labelmap grid, and a voxel of the segment is removed when the edit moved it from inside to
// outside. The segment's border voxels that were already outside the smoothed surface are removed
// only next to voxels the edit removed, and not where they also touch the part of the segment that
// is kept (a thin shell, which would otherwise remain where the surface was cut away). Nothing is
// ever added.
//
// Only the index box around the edit is examined (worldBoxToIndexBox), and the voxelization is
// done within that box: ray parity at the voxel centres against the triangles whose columns cross
// the box (voxelizeIntoBox). The cost of a delete scales with the size of the edit.
//
// On a flat or gently curved part of the surface, the patch closes the hole almost where the
// surface was, so the edited surface removes next to nothing. The removal depth covers this:
// voxels of the segment within that distance of the removed points are removed as well.
//
// An edit that moves the surface rather than cutting it (Smooth, ohif-viewers#148 FR-10) is a
// delta: the segment's voxels the surface moved out of are cleared as above, and the background
// voxels it moved over are set to the segment (computeSurfaceDeltaVoxels). Other segments' voxels
// are never written.


const IDENTITY_DIRECTION = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function _isIdentityDirection(direction) {
  return !direction || IDENTITY_DIRECTION.every((value, i) => Math.abs(direction[i] - value) < 1e-9);
}

/**
 * Nearest-voxel sampler of a labelled grid in world coordinates: (x, y, z) => the value of the
 * voxel whose centre is nearest, or 0 outside the grid.
 *
 * The grid is voxel (i, j, k) at origin + i*spacing[0]*direction[0..2] + j*spacing[1]*direction[3..5]
 * + k*spacing[2]*direction[6..8], with i the fastest index in `data`. Without a `direction` the
 * grid is axis-aligned (the polymorphic segmentation voxelizer's surface -> labelmap result).
 *
 * @param {{ data: ArrayLike<number>, dimensions: ArrayLike<number>, origin: ArrayLike<number>,
 *   spacing: ArrayLike<number>, direction?: ArrayLike<number> }} grid
 * @returns {(x: number, y: number, z: number) => number}
 */
export function createGridSampler(grid) {
  if (!grid?.data) {
    return () => 0;
  }
  const { data } = grid;
  const [nx, ny, nz] = grid.dimensions;
  const [ox, oy, oz] = grid.origin;
  const [sx, sy, sz] = grid.spacing;

  if (_isIdentityDirection(grid.direction)) {
    return (x, y, z) => {
      const i = Math.round((x - ox) / sx);
      const j = Math.round((y - oy) / sy);
      const k = Math.round((z - oz) / sz);
      if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) {
        return 0;
      }
      return data[i + nx * (j + ny * k)];
    };
  }

  // Oblique grid: world -> index through the inverse of the index -> world matrix
  const d = grid.direction;
  const inverse = invert3([
    [d[0] * sx, d[1] * sx, d[2] * sx],
    [d[3] * sy, d[4] * sy, d[5] * sy],
    [d[6] * sz, d[7] * sz, d[8] * sz],
  ]);
  return (x, y, z) => {
    const rx = x - ox;
    const ry = y - oy;
    const rz = z - oz;
    const i = Math.round(inverse[0][0] * rx + inverse[0][1] * ry + inverse[0][2] * rz);
    const j = Math.round(inverse[1][0] * rx + inverse[1][1] * ry + inverse[1][2] * rz);
    const k = Math.round(inverse[2][0] * rx + inverse[2][1] * ry + inverse[2][2] * rz);
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) {
      return 0;
    }
    return data[i + nx * (j + ny * k)];
  };
}

/**
 * Inside test for a voxelized surface (polymorphic segmentation's surface -> labelmap result: an
 * axis-aligned grid in world coordinates).
 *
 * @param {{ data: ArrayLike<number>, dimensions: ArrayLike<number>, origin: ArrayLike<number>,
 *   spacing: ArrayLike<number> }} grid
 * @returns {(x: number, y: number, z: number) => boolean}
 */
export function createGridLookup(grid) {
  if (!grid?.data) {
    return () => false;
  }
  const sample = createGridSampler(grid);
  return (x, y, z) => sample(x, y, z) > 0;
}

/**
 * Proximity test against a point set: (x, y, z) => within `radius` of any point. Points are
 * bucketed on a grid with `radius`-sized cells, so a test looks at 27 cells.
 *
 * @param {ArrayLike<number>} points - flat xyz
 * @param {number} radius
 * @returns {((x: number, y: number, z: number) => boolean)|null} null when radius is not positive
 */
export function createPointProximity(points, radius) {
  if (!(radius > 0) || !points?.length) {
    return null;
  }
  const cells = new Map();
  const cellKey = (i, j, k) => `${i},${j},${k}`;
  for (let p = 0; p < points.length; p += 3) {
    const key = cellKey(
      Math.floor(points[p] / radius), Math.floor(points[p + 1] / radius), Math.floor(points[p + 2] / radius));
    let bucket = cells.get(key);
    if (!bucket) {
      bucket = [];
      cells.set(key, bucket);
    }
    bucket.push(points[p], points[p + 1], points[p + 2]);
  }

  const radiusSquared = radius * radius;
  return (x, y, z) => {
    const ci = Math.floor(x / radius);
    const cj = Math.floor(y / radius);
    const ck = Math.floor(z / radius);
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (let dk = -1; dk <= 1; dk++) {
          const bucket = cells.get(cellKey(ci + di, cj + dj, ck + dk));
          if (!bucket) {
            continue;
          }
          for (let b = 0; b < bucket.length; b += 3) {
            const dx = bucket[b] - x;
            const dy = bucket[b + 1] - y;
            const dz = bucket[b + 2] - z;
            if (dx * dx + dy * dy + dz * dz <= radiusSquared) {
              return true;
            }
          }
        }
      }
    }
    return false;
  };
}

/**
 * Index -> world mapping of a labelmap volume, as origin plus one step vector per index axis.
 *
 * @param {Function} indexToWorld - ([i, j, k]) => [x, y, z] (e.g. the volume's vtkImageData)
 * @returns {{ origin: number[], di: number[], dj: number[], dk: number[] }}
 */
export function volumeAxes(indexToWorld) {
  const origin = Array.from(indexToWorld([0, 0, 0]));
  const step = ijk => Array.from(indexToWorld(ijk)).map((value, d) => value - origin[d]);
  return { origin, di: step([1, 0, 0]), dj: step([0, 1, 0]), dk: step([0, 0, 1]) };
}

export function invert3(m) {
  // m: rows [di, dj, dk] as columns of the index -> world matrix
  const [a, b, c] = [m[0][0], m[1][0], m[2][0]];
  const [d, e, f] = [m[0][1], m[1][1], m[2][1]];
  const [g, h, i] = [m[0][2], m[1][2], m[2][2]];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!det) {
    throw new Error('The labelmap volume has a degenerate orientation');
  }
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}

/**
 * The index box of a volume that covers a world-space box.
 *
 * @returns {{ min: number[], max: number[] }|null} inclusive index bounds, or null when the box
 *   misses the volume
 */
export function worldBoxToIndexBox({ min, max }, axes, dimensions, padding = 1) {
  const inverse = invert3([axes.di, axes.dj, axes.dk]);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let corner = 0; corner < 8; corner++) {
    const p = [corner & 1 ? max[0] : min[0], corner & 2 ? max[1] : min[1], corner & 4 ? max[2] : min[2]];
    const rel = p.map((value, d) => value - axes.origin[d]);
    for (let r = 0; r < 3; r++) {
      const index = inverse[r][0] * rel[0] + inverse[r][1] * rel[1] + inverse[r][2] * rel[2];
      lo[r] = Math.min(lo[r], index);
      hi[r] = Math.max(hi[r], index);
    }
  }

  const boxMin = lo.map(value => Math.max(0, Math.floor(value) - padding));
  const boxMax = hi.map((value, d) => Math.min(dimensions[d] - 1, Math.ceil(value) + padding));
  if (boxMin.some((value, d) => value > boxMax[d])) {
    return null;
  }
  return { min: boxMin, max: boxMax };
}

/** Size of an index box along each axis. */
export function indexBoxSize({ min, max }) {
  return [max[0] - min[0] + 1, max[1] - min[1] + 1, max[2] - min[2] + 1];
}

/**
 * Copy the voxels of an index box out of a labelmap, i fastest.
 *
 * @param {ArrayLike<number>} scalarData
 * @param {number[]} dimensions
 * @param {{ min: number[], max: number[] }} indexBox
 * @returns {Uint8Array}
 */
export function extractIndexBox(scalarData, dimensions, indexBox) {
  const [nx, ny] = dimensions;
  const { min } = indexBox;
  const [bx, by, bz] = indexBoxSize(indexBox);
  const out = new Uint8Array(bx * by * bz);
  for (let k = 0; k < bz; k++) {
    for (let j = 0; j < by; j++) {
      const row = min[0] + nx * (j + min[1] + ny * (k + min[2]));
      const local = bx * (j + by * k);
      for (let i = 0; i < bx; i++) {
        out[local + i] = scalarData[row + i];
      }
    }
  }
  return out;
}

/**
 * Inside mask of a closed surface over an index box of a labelmap: ray parity at every voxel
 * centre of the box, in index space. Each voxel column (j, k) of the box casts one ray along +i;
 * the surface's triangles are bucketed by the columns their projection covers, with a half-open
 * containment rule so a watertight surface is crossed an odd number of times from inside and an
 * even number from outside.
 *
 * @param {Object} params
 * @param {{ points: ArrayLike<number>, polys: ArrayLike<number> }|null} params.surface - world
 *   coordinates; an empty or missing surface has no inside
 * @param {{ origin, di, dj, dk }} params.axes - labelmap index -> world (volumeAxes)
 * @param {{ min: number[], max: number[] }} params.indexBox - inclusive index bounds
 * @returns {Uint8Array} box-local mask (1 inside), i fastest
 */
export function voxelizeIntoBox({ surface, axes, indexBox }) {
  const { min, max } = indexBox;
  const [bx, by, bz] = indexBoxSize(indexBox);
  const mask = new Uint8Array(bx * by * bz);
  const points = surface?.points;
  const polys = surface?.polys;
  if (!points?.length || !polys?.length) {
    return mask;
  }

  // Surface points in continuous index coordinates
  const inverse = invert3([axes.di, axes.dj, axes.dk]);
  const count = Math.floor(points.length / 3);
  const pi = new Float64Array(count);
  const pj = new Float64Array(count);
  const pk = new Float64Array(count);
  for (let v = 0; v < count; v++) {
    const rx = points[3 * v] - axes.origin[0];
    const ry = points[3 * v + 1] - axes.origin[1];
    const rz = points[3 * v + 2] - axes.origin[2];
    pi[v] = inverse[0][0] * rx + inverse[0][1] * ry + inverse[0][2] * rz;
    pj[v] = inverse[1][0] * rx + inverse[1][1] * ry + inverse[1][2] * rz;
    pk[v] = inverse[2][0] * rx + inverse[2][1] * ry + inverse[2][2] * rz;
  }

  // Crossings of each column's ray, by box-local column index j + by * k
  const crossings = new Array(by * bz);
  const minI = min[0];

  // A point exactly on an edge shared by two triangles must count for exactly one of them: the
  // crossing test of every edge is evaluated from its lower-numbered vertex, so both triangles
  // compute the same intersection. A vertical edge (same j) never crosses.
  const edgeCrosses = (a, b, J, K) => {
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const kl = pk[lo];
    const kh = pk[hi];
    if ((kl > K) === (kh > K)) {
      return false;
    }
    return J < pj[lo] + ((K - kl) * (pj[hi] - pj[lo])) / (kh - kl);
  };

  const addTriangle = (a, b, c) => {
    const jMin = Math.min(pj[a], pj[b], pj[c]);
    const jMax = Math.max(pj[a], pj[b], pj[c]);
    const kMin = Math.min(pk[a], pk[b], pk[c]);
    const kMax = Math.max(pk[a], pk[b], pk[c]);
    if (Math.max(pi[a], pi[b], pi[c]) <= minI) {
      return; // every crossing would lie below the box: never counted
    }
    const j0 = Math.max(min[1], Math.ceil(jMin));
    const j1 = Math.min(max[1], Math.floor(jMax));
    const k0 = Math.max(min[2], Math.ceil(kMin));
    const k1 = Math.min(max[2], Math.floor(kMax));
    if (j0 > j1 || k0 > k1) {
      return;
    }

    // Plane of the triangle, as i = base + gj * j + gk * k over its projection
    const ej = pj[b] - pj[a];
    const ek = pk[b] - pk[a];
    const fj = pj[c] - pj[a];
    const fk = pk[c] - pk[a];
    const area = ej * fk - ek * fj;
    if (area === 0) {
      return; // edge-on in projection: the ray grazes it
    }
    const ei = pi[b] - pi[a];
    const fi = pi[c] - pi[a];
    const gj = (ei * fk - fi * ek) / area;
    const gk = (fi * ej - ei * fj) / area;
    const base = pi[a] - gj * pj[a] - gk * pk[a];

    for (let K = k0; K <= k1; K++) {
      for (let J = j0; J <= j1; J++) {
        let inside = edgeCrosses(a, b, J, K);
        if (edgeCrosses(b, c, J, K)) {
          inside = !inside;
        }
        if (edgeCrosses(c, a, J, K)) {
          inside = !inside;
        }
        if (!inside) {
          continue;
        }
        const i = base + gj * J + gk * K;
        if (i <= minI) {
          continue;
        }
        const column = (J - min[1]) + by * (K - min[2]);
        (crossings[column] || (crossings[column] = [])).push(i);
      }
    }
  };

  let p = 0;
  while (p < polys.length) {
    const n = polys[p];
    if (!(n > 0) || p + n >= polys.length) {
      break;
    }
    for (let t = 2; t < n; t++) {
      addTriangle(polys[p + 1], polys[p + t], polys[p + t + 1]);
    }
    p += n + 1;
  }

  // Walk each column: a voxel is inside when an odd number of crossings lie beyond its centre
  for (let column = 0; column < crossings.length; column++) {
    const hits = crossings[column];
    if (!hits) {
      continue;
    }
    hits.sort((x, y) => x - y);
    let next = 0;
    const rowStart = column * bx;
    for (let i = 0; i < bx; i++) {
      const centre = minI + i;
      while (next < hits.length && hits[next] <= centre) {
        next++;
      }
      if ((hits.length - next) & 1) {
        mask[rowStart + i] = 1;
      }
    }
  }
  return mask;
}

/**
 * Voxels of a segment that an edit removed.
 *
 * @param {Object} params
 * @param {ArrayLike<number>} params.boxData - the labelmap voxels of the index box (extractIndexBox)
 * @param {number[]} params.dimensions - labelmap dimensions (for the returned indices)
 * @param {number} params.segmentIndex
 * @param {{ origin, di, dj, dk }} params.axes - labelmap index -> world (volumeAxes)
 * @param {{ min: number[], max: number[] }} params.indexBox - the part of the labelmap the edit
 *   can affect (inclusive index bounds)
 * @param {ArrayLike<number>} params.insideOriginal - box-local mask: inside the unedited surface
 * @param {ArrayLike<number>} params.insideEdited - box-local mask: inside the edited surface
 * @param {Function} [params.nearRemoved] - (x, y, z) => within the removal depth of the removed
 *   points (createPointProximity); such voxels are removed whatever the surfaces say
 * @param {number} [params.shellPasses] - rings of already-outside border voxels removed next to
 *   removed voxels (a border voxel that also touches the kept part of the segment stays)
 * @returns {Int32Array} linear labelmap indices to clear
 */
export function computeCarvedVoxels({
  boxData, dimensions, segmentIndex, axes, indexBox, insideOriginal, insideEdited, nearRemoved,
  shellPasses = 2,
}) {
  const [nx, ny] = dimensions;
  const { min } = indexBox;
  const [bx, by, bz] = indexBoxSize(indexBox);

  // Box-local state: 0 not the segment, 1 removed, 2 shell candidate (segment, outside both
  // surfaces), 3 kept (segment, inside the edited surface)
  const REMOVED = 1;
  const SHELL = 2;
  const KEPT = 3;
  const state = new Uint8Array(bx * by * bz);
  const { origin, di, dj, dk } = axes;

  for (let k = 0; k < bz; k++) {
    for (let j = 0; j < by; j++) {
      for (let i = 0; i < bx; i++) {
        const local = i + bx * (j + by * k);
        if (boxData[local] !== segmentIndex) {
          continue;
        }
        let near = false;
        if (nearRemoved) {
          const I = i + min[0];
          const J = j + min[1];
          const K = k + min[2];
          near = nearRemoved(
            origin[0] + I * di[0] + J * dj[0] + K * dk[0],
            origin[1] + I * di[1] + J * dj[1] + K * dk[1],
            origin[2] + I * di[2] + J * dj[2] + K * dk[2]);
        }
        if (near) {
          state[local] = REMOVED;
        } else if (insideEdited[local]) {
          state[local] = KEPT;
        } else {
          state[local] = insideOriginal[local] ? REMOVED : SHELL;
        }
      }
    }
  }

  // A shell voxel joins the removed part when it touches it and does not touch the kept part
  const joinsRemoved = (i, j, k, current) => {
    let touchesRemoved = false;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = i + dx;
          const y = j + dy;
          const z = k + dz;
          if ((dx || dy || dz) && x >= 0 && y >= 0 && z >= 0 && x < bx && y < by && z < bz) {
            const neighbour = current[x + bx * (y + by * z)];
            if (neighbour === KEPT) {
              return false;
            }
            touchesRemoved = touchesRemoved || neighbour === REMOVED;
          }
        }
      }
    }
    return touchesRemoved;
  };

  for (let pass = 0; pass < shellPasses; pass++) {
    const previous = state.slice();
    let grew = false;
    for (let k = 0; k < bz; k++) {
      for (let j = 0; j < by; j++) {
        for (let i = 0; i < bx; i++) {
          const local = i + bx * (j + by * k);
          if (previous[local] === SHELL && joinsRemoved(i, j, k, previous)) {
            state[local] = REMOVED;
            grew = true;
          }
        }
      }
    }
    if (!grew) {
      break;
    }
  }

  const indices = [];
  for (let k = 0; k < bz; k++) {
    for (let j = 0; j < by; j++) {
      for (let i = 0; i < bx; i++) {
        if (state[i + bx * (j + by * k)] === REMOVED) {
          indices.push(i + min[0] + nx * (j + min[1] + ny * (k + min[2])));
        }
      }
    }
  }
  return Int32Array.from(indices);
}

/**
 * The voxels a surface edit removes from a segment: both surfaces voxelized within the index box,
 * then carved. Plain data in and out, so it can run in a worker.
 *
 * @param {Object} params
 * @param {{ points, polys }} params.original - the segment's surface before the edit
 * @param {{ points, polys }|null} params.edited - after the edit (null: the whole surface is gone)
 * @param {ArrayLike<number>} params.boxData - the labelmap voxels of the index box
 * @param {number[]} params.dimensions
 * @param {number} params.segmentIndex
 * @param {{ origin, di, dj, dk }} params.axes
 * @param {{ min, max }} params.indexBox
 * @param {ArrayLike<number>} [params.selectedPoints] - flat xyz of the removed points (world)
 * @param {number} [params.depth] - removal depth, in the surface's units
 * @returns {Int32Array} linear labelmap indices to clear
 */
export function carveLabelmap({
  original, edited, boxData, dimensions, segmentIndex, axes, indexBox, selectedPoints, depth = 0,
}) {
  return computeCarvedVoxels({
    boxData,
    dimensions,
    segmentIndex,
    axes,
    indexBox,
    insideOriginal: voxelizeIntoBox({ surface: original, axes, indexBox }),
    insideEdited: voxelizeIntoBox({ surface: edited, axes, indexBox }),
    nearRemoved: createPointProximity(selectedPoints, depth),
  });
}

/**
 * The voxels a surface edit removes from a segment and the background voxels it adds to it.
 *
 * @param {Object} params - computeCarvedVoxels's (without `nearRemoved`)
 * @returns {{ remove: Int32Array, add: Int32Array }} linear labelmap indices; `add` holds only
 *   background voxels (other segments are never written)
 */
export function computeSurfaceDeltaVoxels({
  boxData, dimensions, segmentIndex, axes, indexBox, insideOriginal, insideEdited, shellPasses,
}) {
  const remove = computeCarvedVoxels({
    boxData, dimensions, segmentIndex, axes, indexBox, insideOriginal, insideEdited, shellPasses,
  });

  const [nx, ny] = dimensions;
  const { min } = indexBox;
  const [bx, by, bz] = indexBoxSize(indexBox);
  const add = [];
  for (let k = 0; k < bz; k++) {
    for (let j = 0; j < by; j++) {
      for (let i = 0; i < bx; i++) {
        const local = i + bx * (j + by * k);
        if (boxData[local] === 0 && insideEdited[local] && !insideOriginal[local]) {
          add.push(i + min[0] + nx * (j + min[1] + ny * (k + min[2])));
        }
      }
    }
  }
  return { remove, add: Int32Array.from(add) };
}

/**
 * The labelmap delta of a surface edit that moved the surface: both surfaces voxelized within
 * the index box, then compared. Plain data in and out, so it can run in a worker.
 *
 * @param {Object} params - carveLabelmap's (without the removed points and depth)
 * @returns {{ remove: Int32Array, add: Int32Array }}
 */
export function deltaLabelmap({ original, edited, boxData, dimensions, segmentIndex, axes, indexBox }) {
  return computeSurfaceDeltaVoxels({
    boxData,
    dimensions,
    segmentIndex,
    axes,
    indexBox,
    insideOriginal: voxelizeIntoBox({ surface: original, axes, indexBox }),
    insideEdited: voxelizeIntoBox({ surface: edited, axes, indexBox }),
  });
}
