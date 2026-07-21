// Legacy Cornerstone (v2) image loader for the `sonadorlocal:` local-cache scheme (ohif-viewers#125).
//
// Thin v2 adapter over the shared read module (@ohif/core sonadorLocalImageReader, AR-2): it supplies
// the legacy `cornerstone-wado-image-loader` wadouri pipeline for decode and `cornerstone-core`'s
// loadImage for the per-instance remote fallback. `cornerstone-core@2.6.1`'s registerImageLoader
// consumes the same `{ promise }` image-load-object shape as the v3 loader (§2.4), so only this
// wrapper differs from the v3 registration.

import cornerstone from 'cornerstone-core';
import cornerstoneWADOImageLoader from 'cornerstone-wado-image-loader';

import { sonadorLocalImageReader } from '@ohif/core';

const { SONADOR_LOCAL_SCHEME, loadCachedInstanceImage } = sonadorLocalImageReader;

function legacySonadorLocalImageLoader(imageId, options) {
  const promise = loadCachedInstanceImage(imageId, options, {
    version: 'v2',
    wadoImageLoader: cornerstoneWADOImageLoader.wadouri,
    // cornerstone-core@2.6.1 loadImage returns the image-load-object promise directly.
    remoteLoad: (remoteImageId, opts) => cornerstone.loadImage(remoteImageId, opts),
  });

  return { promise };
}

/** Register the `sonadorlocal:` scheme with legacy cornerstone-core. */
export function registerLegacySonadorLocalImageLoader() {
  cornerstone.registerImageLoader(SONADOR_LOCAL_SCHEME, legacySonadorLocalImageLoader);
}

export default legacySonadorLocalImageLoader;
