// Paint selection of surface faces for the 3D Paint tool (ohif-viewers#142, §13), after
// three-mesh-bvh's triangle-painting example: the brush is a sphere on the surface under the
// pointer. The ray from the camera through the pointer finds the first visible surface; when it is
// the target's, the triangles the sphere intersects (a BVH shapecast) are collected, and those
// connected to the hit triangle through them are selected (or erased). The ray keeps a stroke off
// surfaces hidden behind others, and connectivity keeps it off geometry the sphere covers without
// touching the hit piece: the far side of a wall thinner than the brush is reached only where the
// wall's faces connect to the hit side within the sphere (a fold, an edge, a closed rim), not
// across the gap.

import { Raycaster, Sphere, Vector2, Vector3 } from 'three';

import { neighboursOf } from './meshRepair.js';


/**
 * The first surface hit by the ray through a point of the view.
 *
 * @param {Object} params
 * @param {Camera} params.camera
 * @param {number[]} params.ndc - [x, y] in normalized device coordinates
 * @param {Object3D[]} params.objects - meshes that can be hit (the target among them)
 * @returns {{ object, point: Vector3, faceIndex: number, face }|null}
 */
export function raycastSurfaces({ camera, ndc, objects }) {
  if (!objects?.length) {
    return null;
  }
  camera.updateMatrixWorld();
  objects.forEach(object => object.updateMatrixWorld());
  const raycaster = new Raycaster();
  raycaster.firstHitOnly = true;
  raycaster.setFromCamera(new Vector2(ndc[0], ndc[1]), camera);
  const [hit] = raycaster.intersectObjects(objects, false);
  return hit || null;
}

/**
 * The triangles of a geometry a sphere intersects, through its bounds tree.
 *
 * @param {Object} params
 * @param {BufferGeometry} params.geometry - with a three-mesh-bvh bounds tree
 * @param {number[]} params.center - [x, y, z] in the geometry's own coordinates
 * @param {number} params.radius
 * @returns {number[]} triangle indices
 */
export function collectTrianglesInSphere({ geometry, center, radius }) {
  const bvh = geometry?.boundsTree;
  if (!bvh || !(radius > 0)) {
    return [];
  }
  const sphere = new Sphere(new Vector3(center[0], center[1], center[2]), radius);
  const hits = [];
  bvh.shapecast({
    intersectsBounds: box => sphere.intersectsBox(box),
    intersectsTriangle: (triangle, index) => {
      if (triangle.intersectsSphere(sphere)) {
        hits.push(index);
      }
      return false;
    },
  });
  return hits;
}

/**
 * The part of a collected triangle set connected to the hit triangle through shared edges. The
 * hit triangle itself counts even when the sphere missed it (a brush smaller than a triangle).
 *
 * @param {Object} params
 * @param {Iterable<number>} params.collected - triangle indices under the brush
 * @param {number} params.seed - the hit triangle
 * @param {Object} params.topology - triangleTopology
 * @returns {number[]} triangle indices
 */
export function connectedTriangles({ collected, seed, topology }) {
  const set = new Set(collected);
  const seen = new Set([seed]);
  const stack = [seed];
  const out = [];
  while (stack.length) {
    const t = stack.pop();
    out.push(t);
    neighboursOf(topology, t).forEach(n => {
      if (set.has(n) && !seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    });
  }
  return out;
}
