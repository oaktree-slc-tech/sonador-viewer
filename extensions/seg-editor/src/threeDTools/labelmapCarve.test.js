// Which labelmap voxels a 3D delete removes

import {
  computeCarvedVoxels,
  createGridLookup,
  createPointProximity,
  volumeAxes,
  worldBoxToIndexBox,
} from './labelmapCarve';


describe('createGridLookup', () => {
  const grid = {
    data: Uint8Array.from([0, 1, 0, 0, 0, 0, 0, 0]),
    dimensions: [2, 2, 2],
    origin: [10, 20, 30],
    spacing: [2, 2, 2],
  };

  it('reads the nearest grid point', () => {
    const inside = createGridLookup(grid);
    expect(inside(12, 20, 30)).toBe(true);
    expect(inside(12.9, 20.9, 30.9)).toBe(true);
    expect(inside(10, 20, 30)).toBe(false);
  });

  it('is outside beyond the grid, and for no grid at all', () => {
    expect(createGridLookup(grid)(100, 20, 30)).toBe(false);
    expect(createGridLookup(null)(0, 0, 0)).toBe(false);
  });
});

describe('createPointProximity', () => {
  it('tests distance to the nearest point, across grid cells', () => {
    const near = createPointProximity([0, 0, 0, 10, 10, 10], 2);

    expect(near(1.9, 0, 0)).toBe(true);
    expect(near(-1.2, -1.2, 0)).toBe(true);
    expect(near(2.1, 0, 0)).toBe(false);
    expect(near(9, 9, 10)).toBe(true);
    expect(near(5, 5, 5)).toBe(false);
  });

  it('is off for no depth or no points', () => {
    expect(createPointProximity([0, 0, 0], 0)).toBeNull();
    expect(createPointProximity([], 2)).toBeNull();
  });
});

describe('volumeAxes / worldBoxToIndexBox', () => {
  // A volume with 2 mm voxels, its i axis along -y, j along +x (an oblique-free rotation)
  const indexToWorld = ([i, j, k]) => [100 + 2 * j, 50 - 2 * i, 3 * k];

  it('derives the index -> world steps', () => {
    expect(volumeAxes(indexToWorld)).toEqual({
      origin: [100, 50, 0], di: [0, -2, 0], dj: [2, 0, 0], dk: [0, 0, 3],
    });
  });

  it('covers a world box with the index box around it, clamped to the volume', () => {
    const axes = volumeAxes(indexToWorld);
    const box = worldBoxToIndexBox({ min: [104, 40, 3], max: [108, 46, 9] }, axes, [20, 20, 20], 0);
    // x 104..108 -> j 2..4; y 40..46 -> i 2..5; z 3..9 -> k 1..3
    expect(box).toEqual({ min: [2, 2, 1], max: [5, 4, 3] });

    expect(worldBoxToIndexBox({ min: [0, 0, 0], max: [1, 1, 1] }, axes, [20, 20, 20])).toBeNull();
  });
});

describe('computeCarvedVoxels', () => {
  // 1 mm voxels at the world origin; a 6^3 labelmap
  const dimensions = [6, 6, 6];
  const axes = { origin: [0, 0, 0], di: [1, 0, 0], dj: [0, 1, 0], dk: [0, 0, 1] };
  const all = { min: [0, 0, 0], max: [5, 5, 5] };
  const index = (i, j, k) => i + 6 * (j + 6 * k);

  function labelmap(fill) {
    const data = new Uint8Array(216);
    for (let k = 0; k < 6; k++) {
      for (let j = 0; j < 6; j++) {
        for (let i = 0; i < 6; i++) {
          data[index(i, j, k)] = fill(i, j, k);
        }
      }
    }
    return data;
  }

  it('removes the segment voxels the edit moved outside, and nothing else', () => {
    // Segment 2 fills x < 5; segment 1 fills x = 5
    const scalarData = labelmap(i => (i < 5 ? 2 : 1));
    const insideOriginal = () => true;
    const insideEdited = x => x < 3; // the edit cut away x >= 3

    const removed = computeCarvedVoxels({
      scalarData, dimensions, segmentIndex: 2, axes, indexBox: all, insideOriginal, insideEdited,
    });

    const expected = [];
    for (let k = 0; k < 6; k++) {
      for (let j = 0; j < 6; j++) {
        expected.push(index(3, j, k), index(4, j, k));
      }
    }
    expect([...removed].sort((a, b) => a - b)).toEqual(expected.sort((a, b) => a - b));
  });

  it('keeps border voxels outside the smoothed surface away from the edit', () => {
    // The surface (both before and after) misses the segment's outermost layer everywhere
    const scalarData = labelmap(() => 2);
    const insideOriginal = (x, y, z) => [x, y, z].every(v => v >= 1 && v <= 4);
    const insideEdited = insideOriginal;

    const removed = computeCarvedVoxels({
      scalarData, dimensions, segmentIndex: 2, axes, indexBox: all, insideOriginal, insideEdited,
    });

    expect(removed).toHaveLength(0);
  });

  it('removes the border shell next to the voxels the edit removed', () => {
    const scalarData = labelmap(() => 2);
    const insideOriginal = (x, y, z) => [x, y, z].every(v => v >= 1 && v <= 4);
    const insideEdited = (x, y, z) => insideOriginal(x, y, z) && x < 3; // cut at x = 3

    const removed = new Set(computeCarvedVoxels({
      scalarData, dimensions, segmentIndex: 2, axes, indexBox: all, insideOriginal, insideEdited,
    }));

    expect(removed.has(index(3, 2, 2))).toBe(true);  // inside before, outside after
    expect(removed.has(index(5, 2, 2))).toBe(true);  // shell beyond the removed part
    expect(removed.has(index(4, 0, 2))).toBe(true);  // shell beside the removed part
    expect(removed.has(index(0, 2, 2))).toBe(false); // shell on the kept side
    expect(removed.has(index(1, 0, 2))).toBe(false); // shell beside the kept part
    expect(removed.has(index(2, 0, 2))).toBe(false); // shell touching both parts stays
  });

  it('removes segment voxels within the removal depth of the removed points, even inside', () => {
    const scalarData = labelmap(i => (i < 5 ? 2 : 1));
    // The edit changed nothing (the patch lies where the surface was)
    const inside = () => true;
    const nearRemoved = createPointProximity([2, 2, 2], 1.5);

    const removed = new Set(computeCarvedVoxels({
      scalarData, dimensions, segmentIndex: 2, axes, indexBox: all,
      insideOriginal: inside, insideEdited: inside, nearRemoved,
    }));

    expect(removed.has(index(2, 2, 2))).toBe(true);
    expect(removed.has(index(3, 3, 2))).toBe(true);  // 1.41 away
    expect(removed.has(index(3, 3, 3))).toBe(false); // 1.73 away
    expect(removed.size).toBe(19); // the voxels within 1.5 of (2, 2, 2)
  });

  it('only looks inside the index box', () => {
    const scalarData = labelmap(() => 2);

    const removed = computeCarvedVoxels({
      scalarData, dimensions, segmentIndex: 2, axes,
      indexBox: { min: [0, 0, 0], max: [1, 1, 1] },
      insideOriginal: () => true, insideEdited: () => false,
    });

    expect(removed).toHaveLength(8);
  });
});
