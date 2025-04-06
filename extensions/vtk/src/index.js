import React from 'react';

import vtkVersionPackage from '../package.json';

import redux from './redux';

import { logVtkError } from './utils/errors.js';

import LoadingIndicator from './ohifComponents/LoadingIndicator.js';

// VTK volume tools
import OHIFVtkBaseViewport from './ohifComponents/OHIFVtkBaseViewport.js';
import vtkVolumeColorPresetSelector from './toolbarComponents/vtkVolumeColorPresetSelector.js';
import applyVtkColorPreset from './utils/volume/applyVtkColorPreset.js';
import applyVtkVolumeRenderOptions from './utils/volume/applyVtkVolumeRenderOptions.js';
import setVtkVolumeInteractorStyle from './utils/volume/setVtkVolumeInteractorStyle.js';
import vtkInteractorStyleVolumeBase from './utils/volume/vtkInteractorStyleVolumeBase.js';
import vtkVolumeColorPresets, {
  getDefaultVolumePresetForModality,
  VTK_VOLUME_CPROFILE_CT_BONE,
  VTK_VOLUME_CPROFILE_CT_BONES,
  VTK_VOLUME_CPROFILE_CT_CARDIAC,
} from './utils/volume/vtkVolumePresets.js';
import { getWindowLevel, toLowHighRange, toWindowLevel } from './utils/windowLevelRangeConverter.js';

// Cornerstone 3D utilities
import {
  cacheVtkImage,
  cacheVtkLabelmapImage,
  getVolumeAnnotations,
  getVolumeSegmentations,
  inspectVtkLabelmapImage,
  purgeLocalVolume,
  vtkVolume2vtkImage,
  vtkImage2CornerstoneImageOptions,
} from './utils/cornerstone3d.js';

// Tools for working with VTK data
import OHIFVTKViewport from './OHIFVTKViewport';
const vtkUtils = {
  toWindowLevel,
  toLowHighRange,
  getWindowLevel,
  volumeColorPresets: vtkVolumeColorPresets,
  volumeColorPresetsConstants: {
    VTK_VOLUME_CPROFILE_CT_BONE,
    VTK_VOLUME_CPROFILE_CT_BONES,
    VTK_VOLUME_CPROFILE_CT_CARDIAC,
  },
  volumeColorPresetUtils: {
    getDefaultVolumePresetForModality,
  },
  vtkInteractorStyleVolumeBase,
  applyVtkVolumeRenderOptions,
  applyVtkColorPreset,
  setVtkVolumeInteractorStyle,

  // Logging and error display
  logVtkError,
};

// Commands module and toolbar module
import commandsModule from './commandsModule.js';
import toolbarModule from './toolbarModule.js';
import withCommandsManager from './withCommandsManager.js';


// Tools for Working with Cornerstone3D data
const cornerstone3dUtils = {

  // Convert vtk data to Cornerstone data
  cacheVtkImage,
  cacheVtkLabelmapImage,
  purgeLocalVolume,
  vtkImage2CornerstoneImageOptions,
  getVolumeAnnotations,
  getVolumeSegmentations,
  inspectVtkLabelmapImage,
  vtkVolume2vtkImage,
}


// OHIF VTK Extension
const vtkExtension = {
  /**
   * Only required property. Should be a unique value across all extensions.
   */
  id: 'vtk',
  version: vtkVersionPackage.version,

  getViewportModule({ commandsManager, servicesManager }) {
    const ExtendedVTKViewport = (props) => (
      <OHIFVTKViewport {...props} servicesManager={servicesManager} commandsManager={commandsManager} />
    );
    return withCommandsManager(ExtendedVTKViewport, commandsManager);
  },
  getToolbarModule() {
    return toolbarModule;
  },
  getCommandsModule({ commandsManager, servicesManager }) {
    return commandsModule({ commandsManager, servicesManager });
  },
};

export default vtkExtension;
export { vtkExtension, redux, vtkUtils, cornerstone3dUtils,
  OHIFVtkBaseViewport, LoadingIndicator, vtkVolumeColorPresetSelector };

// loadLocales();
