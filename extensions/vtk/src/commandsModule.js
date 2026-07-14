import {
  ToolGroupManager as C3dToolGroupManager,
  SynchronizerManager as C3dSynchronizerManager,

  // Viewport Tools
  WindowLevelTool as C3dWindowLevelTool,
  CrosshairsTool as C3dCrosshairsTool,
  ZoomTool as C3dZoomTool,
  PanTool as C3dPanTool,
  StackScrollTool as C3dStackScrollTool,
  TrackballRotateTool as C3dTrackballRotateTool,
  Enums as c3dToolsEnums,
  addTool as c3dAddTool,

  // Segmentation state
  segmentation as c3dSegmentations,
} from '@cornerstonejs/tools';
import { SegmentationRepresentations } from '@cornerstonejs/tools/enums';
import {
  createVOISynchronizer as c3dCreateVOISynchronizer,
} from '@cornerstonejs/tools/synchronizers';
import {
  getRenderingEngine as c3dGetRenderingEngine,
} from '@cornerstonejs/core';

import OHIF from '@ohif/core';
import { utils as cextUtils } from '@ohif/extension-cornerstone';

import setMPRLayout from './utils/setMPRLayout.js';
import { getCornerstone3dViewport } from './utils/cornerstone3d.js';

import { Enums as vtkEnums } from './enums';

const { DisplaySetApi } = OHIF.display;


