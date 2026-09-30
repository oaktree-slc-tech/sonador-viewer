// Labelled grids and their resampling onto the editor's labelmap grid

import { volumeAxes } from '../threeDTools/labelmapCarve';

import { gridAxes, gridWorldBounds, resampleGridToLabelmap, uniqueGridValues } from './labelmapGrid';


// A 4 x 4 x 4 unit grid with value 1 in the 2 x 2 x 2 block at indices 1..2
function blockGrid(value = 1, extra = {}) {
  const data = new Uint8Array(64);
  for (let k = 1; k <= 2; k++) {
    for (let j = 1; j <= 2; j++) {
      for (let i = 1; i <= 2; i++) {
        data[i + 4 * (j + 4 * k)] = value;
      }
    }
  }
  return { data, dimensions: [4, 4, 4], origin: [0, 0, 0], spacing: [1, 1, 1], ...extra };
}

const identityAxes = () => volumeAxes(ijk => ijk);

describe('gridAxes / gridWorldBounds', () => {
  it('scales the direction cosines by the spacing, identity when no direction is given', () => {
    expect(gridAxes({ origin: [1, 2, 3], spacing: [2, 3, 4] })).toEqual({
      origin: [1, 2, 3], di: [2, 0, 0], dj: [0, 3, 0], dk: [0, 0, 4],
    });
    // Rows along +y, columns along -x
    const axes = gridAxes({ origin: [0, 0, 0], spacing: [2, 3, 4], direction: [0, 1, 0, -1, 0, 0, 0, 0, 1] });
    expect(axes.di).toEqual([0, 2, 0]);
    expect(axes.dj).toEqual([-3, 0, 0]);
  });

  it('bounds the voxel centres of a rotated grid', () => {
    const grid = { dimensions: [3, 2, 2], origin: [10, 10, 10], spacing: [1, 1, 1], direction: [0, 1, 0, -1, 0, 0, 0, 0, 1] };
    expect(gridWorldBounds(grid)).toEqual({ min: [9, 10, 10], max: [10, 12, 11] });
  });
});

describe('uniqueGridValues', () => {
  it('lists the distinct non-zero values, rounded, ascending', () => {
    expect(uniqueGridValues(Float32Array.from([0, 3, 0.2, 7, 3, 1.6]))).toEqual([2, 3, 7]);
    expect(uniqueGridValues(new Uint8Array(4))).toEqual([]);
  });
});

describe('resampleGridToLabelmap', () => {
  it('places the source values at the nearest target voxels, on a finer target grid', () => {
    const target = { dimensions: [8, 8, 8], axes: volumeAxes(ijk => ijk.map(v => v / 2)) };
    const { labelmap, voxelsByValue } = resampleGridToLabelmap({ grid: blockGrid(), ...target, mapValue: v => v + 6 });

    // Half-mm target voxels 1..4 round to source voxels 1..2 on each axis
    expect(voxelsByValue.get(7)).toBe(64);
    expect(labelmap[1 + 8 * (1 + 8 * 1)]).toBe(7);
    expect(labelmap[4 + 8 * (4 + 8 * 4)]).toBe(7);
    expect(labelmap[0]).toBe(0);
    expect(labelmap[5 + 8 * (1 + 8 * 1)]).toBe(0);
  });

  it('keeps a block in place across a small shift and an oblique source grid', () => {
    const shifted = resampleGridToLabelmap({
      grid: blockGrid(1, { origin: [0.4, -0.4, 0.3] }), dimensions: [4, 4, 4], axes: identityAxes(),
    });
    expect(shifted.voxelsByValue.get(1)).toBe(8);
    expect(shifted.labelmap[1 + 4 * (1 + 4 * 1)]).toBe(1);

    // Source rows along +y and columns along -x: the block sits at x in [-2, -1], y in [1, 2]
    const oblique = resampleGridToLabelmap({
      grid: blockGrid(1, { direction: [0, 1, 0, -1, 0, 0, 0, 0, 1] }),
      dimensions: [4, 4, 4],
      axes: volumeAxes(([i, j, k]) => [i - 3, j, k]),
    });
    expect(oblique.voxelsByValue.get(1)).toBe(8);
    expect(oblique.labelmap[1 + 4 * (1 + 4 * 1)]).toBe(1); // world (-2, 1, 1)
    expect(oblique.labelmap[3 + 4 * (1 + 4 * 1)]).toBe(0); // world (0, 1, 1)
  });

  it('skips values the map drops, and a source outside the target', () => {
    const dropped = resampleGridToLabelmap({ grid: blockGrid(), dimensions: [4, 4, 4], axes: identityAxes(), mapValue: () => 0 });
    expect(dropped.voxelsByValue.size).toBe(0);

    const outside = resampleGridToLabelmap({
      grid: blockGrid(1, { origin: [100, 100, 100] }), dimensions: [4, 4, 4], axes: identityAxes(),
    });
    expect(outside.labelmap.some(v => v)).toBe(false);
  });
});
