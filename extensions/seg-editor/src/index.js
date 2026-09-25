import React from 'react';

import sonadorSegEditor from '../package.json';

import Cornerstone3DSegmentationViewerBaseViewport from './components/Cornerstone3DSegmentationViewerLayout';
import SonadorSegmentationEditorPanel from './components/panels/SegmentationEditorPanel';

import commandsModule from './commandsModule.js';
import ConnectedSegmentationEditorViewport from './connectedComponents/ConnectedSegmentationEditorViewport';
import createToolbarModule from './toolbarModule.js';
import withCommandsManager from './connectedComponents/withCommandsManager.js';

import setSegmentationEditorLayout from './utils/setSegmentationEditorLayout.js';

import Enums from './enums';
import { modelsToLabelmap } from './threeDTools/modelsToLabelmap.js';


// Sonador 2D/3D Segmentation Editor
const segmentationEditorExtension = {
  id: 'sonador3dseg',
  version: sonadorSegEditor.version,

  preRegistration() {
    console.log('Register segmentation editor');
  },

  getViewportModule({ commandsManager, servicesManager }) {
    // Create segmentation editor viewport
    const ExtendedSegmentationEditorViewport = (props) => (
      <ConnectedSegmentationEditorViewport
        {...props}
        servicesManager={servicesManager}
        commandsManager={commandsManager}
      />
    );
    return withCommandsManager(ExtendedSegmentationEditorViewport, commandsManager);
  },

  getToolbarModule({ servicesManager }) {
    return createToolbarModule({ servicesManager });
  },

  getCommandsModule({ commandsManager, servicesManager }) {
    console.log('Initialize commands module for seg editor');
    return commandsModule({ commandsManager, servicesManager });
  },
};


export default segmentationEditorExtension;
export {
  modelsToLabelmap,
  Enums, segmentationEditorExtension, setSegmentationEditorLayout, Cornerstone3DSegmentationViewerBaseViewport, 
  SonadorSegmentationEditorPanel
};
