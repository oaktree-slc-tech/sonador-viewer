// Cornerstone3D (v3) image loader for the `sonadorlocal:` local-cache scheme (ohif-viewers#125).
//
// Thin v3 adapter over the shared read module (@ohif/core sonadorLocalImageReader, AR-2): it only
// supplies the v3 `@cornerstonejs/dicom-image-loader` wadouri pipeline for decode and the v3
// `@cornerstonejs/core` image loader for the per-instance remote fallback, then wraps the result in
// the v3 `ImageLoaderFn` return shape (`{ promise, cancelFn?, decache? }`, verified §2.4).

import { imageLoader as c3dImageLoader } from '@cornerstonejs/core';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';

import { sonadorLocalImageReader } from '@ohif/core';

const { SONADOR_LOCAL_SCHEME, loadCachedInstanceImageObject } = sonadorLocalImageReader;

/**
 * v3 ImageLoaderFn. Returns the full `{ promise, cancelFn, decache }` load object; the shared
 * reader resolves the promise to a decoded image (from cache, or the remote loader on a cache
 * miss) and forwards cancel/decache to whichever delegate loader served it. `decache` is what releases the wadouri DataSet when Cornerstone3D evicts the image.
 *
 * The remote fallback is handed the delegate load object rather than only its promise, so a cancel
 * during a cache-miss fallback reaches the remote request too.
 */
function sonadorLocalImageLoader(imageId, options) {
  return loadCachedInstanceImageObject(imageId, options, {
    version: 'v3',
    wadoImageLoader: dicomImageLoader.wadouri,
    remoteLoad: (remoteImageId, opts) => c3dImageLoader.loadImage(remoteImageId, opts),
  });
}

/** Register the `sonadorlocal:` scheme with Cornerstone3D. Idempotent-safe to call once at init. */
export function registerSonadorLocalImageLoader() {
  c3dImageLoader.registerImageLoader(SONADOR_LOCAL_SCHEME, sonadorLocalImageLoader);
}

export default sonadorLocalImageLoader;
