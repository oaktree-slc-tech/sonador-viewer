import cornerstone from 'cornerstone-core';

import OHIF from '@ohif/core';

import version from './version.js';

export function setConfiguration(appConfig) {
  let homepage;
  const { process } = window;
  if (process && process.env && process.env.PUBLIC_URL) {
    homepage = process.env.PUBLIC_URL;
  }

  window.info = {
    version,
    homepage,
  };

  // For debugging
  //if (process.env.node_env === 'development') {
  window.cornerstone = cornerstone;
  //}

  // Kick off Cornerstone3D initialisation with the app configuration.
  // This is the first call site in the boot sequence -- App.js calls setConfiguration() before it
  // registers any extension -- and initCornerstone3d is idempotent, so the request-pool ceilings,
  // cache ceiling and web-worker count configured here are the ones the arg-less call sites in the
  // cornerstone and vtk extensions inherit.
  //
  // The whole `appConfig.cornerstone3d` section is kept for the same reason: subsystems registered
  // later read it through `OHIF.utils.cornerstone3dUtils.getCornerstone3dConfig()` rather than
  // being handed the app configuration -- the vtk extension's labelmap bridge reads
  // `lazyLegacyLabelmap` that way.
  OHIF.utils.cornerstone3dUtils.initCornerstone3d(appConfig);

  if (appConfig.debug) {
    // One debug object, not several globals. `window.cornerstone` stays the legacy library. Both
    // fields are getters so nothing is probed (and no WebGL context is created) unless a developer
    // actually asks for the report.
    const { gpuCapabilities } = OHIF.utils;

    window.__sonador = {
      ...window.__sonador,
      gpu: {
        get capabilities() {
          return gpuCapabilities.getGpuCapabilities();
        },
        get lastAssessment() {
          return gpuCapabilities.getLastVolumeFitAssessment();
        },
        assessVolumeFit: gpuCapabilities.assessVolumeFit,
        probeTextureAllocation: gpuCapabilities.probeTextureAllocation,
      },
    };
  }

  // Install the legacy-facing bridge. Legacy cornerstone-core has no decoder of its own, so every
  // scheme it is asked for resolves through Cornerstone3D. Must run after initCornerstone3d above,
  // which configures the pools, the cache ceiling and the loader the bridge calls.
  //
  // Deleting this call and platform/core/src/loaders/legacyBridge/ is the whole of the bridge's
  // removal when the legacy stack is retired.
  OHIF.installLegacyBridge({
    cornerstone,
    legacyMetadataProvider: OHIF.cornerstone.metadataProvider,
  });

  OHIF.user.getAccessToken = () => {
    // TODO: Get the Redux store from somewhere else
    const state = window.store.getState();
    if (!state.oidc || !state.oidc.user) {
      return;
    }

    return state.oidc.user.access_token;
  };

  OHIF.errorHandler.getHTTPErrorHandler = () => {
    // const { appConfig = {} } = AppContext;

    return appConfig.httpErrorHandler;
  };
}
