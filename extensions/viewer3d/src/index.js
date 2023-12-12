// 3D File Viewer: STL and GLB
import viewer3dPackage from '../package.json';

import commandsModule from './commandsModule.js';
import ConnectedOHIFDicomM3DViewport from './ConnectedOHIFDicomM3DViewport';
import OHIFDicom3DSopClassHandler from './OHIFDicom3DSopClassHandler';
import toolbarModule from './toolbarModule';
import withCommandsManager from './withCommandsManager';

// 3D Model Viewer
export default {
  id: 'viewerm3d',
  version: viewer3dPackage.version,
  preRegistration() {},
  getSopClassHandlerModule() {
    return OHIFDicom3DSopClassHandler;
  },
  getViewportModule({ commandsManager }) {
    return withCommandsManager(ConnectedOHIFDicomM3DViewport, commandsManager);
  },
  getToolbarModule() {
    return toolbarModule;
  },
  getCommandsModule({ commandsManager, servicesManager, appConfig }) {
    return commandsModule({ commandsManager, servicesManager, appConfig });
  },
};
