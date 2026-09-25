// Cornerstone3D surface geometry -> M3DModelView models.
//
// Cornerstone3D stores segmentation surfaces in its geometry cache (polymorphic segmentation's
// marching cubes output): `points` is a flat [x, y, z, ...] array in world (patient) millimetres,
// and `polys` is a VTK cell array ([n, i0 .. i(n-1), n, ...]; triangles in practice). This builds
// the same model shape the M3D viewer produces from STL series ({ geometryId, instance }), so the
// Segmentation Editor's 3D editing canvas and the M3D viewer share M3DModelView.
//
// The BufferGeometry built here is derived and owned by the model, unlike an STL model whose
// geometry is shared through the M3D cache, so disposeSurfaceModel releases both geometry and
// material.

import { BufferAttribute, BufferGeometry, Mesh } from 'three';

import { createModelMaterial } from './hydrateM3DInstance.js';

export const C3D_SURFACE_MODEL_TYPE = 'C3D_SURFACE';

/**
 * Triangle indices from a VTK cell array. Polygons with more than three points are fanned.
 *
 * @param {ArrayLike<number>} polys
 * @returns {Uint32Array}
 */
export function polysToTriangleIndices(polys) {
  const indices = [];
  let i = 0;
  while (i < polys.length) {
    const count = polys[i];
    // Stop at a malformed or truncated cell (its last point index is polys[i + count])
    if (!(count > 0) || i + count >= polys.length) {
      break;
    }
    const first = polys[i + 1];
    for (let k = 2; k < count; k++) {
      indices.push(first, polys[i + k], polys[i + k + 1]);
    }
    i += count + 1;
  }
  return Uint32Array.from(indices);
}

/**
 * @param {{ points: ArrayLike<number>, polys: ArrayLike<number> }} surface
 * @returns {BufferGeometry}
 */
export function surfaceToBufferGeometry(surface) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(surface.points), 3));
  geometry.setIndex(new BufferAttribute(polysToTriangleIndices(surface.polys), 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Build an M3DModelView model from a Cornerstone3D surface.
 *
 * @param {Object} params
 * @param {string} params.geometryId - the Cornerstone3D geometry-cache id of the surface
 * @param {Object} params.surface - the cached Surface (points, polys, segmentIndex)
 * @param {string|number} [params.color] - initial material colour
 * @param {string} [params.lightingModel] - the M3DModelView lighting model the model is shown with
 * @returns {{ geometryId, segmentIndex, m3dType, instance }}
 */
export function createSurfaceModel({ geometryId, surface, color, lightingModel }) {
  const instance = new Mesh(surfaceToBufferGeometry(surface), createModelMaterial(color, { lightingModel }));
  instance.name = geometryId;

  return {
    geometryId,
    segmentIndex: surface.segmentIndex,
    m3dType: C3D_SURFACE_MODEL_TYPE,
    instance,
  };
}

/** Release the Three.js resources a surface model owns. */
export function disposeSurfaceModel(model) {
  const instance = model?.instance;
  if (!instance) {
    return;
  }
  instance.geometry?.dispose();
  const materials = Array.isArray(instance.material) ? instance.material : [instance.material];
  materials.forEach(material => material?.dispose?.());
}
