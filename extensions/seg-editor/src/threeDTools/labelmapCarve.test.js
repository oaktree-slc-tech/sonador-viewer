// Which labelmap voxels a 3D delete removes

import { insideMesh, uvSphere } from './testing/meshes';
import {
  carveLabelmap,
  computeCarvedVoxels,
  computeSurfaceDeltaVoxels,
  createGridLookup,
  createGridSampler,
  createPointProximity,
  deltaLabelmap,
  extractIndexBox,
  indexBoxSize,
  volumeAxes,
  voxelizeIntoBox,
  worldBoxToIndexBox,
} from './labelmapCarve';


describe('createGridSampler', () => {
  it('reads the nearest voxel\'s value of an axis-aligned grid, 0 outside', () => {
    const sample = createGridSampler({
      data: Uint8Array.from([0, 7, 0, 0, 0, 0, 0, 3]), dimensions: [2, 2, 2], origin: [10, 20, 30], spacing: [2, 2, 2],
    });
    expect(sample(12, 20, 30)).toBe(7);
    expect(sample(12.9, 22.9, 32.9)).toBe(3);
    expect(sample(10, 20, 30)).toBe(0);
    expect(sample(100, 20, 30)).toBe(0);
    expect(createGridSampler(undefined)(12, 20, 30)).toBe(0);
  });

  it('follows the direction cosines of an oblique grid', () => {
    // Rows along +y, columns along -x, 2 mm voxels: voxel (1, 0, 0) is at (10, 22, 30), (0, 1, 0) at (8, 20, 30)
    const sample = createGridSampler({
      data: Uint8Array.from([0, 7, 3, 0, 0, 0, 0, 0]), dimensions: [2, 2, 2], origin: [10, 20, 30], spacing: [2, 2, 2],
      direction: [0, 1, 0, -1, 0, 0, 0, 0, 1],
    });
    expect(sample(10, 22, 30)).toBe(7);
    expect(sample(8, 20, 30)).toBe(3);
    expect(sample(12, 20, 30)).toBe(0);
  });
});


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
    expect(createPointProximity(undefined, 2)).toBeNull();
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

describe('extractIndexBox', () => {
  it('copies the box out of the labelmap, i fastest', () => {
    const dimensions = [4, 3, 2];
    const data = Uint8Array.from({ length: 24 }, (_, index) => index);
    const box = { min: [1, 1, 0], max: [2, 2, 1] };

    expect(indexBoxSize(box)).toEqual([2, 2, 2]);
    expect(Array.from(extractIndexBox(data, dimensions, box))).toEqual([
      5, 6, 9, 10, // k = 0: j = 1 (i 1..2), j = 2
      17, 18, 21, 22, // k = 1
    ]);
  });
});

