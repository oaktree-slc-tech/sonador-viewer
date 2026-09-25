// 3D File Viewer: STL and GLB
import viewer3dPackage from '../package.json';

import commandsModule from './commandsModule.js';
import ConnectedOHIFDicomM3DViewport from './connectedComponents/ConnectedOHIFDicomM3DViewport';
import OHIFDicom3DSopClassHandler, {
  MIMETYPE_STL,
  M3D_MIMETYPES,
  getM3DModelType,
  isSTLDisplaySet,
} from './sopClassHandlers/OHIFDicom3DSopClassHandler';
import toolbarModule from './toolbarModule';
import M3DViewerSidebarPanel from './components/panels/M3DViewerPanel';
import withCommandsManager from './connectedComponents/withCommandsManager';

import M3DModelView from './threejs/M3DModelView';
import {
  registerM3DGeometryLoader,
  createSurfaceModel,
  disposeSurfaceModel,
  surfaceToBufferGeometry,
} from './m3dCache';

import Enums from './enums';
import { findM3DSourceDisplaySet, getM3DSourceSeriesUID } from './sopClassHandlers/m3dSourceSeries.js';
import {
  acquireGeometry,
  getM3DSegmentationId,
  releaseGeometry,
} from './m3dCache';


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

// Shared with the Segmentation Editor's 3D editing canvas (Cornerstone3D surfaces in a Three.js view)
export { M3DModelView, MIMETYPE_STL, createSurfaceModel, disposeSurfaceModel, surfaceToBufferGeometry };

// Models as a segmentation (ohif-viewers#143): the source series and the models' geometry
export { findM3DSourceDisplaySet, getM3DSourceSeriesUID, acquireGeometry, releaseGeometry, getM3DSegmentationId };