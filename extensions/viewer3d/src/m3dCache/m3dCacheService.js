// Reference-counted cache layer for Medical 3D (M3D) models, on top of the Cornerstone3D
// geometry cache.
//
// This wrapper exists because the C3D geometry cache, unlike its image/volume caches, provides
// neither reference counting nor automatic eviction for geometry:
//   - No `sharedCacheKey` for geometry, so the cache cannot tell when an entry is still in use.
//   - `decacheIfNecessaryUntilBytesAvailable` only walks the image cache; geometry never auto-evicts.
//   - `putGeometryLoadObject` throws if the id is already present, so concurrent loads must be
//     single-flighted.
//
// `loadAndCacheGeometry` already supplies cache-first + single-flight semantics (it returns the
// existing in-flight/loaded load object without re-invoking the loader). On top of that we keep a
// `Map<geometryId, Set<viewportId>>` so a model stays resident while ANY viewport holds it and is
// freed (via `removeGeometryLoadObject`, which fires the loader's `decache`) only when the last
// viewport releases it. This is what makes cached models reusable across viewports without
// re-transmitting DICOM or duplicating parsed geometry in memory.

import { cache as c3dCache, geometryLoader } from '@cornerstonejs/core';

const refCounts = new Map(); // geometryId -> Set<viewportId>

function addRef(geometryId, viewportId) {
  let owners = refCounts.get(geometryId);
  if (!owners) {
    owners = new Set();
    refCounts.set(geometryId, owners);
  }
  owners.add(viewportId);
}

// Load (or reuse) the cached payload for a geometry and register a viewport reference against it.
// On a cache hit no network request or parse occurs — the registered m3d loader (and therefore the
// caller's `fetchRawData` thunk) is never invoked. This satisfies the "consult the cache before
// retrieving from the cloud" requirement.
//
// options is forwarded to the m3d geometry loader on a miss; it must include:
//   - fetchRawData: () => Promise<ArrayBuffer|Uint8Array>  (full DICOM byte stream)
//   - color?:       per-instance display colour (hex string/number) stored in payload.meta
//   - getStaticUrl?: () => string                          (DRACO decoder path for GLB)
export async function acquireGeometry(geometryId, viewportId, options = {}) {
  if (!geometryId) {
    throw new Error('acquireGeometry: geometryId is required');
  }
  if (!viewportId) {
    throw new Error('acquireGeometry: viewportId is required');
  }

  const payload = await geometryLoader.loadAndCacheGeometry(geometryId, options);
  addRef(geometryId, viewportId);
  return payload;
}

// Drop a viewport's reference. When the last reference is released the underlying cache entry is
// removed, which fires the loader's `decache` and disposes the shared parsed data + source bytes.
export function releaseGeometry(geometryId, viewportId) {
  const owners = refCounts.get(geometryId);
  if (!owners) {
    return;
  }
  owners.delete(viewportId);
  if (owners.size > 0) {
    return;
  }

  refCounts.delete(geometryId);
  if (c3dCache.getGeometryLoadObject(geometryId)) {
    c3dCache.removeGeometryLoadObject(geometryId);
  }
}

// Retrieve the original STL/GLB file bytes as a Blob for downstream consumers (e.g. OpenCascade.js).
// Returns null if the entry is not cached or its source has been released.
export function getSourceBlob(geometryId) {
  const payload = c3dCache.getGeometry(geometryId);
  if (!payload || !payload.source || !payload.source.arrayBuffer) {
    return null;
  }
  return new Blob([payload.source.arrayBuffer], { type: payload.source.mimeType });
}

// Number of live viewport references for a geometry (primarily for diagnostics/tests).
export function getReferenceCount(geometryId) {
  const owners = refCounts.get(geometryId);
  return owners ? owners.size : 0;
}