describe('voxelizeIntoBox', () => {
  const identity = { origin: [0, 0, 0], di: [1, 0, 0], dj: [0, 1, 0], dk: [0, 0, 1] };
  const centre = (axes, I, J, K) => [0, 1, 2].map(d =>
    axes.origin[d] + I * axes.di[d] + J * axes.dj[d] + K * axes.dk[d]);

  function expectMatchesParity(surface, axes, indexBox) {
    const mask = voxelizeIntoBox({ surface, axes, indexBox });
    const [bx, by, bz] = indexBoxSize(indexBox);
    let inside = 0;
    for (let k = 0; k < bz; k++) {
      for (let j = 0; j < by; j++) {
        for (let i = 0; i < bx; i++) {
          const expected = insideMesh(surface, centre(axes, i + indexBox.min[0], j + indexBox.min[1], k + indexBox.min[2]));
          expect(!!mask[i + bx * (j + by * k)]).toBe(expected);
          inside += expected ? 1 : 0;
        }
      }
    }
    return inside;
  }

  it('marks the voxel centres inside a closed surface, and only those', () => {
    // A 10 mm ball on a 1 mm grid, off the grid points so no voxel centre lies on the surface
    const surface = uvSphere({ radius: 10, segments: 24, rings: 16, center: [16.3, 16.1, 15.7] });
    const inside = expectMatchesParity(surface, identity, { min: [4, 4, 4], max: [28, 28, 28] });
    // About the ball's volume, 4/3 pi r^3
    expect(inside).toBeGreaterThan(3900);
    expect(inside).toBeLessThan(4300);
  });

  it('only examines the box, and counts crossings beyond it', () => {
    const surface = uvSphere({ radius: 10, segments: 24, rings: 16, center: [16, 16, 16] });
    // A box cutting through the ball: voxels inside it are inside the ball when within 10 mm
    expectMatchesParity(surface, identity, { min: [10, 14, 14], max: [20, 18, 18] });
  });

  it('works on an oblique labelmap grid', () => {
    const surface = uvSphere({ radius: 6, segments: 20, rings: 12, center: [30.3, 20.1, 10.7] });
    // 2 mm voxels, i along +y, j along -x, k along +z
    const axes = { origin: [40, 10, 0], di: [0, 2, 0], dj: [-2, 0, 0], dk: [0, 0, 2] };
    const inside = expectMatchesParity(surface, axes, { min: [0, 0, 0], max: [10, 10, 10] });
    expect(inside).toBeGreaterThan(80); // 4/3 pi 6^3 / 8 is about 113
  });

  it('counts the voxels of a box-shaped surface with vertices on voxel centres consistently', () => {
    // A closed box from (2, 2, 2) to (6, 6, 6): a watertight mesh whose edges cross voxel centres
    const p = [];
    for (let z = 0; z < 2; z++) {
      for (let y = 0; y < 2; y++) {
        for (let x = 0; x < 2; x++) {
          p.push(2 + 4 * x, 2 + 4 * y, 2 + 4 * z);
        }
      }
    }
    const quad = (a, b, c, d) => [3, a, b, c, 3, a, c, d];
    const polys = Int32Array.from([
      ...quad(0, 2, 3, 1), // z = 2
      ...quad(4, 5, 7, 6), // z = 6
      ...quad(0, 1, 5, 4), // y = 2
      ...quad(2, 6, 7, 3), // y = 6
      ...quad(0, 4, 6, 2), // x = 2
      ...quad(1, 3, 7, 5), // x = 6
    ]);
    const surface = { points: Float32Array.from(p), polys };
    const box = { min: [0, 0, 0], max: [8, 8, 8] };
    const mask = voxelizeIntoBox({ surface, axes: identity, indexBox: box });

    let count = 0;
    for (let k = 0; k <= 8; k++) {
      for (let j = 0; j <= 8; j++) {
        for (let i = 0; i <= 8; i++) {
          const value = mask[i + 9 * (j + 9 * k)];
          const strictlyInside = [i, j, k].every(v => v > 2 && v < 6);
          const strictlyOutside = [i, j, k].some(v => v < 2 || v > 6);
          if (strictlyInside) {
            expect(value).toBe(1);
          } else if (strictlyOutside) {
            expect(value).toBe(0);
          }
          count += value;
        }
      }
    }
    // Every voxel on the faces is counted once or not at all, never doubly
    expect(count).toBeGreaterThanOrEqual(27);
    expect(count).toBeLessThanOrEqual(125);
  });

  it('has no inside for an empty or missing surface', () => {
    const box = { min: [0, 0, 0], max: [2, 2, 2] };
    expect(Array.from(voxelizeIntoBox({ surface: null, axes: identity, indexBox: box }))).toEqual(new Array(27).fill(0));
    expect(Array.from(voxelizeIntoBox({ surface: { points: [], polys: [] }, axes: identity, indexBox: box })))
      .toEqual(new Array(27).fill(0));
  });
});

