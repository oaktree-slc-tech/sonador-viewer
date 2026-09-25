// Hydrate a cached M3D payload into a per-viewport Three.js instance.
//
// The cache holds one immutable, shareable payload per model. Each viewport gets its OWN cheap
// instance built here, so that mutable presentation state (visibility, material, transform,
// animation) is private and never leaks between viewports — while the heavy data (BufferGeometry
// attribute buffers, glTF geometries/materials) is shared by reference.
//
//   STL: a fresh Mesh over the SHARED BufferGeometry, with its OWN Material (so colour/opacity
//        edits stay local). Geometry is owned by the cache; only the material is per-instance.
//   GLB: SkeletonUtils.clone of the cached scene — NOT Object3D.clone(), which breaks skinned-mesh
//        and animation bindings. The clone shares geometries/materials by reference with the
//        cached template (memory-light); only the node graph is duplicated. AnimationClips are
//        immutable and safe to share; each viewport binds them to its own AnimationMixer.

import {
  Color,
  DoubleSide,
  LinearSRGBColorSpace,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
} from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';

import { M3D_GEOMETRY_TYPE } from './m3dGeometryLoader.js';

// Matches M3DModelView's defaultGeometryColor.
export const DEFAULT_GEOMETRY_COLOR = 0x049ef4;

// Hex-string form of the default colour, for consumers that track colours as '#rrggbb' strings
// (segment presentation metadata, colour pickers).
export const DEFAULT_GEOMETRY_COLOR_HEX = '#' + DEFAULT_GEOMETRY_COLOR.toString(16).padStart(6, '0');

function resolveColor(color) {
  if (color === undefined || color === null) {
    return DEFAULT_GEOMETRY_COLOR;
  }
  return new Color(color).getHex();
}

// The per-instance material of a single-mesh model (STL, and the Segmentation Editor's surfaces),
// so every M3D view renders meshes with the same appearance.
//
// lightingModel 'vtk' (M3DModelView lightingModel="vtk"): VTK's default surface look, i.e.
// diffuse-only (ambient 0, specular 0), lit on both sides (VTK's two-sided lighting), with the
// colour taken as a display-space value, as VTK uses it.
export function createModelMaterial(color, { lightingModel = 'm3d' } = {}) {
  if (lightingModel === 'vtk') {
    const displayColor = new Color();
    if (color === undefined || color === null) {
      displayColor.setHex(DEFAULT_GEOMETRY_COLOR, LinearSRGBColorSpace);
    } else if (typeof color === 'number') {
      displayColor.setHex(color, LinearSRGBColorSpace);
    } else {
      displayColor.setStyle(color, LinearSRGBColorSpace);
    }
    return new MeshLambertMaterial({ color: displayColor, side: DoubleSide });
  }

  return new MeshStandardMaterial({
    color: resolveColor(color),
    envMapIntensity: 0.0,
    roughness: 0.9,
  });
}

// Returns:
//   STL -> THREE.Mesh
//   GLB -> { scene: THREE.Object3D, animations: THREE.AnimationClip[] }
// The shape mirrors what M3DModelView already consumes (a mesh to group, or a {scene, animations}).
export function hydrateM3DInstance(payload) {
  if (!payload || !payload.parsed) {
    throw new Error('hydrateM3DInstance: payload has no parsed data');
  }

  if (payload.type === M3D_GEOMETRY_TYPE.GLB) {
    return {
      scene: skeletonClone(payload.parsed.scene),
      animations: payload.parsed.animations || [],
    };
  }

  // STL
  return new Mesh(payload.parsed, createModelMaterial(payload.meta && payload.meta.color));
}

// Dispose only the resources OWNED by this per-viewport instance. The shared, cached data
// (BufferGeometry for STL; geometries/materials for GLB clones) is owned by the cache entry and is
// freed by the loader's `decache` when the last reference is released — disposing it here would
// corrupt other viewports still using it.
export function disposeM3DInstance(instance, type) {
  if (!instance) {
    return;
  }

  // GLB clones share geometry AND materials with the cached template; nothing here is
  // per-instance, so there is nothing to dispose. Detaching from the scene is the caller's job.
  if (type === M3D_GEOMETRY_TYPE.GLB || instance.scene) {
    return;
  }

  // STL Mesh: the material was created in hydrate (per-instance) -> dispose it. The geometry is
  // shared/cached -> leave it alone.
  const material = instance.material;
  if (Array.isArray(material)) {
    material.forEach((m) => m && m.dispose && m.dispose());
  } else if (material && material.dispose) {
    material.dispose();
  }
}
