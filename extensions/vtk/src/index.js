import React from 'react';

import vtkVersionPackage from '../package.json';

import LoadingIndicator from './ohifComponents/LoadingIndicator.js';
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
import commandsModule from './commandsModule.js';
import OHIFVTKViewport from './OHIFVTKViewport';
import redux from './redux';
import toolbarModule from './toolbarModule.js';
import withCommandsManager from './withCommandsManager.js';

// Tools for working with VTK data
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
};

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
export { vtkExtension, redux, vtkUtils, OHIFVtkBaseViewport, LoadingIndicator, vtkVolumeColorPresetSelector };

// loadLocales();