const commandsModule = ({ commandsManager, servicesManager }) => {
  const { UINotificationService, LoggerService } = servicesManager.services;

  function createSetStyleCommand(propertyName) {
    // Creates a command function that sets a style property for a particular segmentation type.
    // If type is provided, sets the property for that type only. If type is not provided,
    // sets the property for both Labelmap and Contour types.
    return ({ type, value, segmentationId }) => {
      const { segmentationService } = servicesManager.services;
      if (type) {
        segmentationService.setStyle({ type, segmentationId }, { [propertyName]: value });
      } else {
        segmentationService.setStyle(
          { type: SegmentationRepresentations.Labelmap, segmentationId }, { [propertyName]: value });
        segmentationService.setStyle(
          { type: SegmentationRepresentations.Contour, segmentationId }, { [propertyName]: value });
      }
    };
  }

  function _registerMpRTools() {
    // Register tools with Cornerstone3D
    c3dAddTool(C3dCrosshairsTool);
    c3dAddTool(C3dZoomTool);
    c3dAddTool(C3dWindowLevelTool);
    c3dAddTool(C3dPanTool);
    c3dAddTool(C3dStackScrollTool);
    c3dAddTool(C3dTrackballRotateTool);
  }
  
  
  const actions = {

    setSegmentationConfiguration: async ({ viewports, globalOpacity, visible, renderOutline, outlineThickness }) => {
      console.log(`[VTK:setSegmentationConfiguration] globalOpacity=${globalOpacity} visible=${visible}`
        +`renderOutline=${renderOutline} outlineThickness=${outlineThickness}`);
    },
    setSegmentConfiguration: async ({ viewports, visible, segmentNumber }) => {
      console.log(`[VTK:setSegmentConfiguration] visible=${visible} segmentNumber=${segmentNumber}`);
    },

    initMprTools: ({ toolGroupId, component }) => {
      // Initialize MPR navigation tools for the provided component. The VTK MPR view spans multiple
      // cells in the layout manager but utilizes a single tool group instance. To prevent race conditions
      // during initalization, this central management method should be used for creating and controlling tools.

      let mprTools = C3dToolGroupManager.getToolGroup(toolGroupId);
      const { viewportId, viewport } = component._checkViewportActive();

      if (!mprTools && viewport) {

        // Register tools with Cornerstone3D
        _registerMpRTools();

        // Initialize tool group and add window/zoom interaction
        mprTools = C3dToolGroupManager.createToolGroup(toolGroupId);
        component.mprTools = mprTools;

        // Add tools to the group
        mprTools.addTool(C3dCrosshairsTool.toolName);
        mprTools.addTool(C3dZoomTool.toolName);
        mprTools.addTool(C3dWindowLevelTool.toolName);
        mprTools.addTool(C3dPanTool.toolName);
        mprTools.addTool(C3dStackScrollTool.toolName);

        // Add viewport to the tool
        mprTools.addViewport(viewportId);

        // Activate tools
        actions.activateMprTools({ toolGroupId, toolMode: component.state.toolMode });

        console.log('[VTK:MPR] initialize tools viewportId='+viewportId);
      } else if (mprTools && !component.mprTools) {

        // Tools already initialized, but not referenced by component. Activate and add reference.
        component.mprTools = mprTools;
        mprTools.addViewport(viewportId);

        console.log('[VTK:MPR] add tools reference for viewportId='+viewportId);
      }
    },

    deactivateMprTools: ({ toolGroupId, removeAllBindings = true }) => {
      // Deactivate the provided tool mode for the specified toolGroupId

      const mprTools = C3dToolGroupManager.getToolGroup(toolGroupId);
      if (mprTools && removeAllBindings) {

        mprTools.setToolPassive(C3dStackScrollTool.toolName);
        mprTools.setToolPassive(C3dPanTool.toolName);
        mprTools.setToolPassive(C3dWindowLevelTool.toolName);
        mprTools.setToolPassive(C3dZoomTool.toolName);
      }
    },

    activateMprTools: ({ toolGroupId, toolMode, displaySetInstanceUID }) => {
      // Activate the provided tool mode for the specified toolGroupId

      actions.deactivateMprTools({ toolGroupId, });
      const mprTools = C3dToolGroupManager.getToolGroup(toolGroupId);
      if (mprTools) {
        if (!toolMode || (toolMode == 'default')) {

          // Set cross-hair tool active
          mprTools.setToolActive(C3dCrosshairsTool.toolName, {
            bindings: [
              { mouseButton: c3dToolsEnums.MouseBindings.Primary }, // Left click
            ]
          });

          mprTools.setToolActive(C3dZoomTool.toolName, {
            bindings: [
              { mouseButton: c3dToolsEnums.MouseBindings.Secondary }, // Right click
            ]
          });

          mprTools.setToolActive(C3dPanTool.toolName, {
            bindings: [
              { mouseButton: c3dToolsEnums.MouseBindings.Auxiliary }, // Middle mouse button
            ]
          });

          // Bind stack scroll to mouse scroll
          mprTools.setToolActive(C3dStackScrollTool.toolName, {
            bindings: [
              { mouseButton: c3dToolsEnums.MouseBindings.Wheel }, // Change slice position on stack scroll
            ]
          });

        } else if (toolMode == 'level') {

          // Set level tools active
          mprTools.setToolActive(C3dWindowLevelTool.toolName, {
            bindings: [
              { mouseButton: c3dToolsEnums.MouseBindings.Primary }, // Left click
            ]
          });

          mprTools.setToolActive(C3dZoomTool.toolName, {
            bindings: [
              { mouseButton: c3dToolsEnums.MouseBindings.Secondary }, // Right click
            ]
          });

          mprTools.setToolActive(C3dPanTool.toolName, {
            bindings: [
              { mouseButton: c3dToolsEnums.MouseBindings.Auxiliary }, // Middle mouse button
            ]
          });

          // Bind stack scroll to mouse scroll
          mprTools.setToolActive(C3dStackScrollTool.toolName, {
            bindings: [
              { mouseButton: c3dToolsEnums.MouseBindings.Wheel }, // Change slice position on stack scroll
            ]
          });
        }

        // Trigger API event to allow for viewports to store the active tool mode
        if (displaySetInstanceUID) {
          DisplaySetApi.Instance.displaySetService.triggerApiEvent(vtkEnums.MPR.EVENTS.VTK_MPR_ACTIVATE_TOOL, {
            displaySetInstanceUID: displaySetInstanceUID, toolGroupId, tool: toolMode, 
          });
        }
      }
    },

    initMprImageSync: ({ voiSyncId, component }) => {
      // Initialize MPR image sync tools for the provided component. The VTK MPR view spans multiple
      // cells in the layout manager but utilizes a single VOI group instance. To prevent race conditions
      // during initalization, this central management method should be used for init of sync groups.

      let mprVoi = C3dSynchronizerManager.getSynchronizer(voiSyncId);
      const { viewportId, viewport } = component._checkViewportActive();

      if (!mprVoi && viewportId) {

        // Initialize synchronizer and attach to the viewport
        mprVoi = c3dCreateVOISynchronizer(voiSyncId);
        component.imgSync = mprVoi;
        mprVoi.add({ renderingEngineId: component.props.renderId, viewportId });

        console.log('[VTK:MPR] initialize VOI sync viewportId='+viewportId);
      } else if (mprVoi && !component.imgSync && viewportId) {

        // Synchronizer already initialized, but not referenced by component. Activate and add reference.
        component.imgSync = mprVoi;
        mprVoi.add({ renderingEngineId: component.props.renderId, viewportId });

        console.log('[VTK:MPR] add VOI sync reference for viewportId='+viewportId);
      }
    },

    resetMprView: () => {
      // Reset the camera and window/level for all viewports in the MPR rendering engine

      const renderEngine = c3dGetRenderingEngine(vtkEnums.MPR.VTK_MPRSLICE_RENDER_ID);
      if (renderEngine) {
        renderEngine.getViewports().forEach(viewport => {
          viewport.resetCamera();
          viewport.resetProperties();
        });
        renderEngine.render();
      }
    },

    enableCrosshairsTool: ({ toolGroupId = vtkEnums.MPR.VTK_MPRSLICE_TOOLGROUP_ID, viewports }) => {
      // Enable MPR cross-hairs tool

      const displaySet = viewports.viewportSpecificData[viewports.activeViewportIndex];
      actions.activateMprTools({
        toolGroupId, toolMode: vtkEnums.MPR.TOOLS.VTK_MPRSLICE_TOOL_DEFAULT, 
        displaySetInstanceUID: displaySet.displaySetInstanceUID,
      });
    },

    enableMprLevelTool: ({ toolGroupId = vtkEnums.MPR.VTK_MPRSLICE_TOOLGROUP_ID, viewports }) => {
      // Enable MPR level tool

      const displaySet = viewports.viewportSpecificData[viewports.activeViewportIndex];
      actions.activateMprTools({
        toolGroupId, toolMode: vtkEnums.MPR.TOOLS.VTK_MPRSLICE_TOOL_LEVEL,
        displaySetInstanceUID: displaySet.displaySetInstanceUID,
      });
    },

    mpr2d: async ({ viewports }) => {
      // Activate 2D MPR view. Sets up a 3-panel layout with axial, sagittal, and coronal slices.
      // Orientation for each panel is derived from the viewport index in OHIFVTKViewport.

      const displaySet = viewports.viewportSpecificData[viewports.activeViewportIndex];

      try {
        await setMPRLayout(displaySet, [{}, {}, {}], 1, 3);
      } catch (error) {
        throw new Error(error);
      }
    },

    // -------------------------------------------------------------------------
    // Segmentation commands
    // -------------------------------------------------------------------------

    editSegmentationLabel: ({ segmentationId }) => {
      // Edit the label of the provided segmentation

      const { UIDialogService, segmentationService } = servicesManager.services;
      const _seg = segmentationService.getSegmentation(segmentationId);
      if (!_seg) {
        return;
      }
      const { label: label0 } = _seg;

      cextUtils.callInputDialog({
        uiDialogService: UIDialogService,
        title: 'Edit Segmentation Label',
        placeholder: 'Enter new label',
        defaultValue: label0,
        centralize: true,
        isDraggable: false,
        showOverlay: true,
      }).then(label => {
        segmentationService.addOrUpdateSegmentation({ segmentationId, label });
      });
    },

    addSegment: ({ segmentationId, config }) => {
      // Add a segment to the provided segmentation

      const { segmentationService } = servicesManager.services;
      segmentationService.addSegment(segmentationId, config);
    },

    editSegmentLabel: ({ segmentationId, segmentIndex }) => {
      // Edit the label of the provided segment

      const { UIDialogService, segmentationService } = servicesManager.services;
      const _seg = c3dSegmentations.state.getSegmentation(segmentationId);
      if (!_seg) {
        console.warn('[VTK:editSegmentLabel] Unable to retrieve segmentation for segmentationId='+segmentationId);
        return;
      }
      if (!_seg.segments[segmentIndex]) {
        console.warn('[VTK:editSegmentLabel] Unable to retrieve segment for segmentationId='+segmentationId+' segmentIndex='+segmentIndex);
        return;
      }

      const label0 = _seg.segments[segmentIndex].label || '';

      cextUtils.callInputDialog({
        uiDialogService: UIDialogService,
        title: 'Edit Segment Label',
        placeholder: 'Enter new label',
        defaultValue: label0,
        centralize: true,
        isDraggable: false,
        showOverlay: true,
      }).then(label => {
        segmentationService.setSegmentLabel(segmentationId, segmentIndex, label);
      });
    },

    editSegmentColor: ({ segmentationId, segmentIndex, viewportId }) => {
      // Edit the color of the specified segment. Launches the Sonador Color Picker Dialog.

      const { segmentationService, UIDialogService } = servicesManager.services;
      const color0 = segmentationService.getSegmentColor(viewportId, segmentationId, segmentIndex);
      const rgbaColor0 = { r: color0[0], g: color0[1], b: color0[2], a: color0[3] / 255.0 };

      cextUtils.callColorPickerDialog({
        uiDialogService: UIDialogService,
        title: 'Select Segment Color',
        value: rgbaColor0,
        centralize: true,
        isDraggable: false,
        showOverlay: true,
      }).then(rgbaColor => {
        const color = [rgbaColor.r, rgbaColor.g, rgbaColor.b, rgbaColor.a * 255.0];
        segmentationService.setSegmentColor(viewportId, segmentationId, segmentIndex, color);
      });
    },

    deleteSegment: ({ segmentationId, segmentIndex }) => {
      // Delete a segment from a segmentation

      const { segmentationService } = servicesManager.services;
      segmentationService.removeSegment(segmentationId, segmentIndex);
    },

    toggleSegmentLock: ({ segmentationId, segmentIndex }) => {
      // Toggle the lock state of a segment

      const { segmentationService } = servicesManager.services;
      segmentationService.toggleSegmentLocked(segmentationId, segmentIndex);
    },

    // -------------------------------------------------------------------------
    // Volume rendering commands
    // -------------------------------------------------------------------------

    setViewportPreset: ({ viewportId, preset }) => {
      const viewport = getCornerstone3dViewport(viewportId);
      if (!viewport) {
        return;
      }
      viewport.setProperties({ preset });
      viewport.render();
    },

    setVolumeRenderingQuality: ({ viewportId, volumeQuality }) => {
      const viewport = getCornerstone3dViewport(viewportId);
      if (!viewport) {
        return;
      }
      const { actor } = viewport.getActors()[0];
      const mapper = actor.getMapper();
      const image = mapper.getInputData();
      const dims = image.getDimensions();
      const spacing = image.getSpacing();

      const spatialDiagonal = Math.sqrt(
        Math.pow(dims[0] * spacing[0], 2) +
        Math.pow(dims[1] * spacing[1], 2) +
        Math.pow(dims[2] * spacing[2], 2)
      );

      let sampleDistance = spacing.reduce((a, b) => a + b) / 3.0;
      sampleDistance /= volumeQuality > 1 ? 0.5 * Math.pow(volumeQuality, 2) : 1.0;

      const samplesPerRay = spatialDiagonal / sampleDistance + 1;
      mapper.setMaximumSamplesPerRay(samplesPerRay);
      mapper.setSampleDistance(sampleDistance);
      viewport.render();
    },

    shiftVolumeOpacityPoints: ({ viewportId, shift }) => {
      const viewport = getCornerstone3dViewport(viewportId);
      if (!viewport) {
        return;
      }
      const { actor } = viewport.getActors()[0];
      const ofun = actor.getProperty().getScalarOpacity(0);
      const size = ofun.getSize();
      const opacityPointValues = [];

      for (let i = 0; i < size; i++) {
        const point = [0, 0, 0, 0];
        ofun.getNodeValue(i, point);
        opacityPointValues.push(point);
      }
      opacityPointValues.forEach(point => { point[0] += shift; });

      ofun.removeAllPoints();
      opacityPointValues.forEach(point => { ofun.addPoint(...point); });
      viewport.render();
    },

    setVolumeLighting: ({ viewportId, options }) => {
      const viewport = getCornerstone3dViewport(viewportId);
      if (!viewport) {
        return;
      }
      const { actor } = viewport.getActors()[0];
      const property = actor.getProperty();

      if (options.shade !== undefined) { property.setShade(options.shade); }
      if (options.ambient !== undefined) { property.setAmbient(options.ambient); }
      if (options.diffuse !== undefined) { property.setDiffuse(options.diffuse); }
      if (options.specular !== undefined) { property.setSpecular(options.specular); }
      viewport.render();
    },
  };

  const definitions = {
    setSegmentationConfiguration: {
      commandFn: actions.setSegmentationConfiguration,
      storeContexts: ['viewports'],
      options: {},
      context: vtkEnums.VIEWPORT,
    },
    setSegmentConfiguration: {
      commandFn: actions.setSegmentConfiguration,
      storeContexts: ['viewports'],
      options: {},
      context: vtkEnums.VIEWPORT,
    },
    enableCrosshairsTool: {
      commandFn: actions.enableCrosshairsTool,
      storeContexts: ['viewports'],
      options: {},
    },
    enableMprLevelTool: {
      commandFn: actions.enableMprLevelTool,
      storeContexts: ['viewports'],
      options: {},
    },
    resetMprView: {
      commandFn: actions.resetMprView,
      options: {},
    },
    initMprTools: {
      commandFn: actions.initMprTools,
      options: {},
      context: vtkEnums.VIEWPORT,
    },
    initMprImageSync: {
      commandFn: actions.initMprImageSync,
      options: {},
      context: vtkEnums.VIEWPORT,
    },
    mpr2d: {
      commandFn: actions.mpr2d,
      storeContexts: ['viewports'],
      options: {},
      context: 'VIEWER',
    },

    // Segmentation commands
    editSegmentationLabel: {
      commandFn: actions.editSegmentationLabel,
      options: {},
      context: vtkEnums.VIEWPORT,
    },
    addSegment: {
      commandFn: actions.addSegment,
      options: {},
      context: vtkEnums.VIEWPORT,
    },
    editSegmentLabel: {
      commandFn: actions.editSegmentLabel,
      options: {},
      context: vtkEnums.VIEWPORT,
    },
    editSegmentColor: {
      commandFn: actions.editSegmentColor,
      options: {},
      context: vtkEnums.VIEWPORT,
    },
    deleteSegment: {
      commandFn: actions.deleteSegment,
      options: {},
      context: vtkEnums.VIEWPORT,
    },
    toggleSegmentLock: {
      commandFn: actions.toggleSegmentLock,
      options: {},
      context: vtkEnums.VIEWPORT,
    },
    setFillAlpha: {
      commandFn: createSetStyleCommand('fillAlpha'),
      options: {},
      context: vtkEnums.VIEWPORT,
    },
    setOutlineWidth: {
      commandFn: createSetStyleCommand('outlineWidth'),
      options: {},
      context: vtkEnums.VIEWPORT,
    },
    setRenderFill: {
      commandFn: createSetStyleCommand('renderFill'),
      options: {},
      context: vtkEnums.VIEWPORT,
    },
    setRenderFillInactive: {
      commandFn: createSetStyleCommand('renderFillInactive'),
      options: {},
      context: vtkEnums.VIEWPORT,
    },
    setRenderOutline: {
      commandFn: createSetStyleCommand('renderOutline'),
      options: {},
      context: vtkEnums.VIEWPORT,
    },
    setRenderOutlineInactive: {
      commandFn: createSetStyleCommand('renderOutlineInactive'),
      options: {},
      context: vtkEnums.VIEWPORT,
    },

    // Volume rendering commands
    setViewportPreset: {
      commandFn: actions.setViewportPreset,
      options: {},
      context: vtkEnums.VIEWPORT,
    },
    setVolumeRenderingQuality: {
      commandFn: actions.setVolumeRenderingQuality,
      options: {},
      context: vtkEnums.VIEWPORT,
    },
    shiftVolumeOpacityPoints: {
      commandFn: actions.shiftVolumeOpacityPoints,
      options: {},
      context: vtkEnums.VIEWPORT,
    },
    setVolumeLighting: {
      commandFn: actions.setVolumeLighting,
      options: {},
      context: vtkEnums.VIEWPORT,
    },
  };

  return {
    definitions,
    defaultContext: vtkEnums.ACTIVE_VIEWPORT,
  };
};


export default commandsModule;
