// Paint selection: the brush is a sphere on the surface under the pointer, and a stroke selects
// the triangles it covers that are connected to what it hit

import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
} from 'three';

import { ensureBoundsTree } from '../threejs/meshBvh';

import { uvSphere } from './testing/meshes';
import { polysToTriangles, triangleTopology } from './meshRepair';
import { collectTrianglesInSphere, connectedTriangles, raycastSurfaces } from './paintSelection';


// An indexed geometry over the surface's own vertices, as the canvas builds its meshes
function sphereMesh(surface) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(surface.points), 3));
  geometry.setIndex(new BufferAttribute(polysToTriangles(surface.polys), 1));
  ensureBoundsTree(geometry);
  const mesh = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }));
  mesh.updateMatrixWorld();
  return mesh;
}

function frontCamera() {
  // Looking down -z at the origin
  const camera = new OrthographicCamera(-20, 20, 20, -20, 0.1, 200);
  camera.position.set(0, 0, 100);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

const centroid = (surface, t) => [0, 1, 2].map(d =>
  [1, 2, 3].reduce((sum, k) => sum + surface.points[3 * surface.polys[4 * t + k] + d], 0) / 3);

describe('raycastSurfaces', () => {
  it('finds the first surface under a point of the view, nearest to the camera', () => {
    const near = sphereMesh(uvSphere({ radius: 5, center: [0, 0, 10] }));
    const far = sphereMesh(uvSphere({ radius: 10, center: [0, 0, -10] }));

    const hit = raycastSurfaces({ camera: frontCamera(), ndc: [0, 0], objects: [far, near] });

    expect(hit.object).toBe(near);
    expect(hit.point.z).toBeCloseTo(15, 0);
    expect(hit.faceIndex).toBeGreaterThanOrEqual(0);
    expect(raycastSurfaces({ camera: frontCamera(), ndc: [0.99, 0.99], objects: [far, near] })).toBeNull();
    expect(raycastSurfaces({ camera: frontCamera(), ndc: [0, 0], objects: [] })).toBeNull();
  });
});

describe('collectTrianglesInSphere', () => {
  const surface = uvSphere({ radius: 10, segments: 24, rings: 16 });

  it('collects the triangles the sphere intersects', () => {
    const mesh = sphereMesh(surface);

    const hits = collectTrianglesInSphere({ geometry: mesh.geometry, center: [0, 0, 10], radius: 3 });

    expect(hits.length).toBeGreaterThan(3);
    hits.forEach(t => {
      const [x, y, z] = centroid(surface, t);
      expect(Math.hypot(x, y, z - 10)).toBeLessThan(3 + 3); // within the brush plus a triangle's size
    });
    expect(collectTrianglesInSphere({ geometry: mesh.geometry, center: [0, 0, 10], radius: 6 }).length)
      .toBeGreaterThan(hits.length);
    expect(collectTrianglesInSphere({ geometry: mesh.geometry, center: [0, 0, 10], radius: 0 })).toEqual([]);
    expect(collectTrianglesInSphere({ geometry: new BufferGeometry(), center: [0, 0, 10], radius: 1 })).toEqual([]);
  });
});

describe('connectedTriangles', () => {
  it('keeps the part of the brush connected to the hit, and the hit triangle itself', () => {
    // Two spheres 1 apart, one surface: a brush spanning the gap stays on the sphere it hit
    const a = uvSphere({ radius: 5, center: [0, 0, 0] });
    const b = uvSphere({ radius: 5, center: [11, 0, 0] });
    const offset = a.points.length / 3;
    const polysB = Int32Array.from(b.polys);
    for (let i = 0; i < polysB.length; i += 4) {
      polysB[i + 1] += offset;
      polysB[i + 2] += offset;
      polysB[i + 3] += offset;
    }
    const points = new Float32Array(a.points.length + b.points.length);
    points.set(a.points);
    points.set(b.points, a.points.length);
    const polys = new Int32Array(a.polys.length + polysB.length);
    polys.set(a.polys);
    polys.set(polysB, a.polys.length);
    const two = { points, polys };
    const mesh = sphereMesh(two);
    const topology = triangleTopology(two);
    const cellsOfA = a.polys.length / 4;

    const collected = collectTrianglesInSphere({ geometry: mesh.geometry, center: [5.5, 0, 0], radius: 4 });
    expect(collected.some(t => t >= cellsOfA)).toBe(true); // the brush reaches both spheres
    const seed = collected.find(t => t < cellsOfA);

    const selected = connectedTriangles({ collected, seed, topology });

    expect(selected.length).toBeGreaterThan(0);
    selected.forEach(t => expect(t).toBeLessThan(cellsOfA));
    expect(new Set(selected)).toEqual(new Set(collected.filter(t => t < cellsOfA)));

    // A brush smaller than its triangle still selects the hit triangle
    expect(connectedTriangles({ collected: [], seed: 7, topology })).toEqual([7]);
  });
});
