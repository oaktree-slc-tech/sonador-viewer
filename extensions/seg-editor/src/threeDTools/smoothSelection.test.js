// Smooth of the 3D selection: the region moves, its boundary and the rest of the surface stay

import { uvSphere, verticesWhere } from './testing/meshes';
import { findBoundaryLoops } from './meshCut';
import { selectionTopology, triangleTopology } from './meshRepair';
import { smoothRegion, smoothSurface } from './smoothSelection';


// A sphere with a bump: the vertices of a cap pushed outwards by a noisy amount
function bumpySphere() {
  const surface = uvSphere({ radius: 10, segments: 24, rings: 16 });
  const points = Float32Array.from(surface.points);
  for (let v = 0; v < points.length / 3; v++) {
    if (points[3 * v + 2] > 6) {
      const scale = 1 + 0.15 * ((v * 7919) % 5) / 4;
      points[3 * v] *= scale;
      points[3 * v + 1] *= scale;
      points[3 * v + 2] *= scale;
    }
  }
  return { points, polys: surface.polys };
}

const cap = (surface, z) => verticesWhere(surface.points, ([, , pz]) => pz > z);

function positionsOf(points, indices) {
  return indices.map(v => [points[3 * v], points[3 * v + 1], points[3 * v + 2]]);
}

describe('smoothRegion', () => {
  it('splits the selection into its interior and its boundary ring', () => {
    const surface = uvSphere({ radius: 10, segments: 16, rings: 10 });
    const topology = selectionTopology(surface);
    const selected = cap(surface, 5);

    const { interior, boundary, weights } = smoothRegion(selected, topology, false);

    expect(interior.size).toBeGreaterThan(0);
    expect(boundary.size).toBeGreaterThan(0);
    expect(interior.size + boundary.size).toBe(selected.length);
    // Pinned boundary: only the interior moves
    expect(weights.size).toBe(interior.size);
    // Feathered boundary: it moves at half weight
    expect(smoothRegion(selected, topology, true).weights.get([...boundary][0])).toBe(0.5);
  });
});

