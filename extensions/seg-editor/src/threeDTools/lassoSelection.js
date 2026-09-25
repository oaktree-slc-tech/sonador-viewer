// Lasso selection of surface points for the 3D Selection tool (ohif-viewers#142, FR-18), after
// three-mesh-bvh's lasso-selection example: the lasso is drawn in screen space, each vertex of the
// target mesh is projected and tested against it, and only vertices the camera can see are kept.
// Visibility is a raycast from the camera towards the vertex against every visible mesh (the
// meshes carry three-mesh-bvh bounds trees, so each cast is fast): a vertex is hidden when
// something is hit in front of it.

import { Raycaster, Vector2, Vector3 } from 'three';


export const SELECTION_MODES = {
  replace: 'replace',
  add: 'add',
  subtract: 'subtract',
};

/**
 * Even-odd point-in-polygon test.
 *
 * @param {number} x
 * @param {number} y
 * @param {ArrayLike<number>} polygon - flat [x0, y0, x1, y1, ...], closed implicitly
 */
export function pointInPolygon(x, y, polygon) {
  let inside = false;
  const count = polygon.length / 2;
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const xi = polygon[2 * i];
    const yi = polygon[2 * i + 1];
    const xj = polygon[2 * j];
    const yj = polygon[2 * j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function _polygonBounds(polygon) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < polygon.length; i += 2) {
    minX = Math.min(minX, polygon[i]);
    maxX = Math.max(maxX, polygon[i]);
    minY = Math.min(minY, polygon[i + 1]);
    maxY = Math.max(maxY, polygon[i + 1]);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Vertices of `mesh` inside a lasso.
 *
 * @param {Object} params
 * @param {Mesh} params.mesh - the target mesh
 * @param {Camera} params.camera
 * @param {ArrayLike<number>} params.lasso - lasso polygon in normalized device coordinates
 * @param {Mesh[]} [params.occluders] - meshes that can hide the target's vertices (the target
 *   included); pass none to select regardless of visibility
 * @returns {number[]} vertex indices
 */
export function selectVerticesInLasso({ mesh, camera, lasso, occluders }) {
  if (!mesh?.geometry || lasso.length < 6) {
    return [];
  }
  const position = mesh.geometry.getAttribute('position');
  const bounds = _polygonBounds(lasso);
  mesh.updateMatrixWorld();
  camera.updateMatrixWorld();

  const radius = mesh.geometry.boundingSphere?.radius
    ?? (mesh.geometry.computeBoundingSphere(), mesh.geometry.boundingSphere.radius);
  const tolerance = Math.max(radius * 1e-3, 1e-6);

  const raycaster = new Raycaster();
  raycaster.firstHitOnly = true;
  const ndc = new Vector2();
  const world = new Vector3();
  const projected = new Vector3();

  const selected = [];
  for (let v = 0; v < position.count; v++) {
    world.fromBufferAttribute(position, v).applyMatrix4(mesh.matrixWorld);
    projected.copy(world).project(camera);
    const { x, y, z } = projected;
    if (z < -1 || z > 1 || x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) {
      continue;
    }
    if (!pointInPolygon(x, y, lasso)) {
      continue;
    }

    if (occluders?.length) {
      ndc.set(x, y);
      raycaster.setFromCamera(ndc, camera);
      const distance = raycaster.ray.origin.distanceTo(world);
      raycaster.far = distance - tolerance;
      if (raycaster.far > 0 && raycaster.intersectObjects(occluders, false).length) {
        continue; // something in front of the vertex
      }
    }
    selected.push(v);
  }
  return selected;
}

/**
 * Combine a lasso's vertices with the current selection.
 *
 * @param {Set<number>} current
 * @param {number[]} lassoed
 * @param {string} mode - SELECTION_MODES
 * @returns {Set<number>}
 */
export function combineSelection(current, lassoed, mode) {
  if (mode === SELECTION_MODES.add) {
    const next = new Set(current);
    lassoed.forEach(v => next.add(v));
    return next;
  }
  if (mode === SELECTION_MODES.subtract) {
    const next = new Set(current);
    lassoed.forEach(v => next.delete(v));
    return next;
  }
  return new Set(lassoed);
}

/** Selection mode for a pointer event's modifier keys: Shift adds, Ctrl/Cmd subtracts. */
export function selectionModeForEvent(event) {
  if (event?.ctrlKey || event?.metaKey) {
    return SELECTION_MODES.subtract;
  }
  if (event?.shiftKey) {
    return SELECTION_MODES.add;
  }
  return SELECTION_MODES.replace;
}
