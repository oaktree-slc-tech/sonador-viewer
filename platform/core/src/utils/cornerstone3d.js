import {
  init as c3dCoreInit,
  cache as c3dCache,
  imageLoadPoolManager,
  Enums as c3dEnums,
  getShouldUseCPURendering,
} from '@cornerstonejs/core';
// `getSupportedTextureFormats` is the probe Cornerstone3D's own `init()` runs to decide norm16
// usability; it is reachable through the package's `./utilities/*` exports pattern even though the
// memoised result (`getCanUseNorm16Texture`) is not exported at all. See the note in runInit().
import { getSupportedTextureFormats } from '@cornerstonejs/core/utilities/textureSupport';
import { init as c3dToolsInit } from '@cornerstonejs/tools';
import { init as c3dDcmImageLoaderInit } from '@cornerstonejs/dicom-image-loader';
import * as polySeg from '@cornerstonejs/polymorphic-segmentation';

import { init as c3dPolySegInit } from '@cornerstonejs/polymorphic-segmentation';

import { createSingleFlightPolySeg } from './polySegSingleFlight';
import { configureGpuCapabilities } from './gpuCapabilities';
import getAuthorizationHeader from '../DICOMWeb/getAuthorizationHeader';


// Track init state of Cornerstone3D. The promise (not just the boolean) is the latch: init is
// kicked off without `await` from the cornerstone extension and awaited from the vtk extension's
// preRegistration, so two callers can otherwise both pass a boolean guard before the first `await`
// inside and run the whole sequence twice.
let C3D_INIT = false;
let C3D_INIT_PROMISE = null;

// The appConfig section the first caller supplied, kept so the arg-less call sites (the cornerstone
// extension, the vtk extension, the segmentation editor) inherit it.
let C3D_APP_CONFIG = {};


/**
 * Request-pool ceilings. Cornerstone3D 4.22.13 ships 1000 for each image-load request type,
 * which is effectively unbounded; the streaming volume path opens one `loadAndCacheImage` request
 * per slice, so a single large series would otherwise put thousands of requests in flight at once.
 * The defaults below are upstream OHIF v3's (extensions/cornerstone/src/init.tsx at v3.12.12).
 */
export const DEFAULT_MAX_NUM_REQUESTS = {
  interaction: 10,
  thumbnail: 5,
  prefetch: 5,
  compute: 10,
};

// The value the legacy initWebWorkers.js uses, kept identical so the two decode pools do not size
// themselves differently on the same machine.
const MAX_WEB_WORKERS = 6;

function getDefaultMaxWebWorkers() {
  const concurrency =
    typeof navigator !== 'undefined' && navigator.hardwareConcurrency
      ? navigator.hardwareConcurrency
      : 2;

  return Math.max(1, Math.min(concurrency - 1, MAX_WEB_WORKERS));
}


function applyRequestPoolConfiguration(c3dConfig) {
  // Only the four RequestType values Cornerstone3D defines; anything else in the config is ignored
  // rather than passed through to a pool that has no such bucket.
  const requestTypes = c3dEnums?.RequestType || {};
  const configured = c3dConfig.maxNumRequests || {};

  Object.keys(DEFAULT_MAX_NUM_REQUESTS).forEach(type => {
    const requestType = requestTypes[type.charAt(0).toUpperCase() + type.slice(1)];
    if (!requestType) {
      return;
    }

    const value = Number.isFinite(configured[type])
      ? configured[type]
      : DEFAULT_MAX_NUM_REQUESTS[type];

    imageLoadPoolManager.setMaxSimultaneousRequests(requestType, value);
  });
}


function applyCacheConfiguration(c3dConfig) {
  // Absent from the config means "leave the library default" (3 GiB in 4.22.13).
  const { maxCacheSizeBytes } = c3dConfig;

  if (Number.isFinite(maxCacheSizeBytes) && maxCacheSizeBytes > 0) {
    c3dCache.setMaxCacheSize(maxCacheSizeBytes);
  }
}


