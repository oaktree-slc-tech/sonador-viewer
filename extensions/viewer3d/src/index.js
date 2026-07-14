// 3D File Viewer: STL and GLB
import viewer3dPackage from '../package.json';

import commandsModule from './commandsModule.js';
import ConnectedOHIFDicomM3DViewport from './connectedComponents/ConnectedOHIFDicomM3DViewport';
import OHIFDicom3DSopClassHandler, {
  M3D_MIMETYPES,
  getM3DModelType,
  isSTLDisplaySet,
} from './sopClassHandlers/OHIFDicom3DSopClassHandler';
import toolbarModule from './toolbarModule';
import M3DViewerSidebarPanel from './components/panels/M3DViewerPanel';
import withCommandsManager from './connectedComponents/withCommandsManager';

import { registerM3DGeometryLoader } from './m3dCache';

import Enums from './enums';


// 3D Model Viewer
export default {

  id: 'viewerm3d',
  version: viewer3dPackage.version,
  preRegistration() {
    // Register the M3D geometry loader so STL/GLB models can be stored in and retrieved from the
    // Cornerstone3D geometry cache via the `m3d:` scheme.
    registerM3DGeometryLoader();
  },
  getSopClassHandlerModule() {
    return OHIFDicom3DSopClassHandler;
  },
  getViewportModule({ commandsManager, servicesManager }) {
    // servicesManager provides segmentationService for the STL presentation-state segmentation
    return withCommandsManager(ConnectedOHIFDicomM3DViewport, commandsManager, { servicesManager });
  },
  getToolbarModule() {
    return toolbarModule;
  },
  getCommandsModule({ commandsManager, servicesManager, appConfig }) {
    return commandsModule({ commandsManager, servicesManager, appConfig });
  },
};


export { Enums, M3DViewerSidebarPanel, M3D_MIMETYPES, getM3DModelType, isSTLDisplaySet, };