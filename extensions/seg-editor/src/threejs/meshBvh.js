// three-mesh-bvh wiring for the 3D editing tools (ohif-viewers#142).
//
// A bounding volume hierarchy makes raycasts and spatial queries against the segment surface
// meshes fast enough for interactive tools. three-mesh-bvh installs through prototype extensions,
// so the helpers here install them once and keep the per-geometry bookkeeping in one place.
// Meshes without a bounds tree keep three's own raycast.

import { BufferGeometry, Mesh } from 'three';
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
  MeshBVH,
} from 'three-mesh-bvh';


let installed = false;

/** Installs the three-mesh-bvh prototype extensions (idempotent). */
export function installMeshBvh() {
  if (installed) {
    return;
  }

  BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
  BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
  Mesh.prototype.raycast = acceleratedRaycast;
  installed = true;
}

/**
 * Returns the geometry's bounds tree, building it on first use.
 *
 * @param {BufferGeometry} geometry
 * @param {Object} [options] - MeshBVH options
 * @returns {MeshBVH}
 */
export function ensureBoundsTree(geometry, options = {}) {
  installMeshBvh();

  if (!geometry.boundsTree) {
    geometry.computeBoundsTree(options);
  }

  return geometry.boundsTree;
}

/** Rebuilds the bounds tree after the geometry's positions changed. */
export function refreshBoundsTree(geometry, options = {}) {
  installMeshBvh();
  geometry.disposeBoundsTree();
  geometry.computeBoundsTree(options);
  return geometry.boundsTree;
}

/** Drops the bounds tree; call alongside geometry disposal. */
export function releaseBoundsTree(geometry) {
  if (geometry && geometry.boundsTree) {
    geometry.disposeBoundsTree();
  }
}

export { MeshBVH };
