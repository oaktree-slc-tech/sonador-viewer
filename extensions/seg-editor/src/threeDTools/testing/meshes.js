// Test meshes and checks for the 3D tool geometry tests.

/**
 * A closed, welded UV sphere as a Cornerstone3D surface (flat points, VTK cell array polys).
 */
export function uvSphere({ radius = 10, segments = 16, rings = 10, center = [0, 0, 0] } = {}) {
  const points = [center[0], center[1], center[2] + radius];
  for (let i = 1; i < rings; i++) {
    const theta = (Math.PI * i) / rings;
    for (let j = 0; j < segments; j++) {
      const phi = (2 * Math.PI * j) / segments;
      points.push(
        center[0] + radius * Math.sin(theta) * Math.cos(phi),
        center[1] + radius * Math.sin(theta) * Math.sin(phi),
        center[2] + radius * Math.cos(theta));
    }
  }
  points.push(center[0], center[1], center[2] - radius);
  const south = points.length / 3 - 1;
  const id = (i, j) => 1 + (i - 1) * segments + ((j + segments) % segments);

  const polys = [];
  for (let j = 0; j < segments; j++) {
    polys.push(3, 0, id(1, j), id(1, j + 1));
  }
  for (let i = 1; i < rings - 1; i++) {
    for (let j = 0; j < segments; j++) {
      polys.push(3, id(i, j), id(i + 1, j), id(i + 1, j + 1));
      polys.push(3, id(i, j), id(i + 1, j + 1), id(i, j + 1));
    }
  }
  for (let j = 0; j < segments; j++) {
    polys.push(3, south, id(rings - 1, j + 1), id(rings - 1, j));
  }
  return { points: Float32Array.from(points), polys: Int32Array.from(polys) };
}

/** Edge-use counts of a VTK cell array (triangles): a closed manifold uses every edge twice. */
export function edgeUse(polys) {
  const counts = new Map();
  let i = 0;
  while (i < polys.length) {
    const count = polys[i];
    const cell = Array.from(polys.slice(i + 1, i + 1 + count));
    cell.forEach((a, k) => {
      const b = cell[(k + 1) % count];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    i += count + 1;
  }
  return counts;
}

export function isClosedManifold(polys) {
  return [...edgeUse(polys).values()].every(count => count === 2);
}

/** Vertex indices of a surface whose position satisfies `predicate([x, y, z])`. */
export function verticesWhere(points, predicate) {
  const selected = [];
  for (let v = 0; v < points.length / 3; v++) {
    if (predicate([points[3 * v], points[3 * v + 1], points[3 * v + 2]])) {
      selected.push(v);
    }
  }
  return selected;
}

/**
 * Point-in-closed-mesh by ray parity (+x ray), with a small skew to stay off edges. Stands in for
 * the polymorphic segmentation voxelizer in tests.
 */
export function insideMesh({ points, polys }, [x, y, z]) {
  const dy = 1e-7;
  const dz = 2e-7;
  let crossings = 0;
  let i = 0;
  while (i < polys.length) {
    const count = polys[i];
    for (let k = 2; k < count; k++) {
      const [a, b, c] = [polys[i + 1], polys[i + k], polys[i + k + 1]].map(v => [
        points[3 * v], points[3 * v + 1], points[3 * v + 2]]);
      // Intersect the ray (x, y + dy, z + dz) + t (1, 0, 0), t > 0, with triangle abc
      const py = y + dy;
      const pz = z + dz;
      const d1 = (b[1] - a[1]) * (pz - a[2]) - (b[2] - a[2]) * (py - a[1]);
      const d2 = (c[1] - b[1]) * (pz - b[2]) - (c[2] - b[2]) * (py - b[1]);
      const d3 = (a[1] - c[1]) * (pz - c[2]) - (a[2] - c[2]) * (py - c[1]);
      if ((d1 > 0 && d2 > 0 && d3 > 0) || (d1 < 0 && d2 < 0 && d3 < 0)) {
        // x of the triangle's plane at (py, pz)
        const n = [
          (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
          (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
          (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
        ];
        if (n[0]) {
          const hitX = a[0] - (n[1] * (py - a[1]) + n[2] * (pz - a[2])) / n[0];
          if (hitX > x) {
            crossings++;
          }
        }
      }
    }
    i += count + 1;
  }
  return crossings % 2 === 1;
}

/**
 * A voxelizer result (axis-aligned grid over the surface's point bounds) computed with
 * insideMesh; mirrors the polymorphic segmentation result shape.
 */
export function voxelizeByParity(surface, cells = 24) {
  const { points } = surface;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < points.length; v += 3) {
    for (let d = 0; d < 3; d++) {
      min[d] = Math.min(min[d], points[v + d]);
      max[d] = Math.max(max[d], points[v + d]);
    }
  }
  const spacing = Math.max(...max.map((value, d) => value - min[d])) / cells;
  const dimensions = max.map((value, d) => Math.floor((value - min[d]) / spacing) + 1);
  const data = new Uint8Array(dimensions[0] * dimensions[1] * dimensions[2]);
  for (let k = 0; k < dimensions[2]; k++) {
    for (let j = 0; j < dimensions[1]; j++) {
      for (let i = 0; i < dimensions[0]; i++) {
        const p = [min[0] + i * spacing, min[1] + j * spacing, min[2] + k * spacing];
        data[i + dimensions[0] * (j + dimensions[1] * k)] = insideMesh(surface, p) ? 1 : 0;
      }
    }
  }
  return { data, dimensions, origin: min, spacing: [spacing, spacing, spacing] };
}
