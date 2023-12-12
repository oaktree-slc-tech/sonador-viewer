import React from 'react';

import viewer3dColumePackage from '../package.json';

import commandsModule from './commandsModule.js';
import OHIFVtkVolumeViewport from './OHIFVtkVolumeViewport';
import toolbarModule from './toolbarModule.js';
import withCommandsManager from './withCommandsManager.js';

// 3D Volume Rendering Plugin: provide volume rendering capabilities
export default {
  id: 'viewer3dvol',
  version: viewer3dColumePackage.version,

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
