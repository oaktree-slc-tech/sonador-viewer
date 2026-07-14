// Geometry-cache identifiers for Medical 3D (M3D) models.
//
// Each STL instance and each GLB scene is stored as a single Cornerstone3D geometry-cache
// entry keyed by the SOPInstanceUID. The `m3d:` scheme prefix mirrors how volumes use
// `cornerstoneStreamingImageVolume:` and lets a registered geometry loader be selected by
// scheme (see m3dGeometryLoader.js).

export const M3D_GEOMETRY_SCHEME = 'm3d';

export function getM3DGeometryId(sopInstanceUID) {
  if (!sopInstanceUID) {
    throw new Error('getM3DGeometryId: sopInstanceUID is required');
  }
  return `${M3D_GEOMETRY_SCHEME}:${sopInstanceUID}`;
}

export function isM3DGeometryId(geometryId) {
  return typeof geometryId === 'string' && geometryId.indexOf(`${M3D_GEOMETRY_SCHEME}:`) === 0;
}

export function getSopInstanceUIDFromGeometryId(geometryId) {
  if (!isM3DGeometryId(geometryId)) {
    return undefined;
  }
  return geometryId.substring(M3D_GEOMETRY_SCHEME.length + 1);
}
