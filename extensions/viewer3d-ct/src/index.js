import React from 'react';

import OHIF from '@ohif/core';
import { asyncComponent, retryImport } from '@ohif/ui';
import { vtkUtils } from '@ohif/extension-vtk';

import commandsModule from './commandsModule.js';
import toolbarModule from './toolbarModule.js';
import withCommandsManager from './withCommandsManager.js';
import { version } from '../package.json';

const OHIFVtkVolumeViewport = asyncComponent(() =>
  retryImport(() => import('./OHIFVtkVolumeViewport.js'))
);

// 3D CT Volume Rendering Plugin: provide CT volume rendering capabilities
export default {
  id: 'viewer3dct',

  getViewportModule({ commandsManager, servicesManager }) {
    // Create connected volume rendering viewport

    const ExtendedVtkVolumeViewport = (props) => (
      <OHIFVtkVolumeViewport
        {...props}
        servicesManager={servicesManager}
        commandsManager={commandsManager}
      />
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
