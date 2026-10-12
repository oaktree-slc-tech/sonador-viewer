// The triangle selection model: topology in the surface's own triangle order, and shaping by rings

import { uvSphere, verticesWhere } from './testing/meshes';
import {
  cleanRim,
  conditionSurface,
  growTriangles,
  largestConnectedTriangles,
  neighboursOf,
  shrinkTriangles,
  triangleComponents,
  trianglesAt,
  trianglesTouchingVertices,
  trianglesVertices,
  triangleTopology,
} from './meshRepair';


const sphere = uvSphere({ radius: 10, segments: 12, rings: 8 });
const topology = triangleTopology(sphere);
const northPole = verticesWhere(sphere.points, ([, , z]) => z > 9.9)[0];
const capCells = () => Array.from(trianglesAt(topology, topology.canonical[northPole]));

describe('triangleTopology', () => {
  it('links triangles across shared edges and lists the triangles at each vertex', () => {
    expect(topology.count).toBe(sphere.polys.length / 4);
    // A closed manifold: every triangle has exactly three edge neighbours
    for (let t = 0; t < topology.count; t++) {
      expect(neighboursOf(topology, t)).toHaveLength(3);
    }
    expect(capCells()).toHaveLength(12);
    // Typed arrays throughout, so a worker can hand it over as it is
    expect(topology.adjacency.items).toBeInstanceOf(Int32Array);
    expect(topology.vertexTriangles.offsets).toBeInstanceOf(Int32Array);
  });

  it('gives a degenerate triangle no neighbours, and conditionSurface its source index', () => {
    const polys = Int32Array.from([...sphere.polys, 3, 0, 0, 1]);
    const topo = triangleTopology({ points: sphere.points, polys });
    const last = polys.length / 4 - 1;
    expect(neighboursOf(topo, last)).toHaveLength(0);
    expect(neighboursOf(topo, 99999)).toHaveLength(0);

    const conditioned = conditionSurface({ points: sphere.points, polys });
    expect(conditioned.degenerate).toBe(1);
    expect(conditioned.source).toHaveLength(sphere.polys.length / 4);
    expect(Array.from(conditioned.source)).toEqual([...Array(sphere.polys.length / 4).keys()]);
  });

  it('maps a triangle selection to its vertices and back', () => {
    const cells = capCells();
    const vertices = trianglesVertices(cells, sphere.polys);
    expect(vertices.size).toBe(13);
    expect(vertices.has(northPole)).toBe(true);
    expect(trianglesTouchingVertices([northPole], topology)).toEqual(new Set(cells));
  });
});

describe('triangle selection shaping', () => {
  it('grows by one ring of edge neighbours and shrinks back', () => {
    const cap = new Set(capCells());
    const grown = growTriangles(cap, topology);
    expect(grown.size).toBe(12 + 12); // the next band's triangles sharing an edge with the cap
    expect(shrinkTriangles(grown, topology)).toEqual(cap);
    expect(shrinkTriangles(cap, topology).size).toBe(0);
  });

  it('splits a selection into edge-connected parts and keeps the largest', () => {
    const southPole = verticesWhere(sphere.points, ([, , z]) => z < -9.9)[0];
    const south = Array.from(trianglesAt(topology, topology.canonical[southPole]));
    const selected = new Set([...growTriangles(new Set(capCells()), topology), ...south]);

    const components = triangleComponents(selected, topology);
    expect(components).toHaveLength(2);
    expect(components[0].size).toBe(24);
    const largest = largestConnectedTriangles(selected, topology);
    expect(largest.size).toBe(24);
    expect(largest.has(south[0])).toBe(false);
  });
});

describe('cleanRim scoped to the rim', () => {
  // The sphere plus a separate tetrahedron far away, one surface
  const far = { points: [100, 0, 0, 101, 0, 0, 100, 1, 0, 100, 0, 1], polys: [3, 0, 1, 2, 3, 0, 3, 1, 3, 1, 3, 2, 3, 0, 2, 3] };
  const offset = sphere.points.length / 3;
  const points = Float32Array.from([...sphere.points, ...far.points]);
  const polys = Int32Array.from([...sphere.polys, ...far.polys.map((v, i) => (i % 4 === 0 ? v : v + offset))]);
  const { triangles, canonical } = conditionSurface({ points, polys });
  const tetrahedron = far.polys.length / 4;

  it('removes a small island only when it touches the rim', () => {
    // No rim given: the tetrahedron is an island and goes (the old behaviour)
    expect(cleanRim(triangles, { islandMaxTriangles: 50 }).islandsRemoved).toBe(1);

    // The rim is the sphere's cap: the tetrahedron is untouched, and nothing is reported removed
    const rim = new Set(capCells().flatMap(t => [0, 1, 2].map(k => canonical[polys[4 * t + 1 + k]])));
    const kept = triangles.filter((_, i) => !capCells().includes(Math.floor(i / 3)));
    const scoped = cleanRim(kept, { islandMaxTriangles: 50, touching: rim });
    expect(scoped.islandsRemoved).toBe(0);
    expect(scoped.triangles.length / 3).toBe(kept.length / 3);
    expect(scoped.removed).toHaveLength(0);
  });

  it('reports the triangles it removed', () => {
    // A lone triangle hanging off the rim by one vertex is an island of one; with the rim given
    // it still goes, and is reported
    const rimVertex = canonical[polys[4 * capCells()[0] + 1]];
    const fresh = points.length / 3; // two vertices nothing else uses, so the triangle shares no edge
    const extra = Int32Array.from([...triangles, rimVertex, fresh, fresh + 1]);
    const result = cleanRim(extra, { islandMaxTriangles: 1, touching: new Set([rimVertex]) });
    expect(result.islandsRemoved).toBe(1);
    expect(Array.from(result.removed)).toEqual([rimVertex, fresh, fresh + 1]);
    expect(result.triangles.length).toBe(triangles.length);
    expect(tetrahedron).toBe(4);
  });
});
