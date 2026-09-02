import React from 'react';

import vtkVersionPackage from '../package.json';

import redux from './redux';

import { logVtkError } from './utils/errors.js';

import LoadingIndicator from './components/LoadingIndicator.js';
import VolumeFitNotice from './components/VolumeFitNotice.js';

// VTK volume tools
import OHIFVtkBaseViewport from './ohifComponents/OHIFVtkBaseViewport.js';
import vtkVolumeColorPresetSelector from './toolbarComponents/vtkVolumeColorPresetSelector.js';
import DisplaySetAttributeActiveToolbarButton from './toolbarComponents/DisplaySetAttributeActiveToolbarButton';
import createViewportToggleFeatureCommand from './utils/createViewportToggleFeatureCommand.js';
import applyVtkColorPreset from './utils/volume/applyVtkColorPreset.js';
import applyVtkVolumeRenderOptions from './utils/volume/applyVtkVolumeRenderOptions.js';
import vtkInteractorStyleVolumeBase from './utils/volume/vtkInteractorStyleVolumeBase.js';
import vtkVolumeColorPresets, {
  getDefaultVolumePresetForModality,
  VTK_VOLUME_CPROFILE_CT_BONE,
  VTK_VOLUME_CPROFILE_CT_BONES,
  VTK_VOLUME_CPROFILE_CT_CARDIAC,
} from './utils/volume/vtkVolumePresets.js';
import { getWindowLevel, toLowHighRange, toWindowLevel } from './utils/windowLevelRangeConverter.js';


// Initialize Cornerstone3D integrations and components
import { init as c3dCoreInit } from '@cornerstonejs/core';
import { init as c3dToolsInit } from '@cornerstonejs/tools';
import { init as c3dDcmImageLoaderInit } from '@cornerstonejs/dicom-image-loader';
import * as polySeg from '@cornerstonejs/polymorphic-segmentation';
import { init as c3dPolySegInit } from '@cornerstonejs/polymorphic-segmentation';


// Cornerstone 3D utilities
import {
  initCornerstone3d,
  cacheVtkLabelmapImage,
  getVolumeAnnotations,
  getVolumeSegmentations,
  inspectVtkLabelmapImage,
  vtkVolume2vtkImage,
  forceClearSegment,
  getCornerstone3dViewport,
  removeVolumeActors,
  terminateWorkerComputeJobs,

  // Cornerstone3D streaming image volumes
  VOLUME_LOADER_SCHEME,
  DECIMATED_VOLUME_LOADER_SCHEME,
  getVolumeIdForDisplaySet,
  isDecimatedVolumeId,
  estimateVolumeShape,
  assessDisplaySetVolumeFit,
  createImageVolumeForDisplaySet,
  suggestDecimationAfterFailure,
  mapLabelmapBufferToVolumeOrder,
  volumeLease,
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

  // Logging and error display
  logVtkError,
};

// Commands module and toolbar module
import commandsModule from './commandsModule.js';
import toolbarModule from './toolbarModule.js';
import withCommandsManager from './connectedComponents/withCommandsManager.js';


// Tools for Working with Cornerstone3D
import Cornerstone3DBaseView from './components/Cornerstone3DBaseView.js';
import Cornerstone3DLabelmapBaseView from './components/Cornerstone3DLabelmapBaseView.js';
import Cornerstone3DInspectionView from './components/Cornerstone3DInspectionView.js';

// Volume Rendering controls
import { VolumeRenderingMenuButton } from './components/VolumeRendering/VolumeRenderingMenuButton';
import { VolumeRenderingOptions } from './components/VolumeRendering/VolumeRenderingOptions';
import { VolumeRenderingPresets } from './components/VolumeRendering/VolumeRenderingPresets';
import { VolumeRenderingPresetsContent } from './components/VolumeRendering/VolumeRenderingPresetsContent';
import { VolumeRenderingQuality } from './components/VolumeRendering/VolumeRenderingQuality';
import { VolumeShift } from './components/VolumeRendering/VolumeShift';
import { VolumeLighting } from './components/VolumeRendering/VolumeLighting';
import { VolumeShade } from './components/VolumeRendering/VolumeShade';

import ViewportGridOverlayTool from './components/tools/ViewportGridOverlayTool';
import SonadorZoomTool from './components/tools/SonadorZoomTool';

import Enums from './enums';


const cornerstone3dViewportTools = {
  ViewportGridOverlayTool, SonadorZoomTool, getCornerstone3dViewport, removeVolumeActors
}


const cornerstone3dUtils = {

  // Initialize Cornerstone3D tools
  initCornerstone3d,

  // Cornerstone3D streaming image volumes: creation, identification and reference-counted
  // release. `createLocalVolume` is used only for labelmaps, never for imaging data.
  VOLUME_LOADER_SCHEME,
  DECIMATED_VOLUME_LOADER_SCHEME,
  getVolumeIdForDisplaySet,
  isDecimatedVolumeId,
  estimateVolumeShape,
  assessDisplaySetVolumeFit,
  createImageVolumeForDisplaySet,
  suggestDecimationAfterFailure,
  mapLabelmapBufferToVolumeOrder,
  volumeLease,

  // Convert vtk data to Cornerstone data
  cacheVtkLabelmapImage,
  getVolumeAnnotations,
  getVolumeSegmentations,
  inspectVtkLabelmapImage,
  vtkVolume2vtkImage,
  forceClearSegment,
  getCornerstone3dViewport,
  removeVolumeActors,
  terminateWorkerComputeJobs,

  viewportTools: cornerstone3dViewportTools,
}


// Toolbar Components
const toolbarComponents = {
  DisplaySetAttributeActiveToolbarButton,
}



// OHIF VTK Extension
const vtkExtension = {
 
  id: 'vtk',
  version: vtkVersionPackage.version,

  async preRegistration() {
    console.log('Register VTK and Cornerstone3D components');

    // Initialize Cornerstone3D Modules
    await initCornerstone3d();
    console.log('VTK and Cornerston3D registered successfully');
  },

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
export {
  Enums, vtkExtension, redux, vtkUtils, cornerstone3dUtils, cornerstone3dViewportTools, toolbarComponents,
  OHIFVtkBaseViewport, Cornerstone3DBaseView, Cornerstone3DLabelmapBaseView, Cornerstone3DInspectionView,
  LoadingIndicator, VolumeFitNotice, vtkVolumeColorPresetSelector, DisplaySetAttributeActiveToolbarButton, createViewportToggleFeatureCommand,
  VolumeRenderingMenuButton, VolumeRenderingOptions, VolumeRenderingPresets, VolumeRenderingPresetsContent,
  VolumeRenderingQuality, VolumeShift, VolumeLighting, VolumeShade,
};