async function runInit() {
  const c3dConfig = C3D_APP_CONFIG.cornerstone3d || {};

  await c3dCoreInit();

  // Pools and cache are configured immediately after core init, before any loader can queue work.
  applyRequestPoolConfiguration(c3dConfig);
  applyCacheConfiguration(c3dConfig);

  await c3dDcmImageLoaderInit({
    maxWebWorkers: Number.isFinite(c3dConfig.maxWebWorkers)
      ? c3dConfig.maxWebWorkers
      : getDefaultMaxWebWorkers(),

    // Credentials for every request this loader makes (wadors frames, wadouri objects, and the
    // streaming/range variants -- they all funnel through `internal/xhrRequest` and
    // `internal/streamRequest`, and both call `beforeSend`).
    //
    // The legacy stack configures the equivalent hook on cornerstone-wado-image-loader in
    // platform/viewer/src/config.js. That covered every image request until the volumetric
    // surfaces started loading through @cornerstonejs/dicom-image-loader, which has its own
    // options and no auth of its own -- so remote series came back 403 (the browser reports it
    // as a CORS failure, because the rejection carries no Access-Control-Allow-Origin).
    //
    // NOTE the contract differs from the legacy loader's: v2's `beforeSend(xhr)` set headers on
    // the request itself, while this one RETURNS a header object that the loader merges over its
    // own defaults. Setting them on the xhr here would be overwritten by that merge.
    beforeSend: () => getAuthorizationHeader(),

    // Mirrors the legacy loader's errorInterceptor so both stacks report transport failures the
    // same way.
    errorInterceptor: error => {
      if (typeof C3D_APP_CONFIG.httpErrorHandler === 'function') {
        C3D_APP_CONFIG.httpErrorHandler(error);
      }
    },
  });
  await c3dPolySegInit();
  // Wrap polySeg so concurrent surfaceDisplay.render() calls coalesce onto a single
  // in-flight computeSurfaceData job per segmentation, instead of fanning out duplicate
  // marching-cubes worker jobs onto the single (maxWorkerInstances: 1) polySeg worker.
  await c3dToolsInit({ addons: { polySeg: createSingleFlightPolySeg(polySeg) }});

  // Hand the GPU pre-flight the two facts only Cornerstone3D knows, now that init() has settled on
  // GPU or CPU rendering.
  //
  // A deliberate departure from ohif-viewers#133 FR-5, which asks for `getCanUseNorm16Texture()`.
  // That function is NOT exported from
  // @cornerstonejs/core's entry point in 4.22.13 and the package's `exports` map has no `./init`
  // subpath, so its memoised value cannot be read at all -- reaching for it off the module
  // namespace only produces a webpack "export not found" warning on every build. Its value is
  // exactly `getSupportedTextureFormats().norm16 && .norm16Linear` (see `_hasNorm16TextureSupport`
  // in the library's init module), and that probe IS exported, so the same answer is computed here
  // from the same function. The cost is re-running the probe once per session: two 4x4 canvas
  // renders, which is what init() itself already paid.
  const textureFormats = getSupportedTextureFormats();

  configureGpuCapabilities({
    volumeTextureBudgetBytes: c3dConfig.volumeTextureBudgetBytes,
    norm16: !!(textureFormats.norm16 && textureFormats.norm16Linear),
    cpuRendering: !!getShouldUseCPURendering(),
  });

  C3D_INIT = true;
  return C3D_INIT;
}


/**
 * Initialize Cornerstone3D core, the DICOM image loader, polymorphic segmentation and tools.
 *
 * Idempotent: repeat calls return the same promise, so the first caller's `appConfig` is the one
 * that is applied. `platform/viewer/src/config.js` calls this with the app configuration before any
 * extension registers, so the arg-less call sites inherit it.
 *
 * @param {object} [appConfig] - the viewer app configuration; `appConfig.cornerstone3d` holds
 *   `maxNumRequests`, `maxCacheSizeBytes`, `maxWebWorkers` and `volumeTextureBudgetBytes`.
 * @returns {Promise<boolean>}
 */
export function initCornerstone3d(appConfig) {
  if (appConfig && !C3D_INIT_PROMISE) {
    C3D_APP_CONFIG = appConfig;
  }

  if (!C3D_INIT_PROMISE) {
    C3D_INIT_PROMISE = runInit();
    // Drop the latch on failure so a later caller can retry, and so the rejection is observed here
    // rather than surfacing as an unhandled rejection from the fire-and-forget call site.
    C3D_INIT_PROMISE.catch(() => {
      C3D_INIT_PROMISE = null;
    });
  }

  return C3D_INIT_PROMISE;
}