describe('smoothSurface', () => {
  it('moves the interior of the region, pins its boundary, and leaves the rest alone', () => {
    const surface = bumpySphere();
    const selected = cap(surface, 6);
    const topology = selectionTopology(surface);
    const { boundary } = smoothRegion(selected, topology, false);
    const outside = verticesWhere(surface.points, ([, , z]) => z <= 6);

    const result = smoothSurface({ surface, selected, options: { strength: 0.5, passes: 3, feather: false } });

    expect(result.changed).toBe(true);
    expect(result.after.polys).toBe(surface.polys);
    expect(result.after.points).toHaveLength(surface.points.length);
    expect(result.flipped).toBe(0);
    expect(result.degenerate).toBe(0);
    expect(result.maxDisplacement).toBeGreaterThan(0.05);
    // The boundary ring and everything outside the region did not move
    expect(positionsOf(result.after.points, [...boundary])).toEqual(positionsOf(surface.points, [...boundary]));
    expect(positionsOf(result.after.points, outside)).toEqual(positionsOf(surface.points, outside));
    // The bumps are smaller: the interior's radii vary less than before
    const radii = points => selected.map(v => Math.hypot(points[3 * v], points[3 * v + 1], points[3 * v + 2]));
    const spread = values => Math.max(...values) - Math.min(...values);
    expect(spread(radii(result.after.points))).toBeLessThan(spread(radii(surface.points)));
    // The edit box covers the moved vertices before and after
    expect(result.editBox.max[2]).toBeGreaterThan(9);
    expect(result.editBox.min[2]).toBeLessThan(result.editBox.max[2]);
  });

  it('lets the boundary move at half weight when feathering', () => {
    const surface = bumpySphere();
    const selected = cap(surface, 6);
    const topology = selectionTopology(surface);
    const { boundary } = smoothRegion(selected, topology, true);

    const result = smoothSurface({ surface, selected, options: { feather: true } });

    const moved = [...boundary].filter(v => positionsOf(result.after.points, [v])[0]
      .some((value, d) => value !== surface.points[3 * v + d]));
    expect(moved.length).toBeGreaterThan(0);
    expect(result.moved).toBe(selected.length);
  });

  it('moves coincident vertices together, so no edge opens', () => {
    // The sphere with one cap vertex duplicated: triangles on either side of it use different copies
    const base = bumpySphere();
    const duplicated = base.points.length / 3;
    const target = cap(base, 8)[1];
    const points = new Float32Array(base.points.length + 3);
    points.set(base.points);
    points.set(base.points.subarray(3 * target, 3 * target + 3), 3 * duplicated);
    const polys = Int32Array.from(base.polys);
    let swapped = 0;
    for (let i = 0; i < polys.length; i += 4) {
      for (let k = 1; k <= 3 && swapped < 2; k++) {
        if (polys[i + k] === target) {
          polys[i + k] = duplicated;
          swapped++;
        }
      }
    }
    expect(swapped).toBe(2);
    const surface = { points, polys };
    expect(findBoundaryLoops(surface.polys)).toHaveLength(0);

    const result = smoothSurface({ surface, selected: [...cap(surface, 6), duplicated], options: { feather: false } });

    expect(Array.from(result.after.points.subarray(3 * duplicated, 3 * duplicated + 3)))
      .toEqual(Array.from(result.after.points.subarray(3 * target, 3 * target + 3)));
    expect(result.after.points.subarray(3 * target, 3 * target + 3))
      .not.toEqual(surface.points.subarray(3 * target, 3 * target + 3));
  });

  it('has nothing to smooth when the selection has no interior and no feather', () => {
    const surface = uvSphere({ radius: 10, segments: 16, rings: 10 });
    const selected = [1, 2, 3]; // three ring vertices: every one has unselected neighbours

    const result = smoothSurface({ surface, selected, options: { feather: false } });

    expect(result.changed).toBe(false);
    expect(result.after).toBeNull();
    expect(result.moved).toBe(0);
  });

  it('takes a triangle selection: the interior is the vertices all of whose faces are selected', () => {
    const surface = bumpySphere();
    const cells = [];
    for (let t = 0; t < surface.polys.length / 4; t++) {
      if ([1, 2, 3].every(k => surface.points[3 * surface.polys[4 * t + k] + 2] > 6)) {
        cells.push(t);
      }
    }
    const topology = selectionTopology(surface);
    const { interior, boundary } = smoothRegion([], topology, false, {
      selectedTriangles: cells, triangleTopology: triangleTopology(surface),
    });
    expect(interior.size).toBeGreaterThan(0);
    expect(boundary.size).toBeGreaterThan(0);
    // The boundary ring: vertices of selected triangles with an unselected triangle around them
    boundary.forEach(c => expect(surface.points[3 * c + 2]).toBeGreaterThan(6));

    const result = smoothSurface({ surface, selectedTriangles: cells, options: { feather: false } });

    expect(result.changed).toBe(true);
    expect(result.moved).toBe(interior.size);
    expect(positionsOf(result.after.points, [...boundary])).toEqual(positionsOf(surface.points, [...boundary]));
  });

  it('does not move a flat region', () => {
    // A regular grid in the plane z = 0, triangulated; its interior vertices are already at the
    // mean of their neighbours
    const n = 7;
    const points = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        points.push(i, j, 0);
      }
    }
    const polys = [];
    const id = (i, j) => j * n + i;
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        polys.push(3, id(i, j), id(i + 1, j), id(i + 1, j + 1), 3, id(i, j), id(i + 1, j + 1), id(i, j + 1));
      }
    }
    const surface = { points: Float32Array.from(points), polys: Int32Array.from(polys) };
    const selected = [];
    for (let j = 1; j < n - 1; j++) {
      for (let i = 1; i < n - 1; i++) {
        selected.push(id(i, j));
      }
    }

    const result = smoothSurface({ surface, selected, options: { passes: 5 } });

    expect(result.changed).toBe(true);
    expect(result.maxDisplacement).toBeLessThan(1e-5);
  });
});
