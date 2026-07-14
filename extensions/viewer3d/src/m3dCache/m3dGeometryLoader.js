// Cornerstone3D geometry loader for Medical 3D (M3D) models.
//
// Registered under the `m3d:` scheme. The loader produces an IGeometry-shaped payload that the
// Cornerstone3D geometry cache stores verbatim (the cache only requires `id` + numeric
// `sizeInBytes`; it does not enforce GeometryType — see core cache.js `_putGeometryCommon`).
//
// The payload deliberately separates the IMMUTABLE, shareable data (raw STL/GLB bytes + parsed
// BufferGeometry / parsed glTF) from any per-viewport presentation. Hydration into a per-viewport
// Three.js Object3D happens elsewhere (hydrateM3DInstance.js) so that visibility/material/transform
// state never flows between viewports.
//
// The loader never performs network I/O directly: the caller supplies a `fetchRawData` thunk that
// resolves the full DICOM byte stream (cache-first orchestration lives in m3dCacheService.js, so on
// a cache hit this loader — and therefore `fetchRawData` — is never invoked).

import dicomParser from 'dicom-parser';
import { geometryLoader } from '@cornerstonejs/core';

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader';

import { MIMETYPE_GLB, MIMETYPE_STL } from '../sopClassHandlers/OHIFDicom3DSopClassHandler.js';

export const M3D_GEOMETRY_TYPE = {
  STL: 'M3D_STL',
  GLB: 'M3D_GLB',
};

// Extract the encapsulated document (the actual STL/GLB file) from the parsed DICOM dataset.
// Uint8Array.prototype.slice copies into a fresh, tightly-packed ArrayBuffer (unlike subarray),
// so the returned bytes are exactly the document and are safe to hand to Three.js loaders and to
// retain as the original-file reference.
function extractEncapsulatedDocument(dataSet) {
  const fileTag = dataSet.elements.x00420011;
  if (!fileTag) {
    throw new Error('m3dGeometryLoader: dataset has no encapsulated document (x00420011)');
  }
  const offset = fileTag.dataOffset;
  const remainder = offset + fileTag.length;
  return dataSet.byteArray.slice(offset, remainder);
}

function toArrayBuffer(u8) {
  return u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength
    ? u8.buffer
    : u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

function geometryBytes(geometry) {
  let total = 0;
  if (geometry.index && geometry.index.array) {
    total += geometry.index.array.byteLength;
  }
  const attributes = geometry.attributes || {};
  Object.keys(attributes).forEach((name) => {
    if (attributes[name] && attributes[name].array) {
      total += attributes[name].array.byteLength;
    }
  });
  return total;
}

function estimateParsedBytes(parsed, type) {
  if (type === M3D_GEOMETRY_TYPE.GLB) {
    let total = 0;
    parsed.scene.traverse((obj) => {
      if (obj.geometry) {
        total += geometryBytes(obj.geometry);
      }
    });
    return total;
  }
  // STL: parsed is a single BufferGeometry
  return geometryBytes(parsed);
}

function disposeMaterial(material) {
  if (Array.isArray(material)) {
    material.forEach((m) => m && m.dispose && m.dispose());
  } else if (material && material.dispose) {
    material.dispose();
  }
}

// Free everything the cache entry owns. Fired by cache.removeGeometryLoadObject (i.e. by the
// cache service once the last viewport releases its reference).
export function disposeM3DPayload(payload) {
  if (!payload) {
    return;
  }
  if (payload.type === M3D_GEOMETRY_TYPE.GLB && payload.parsed && payload.parsed.scene) {
    payload.parsed.scene.traverse((obj) => {
      if (obj.geometry && obj.geometry.dispose) {
        obj.geometry.dispose();
      }
      if (obj.material) {
        disposeMaterial(obj.material);
      }
    });
  } else if (payload.parsed && payload.parsed.dispose) {
    // STL BufferGeometry
    payload.parsed.dispose();
  }
  payload.parsed = null;
  payload.source = null;
}

async function parseDocument(docBytes, { mimeType, getStaticUrl }) {
  if (mimeType === MIMETYPE_GLB) {
    const loader = new GLTFLoader();
    if (getStaticUrl && typeof getStaticUrl === 'function' && getStaticUrl()) {
      // GLB assets may be DRACO-compressed; the decoder must be staged from a static server.
      const dracoLoader = new DRACOLoader();
      dracoLoader.setDecoderPath(getStaticUrl() + '/threejs/lib/draco/gltf/');
      loader.setDRACOLoader(dracoLoader);
    }
    const gltf = await loader.parseAsync(toArrayBuffer(docBytes), '');
    return {
      type: M3D_GEOMETRY_TYPE.GLB,
      parsed: { scene: gltf.scene, animations: gltf.animations || [] },
    };
  }

  // STL (default). STLLoader.parse is synchronous and returns a BufferGeometry.
  const geometry = new STLLoader().parse(toArrayBuffer(docBytes));
  return { type: M3D_GEOMETRY_TYPE.STL, parsed: geometry };
}

async function buildPayload(geometryId, rawBuffer, options) {
  const { color, getStaticUrl } = options;

  const byteArray = rawBuffer instanceof Uint8Array ? rawBuffer : new Uint8Array(rawBuffer);
  const dataSet = dicomParser.parseDicom(byteArray);
  const mimeType = dataSet.string('x00420012');
  const sopInstanceUID = dataSet.string('x00080018');
  const docBytes = extractEncapsulatedDocument(dataSet);

  const { type, parsed } = await parseDocument(docBytes, { mimeType, getStaticUrl });

  const sourceArrayBuffer = toArrayBuffer(docBytes);
  const sizeInBytes = sourceArrayBuffer.byteLength + estimateParsedBytes(parsed, type);

  return {
    id: geometryId,
    type,
    // Convenience MIME that maps onto the sopClassHandler constants the viewer already speaks.
    mimeType: type === M3D_GEOMETRY_TYPE.GLB ? MIMETYPE_GLB : MIMETYPE_STL,
    sizeInBytes,
    // Original file data retained for downstream consumers (e.g. OpenCascade.js). Nothing is
    // built on this yet — it is reserved per the design and counted toward sizeInBytes.
    source: { arrayBuffer: sourceArrayBuffer, mimeType, sopInstanceUID },
    // Immutable, shareable parsed data. Hydrated per-viewport via hydrateM3DInstance.
    parsed,
    meta: { color },
  };
}

// GeometryLoaderFn: (geometryId, options) => { promise, cancelFn, decache }
export function m3dGeometryLoader(geometryId, options = {}) {
  const { fetchRawData } = options;
  if (typeof fetchRawData !== 'function') {
    throw new Error('m3dGeometryLoader: options.fetchRawData thunk is required');
  }

  let canceled = false;
  let payload;

  const promise = (async () => {
    const rawBuffer = await fetchRawData();
    if (canceled) {
      throw new Error(`m3dGeometryLoader: load canceled for ${geometryId}`);
    }
    payload = await buildPayload(geometryId, rawBuffer, options);
    return payload;
  })();

  return {
    promise,
    cancelFn: () => {
      canceled = true;
    },
    decache: () => {
      disposeM3DPayload(payload);
      payload = undefined;
    },
  };
}

let registered = false;

export function registerM3DGeometryLoader() {
  if (registered) {
    return;
  }
  geometryLoader.registerGeometryLoader('m3d', m3dGeometryLoader);
  registered = true;
}
