// M3D <-> Cornerstone3D geometry-cache compatibility layer.
//
// Stores Three.js STL-series and GLB-scene data in the Cornerstone3D geometry cache so that loaded
// models can be reused across viewports without re-transmitting DICOM or duplicating parsed
// geometry in memory, while keeping per-viewport presentation state isolated. See the individual
// modules for the design rationale.

export { M3D_GEOMETRY_SCHEME, getM3DGeometryId, isM3DGeometryId, getSopInstanceUIDFromGeometryId } from './m3dGeometryId.js';
export { M3D_GEOMETRY_TYPE, m3dGeometryLoader, registerM3DGeometryLoader, disposeM3DPayload } from './m3dGeometryLoader.js';
export { acquireGeometry, releaseGeometry, getSourceBlob, getReferenceCount } from './m3dCacheService.js';
export { hydrateM3DInstance, disposeM3DInstance, DEFAULT_GEOMETRY_COLOR, DEFAULT_GEOMETRY_COLOR_HEX } from './hydrateM3DInstance.js';
export { M3D_SEGMENTATION_SCHEME, getM3DSegmentationId, registerM3DSegmentation, releaseM3DSegmentation } from './m3dSegmentationState.js';
