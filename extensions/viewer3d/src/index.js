// 3D File Viewer: STL and GLB

import { asyncComponent, retryImport } from '@ohif/ui';

import { version } from '../package.json';
import OHIFDicom3DSopClassHandler from './OHIFDicom3DSopClassHandler.js';
import commandsModule from './commandsModule.js';
import toolbarModule from './toolbarModule.js';
import withCommandsManager from './withCommandsManager.js';

const ConnectedOHIFDicomM3DViewport = asyncComponent(() =>
  retryImport(() => import('./ConnectedOHIFDicomM3DViewport.js'))
);

// 3D Model Viewer
export default {
  id: 'viewerm3d',
  version,
  preRegistration({ servicesManager, commandsManager, appConfig }) {},
  getSopClassHandlerModule({ servicesManager }) {
    return OHIFDicom3DSopClassHandler;
  },
  getViewportModule({ commandsManager, servicesManager }) {
    return withCommandsManager(ConnectedOHIFDicomM3DViewport, commandsManager);
  },
  getToolbarModule() {
    return toolbarModule;
  },
  getCommandsModule({ commandsManager, servicesManager, appConfig }) {
    return commandsModule({ commandsManager, servicesManager, appConfig });
  },
};