describe('computeCarvedVoxels', () => {
  // 1 mm voxels at the world origin; a 6^3 labelmap, carved over all of it
  const dimensions = [6, 6, 6];
  const axes = { origin: [0, 0, 0], di: [1, 0, 0], dj: [0, 1, 0], dk: [0, 0, 1] };
  const all = { min: [0, 0, 0], max: [5, 5, 5] };
  const index = (i, j, k) => i + 6 * (j + 6 * k);

  function fill(predicate) {
    const data = new Uint8Array(216);
    for (let k = 0; k < 6; k++) {
      for (let j = 0; j < 6; j++) {
        for (let i = 0; i < 6; i++) {
          data[index(i, j, k)] = predicate(i, j, k);
        }
      }
    }
    return data;
  }
  const labelmap = fill;
  const mask = predicate => fill((i, j, k) => (predicate(i, j, k) ? 1 : 0));

  it('removes the segment voxels the edit moved outside, and nothing else', () => {
    // Segment 2 fills x < 5; segment 1 fills x = 5
    const boxData = labelmap(i => (i < 5 ? 2 : 1));
    const insideOriginal = mask(() => true);
    const insideEdited = mask(x => x < 3); // the edit cut away x >= 3

    const removed = computeCarvedVoxels({
      boxData, dimensions, segmentIndex: 2, axes, indexBox: all, insideOriginal, insideEdited,
    });

    const expected = [];
    for (let k = 0; k < 6; k++) {
      for (let j = 0; j < 6; j++) {
        expected.push(index(3, j, k), index(4, j, k));
      }
    }
    expect([...removed].sort((a, b) => a - b)).toEqual(expected.sort((a, b) => a - b));
  });

  it('adds the background voxels the surface moved over, never another segment\'s', () => {
    // Segment 2 fills x < 3, segment 1 fills x = 5, the rest is background; the edited surface
    // reaches x < 5 where the original reached x < 3
    const boxData = labelmap(i => (i < 3 ? 2 : i === 5 ? 1 : 0));
    const insideOriginal = mask(x => x < 3);
    const insideEdited = mask(x => x < 5);

    const { remove, add } = computeSurfaceDeltaVoxels({
      boxData, dimensions, segmentIndex: 2, axes, indexBox: all, insideOriginal, insideEdited,
    });

    expect(remove).toHaveLength(0);
    const expected = [];
    for (let k = 0; k < 6; k++) {
      for (let j = 0; j < 6; j++) {
        expected.push(index(3, j, k), index(4, j, k));
      }
    }
    expect([...add].sort((a, b) => a - b)).toEqual(expected.sort((a, b) => a - b));

    // The surface pulled back instead: the segment's voxels it left are removed, nothing is added
    const back = computeSurfaceDeltaVoxels({
      boxData, dimensions, segmentIndex: 2, axes, indexBox: all, insideOriginal: insideEdited, insideEdited: insideOriginal,
    });
    expect(back.add).toHaveLength(0);
    expect(back.remove).toHaveLength(0); // x = 3, 4 are background already; nothing of segment 2 lies there
  });

  it('keeps border voxels outside the smoothed surface away from the edit', () => {
    // The surface (both before and after) misses the segment's outermost layer everywhere
    const boxData = labelmap(() => 2);
    const insideOriginal = mask((x, y, z) => [x, y, z].every(v => v >= 1 && v <= 4));

    const removed = computeCarvedVoxels({
      boxData, dimensions, segmentIndex: 2, axes, indexBox: all, insideOriginal, insideEdited: insideOriginal,
    });

    expect(removed).toHaveLength(0);
  });

  it('removes the border shell next to the voxels the edit removed', () => {
    const boxData = labelmap(() => 2);
    const within = (x, y, z) => [x, y, z].every(v => v >= 1 && v <= 4);
    const insideOriginal = mask(within);
    const insideEdited = mask((x, y, z) => within(x, y, z) && x < 3); // cut at x = 3

    const removed = new Set(computeCarvedVoxels({
      boxData, dimensions, segmentIndex: 2, axes, indexBox: all, insideOriginal, insideEdited,
    }));

    expect(removed.has(index(3, 2, 2))).toBe(true);  // inside before, outside after
    expect(removed.has(index(5, 2, 2))).toBe(true);  // shell beyond the removed part
    expect(removed.has(index(4, 0, 2))).toBe(true);  // shell beside the removed part
    expect(removed.has(index(0, 2, 2))).toBe(false); // shell on the kept side
    expect(removed.has(index(1, 0, 2))).toBe(false); // shell beside the kept part
    expect(removed.has(index(2, 0, 2))).toBe(false); // shell touching both parts stays
  });

  it('removes segment voxels within the removal depth of the removed points, even inside', () => {
    const boxData = labelmap(i => (i < 5 ? 2 : 1));
    // The edit changed nothing (the patch lies where the surface was)
    const inside = mask(() => true);
    const nearRemoved = createPointProximity([2, 2, 2], 1.5);

    const removed = new Set(computeCarvedVoxels({
      boxData, dimensions, segmentIndex: 2, axes, indexBox: all,
      insideOriginal: inside, insideEdited: inside, nearRemoved,
    }));

    expect(removed.has(index(2, 2, 2))).toBe(true);
    expect(removed.has(index(3, 3, 2))).toBe(true);  // 1.41 away
    expect(removed.has(index(3, 3, 3))).toBe(false); // 1.73 away
    expect(removed.size).toBe(19); // the voxels within 1.5 of (2, 2, 2)
  });

  it('returns labelmap indices for a box that is not at the origin', () => {
    const box = { min: [2, 2, 2], max: [3, 3, 3] };
    const boxData = Uint8Array.from([2, 2, 2, 2, 2, 2, 2, 2]);

    const removed = computeCarvedVoxels({
      boxData, dimensions, segmentIndex: 2, axes, indexBox: box,
      insideOriginal: Uint8Array.from([1, 1, 1, 1, 1, 1, 1, 1]), insideEdited: new Uint8Array(8),
    });

    expect([...removed].sort((a, b) => a - b)).toEqual([
      index(2, 2, 2), index(3, 2, 2), index(2, 3, 2), index(3, 3, 2),
      index(2, 2, 3), index(3, 2, 3), index(2, 3, 3), index(3, 3, 3),
    ].sort((a, b) => a - b));
  });
});

