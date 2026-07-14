import { createViewportToggleFeatureCommand } from '@ohif/extension-vtk';

import { Enums as SegEditEnums } from './enums';

import setSegmentationEditorLayout from './utils/setSegmentationEditorLayout.js';


const commandsModule = ({ servicesManager, commandsManager, appConfig }) => {

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

    // 3D-viewport rendering toggles: flip the editor-scoped displaySet attributes and republish
    // (same pattern as toggleVolumeRendering / toggleSegmentationSurface in the volume viewer).
    // The attributes are initialized during editor load (OHIFSegmentationEditorViewport) and are
    // deliberately distinct from the volume viewer's imageVolumeRenderingEnabled /
    // segmentationSurfaceEnabled, which carry panel-visibility semantics elsewhere.
    toggleSegEditorVolumeRendering: {
      commandFn: createViewportToggleFeatureCommand('segEditorVolumeRenderingEnabled'),
      storeContexts: ['viewports'],
      options: {},
    },
    toggleSegEditorSurfaceRendering: {
      commandFn: createViewportToggleFeatureCommand('segEditorSurfaceRenderingEnabled'),
      storeContexts: ['viewports'],
      options: {},
    },
  };

  return {
    definitions,
    defaultContext: SegEditEnums.ACTIVE_VIEWPORT,
  };
};


export default commandsModule;
