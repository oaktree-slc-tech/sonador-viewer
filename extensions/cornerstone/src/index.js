import React from 'react';

import cornerstonePackage from '../package.json';

import commandsModule from './commandsModule.js';
import CornerstoneViewportDownloadForm from './CornerstoneViewportDownloadForm';
import init from './init.js';
import OHIFCornerstoneViewport from './OHIFCornerstoneViewport';
import { getEnabledElement, setEnabledElement } from './state';
import toolbarModule from './toolbarModule.js';

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
  preRegistration({ servicesManager, configuration = {} }) {
    init({ servicesManager, configuration });
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
  getCommandsModule({ servicesManager }) {
    return commandsModule({ servicesManager });
  },
};

export { CornerstoneViewportDownloadForm, cornerstoneState };
