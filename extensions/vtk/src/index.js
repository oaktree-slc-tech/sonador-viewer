import React from 'react';
import { asyncComponent, retryImport } from '@ohif/ui';

import redux from './redux';

import OHIFVtkBaseViewport from './ohifComponents/OHIFVtkBaseViewport.js';
import LoadingIndicator from './ohifComponents/LoadingIndicator.js';

import applyVtkColorPreset from './utils/volume/applyVtkColorPreset.js';
import vtkVolumeColorPresets, {
  VTK_VOLUME_CPROFILE_CT_BONE,
  VTK_VOLUME_CPROFILE_CT_BONES,
  VTK_VOLUME_CPROFILE_CT_CARDIAC,
} from './utils/volume/vtkVolumePresets.js';
import applyVtkVolumeRenderOptions from './utils/volume/applyVtkVolumeRenderOptions.js';
import {
  toWindowLevel,
  toLowHighRange,
  getWindowLevel,
} from './utils/windowLevelRangeConverter.js';
import setVtkVolumeInteractorStyle from './utils/volume/setVtkVolumeInteractorStyle.js';
import vtkInteractorStyleVolumeBase from './utils/volume/vtkInteractorStyleVolumeBase.js';

import vtkVolumeColorPresetSelector from './toolbarComponents/vtkVolumeColorPresetSelector.js';

import commandsModule from './commandsModule.js';
import toolbarModule from './toolbarModule.js';
import withCommandsManager from './withCommandsManager.js';
import { version } from '../package.json';

const OHIFVTKViewport = asyncComponent(() =>
  retryImport(() =>
    import(/* webpackChunkName: "OHIFVTKViewport" */ './OHIFVTKViewport.js')
  )
);

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
  version,

  getViewportModule({ commandsManager, servicesManager }) {
    const ExtendedVTKViewport = (props) => (
      <OHIFVTKViewport
        {...props}
        servicesManager={servicesManager}
        commandsManager={commandsManager}
      />
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
export {
  vtkExtension,
  redux,
  vtkUtils,
  OHIFVtkBaseViewport,
  LoadingIndicator,
  vtkVolumeColorPresetSelector,
};

// loadLocales();
