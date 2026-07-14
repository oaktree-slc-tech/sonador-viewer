import React from 'react';

import viewer3dVolumePackage from '../package.json';

import SonadorVolumeViewerPanel from './components/panels/VolumeViewerPanel';

import commandsModule from './commandsModule.js';
import OHIFVtkVolumeViewport from './ohifComponents/OHIFVtkVolumeViewport';
import toolbarModule from './toolbarModule.js';
import withCommandsManager from './connectedComponents/withCommandsManager.js';

import Enums from './enums';


// Cornerstone 3D segmentation utilities
import {
  syncTableSegRepData, checkSegmentsLength, c3dSeg2SegmentationTableData, 
  checkActiveSeg, tableSgmentationRepVisible, mutateSegmentationTableRepresentationVisibility, 
  createSyncStyleAttrsCommand, createViewerOnToggleSegmentVisibility, createViewerOnToggleSegmentationRepresentationVisibility,
  attachCoreSegmentationTableEvents, attachSegmentationAddTableEvents, attachSegmentationRepresentationTableEvents, 
  attachSegmentRemovedTableEvents,
} from './utils/cornerstone3dSegmentations';


const cornerstone3dSegmentationUtils = {
  syncTableSegRepData, checkSegmentsLength, c3dSeg2SegmentationTableData, 
  checkActiveSeg, tableSgmentationRepVisible, mutateSegmentationTableRepresentationVisibility,
  createSyncStyleAttrsCommand, createViewerOnToggleSegmentVisibility, createViewerOnToggleSegmentationRepresentationVisibility,
  attachCoreSegmentationTableEvents, attachSegmentationAddTableEvents, attachSegmentationRepresentationTableEvents,
  attachSegmentRemovedTableEvents,
}


// 3D Volume Rendering Plugin: provide volume rendering capabilities
export default {
  id: 'viewer3dvol',
  version: viewer3dVolumePackage.version,

  getViewportModule({ commandsManager, servicesManager }) {
    // Create connected volume rendering viewport

    const ExtendedVtkVolumeViewport = (props) => (
      <OHIFVtkVolumeViewport {...props} servicesManager={servicesManager} commandsManager={commandsManager} />
    );
    return withCommandsManager(ExtendedVtkVolumeViewport, commandsManager);
  },

  getToolbarModule() {
    return toolbarModule;
  },

  getCommandsModule({ commandsManager, servicesManager }) {
    return commandsModule({ commandsManager, servicesManager });
  },
};


export { Enums, cornerstone3dSegmentationUtils, SonadorVolumeViewerPanel, };