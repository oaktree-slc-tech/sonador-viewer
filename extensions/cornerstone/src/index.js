import React from 'react';
import OHIF from '@ohif/core';

import cornerstonePackage from '../package.json';

import CornerstoneViewportDownloadForm from './CornerstoneViewportDownloadForm';
import OHIFCornerstoneViewport from './OHIFCornerstoneViewport';

import { createDicomLocalApi } from './DicomLocalDataSource';
import { getEnabledElement, setEnabledElement } from './state';
import SyncGroupService from './services/SyncGroupService';
import CornerstoneViewportService from './services/ViewportService/CornerstoneViewportService';

import toolbarModule from './toolbarModule';
import commandsModule from './commandsModule';

import init from './init';

const { DisplaySetService, CustomizationService } = OHIF;
const cornerstoneState = {
  setEnabledElement,
  getEnabledElement,
};


export default {
  /**
   * Only required property. Should be a unique value across all extensions.
   */
  id: 'cornerstone',
  version: cornerstonePackage.version,

  /**
   *
   * @param {object} [servicesManager={}]
   * @param {object} [configuration={}]
   * @param {object|array} [configuration.csToolsConfig] - Passed directly to `initCornerstoneTools`
   */
  preRegistration({ servicesManager, commandsManager, configuration = {} }) {

    // Register OHIF v3 Viewport Sync Service. TODO: This service provides an integration stub
    // only and (at some point in the future), we will want to replace the OHIF v2 viewport currently
    // provided by the Sonador viewer with a modernized version similar in functionality to what
    // OHIF v3 provides. The service is provided here to provide compatibility with the OHIF v3
    // MeasurementService and DicomMetadataService.
    servicesManager.registerService(CornerstoneViewportService.REGISTRATION)
    servicesManager.registerService(SyncGroupService.REGISTRATION);

    init({ servicesManager, commandsManager, configuration });
  },
  getViewportModule({ commandsManager, appConfig }) {
    return (props) => {
      /**
       * TODO: This appears to be used to set the redux parameters for
       * the viewport when new images are loaded. It's very ugly
       * and we should remove it.
       */
      const onNewImageHandler = (jumpData) => {
        /** Do not trigger all viewports to render unnecessarily */
        jumpData.refreshViewports = false;
        commandsManager.runCommand('jumpToImage', jumpData);
      };

      const { studyPrefetcher } = appConfig;
      const isStackPrefetchEnabled = studyPrefetcher && !studyPrefetcher.enabled;

      return (
        <OHIFCornerstoneViewport
          {...props}
          onNewImage={onNewImageHandler}
          isStackPrefetchEnabled={isStackPrefetchEnabled}
        />
      );
    };
  },
  getToolbarModule() {
    return toolbarModule;
  },
  getCommandsModule({ commandsManager, servicesManager }) {
    return commandsModule({ commandsManager, servicesManager });
  },
};


export { CornerstoneViewportDownloadForm, cornerstoneState, createDicomLocalApi };
