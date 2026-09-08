// The one image loader registered with legacy cornerstone-core.
//
// Every scheme the viewer emits resolves through here, and here resolves through Cornerstone3D.
// The legacy library never decodes again: `cornerstone-wado-image-loader` and its web workers are
// not configured or started, so a `wadors:` or `wadouri:` id reaching legacy `loadAndCacheImage`
// has nowhere else to go.
//
// Direction is one-way. The bridge never puts anything into the Cornerstone3D cache itself and
// never decodes; it asks Cornerstone3D for the image and waits. That keeps eviction, pooling and
// pixel ownership in one place.

import { imageLoader as c3dImageLoader, Enums as c3dEnums } from '@cornerstonejs/core';

import toLegacyImage from './toLegacyImage.js';

// The schemes the viewer generates: WADO-RS and WADO-URI for remote studies, `dicomfile:` for
// local upload, `sonadorlocal:` for the offline cache. `dicomweb:` is the legacy alias the older
// study-list paths still emit.
export const BRIDGED_SCHEMES = ['wadors', 'dicomweb', 'wadouri', 'dicomfile', 'sonadorlocal'];

// Legacy request classes map one-to-one onto Cornerstone3D's. Both libraries use the same three
// names for the same intent, so this is a validation step rather than a translation: an
// unrecognised value falls back to the lowest class rather than being passed through, because
// Cornerstone3D's pool manager keys its queues on the enum and would otherwise create a queue
// nothing drains.
const REQUEST_TYPE_BY_LEGACY_NAME = {
  interaction: c3dEnums.RequestType.Interaction,
  thumbnail: c3dEnums.RequestType.Thumbnail,
  prefetch: c3dEnums.RequestType.Prefetch,
};

export function toRequestType(legacyRequestType) {
  return REQUEST_TYPE_BY_LEGACY_NAME[legacyRequestType] || c3dEnums.RequestType.Prefetch;
}

/**
 * Build the loader function. One instance serves every scheme -- the scheme is already encoded in
 * the imageId, and Cornerstone3D dispatches on it again on the other side.
 *
 * @returns {(imageId: string, options?: object) => {promise: Promise, cancelFn: Function, decache: Function}}
 */
export function createBridgeLoader() {
  return function bridgeImageLoader(imageId, options) {
    const { requestType, priority, additionalDetails, ...passThrough } = options || {};

    const promise = c3dImageLoader
      .loadAndCacheImage(imageId, {
        ...passThrough,
        requestType: toRequestType(requestType),
        priority: Number.isFinite(priority) ? priority : 0,
        // cancelLoadImage filters the pool on `additionalDetails.imageId`, so a request queued
        // without it cannot be cancelled.
        additionalDetails: { ...additionalDetails, imageId },
      })
      .then(image => toLegacyImage(image, imageId));

    return {
      promise,

      cancelFn: () => {
        try {
          c3dImageLoader.cancelLoadImage(imageId);
        } catch (error) {
          // cancelLoadImage calls the cached load object's cancelFn without checking that it
          // exists. Nothing useful follows from a failed cancel, and throwing here would take
          // down the legacy caller's own cleanup.
          console.warn(`[legacyBridge] Error cancelling load for ${imageId}.`, error);
        }
      },

      // Deliberately empty. Cornerstone3D owns the pixels; the legacy cache is a mirror, and the
      // legacy LRU dropping an entry must not free anything a Cornerstone3D consumer still holds.
      // Eviction happens on the Cornerstone3D side and reaches the mirror through cacheMirror.js.
      decache: () => {},
    };
  };
}

/**
 * Register the bridge for every scheme the viewer emits, plus as the fallback for anything else.
 *
 * @param {object} cornerstone - the legacy cornerstone-core module
 * @returns {Function} the loader that was registered
 */
export function registerLegacyBridgeLoaders(cornerstone) {
  const loader = createBridgeLoader();

  BRIDGED_SCHEMES.forEach(scheme => cornerstone.registerImageLoader(scheme, loader));

  // The legacy library calls the unknown-scheme loader with the imageId alone, so this cannot be
  // the same reference -- it would silently lose the request options.
  cornerstone.registerUnknownImageLoader(imageId => loader(imageId, {}));

  return loader;
}

export default createBridgeLoader;
