import cornerstone from 'cornerstone-core';
import cornerstoneWADOImageLoader from 'cornerstone-wado-image-loader';
import dicomParser from 'dicom-parser';

import OHIF from '@ohif/core';

import version from './version.js';
import { registerLegacySonadorLocalImageLoader } from './lib/sonadorLocalImageLoaderV2.js';

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
  window.cornerstoneWADOImageLoader = cornerstoneWADOImageLoader;
  //}

  cornerstoneWADOImageLoader.external.cornerstone = cornerstone;
  cornerstoneWADOImageLoader.external.dicomParser = dicomParser;

  // Kick off Cornerstone3D initialisation with the app configuration.
  // This is the first call site in the boot sequence -- App.js calls setConfiguration() before it
  // registers any extension -- and initCornerstone3d is idempotent, so the request-pool ceilings,
  // cache ceiling and web-worker count configured here are the ones the arg-less call sites in the
  // cornerstone and vtk extensions inherit.
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

  // Register the local/offline cache image loader with legacy cornerstone-core (ohif-viewers#125,
  // AR-3) before cornerstoneWADOImageLoader self-registers its wadouri/wadors handlers via
  // .configure() below. The `sonadorlocal:` scheme is distinct, so there is no ordering conflict —
  // it just needs to exist before any component tries to load a `sonadorlocal:` imageId.
  registerLegacySonadorLocalImageLoader();

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

  cornerstoneWADOImageLoader.configure({
    beforeSend: function (xhr) {
      const headers = OHIF.DICOMWeb.getAuthorizationHeader();

      if (headers.Authorization) {
        xhr.setRequestHeader('Authorization', headers.Authorization);
      }
    },
    errorInterceptor: (error) => {
      // const { appConfig = {} } = AppContext;

      if (typeof appConfig.httpErrorHandler === 'function') {
        appConfig.httpErrorHandler(error);
      }
    },
  });
}
