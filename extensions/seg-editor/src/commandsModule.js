// import { init as coreInit } from '@cornerstonejs/core';
// import { init as dicomImageLoaderInit } from '@cornerstonejs/dicom-image-loader';

import setSegmentationEditorLayout from './utils/setSegmentationEditorLayout.js';

const commandsModule = ({ servicesManager, commandsManager, appConfig }) => {
  const { UINotificationService, LoggerService } = servicesManager.services;

  // Reference cache for segmentation editor API instances
  let apis = {};

  const actions = {
    closeSegEditor() {
      // Exit Segmentation Editor

      // Enable default (Cornerstone) layout for the viewer
      commandsManager.runCommand('setCornerstoneLayout');
    },

    segmentationEditor: async ({ viewports }) => {
      // Open segmentation editor

      // Retrieve currently active display set
      const displaySet = viewports.viewportSpecificData[viewports.activeViewportIndex];

      // Set layout of viewport for CT volume viewer
      try {
        // Retrieve Segmentation editor API reference
        apis = await setSegmentationEditorLayout(displaySet, [{}]);
      } catch (err) {
        throw new Error(err);
      }
    },
  };

  window.segEditorActions = actions;

  const definitions = {
    closeSegEditor: {
      commandFn: actions.closeSegEditor,
      options: {},
    },
    segmentationEditor: {
      commandFn: actions.segmentationEditor,
      storeContexts: ['viewports'],
      options: {},
      context: 'VIEWER',
    },
  };

  return {
    definitions,
    defaultContext: 'ACTIVE_VIEWPORT::SONADOR3DSEG',
  };
};

export default commandsModule;
