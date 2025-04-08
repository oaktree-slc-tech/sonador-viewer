import _ from 'lodash';

import Constants from '@kitware/vtk.js/Rendering/Core/VolumeMapper/Constants.js';

import csTools from 'cornerstone-tools';
import { vtkUtils } from '@ohif/extension-vtk';

import vtkInteractorStyleVolumeWindowLevel from './utils/vtkInteractorStyleVolumeWindowLevel.js';
import vtkInteractorStyleVolumePan from './utils/vtkInteractorStyleVolumePan.js';
import setCTVolumeLayout from './utils/setCTVolumeLayout.js';

const commandsModule = ({ commandsManager, servicesManager }) => {
  const { UINotificationService, LoggerService } = servicesManager.services;

  // Reference cache for VTK API instances
  let apis = {};
  let currentActiveColorPreset = null;

  async function _getActiveViewportVTKApi(viewports) {
    // Retrieve the VTK API for the currently active VTK viewport

    // Unpack viewport configuration/layout
    const { numRows, numColumns, layout, viewportSpecificData, activeViewportIndex } = viewports;

    // Retrieve active viewport data and locate VTK API
    const currentData = layout.viewports[activeViewportIndex];
    if (currentData && currentData.viewer3dvol) {
      return apis[activeViewportIndex];
    }

    throw new Error('Unable to locate VTK API for currently active viewport');
  }

  function _applyVtkVolumeRenderOptions(api, options) {
    ``;
    // Apply volume rendering options for the provided viewport API
    options = options || {};

    // Retrieve volume actor, mapper, and image reference
    const volumeActor = api.volumes[0];
    const volumeMapper = volumeActor.getMapper();
    const imageData = volumeMapper.getInputData();

    // Apply options to volume and re-render
    vtkUtils.applyVtkVolumeRenderOptions(imageData, volumeActor, volumeMapper, options);
    api.genericRenderWindow.getRenderWindow().render();

    // Determine new window/level
    const wl = vtkUtils.getWindowLevel(volumeActor);
    api.updateVOI(wl.windowWidth, wl.windowCenter);
  }

  const actions = {
    closeViewer3d() {
      // Exit 3D CT volume viewer

      // Enable default (Cornerstone) layout for the viewer
      commandsManager.runCommand('setCornerstoneLayout');
      currentActiveColorPreset = null;
    },

    setVtkVolumeColorPreset: async ({ viewports, activeColorPreset }) => {
      // Change color preset being used to render the volume
      const api = await _getActiveViewportVTKApi(viewports);
      if (api && currentActiveColorPreset != activeColorPreset) {
        // On first init, there won't be an active color preset. In this case
        // skip applying the preset to the volume since the viewport will set
        // the rendering options values as part of its startup.
        if (currentActiveColorPreset) {
          _applyVtkVolumeRenderOptions(api, {
            vtkColorPreset: activeColorPreset,
          });
        }
      }

      // Update value of currently active preset
      currentActiveColorPreset = activeColorPreset;
    },

    enableVolumeRotateTool: async ({ viewports }) => {
      // Enable rotate tool
      const api = await _getActiveViewportVTKApi(viewports);

      // Set default interactor style
      api.genericRenderWindow.getInteractor().disable();
      vtkUtils.setVtkVolumeInteractorStyle(api, api.defaultVolumeInteractorStyle);
      api.genericRenderWindow.getInteractor().enable();
    },

    enableVolumeLevelTool: async ({ viewports }) => {
      // Enable window/level tool

      // Retrieve API reference and disable interactor while creating new style
      const api = await _getActiveViewportVTKApi(viewports);
      api.genericRenderWindow.getInteractor().disable();

      // Create instance of window level interactor
      function updateVOI(windowWidth, windowCenter) {
        api.updateVOI(windowWidth, windowCenter);
      }
      const throttledUpdateVOI = _.throttle(updateVOI, 16, { trailing: true });

      // Create MPR window level interactor and apply
      const istyle = vtkInteractorStyleVolumeWindowLevel.newInstance();
      vtkUtils.setVtkVolumeInteractorStyle(api, istyle, {
        setOnLevelsChanged: ({ windowWidth, windowCenter }) => {
          // Render application change and update global state
          const rwindow = api.genericRenderWindow.getRenderWindow();
          rwindow.render();

          // Update viewport VOI
          throttledUpdateVOI(windowWidth, windowCenter);
        },
      });

      // Re-enable interactor with new style
      api.genericRenderWindow.getInteractor().enable();
    },

    enableVolumePanTool: async ({ viewports }) => {
      // Enable window/pan tool
      const api = await _getActiveViewportVTKApi(viewports);
      api.genericRenderWindow.getInteractor().disable();

      // Create instance of pan interactor
      const istyle = vtkInteractorStyleVolumePan.newInstance();
      vtkUtils.setVtkVolumeInteractorStyle(api, istyle);

      // Re-enable interactor with new style
      api.genericRenderWindow.getInteractor().enable();
    },

    resetCTVolumeView: async ({ viewports }) => {
      // Reset volume back to selected VTK color preset values

      const api = await _getActiveViewportVTKApi(viewports);
      if (api && api.volumes) {
        // Retrieve volume actor, mapper, and image reference
        _applyVtkVolumeRenderOptions(api, {
          vtkColorPreset: currentActiveColorPreset || undefined,
        });
      }
    },

    viewer3dCT: async ({ viewports }) => {
      // Open VTK volume viewer for CT modalities

      // Retrieve currently active display set
      const displaySet = viewports.viewportSpecificData[viewports.activeViewportIndex];

      // Set layout of viewport for CT volume viewer
      try {
        // Retrieve VTK API references and cache copy of the default interactors
        apis = await setCTVolumeLayout(displaySet, [{}]);
        _.each(apis, (api, k) => {
          // Set reference to default volume interactor style
          api.defaultVolumeInteractorStyle = api.genericRenderWindow.getInteractor().getInteractorStyle();

          // Set volume options to default render
          _applyVtkVolumeRenderOptions(api, {
            vtkColorPreset: vtkUtils.volumeColorPresetUtils.getDefaultVolumePresetForModality(displaySet.Modality),
          });
        });

        // Set rotate tool active
      } catch (error) {
        throw new Error(error);
      }
    },
  };

  window.viewer3dActions = actions;

  const definitions = {
    closeViewer3d: {
      commandFn: actions.closeViewer3d,
      options: {},
    },
    setVtkVolumeColorPreset: {
      commandFn: actions.setVtkVolumeColorPreset,
      storeContexts: ['viewports'],
      options: {},
    },
    enableVolumeRotateTool: {
      commandFn: actions.enableVolumeRotateTool,
      storeContexts: ['viewports'],
      options: {},
    },
    enableVolumeLevelTool: {
      commandFn: actions.enableVolumeLevelTool,
      storeContexts: ['viewports'],
      options: {},
    },
    enableVolumePanTool: {
      commandFn: actions.enableVolumePanTool,
      storeContexts: ['viewports'],
      options: {},
    },
    resetCTVolumeView: {
      commandFn: actions.resetCTVolumeView,
      storeContexts: ['viewports'],
      options: {},
    },
    viewer3dCT: {
      commandFn: actions.viewer3dCT,
      storeContexts: ['viewports'],
      options: {},
      context: 'VIEWER',
    },
  };

  return {
    definitions,
    defaultContext: 'ACTIVE_VIEWPORT::VIEWER3DVOL',
  };
};

export default commandsModule;
