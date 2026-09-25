// Labelmap side of the 3D Selection tool's delete (ohif-viewers#142, FR-21): which voxels of the
// segment the edited surface removes.
//
// The labelmap is the source of truth, and the surface is a smoothed approximation of it: a
// voxelized copy of the unedited surface already differs from the segment along its whole border
// (about 3% of a small segment's voxels). Keeping only the voxels inside the edited surface would
// therefore erode the whole segment on every delete. Instead, the original and the edited
// surfaces are voxelized on the same grid, and a voxel of the segment is removed when the edit
// moved it from inside to outside. The segment's border voxels that were already outside the
// smoothed surface are removed only next to voxels the edit removed, and not where they also touch
// the part of the segment that is kept (a thin shell, which would otherwise remain where the
// surface was cut away). Nothing is ever added.
//
// On a flat or gently curved part of the surface, the patch closes the hole almost where the
// surface was, so the edited surface removes next to nothing. The removal depth covers this:
// voxels of the segment within that distance of the removed points are removed as well.


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
  const { data } = grid;
  const [nx, ny, nz] = grid.dimensions;
  const [ox, oy, oz] = grid.origin;
  const [sx, sy, sz] = grid.spacing;

  return (x, y, z) => {
    const i = Math.round((x - ox) / sx);
    const j = Math.round((y - oy) / sy);
    const k = Math.round((z - oz) / sz);
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) {
      return false;
    }
    return data[i + nx * (j + ny * k)] > 0;
  };
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
  if (!(radius > 0) || !points.length) {
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

function _invert3(m) {
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
  const inverse = _invert3([axes.di, axes.dj, axes.dk]);
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

/**
 * Voxels of a segment that an edit removed.
 *
 * @param {Object} params
 * @param {ArrayLike<number>} params.scalarData - the labelmap voxels
 * @param {number[]} params.dimensions - labelmap dimensions
 * @param {number} params.segmentIndex
 * @param {{ origin, di, dj, dk }} params.axes - labelmap index -> world (volumeAxes)
 * @param {{ min: number[], max: number[] }} params.indexBox - the part of the labelmap the edit
 *   can affect (inclusive index bounds)
 * @param {Function} params.insideOriginal - (x, y, z) => inside the unedited surface
 * @param {Function} params.insideEdited - (x, y, z) => inside the edited surface
 * @param {Function} [params.nearRemoved] - (x, y, z) => within the removal depth of the removed
 *   points (createPointProximity); such voxels are removed whatever the surfaces say
 * @param {number} [params.shellPasses] - rings of already-outside border voxels removed next to
 *   removed voxels (a border voxel that also touches the kept part of the segment stays)
 * @returns {Int32Array} linear labelmap indices to clear
 */
export function computeCarvedVoxels({
  scalarData, dimensions, segmentIndex, axes, indexBox, insideOriginal, insideEdited, nearRemoved,
  shellPasses = 2,
}) {
  const [nx, ny] = dimensions;
  const { min, max } = indexBox;
  const bx = max[0] - min[0] + 1;
  const by = max[1] - min[1] + 1;
  const bz = max[2] - min[2] + 1;

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
        const I = i + min[0];
        const J = j + min[1];
        const K = k + min[2];
        if (scalarData[I + nx * (J + ny * K)] !== segmentIndex) {
          continue;
        }
        const x = origin[0] + I * di[0] + J * dj[0] + K * dk[0];
        const y = origin[1] + I * di[1] + J * dj[1] + K * dk[1];
        const z = origin[2] + I * di[2] + J * dj[2] + K * dk[2];
        const local = i + bx * (j + by * k);
        if (nearRemoved?.(x, y, z)) {
          state[local] = REMOVED;
        } else if (insideEdited(x, y, z)) {
          state[local] = KEPT;
        } else {
          state[local] = insideOriginal(x, y, z) ? REMOVED : SHELL;
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