describe('carveLabelmap', () => {
  it('removes the part of the segment between the two surfaces, within the box', () => {
    // A 10 mm ball of segment 1 on a 1 mm grid centred at (16, 16, 16); the edited surface is the
    // ball with its top (z > 22) cut flat
    const dimensions = [32, 32, 32];
    const axes = { origin: [0, 0, 0], di: [1, 0, 0], dj: [0, 1, 0], dk: [0, 0, 1] };
    const original = uvSphere({ radius: 10, segments: 24, rings: 16, center: [16, 16, 16] });
    const edited = uvSphere({ radius: 10, segments: 24, rings: 16, center: [16, 16, 16] });
    const points = Float32Array.from(edited.points);
    for (let v = 2; v < points.length; v += 3) {
      points[v] = Math.min(points[v], 22);
    }
    edited.points = points;
    const indexBox = { min: [4, 4, 18], max: [28, 28, 28] };
    const scalarData = new Uint8Array(32 * 32 * 32);
    for (let k = 0; k < 32; k++) {
      for (let j = 0; j < 32; j++) {
        for (let i = 0; i < 32; i++) {
          scalarData[i + 32 * (j + 32 * k)] = Math.hypot(i - 16, j - 16, k - 16) <= 10 ? 1 : 0;
        }
      }
    }

    const removed = carveLabelmap({
      original, edited, boxData: extractIndexBox(scalarData, dimensions, indexBox), dimensions,
      segmentIndex: 1, axes, indexBox,
    });

    expect(removed.length).toBeGreaterThan(50);
    removed.forEach(index => {
      expect(scalarData[index]).toBe(1);
      const k = Math.floor(index / (32 * 32));
      expect(k).toBeGreaterThanOrEqual(22);
    });
  });
});

describe('deltaLabelmap', () => {
  it('moves the segment with the surface: voxels added where it grew, removed where it shrank', () => {
    // A 10 mm ball of segment 1 on a 1 mm grid centred at (16, 16, 16); the surface shifts 2 mm
    // along +x, as a smooth that pushed one side out and the other in would
    const dimensions = [32, 32, 32];
    const axes = { origin: [0, 0, 0], di: [1, 0, 0], dj: [0, 1, 0], dk: [0, 0, 1] };
    const original = uvSphere({ radius: 10, segments: 24, rings: 16, center: [16.3, 16.3, 16.3] });
    const edited = uvSphere({ radius: 10, segments: 24, rings: 16, center: [18.3, 16.3, 16.3] });
    const indexBox = { min: [2, 2, 2], max: [30, 30, 30] };
    const scalarData = new Uint8Array(32 * 32 * 32);
    for (let k = 0; k < 32; k++) {
      for (let j = 0; j < 32; j++) {
        for (let i = 0; i < 32; i++) {
          scalarData[i + 32 * (j + 32 * k)] = Math.hypot(i - 16.3, j - 16.3, k - 16.3) <= 10 ? 1 : 0;
        }
      }
    }

    const { remove, add } = deltaLabelmap({
      original, edited, boxData: extractIndexBox(scalarData, dimensions, indexBox), dimensions,
      segmentIndex: 1, axes, indexBox,
    });

    expect(add.length).toBeGreaterThan(100);
    expect(remove.length).toBeGreaterThan(100);
    // Similar amounts on both sides, and on the right sides
    expect(Math.abs(add.length - remove.length) / add.length).toBeLessThan(0.3);
    add.forEach(index => {
      expect(scalarData[index]).toBe(0);
      expect(index % 32).toBeGreaterThan(16);
    });
    // (the shell rule takes a border voxel next to the removed ones along with them)
    remove.forEach(index => {
      expect(scalarData[index]).toBe(1);
      expect(index % 32).toBeLessThan(18);
    });
  });
});
