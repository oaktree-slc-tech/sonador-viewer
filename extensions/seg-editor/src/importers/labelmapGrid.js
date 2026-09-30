// Labelled voxel grids as the importers hand them over, and their resampling onto the editor's
// labelmap grid.
//
// A grid is `{ data, dimensions, origin, spacing, direction }` in patient (LPS) millimetres:
// voxel (i, j, k), i fastest in `data`, sits at
//   origin + i*spacing[0]*direction[0..2] + j*spacing[1]*direction[3..5] + k*spacing[2]*direction[6..8].
// Every source (DICOM SEG, NRRD, NIfTI) is read into this one shape, so the import into the
// segmentation is written once. Resampling is nearest-neighbour at the editor voxel's centre,
// which keeps the source's own placement and size on the editor's grid.

import { createGridSampler, worldBoxToIndexBox } from '../threeDTools/labelmapCarve.js';


export const IDENTITY_DIRECTION = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Index -> world of a grid, as origin plus one step vector per index axis */
export function gridAxes({ origin, spacing, direction = IDENTITY_DIRECTION }) {
  const axis = a => [0, 1, 2].map(d => direction[3 * a + d] * spacing[a]);
  return { origin: [...origin], di: axis(0), dj: axis(1), dk: axis(2) };
}

/** World-space bounding box of a grid's voxel centres */
export function gridWorldBounds(grid) {
  const { origin, di, dj, dk } = gridAxes(grid);
  const [nx, ny, nz] = grid.dimensions;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let corner = 0; corner < 8; corner++) {
    const i = corner & 1 ? nx - 1 : 0;
    const j = corner & 2 ? ny - 1 : 0;
    const k = corner & 4 ? nz - 1 : 0;
    for (let d = 0; d < 3; d++) {
      const value = origin[d] + i * di[d] + j * dj[d] + k * dk[d];
      min[d] = Math.min(min[d], value);
      max[d] = Math.max(max[d], value);
    }
  }
  return { min, max };
}

/** The distinct non-zero (integer) values of a grid, ascending */
export function uniqueGridValues(data) {
  const values = new Set();
  for (let i = 0; i < data.length; i++) {
    const value = Math.round(data[i]);
    if (value) {
      values.add(value);
    }
  }
  return Array.from(values).sort((a, b) => a - b);
}

/**
 * Resample a labelled grid onto a target grid, nearest voxel wins.
 *
 * @param {Object} params
 * @param {Object} params.grid - the source grid
 * @param {number[]} params.dimensions - target grid dimensions
 * @param {{ origin, di, dj, dk }} params.axes - target grid index -> world
 * @param {(value: number) => number} [params.mapValue] - source value -> target value (0 skips
 *   the voxel); the identity by default
 * @returns {{ labelmap: Uint16Array, voxelsByValue: Map<number, number> }} the target labelmap,
 *   with the voxel count written per target value
 */
export function resampleGridToLabelmap({ grid, dimensions, axes, mapValue = value => value }) {
  const [nx, ny, nz] = dimensions;
  const labelmap = new Uint16Array(nx * ny * nz);
  const voxelsByValue = new Map();

  const box = worldBoxToIndexBox(gridWorldBounds(grid), axes, dimensions, 1);
  if (!box) {
    return { labelmap, voxelsByValue };
  }

  const sample = createGridSampler(grid);
  const { origin, di, dj, dk } = axes;
  const mapped = new Map();
  const map = value => {
    if (!mapped.has(value)) {
      mapped.set(value, mapValue(Math.round(value)) || 0);
    }
    return mapped.get(value);
  };

  for (let k = box.min[2]; k <= box.max[2]; k++) {
    for (let j = box.min[1]; j <= box.max[1]; j++) {
      for (let i = box.min[0]; i <= box.max[0]; i++) {
        const x = origin[0] + i * di[0] + j * dj[0] + k * dk[0];
        const y = origin[1] + i * di[1] + j * dj[1] + k * dk[1];
        const z = origin[2] + i * di[2] + j * dj[2] + k * dk[2];
        const value = sample(x, y, z);
        if (!value) {
          continue;
        }
        const target = map(value);
        if (!target) {
          continue;
        }
        labelmap[i + nx * (j + ny * k)] = target;
        voxelsByValue.set(target, (voxelsByValue.get(target) || 0) + 1);
      }
    }
  }

  return { labelmap, voxelsByValue };
}
