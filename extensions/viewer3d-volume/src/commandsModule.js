import _ from 'lodash';

import {
  ToolGroupManager as C3dToolGroupManager,

  // Viewport Tools
  PanTool as C3dPanTool,
  TrackballRotateTool as C3dTrackballRotateTool,
  VolumeCroppingTool as C3dVolumeCroppingTool,
  Enums as c3dToolsEnums,
  addTool as c3dAddTool,
} from '@cornerstonejs/tools';

import OHIF from "@ohif/core";
import {
  createViewportToggleFeatureCommand,
  cornerstone3dUtils as c3dUtils,
} from '@ohif/extension-vtk';

import setCTVolumeLayout from './utils/setCTVolumeLayout.js';

import { Enums as VolViewerEnums } from './enums';

const { SonadorZoomTool } = c3dUtils.viewportTools;
const { DisplaySetApi } = OHIF.display;


const commandsModule = ({ commandsManager, servicesManager }) => {
  const { UINotificationService, LoggerService } = servicesManager.services;

  function _registerVolumeViewerTools() {
    // Register tool instances with Cornerstone3D (idempotent: addTool no-ops when the tool is
    // already in the global registry)
    c3dAddTool(SonadorZoomTool);
    c3dAddTool(C3dPanTool);
    c3dAddTool(C3dTrackballRotateTool);
  }

  const _triggerToolStateEvent = ({ tool, displaySetInstanceUID, state, toolMode }) => {
    // Broadcast a tool activation-state change so widgets and other components can synchronize
    // without polling tool groups (AR-4 on ohif-viewers#122). toolMode rides along on every
    // mode change (FR-9).
    DisplaySetApi.Instance.displaySetService.triggerApiEvent(VolViewerEnums.EVENTS.VOLVIEWER_TOOL_STATE, {
      tool, displaySetInstanceUID, state, toolMode,
    });
  };

  const _parkCroppingToolInput = (volumeTools) => {
    // Park the cropping tool in the "visible but input-free" state used by the Default and Pan
    // modes: setToolEnabled REPLACES the tool options (bindings: []), which is the only reliable
    // way to strip a previously granted Primary binding — setToolActive MERGES new bindings into
    // the existing set. Enabled mode keeps the handle/edge actors and clipping planes rendering
    // (VolumeCroppingTool.onSetToolEnabled is a no-op) while Cornerstone3D stops dispatching
    // mouse input to the tool.

    const croppingTool = volumeTools.getToolInstance(C3dVolumeCroppingTool.toolName);
    if (croppingTool && croppingTool.mode === c3dToolsEnums.ToolModes.Active) {
      volumeTools.setToolEnabled(C3dVolumeCroppingTool.toolName);
    }
  };

  const _publishToolMode = ({ toolMode, displaySetInstanceUID }) => {
    // Record the tool mode on the displaySet — volumeViewerToolMode drives the Rotate/Pan
    // widget highlights and volumeCropSelectActive the Adjust widget — and broadcast the mode
    // change through the tool-state event (FR-9). The mode widgets are all attribute-driven so
    // their active states stay mutually exclusive regardless of whether the mode changed via a
    // toolbar click, a command, or the FR-9 auto-transitions.

    if (!displaySetInstanceUID) {
      return;
    }

    const _ds = DisplaySetApi.Instance.displaySetService.getDisplaySetByUID(displaySetInstanceUID);
    if (!_ds) {
      return;
    }

    // Publish widget state when the attribute lifecycle has been initialized (AR-2 non-nil guard)
    let changed = false;
    const _mode = toolMode || VolViewerEnums.TOOLS.VOLVIEWER_TOOL_DEFAULT;
    if (!_.isNil(_ds.volumeViewerToolMode) && _ds.volumeViewerToolMode !== _mode) {
      _ds.volumeViewerToolMode = _mode;
      changed = true;
    }

    const selectActive = _mode == VolViewerEnums.TOOLS.VOLVIEWER_TOOL_SELECT;
    if (!_.isNil(_ds.volumeCropSelectActive) && !!_ds.volumeCropSelectActive !== selectActive) {
      _ds.volumeCropSelectActive = selectActive;
      changed = true;
    }

    if (changed) {
      DisplaySetApi.Instance.displaySetService.addDisplaySets([_ds]);
    }

    _triggerToolStateEvent({
      tool: VolViewerEnums.TOOLS.VOLVIEWER_TOOL_CROP, displaySetInstanceUID,
      state: _ds.volumeCroppingEnabled === true ? 'active' : 'inactive',
      toolMode: _mode,
    });
  };

  const actions = {
    closeViewer3d() {
      // Exit 3D CT volume viewer

      // Enable default (Cornerstone) layout for the viewer
      commandsManager.runCommand('setCornerstoneLayout');
    },

    initVolumeViewerTools: ({ toolGroupId, component }) => {
      // Initialize navigation tools for the volume viewer viewport. Central, idempotent
      // registration following the MPR pattern (initMprTools, extensions/vtk/src/commandsModule.js):
      // get-or-create the tool group, register tools once, and store the reference on the
      // component; re-entry is a no-op.

      let volumeTools = C3dToolGroupManager.getToolGroup(toolGroupId);
      const { viewportId, viewport } = component._checkViewportActive();

      if (!volumeTools && viewport) {

        // Register tool instances with Cornerstone3D
        _registerVolumeViewerTools();

        // Initialize tool group and add navigation interaction
        volumeTools = C3dToolGroupManager.createToolGroup(toolGroupId);
        component.volumeTools = volumeTools;

        // Add tools to the group
        volumeTools.addTool(SonadorZoomTool.toolName);
        volumeTools.addTool(C3dPanTool.toolName);
        volumeTools.addTool(C3dTrackballRotateTool.toolName);

        // Add viewport to the tool group
        volumeTools.addViewport(viewportId);

        console.log('[VolViewer] initialize tools viewportId='+viewportId);
      } else if (volumeTools && !component.volumeTools && viewportId) {

        // Tools already initialized, but not referenced by component. Add reference and viewport.
        component.volumeTools = volumeTools;
        volumeTools.addViewport(viewportId);

        console.log('[VolViewer] add tools reference for viewportId='+viewportId);
      }
    },

    deactivateVolumeViewerTools: ({ toolGroupId, removeAllBindings = true }) => {
      // Deactivate navigation tools for the specified toolGroupId in preparation of
      // applying new bindings

      const volumeTools = C3dToolGroupManager.getToolGroup(toolGroupId);
      if (volumeTools && removeAllBindings) {
        volumeTools.setToolPassive(C3dPanTool.toolName);
        volumeTools.setToolPassive(SonadorZoomTool.toolName);
        volumeTools.setToolPassive(C3dTrackballRotateTool.toolName);
      }
    },

    activateVolumeViewerTools: ({ toolGroupId, toolMode, displaySetInstanceUID }) => {
      // Activate the provided tool mode for the specified toolGroupId. Modes reassign the
      // Primary mouse binding while Secondary/Auxiliary/Wheel stay stable (§5.6 binding table
      // on ohif-viewers#122); with cropping enabled the crop handles remain visible in every
      // mode but only receive input in select.

      actions.deactivateVolumeViewerTools({ toolGroupId, });
      const volumeTools = C3dToolGroupManager.getToolGroup(toolGroupId);

      if (volumeTools) {

        // Select is only a legal mode while cropping is enabled; fall back to default (§5.6)
        if (toolMode == VolViewerEnums.TOOLS.VOLVIEWER_TOOL_SELECT && displaySetInstanceUID) {
          const _ds = DisplaySetApi.Instance.displaySetService.getDisplaySetByUID(displaySetInstanceUID);
          if (_ds?.volumeCroppingEnabled !== true) {
            toolMode = VolViewerEnums.TOOLS.VOLVIEWER_TOOL_DEFAULT;
          }
        }

        if (!toolMode || (toolMode == VolViewerEnums.TOOLS.VOLVIEWER_TOOL_DEFAULT)) {

          // Rotate image and segmentation volumes
          volumeTools.setToolActive(C3dTrackballRotateTool.toolName, {
            bindings: [
              { mouseButton: c3dToolsEnums.MouseBindings.Primary }, // Left click
            ]
          });

          // Pan volume (right click — matches Three.js convention)
          volumeTools.setToolActive(C3dPanTool.toolName, {
            bindings: [
              { mouseButton: c3dToolsEnums.MouseBindings.Secondary }, // Right mouse button press
            ]
          });

          // Zoom volume (middle click + scroll wheel — matches Three.js convention)
          volumeTools.setToolActive(SonadorZoomTool.toolName, {
            bindings: [
              { mouseButton: c3dToolsEnums.MouseBindings.Auxiliary }, // Middle mouse button press
              { mouseButton: c3dToolsEnums.MouseBindings.Wheel },     // Scroll wheel
            ]
          });

          // Handles stay visible but receive no input outside select
          _parkCroppingToolInput(volumeTools);

        } else if (toolMode == VolViewerEnums.TOOLS.VOLVIEWER_TOOL_PAN) {

          // Pan volume (left click)
          volumeTools.setToolActive(C3dPanTool.toolName, {
            bindings: [
              { mouseButton: c3dToolsEnums.MouseBindings.Primary }, // Left Click
            ]
          });

          // Handles stay visible but receive no input outside select
          _parkCroppingToolInput(volumeTools);

        } else if (toolMode == VolViewerEnums.TOOLS.VOLVIEWER_TOOL_SELECT) {

          // Select ("Adjust"): the cropping tool holds Primary — Cornerstone3D only dispatches
          // preMouseDownCallback/mouseDragCallback to the binding holder. Sphere within grab
          // distance: drag the handle; empty space: the tool's built-in trackball rotation;
          // Shift+drag: rotate the crop planes.
          volumeTools.setToolActive(C3dVolumeCroppingTool.toolName, {
            bindings: [
              { mouseButton: c3dToolsEnums.MouseBindings.Primary }, // Left click
            ]
          });

          // Re-assert handle/clipping visibility: onSetToolActive resets showHandles /
          // showClippingPlanes to false whenever the tool (re)activates.
          const croppingTool = volumeTools.getToolInstance(C3dVolumeCroppingTool.toolName);
          croppingTool?.setClippingPlanesVisible(true);

          // Pan volume (right click) and zoom (middle click + scroll wheel) as in default mode
          volumeTools.setToolActive(C3dPanTool.toolName, {
            bindings: [
              { mouseButton: c3dToolsEnums.MouseBindings.Secondary }, // Right mouse button press
            ]
          });
          volumeTools.setToolActive(SonadorZoomTool.toolName, {
            bindings: [
              { mouseButton: c3dToolsEnums.MouseBindings.Auxiliary }, // Middle mouse button press
              { mouseButton: c3dToolsEnums.MouseBindings.Wheel },     // Scroll wheel
            ]
          });
        }

        // Publish the mode change: widget state on the displaySet + tool-state event (FR-9)
        _publishToolMode({ toolMode, displaySetInstanceUID });
      }
    },

    initVolumeCroppingTool: ({ toolGroupId, component }) => {
      // Idempotent registration of the volume cropping tool. Called from the viewport's
      // initTools() after the navigation tools, so the viewport is already bound to the group.
      // Registration only — the tool is activated on demand by activateVolumeCropping.

      const volumeTools = C3dToolGroupManager.getToolGroup(toolGroupId);
      const { viewport } = component._checkViewportActive();
      if (!volumeTools || !viewport) {
        return;
      }

      if (!volumeTools.getToolInstance(C3dVolumeCroppingTool.toolName)) {
        c3dAddTool(C3dVolumeCroppingTool);
        volumeTools.addTool(C3dVolumeCroppingTool.toolName);

        // Sonador defaults for the cropping box and manipulation handles
        volumeTools.setToolConfiguration(C3dVolumeCroppingTool.toolName, {
          initialCropFactor: 0.08,
          showCornerSpheres: true,
          showHandles: true,
        });

        console.log('[VolViewer] initialize volume cropping tool toolGroupId='+toolGroupId);
      }
    },

    activateVolumeCropping: ({ toolGroupId, displaySetInstanceUID }) => {
      // Activate volume cropping: the cropping box initializes, the manipulation spheres/edges
      // become visible, and the clipping planes apply to the volume. The Primary mouse binding
      // is granted by select mode — activated here without bindings, the tool renders but
      // receives no input (§5.6).

      const volumeTools = C3dToolGroupManager.getToolGroup(toolGroupId);
      if (!volumeTools) {
        return;
      }

      volumeTools.setToolActive(C3dVolumeCroppingTool.toolName);

      // onSetToolActive initializes the cropping box but leaves handles and clipping hidden;
      // setClippingPlanesVisible(true) is the visible-on switch (it re-applies the clipping
      // planes and shows the sphere/edge handles).
      const croppingTool = volumeTools.getToolInstance(C3dVolumeCroppingTool.toolName);
      croppingTool?.setClippingPlanesVisible(true);

      _triggerToolStateEvent({
        tool: VolViewerEnums.TOOLS.VOLVIEWER_TOOL_CROP, displaySetInstanceUID, state: 'active',
      });

      // Auto-activate select — the user enabled the tool to use it (FR-9). Routed through the
      // VOLVIEWER_ACTIVATE_TOOL signal so the viewport's activateTools(mode) delegate runs and
      // its tool-mode state stays consistent with the bindings.
      DisplaySetApi.Instance.displaySetService.triggerApiEvent(VolViewerEnums.EVENTS.VOLVIEWER_ACTIVATE_TOOL, {
        displaySetInstanceUID, tool: VolViewerEnums.TOOLS.VOLVIEWER_TOOL_SELECT,
      });
    },

    deactivateVolumeCropping: ({ toolGroupId, displaySetInstanceUID, state = 'inactive', resetToolState = false }) => {
      // Deactivate volume cropping: clipping planes are removed (the volume returns to its
      // uncropped rendering), the manipulation handles are hidden, and the tool is disabled so
      // it no longer holds any mouse bindings.

      // @param state: activation state reported through the tool-state event — 'inactive' for a
      //  user toggle, 'hidden' when force-disabled because volume rendering turned off (FR-4).
      // @param resetToolState: clear the tool's cached scene state (sphere/edge actors, original
      //  clipping planes) so the next activation re-initializes from the volume bounds. Required
      //  when the volume actor is being removed or replaced (volume-rendering off, viewer reset):
      //  setVolumes() reinitializes the viewport actor list, and the tool's own new-volume reset
      //  (_onNewVolume) cannot fire while it is disabled — stale sphereStates otherwise suppress
      //  re-initialization on the next setToolActive, leaving the handles invisible/unreachable.

      const volumeTools = C3dToolGroupManager.getToolGroup(toolGroupId);
      if (!volumeTools) {
        return;
      }

      // Revert select to default before disabling (FR-9): the signal handler runs synchronously,
      // restoring the navigation bindings on Primary and clearing volumeCropSelectActive while
      // the cropping tool still exists in an active state.
      const _ds = displaySetInstanceUID
        ? DisplaySetApi.Instance.displaySetService.getDisplaySetByUID(displaySetInstanceUID) : undefined;
      if (_ds?.volumeCropSelectActive) {
        DisplaySetApi.Instance.displaySetService.triggerApiEvent(VolViewerEnums.EVENTS.VOLVIEWER_ACTIVATE_TOOL, {
          displaySetInstanceUID, tool: VolViewerEnums.TOOLS.VOLVIEWER_TOOL_DEFAULT,
        });
      }

      const croppingTool = volumeTools.getToolInstance(C3dVolumeCroppingTool.toolName);
      croppingTool?.setClippingPlanesVisible(false);
      volumeTools.setToolDisabled(C3dVolumeCroppingTool.toolName);

      if (resetToolState && croppingTool) {

        // Mirror the tool's internal _onNewVolume reset: with these cleared, the next
        // onSetToolActive re-initializes the cropping box and handle actors for the new volume
        croppingTool.originalClippingPlanes = [];
        croppingTool.sphereStates = [];
        croppingTool.edgeLines = {};
      }

      _triggerToolStateEvent({
        tool: VolViewerEnums.TOOLS.VOLVIEWER_TOOL_CROP, displaySetInstanceUID, state,
      });
    },

    toggleVolumeCropping: ({ viewports }) => {
      // Toolbar entry point: flip the volumeCroppingEnabled displaySet attribute and
      // activate/deactivate the cropping tool accordingly. Follows the
      // createViewportToggleFeatureCommand pattern, with two additional constraints that keep it
      // hand-rolled: cropping is only available while volume rendering is enabled, and the flip
      // drives tool activation side effects.

      const { activeViewportIndex, viewportSpecificData } = viewports;
      const viewportData = viewportSpecificData[activeViewportIndex];
      if (!viewportData?.displaySetInstanceUID) {
        return;
      }

      const _ds = DisplaySetApi.Instance.displaySetService.getDisplaySetByUID(viewportData.displaySetInstanceUID);

      // Cropping depends on an active volume rendering (FR-2/FR-4), and the attribute must have
      // been initialized by the viewport lifecycle (non-nil guard, AR-2)
      if (!_ds || _ds.imageVolumeRenderingEnabled !== true || _.isNil(_ds.volumeCroppingEnabled)) {
        return;
      }

      // Publish to displaySetService
      _ds.volumeCroppingEnabled = !_ds.volumeCroppingEnabled;
      DisplaySetApi.Instance.displaySetService.addDisplaySets([_ds]);

      const toolGroupId = VolViewerEnums.VOLVIEWER_TOOLGROUP_ID;
      if (_ds.volumeCroppingEnabled) {
        actions.activateVolumeCropping({ toolGroupId, displaySetInstanceUID: _ds.displaySetInstanceUID });
      } else {
        actions.deactivateVolumeCropping({ toolGroupId, displaySetInstanceUID: _ds.displaySetInstanceUID });
      }
    },

    enableVolumeRotateTool: async ({ viewports }) => {
      // Enable rotate tool

      const { activeViewportIndex, viewportSpecificData } = viewports;
      const viewportData = viewportSpecificData[activeViewportIndex];

      if (viewportData) {
        DisplaySetApi.Instance.displaySetService.triggerApiEvent(
          VolViewerEnums.EVENTS.VOLVIEWER_ACTIVATE_TOOL, {
            displaySetInstanceUID: viewportData.displaySetInstanceUID,
            tool: VolViewerEnums.TOOLS.VOLVIEWER_TOOL_DEFAULT,
          });
      }
    },

    enableVolumePanTool: async ({ viewports }) => {
      // Enable window/pan tool

      const { activeViewportIndex, viewportSpecificData } = viewports;
      const viewportData = viewportSpecificData[activeViewportIndex];

      if (viewportData) {
        DisplaySetApi.Instance.displaySetService.triggerApiEvent(
          VolViewerEnums.EVENTS.VOLVIEWER_ACTIVATE_TOOL, {
            displaySetInstanceUID: viewportData.displaySetInstanceUID,
            tool: VolViewerEnums.TOOLS.VOLVIEWER_TOOL_PAN,
          });
      }
    },

    enableVolumeSelectTool: async ({ viewports }) => {
      // Enable the select ("Adjust") tool mode: crop-handle interaction on the Primary binding

      const { activeViewportIndex, viewportSpecificData } = viewports;
      const viewportData = viewportSpecificData[activeViewportIndex];
      if (!viewportData?.displaySetInstanceUID) {
        return;
      }

      // Select is only a legal mode while cropping is enabled (§5.6)
      const _ds = DisplaySetApi.Instance.displaySetService.getDisplaySetByUID(viewportData.displaySetInstanceUID);
      if (_ds?.volumeCroppingEnabled !== true) {
        return;
      }

      DisplaySetApi.Instance.displaySetService.triggerApiEvent(
        VolViewerEnums.EVENTS.VOLVIEWER_ACTIVATE_TOOL, {
          displaySetInstanceUID: viewportData.displaySetInstanceUID,
          tool: VolViewerEnums.TOOLS.VOLVIEWER_TOOL_SELECT,
        });
    },

    resetCTVolumeView: async ({ viewports }) => {
      // Trigger a full reset of the 3D volume viewer: clears segmentations,
      // unloads the C3D volume cache, and re-loads the initial rendering state.

      const { activeViewportIndex, viewportSpecificData } = viewports;
      const viewportData = viewportSpecificData[activeViewportIndex];

      if (viewportData) {
        DisplaySetApi.Instance.displaySetService.triggerApiEvent(
          VolViewerEnums.EVENTS.VOLVIEWER_RESET, {
            displaySetInstanceUID: viewportData.displaySetInstanceUID,
          });
      }
    },

    viewer3dCT: async ({ viewports }) => {
      // Open VTK volume viewer for CT modalities

      // Retrieve currently active display set
      const displaySet = viewports.viewportSpecificData[viewports.activeViewportIndex];

      // Set layout of viewport for CT volume viewer
      try {
        await setCTVolumeLayout(displaySet, [{}]);
      } catch (error) {
        throw new Error(error);
      }
    },
  };

  const definitions = {
    closeViewer3d: {
      commandFn: actions.closeViewer3d,
      options: {},
    },

    // Tool registration/activation commands. Registered under the plain VIEWPORT context
    // (per-definition, like the MPR trio in extensions/vtk) so viewport components can invoke
    // them explicitly regardless of the currently active viewport context.
    initVolumeViewerTools: {
      commandFn: actions.initVolumeViewerTools,
      options: {},
      context: VolViewerEnums.VIEWPORT,
    },
    activateVolumeViewerTools: {
      commandFn: actions.activateVolumeViewerTools,
      options: {},
      context: VolViewerEnums.VIEWPORT,
    },
    deactivateVolumeViewerTools: {
      commandFn: actions.deactivateVolumeViewerTools,
      options: {},
      context: VolViewerEnums.VIEWPORT,
    },
    initVolumeCroppingTool: {
      commandFn: actions.initVolumeCroppingTool,
      options: {},
      context: VolViewerEnums.VIEWPORT,
    },
    activateVolumeCropping: {
      commandFn: actions.activateVolumeCropping,
      options: {},
      context: VolViewerEnums.VIEWPORT,
    },
    deactivateVolumeCropping: {
      commandFn: actions.deactivateVolumeCropping,
      options: {},
      context: VolViewerEnums.VIEWPORT,
    },
    toggleVolumeCropping: {
      commandFn: actions.toggleVolumeCropping,
      storeContexts: ['viewports'],
      options: {},
    },
    enableVolumeRotateTool: {
      commandFn: actions.enableVolumeRotateTool,
      storeContexts: ['viewports'],
      options: {},
    },
    enableVolumePanTool: {
      commandFn: actions.enableVolumePanTool,
      storeContexts: ['viewports'],
      options: {},
    },
    enableVolumeSelectTool: {
      commandFn: actions.enableVolumeSelectTool,
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
    toggleVolumeRendering: {
      commandFn: createViewportToggleFeatureCommand('imageVolumeRenderingEnabled'),
      storeContexts: ['viewports'],
      options: {},
    },
    toggleSegmentationSurface: {
      commandFn: createViewportToggleFeatureCommand('segmentationSurfaceEnabled'),
      storeContexts: ['viewports'],
      options: {},
    },
  };

  return {
    definitions,
    defaultContext: 'ACTIVE_VIEWPORT::VIEWER3DVOL',
  };
};

export default commandsModule;
