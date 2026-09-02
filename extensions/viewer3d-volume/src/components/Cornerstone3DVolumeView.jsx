import _ from 'lodash';

import React, { Component, createRef } from "react";
import { withTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import {
  RenderingEngine as C3dRenderingEngine,
  Enums as c3dEnums,
  init as c3dCoreInit,
  volumeLoader as c3dVolumeLoader,
  eventTarget as c3dEventTarget,

  getWebWorkerManager as c3dGetWebWorkerManager,
} from "@cornerstonejs/core";

import {
  init as c3dToolsInit,
  Enums as c3dToolsEnums,

  // Tool management utilities (tool registration/activation itself is delegated to the
  // commands module — command-based tool registration, ohif-viewers#122 §6)
  ToolGroupManager as C3dToolGroupManager,

  // Annotation management
  annotation as c3dAnnotations,
  cancelActiveManipulations,

  // Segmentations
  segmentation as c3dSegmentations,
} from '@cornerstonejs/tools';

import OHIF from "@ohif/core";
import {
  Enums as vtkEnums,
  cornerstone3dUtils as c3dUtils,
  Cornerstone3DLabelmapBaseView,
  LoadingIndicator,
  VolumeRenderingMenuButton,
} from '@ohif/extension-vtk';

import { eventTypes as uiEvents } from '@ohif/ui';

import { Enums as VolViewerEnums } from '../enums';
import styles from './Cornerstone3DVolumeViewport.css';

const { ViewportType, Events: c3dEvents } = c3dEnums;

const { DisplaySetApi } = OHIF.display;


class Cornerstone3DVolumeViewport extends Cornerstone3DLabelmapBaseView {
  // React component that can be used to load and view DICOM or NIFTI segmentations. (Uses VTK.js components
  // and Cornerstone3D.) The viewport tracks a volume rendered version of the segmentation.

  static id = 'Cornerstone3DVolumeViewport';

  constructor(props) {
    super(props);
    this._surfaceEpoch = 0;
  }

  state = {
    ...Cornerstone3DLabelmapBaseView.state,
    surfaceModelInit: false,
    surfaceRendering: false,
    surfaceRenderProgress: 0,
  }

  static propTypes = {
    ..._.omit(Cornerstone3DLabelmapBaseView.propTypes, 'orientation'),
    toolGroupId: PropTypes.string,
    surfaceToolGroupId: PropTypes.string,
    voiSyncId: PropTypes.string,
    commandsManager: PropTypes.object,
    onCreated: PropTypes.func,
    onDestroyed: PropTypes.func,
    imageVolumeRenderingEnabled: PropTypes.bool.isRequired,
    segmentationSurfaceEnabled: PropTypes.bool.isRequired,
    defaultVolumeRenderPresetMR: PropTypes.string.isRequired,
    defaultVolumeRenderPresetCT: PropTypes.string.isRequired,
    uiMessageSurfaceInitializing: PropTypes.string.isRequired,
    uiMessageSurfaceRendering: PropTypes.string.isRequired,
    onVolumeLabelmapImageLoad: PropTypes.func,
  }

  static defaultProps = {
    ... _.omit(Cornerstone3DLabelmapBaseView.defaultProps, 'renderId', 'toolGroupId', 'cornerstone3dViewProps', 'orientation'),
    renderId: VolViewerEnums.VOLVIEWER_RENDER_ID,
    toolGroupId: VolViewerEnums.VOLVIEWER_TOOLGROUP_ID,
    surfaceToolGroupId: VolViewerEnums.VOLVIEWER_ID,
    voiSyncId: VolViewerEnums.VOLVIEWER_VOI_SYNC_ID,
    cornerstone3dViewProps: {
      type: ViewportType.VOLUME_3D, defaultOptions: { background: [0, 0, 0], }
    },
    imageVolumeRenderingEnabled: true,
    segmentationSurfaceEnabled: false,
    defaultVolumeRenderPresetMR: 'MR-Default',
    defaultVolumeRenderPresetCT: 'CT-Default',
    uiMessageSurfaceInitializing: 'Initializing ...',
    uiMessageSurfaceRendering: 'Rendering ...',
  }

  _initViewProps() {
    // Maintain persistent references to tab components and references

    const component = this;
    console.log('[Cornerstone3DVolumeViewport:_initViewProps]', component.props);

    // Ccreate copy of Cornerstone view properties
    component.cornerstone3dViewProps = _.clone(component.props.cornerstone3dViewProps);
  }

  _evtDisplaySetApi({ apiEvent, uiEvent, ...apiData }) {
    // Manage displaySetApi events
    const component = this;

    const { displaySet: _ds } = component.props.viewportData;

    if (apiEvent == OHIF.display.Enums.EVENTS.UI && uiEvent == uiEvents.sidebar.toggle && component.renderEngine) {

      // Resize viewport in response to UI/DOM events
      const { eventTimeout } = component.props;

      setTimeout(() => {
        // Resize and render viewports after sidebar toggle event changes display size

        component.renderEngine.resize();
        component.renderEngine.render();
      }, eventTimeout);

    } else if (apiEvent == VolViewerEnums.EVENTS.VOLVIEWER_ACTIVATE_TOOL && apiData.displaySetInstanceUID == _ds.displaySetInstanceUID) {

      // Activate a tool within the viewport
      component.activateTools(apiData.tool);

    } else if (apiEvent == VolViewerEnums.EVENTS.VOLVIEWER_RESET && apiData.displaySetInstanceUID == _ds.displaySetInstanceUID) {

      // Full reset: clear segmentations, unload volumes, reload initial state
      component._resetVolumeViewerState();
    }
  }

  _evtWorkerProgress(evt) {
    //  Track background worker progress and trigger UI updates / state changes
    const component = this;
    if (!component._isMounted || !component.props.segmentationSurfaceEnabled) return;

    // Unpack event details and update component state
    const { eventTimeout } = component.props;
    const { detail: msg } = evt;

    if (msg.type == vtkEnums.CORNERSTONE.CORNERSTONE3D_WORKER_EVENT_TYPE_LABELMAP) {

      // Labelmap <-> Surface update
      const { progress } = msg;
      let state = { surfaceRenderProgress: progress, };

      // Check for completion of the background rendering process
      const { volumeId: labelmapInstanceUID } = component._segVol();
      if (labelmapInstanceUID && progress == 100) {

        // Check if background rendering of 3D volume is complete
        const _seg = c3dSegmentations.state.getSegmentation(labelmapInstanceUID);
        const segIdx = evt.detail.id;
        const segIdxMax = _.max(_.keys(_seg.segments));

        // Remove rendering screen
        if (segIdx == segIdxMax) {
          setTimeout(() => {
            component.setState({ surfaceRendering: false });
          }, 3*eventTimeout);
        }
      }

      // Update component state
      component.setState(state);
    }
  }

  initUi() {
    // Initialize 3D viewports UI
    const component = this;

    super.initUi();
    component.subscribeEventListeners();
  }

  subscribeEventListeners() {
    // Subscribe to event listeners for segmentations and Cornerstone3D events

    const component = this;

    // Web worker updates
    component.worker_progress = c3dEventTarget.addEventListener(
      c3dEnums.Events.WEB_WORKER_PROGRESS, component._evtWorkerProgress.bind(component), { capture: true });

    console.log('Initialize 3D viewport event listeners');
  }

  onImageVolumeLoadingCompleted() {
    // The 3D viewer's rendering presets read the volume's scalar range, and surface
    // extraction walks the whole labelmap and competes with the load for the worker pool, so both
    // wait for the streaming volume to finish rather than acting on a partly-filled one. The MPR
    // slice views deliberately do not wait.

    const component = this;
    const { imageVolumeRenderingEnabled, defaultVolumeRenderPresetMR } = component.props;
    const { viewport: _view3d } = component._checkViewportActive();

    component._imageVolumeComplete = true;

    if (_view3d && imageVolumeRenderingEnabled) {
      _view3d.setProperties({ preset: defaultVolumeRenderPresetMR });
      component.render3d();
    }

    if (component._surfaceRenderDeferred) {
      component._surfaceRenderDeferred = false;
      component.createSurfaceRepresentation();
    }
  }

  async _setImageVolume() {
    // Set the image volume for the view and apply default rendering preset

    const component = this;
    const { imageVolumeRenderingEnabled, defaultVolumeRenderPresetMR } = component.props;
    const { viewportId: _v3d_id, viewport: _view3d } = component._checkViewportActive();

    if (imageVolumeRenderingEnabled) {
      await super._setImageVolume();

      if (_view3d) {
        _view3d.setProperties({ preset: defaultVolumeRenderPresetMR });
      }
    }
  }

  runCommand(commandName, options) {
    // Invoke a volume-viewer command under the plain VIEWPORT context. Tool registration and
    // activation are owned by the commands module (command-based tool registration,
    // ohif-viewers#122 §6); the viewport methods below are thin delegates.

    const { commandsManager } = this.props;
    if (!commandsManager) {
      console.warn('[Cornerstone3DVolumeViewport] commandsManager unavailable, unable to run command '+commandName);
      return;
    }
    return commandsManager.runCommand(commandName, options, VolViewerEnums.VIEWPORT);
  }

  initTools() {
    // Initialize navigation tools for the volume (delegates registration to the central,
    // idempotent initVolumeViewerTools command)

    const component = this;
    const { toolGroupId } = component.props;

    component.runCommand('initVolumeViewerTools', { toolGroupId, component });

    // Register the volume cropping tool once the viewport is bound to the tool group
    // (registration only; activation is driven by the toggleVolumeCropping command)
    component.runCommand('initVolumeCroppingTool', { toolGroupId, component });

    component.activateTools('default');
    super.initTools();
  }

  deactivateTools(options) {
    // Deactivate tools in preparation of applying new bindings
    options = options || {};
    _.defaults(options, { removeAllBindings: true });

    const component = this;
    const { toolGroupId } = component.props;

    component.runCommand('deactivateVolumeViewerTools', {
      toolGroupId, removeAllBindings: options.removeAllBindings,
    });
  }

  activateTools(mode) {
    // Activate viewport tools. Binding changes are delegated to the central command
    // (which deactivates before applying the new mode, publishes the mode through the
    // tool-state event, and keeps the select-widget displaySet state current); tool-mode
    // state tracking and the re-render remain viewport concerns.

    const component = this;
    const { toolGroupId } = component.props;
    const { toolMode } = this.state;
    const { displaySet } = component.props.viewportData;

    component.runCommand('activateVolumeViewerTools', {
      toolGroupId, toolMode: mode, displaySetInstanceUID: displaySet?.displaySetInstanceUID,
    });

    // Update state if tool mode is different than current mode
    const volumeTools = C3dToolGroupManager.getToolGroup(toolGroupId);
    if (volumeTools && mode && (mode != toolMode)) {

      // Set current tool mode and re-render viewport
      component.setState({ toolMode: mode });
      component.render3d();
    }
  }

  _forceDisableVolumeCropping(state = 'hidden') {
    // Cropping depends on an active volume rendering: deactivate the cropping tool, reset the
    // displaySet attribute, and republish. The toolbar button follows the displaySet change and
    // the tool-state event reports the transition ('hidden' when volume rendering turned off,
    // 'inactive' on a viewer reset).

    const component = this;
    const { toolGroupId } = component.props;
    const { displaySet } = component.props.viewportData;

    const _ds = displaySet?.displaySetInstanceUID
      ? DisplaySetApi.Instance.displaySetService.getDisplaySetByUID(displaySet.displaySetInstanceUID)
      : undefined;
    if (!_ds || !_ds.volumeCroppingEnabled) {
      return;
    }

    _ds.volumeCroppingEnabled = false;
    DisplaySetApi.Instance.displaySetService.addDisplaySets([_ds]);

    // Both force-disable paths (volume-rendering off, viewer reset) remove or replace the
    // volume actor, so the tool's cached scene state must be reset for the next activation
    component.runCommand('deactivateVolumeCropping', {
      toolGroupId, displaySetInstanceUID: _ds.displaySetInstanceUID, state, resetToolState: true,
    });
  }

  disableVolumeRendering(options) {
    // Remove volume actors from the 3D scene. This method is intended to run
    // after the volume has been loaded to the scene and a volume actor is available.

    const component = this;

    const { viewportId: _v3d_id, viewport: _view3d } = component._checkViewportActive();
    if (_view3d) {
      c3dUtils.removeVolumeActors(_v3d_id, options);
      component.render3d();
    }
  }

  async _activateSurfaceRepresentation() {
    // Activate the segmentation surface representation for the volume

    const component = this;
    const { viewportId: _v3d_id, viewport: _view3d } = component._checkViewportActive();
    if (_view3d) {
      const { volumeId: labelmapInstanceUID } = component._segVol();

      if (labelmapInstanceUID) {

        // Create surface segmentation representation
        const _rep = component._getSegmentationRepresentation({
          volumeId: labelmapInstanceUID,
          type: c3dToolsEnums.SegmentationRepresentations.Surface,
        });

        await c3dSegmentations.addSegmentationRepresentations(_v3d_id, [ _rep ]);
      }
    }
  }

  async _applySurfaceColorLUT() {
    // Apply the ColorLUT of the segmentation fo the surface representation

    const component = this;

    // Retrieve 3D viewport ID and volumeId
    const { viewportId: _v3d_id, viewport: _view3d } = component._checkViewportActive();
    const { volumeId: labelmapInstanceUID } = component._segVol();

    if (_v3d_id && labelmapInstanceUID) {

      // Check lutIdx (set during initial load of segmentation data)
      if (!component.lutIdx) {
        throw new Error('Unable to apply colorLut to surface, invalid component lutIdx');
      }

      // Attach colorLUT to 3D surface
      c3dSegmentations.config.color.setColorLUT(_v3d_id, labelmapInstanceUID, component.lutIdx);
    }
  }

  async createSurfaceRepresentation() {
    // Create the surface representation and register display properties

    const component = this;

    const { surfaceModelInit } = component.state;

    // Wait for the reference image volume; onImageVolumeLoadingCompleted re-drives this.
    if (!component._imageVolumeComplete) {
      component._surfaceRenderDeferred = true;
      return;
    }

    const { viewportId: _v3d_id, viewport: _view3d } = component._checkViewportActive();

    if (_view3d) {
      const { volumeId: labelmapInstanceUID } = component._segVol();

      if (labelmapInstanceUID && !surfaceModelInit && !component._surfaceCreateStarted) {

        // Synchronous latch, set before the first await: setState({ surfaceModelInit }) lands too
        // late to stop a re-render-driven re-entry, and two passes would attach the Surface
        // representation twice and fan out duplicate marching-cubes jobs.
        component._surfaceCreateStarted = true;

        // Increment epoch and capture it. Any async path that completes after the epoch has changed
        // (e.g. because the user toggled off mid-computation) will abort without updating state.
        component._surfaceEpoch += 1;
        const epoch = component._surfaceEpoch;

        // Pause segmentation update events to prevent componentDidUpdate from re-queuing
        // worker jobs while the initial surface computation is in progress.
        component.setState({ segRepUpdatePaused: true });

        // Create surface segmentation representation
        await component._activateSurfaceRepresentation();

        // Abort if the surface was toggled off (or the component unmounted) during the await
        if (epoch !== component._surfaceEpoch || !component._isMounted) {
          component._surfaceCreateStarted = false;
          return;
        }

        component._applySurfaceColorLUT();

        // Log state of segmentations: 2D and 3D (surface)
        const _seg = c3dSegmentations.state.getSegmentation(labelmapInstanceUID);
        console.log('[Cornerstone3DVolumeViewport-createSurfaceRender] 3D seg', _seg, component.lutIdx);

        // Resume updates and mark surface as initialised
        component._surfaceCreateStarted = false;
        component.setState({ surfaceModelInit: true, surfaceRendering: true, segRepUpdatePaused: false });
      }
    }
  }

  removeSurfaceRepresentation() {
    // Remove the surface representation

    const component = this;
    const { viewportId: _v3d_id, viewport: _view3d } = component._checkViewportActive();
    const { volumeId: labelmapInstanceUID } = component._segVol();

    if (_v3d_id && labelmapInstanceUID) {

      // Invalidate the current epoch so any in-flight async callbacks in createSurfaceRepresentation
      // abort before they update state or re-add the representation.
      component._surfaceEpoch += 1;
      component._surfaceCreateStarted = false;

      c3dSegmentations.removeSurfaceRepresentation(_v3d_id, labelmapInstanceUID);
      component.setState({ surfaceModelInit: false, surfaceRendering: false, segRepUpdatePaused: false });
    }
  }

  async _resetVolumeViewerState() {
    // Perform a full reset of the 3D viewer: clear segmentations, unload C3D volumes,
    // and restart the base-class loading lifecycle so the view returns to first-run state.

    const component = this;
    if (!component._isMounted) return;

    // 1. Cancel any in-flight tool interactions and background worker jobs, and return the
    //    cropping tool to its disabled state (no clipping planes, no handle actors) so the
    //    reload starts clean with the toggle button inactive
    const { viewport: _view3d } = component._checkViewportActive();
    if (_view3d?.element) {
      cancelActiveManipulations(_view3d.element);
    }
    c3dUtils.terminateWorkerComputeJobs();
    component._forceDisableVolumeCropping('inactive');

    // 2. Remove surface representation (also increments epoch to abort in-flight creation)
    if (component.state.surfaceModelInit) {
      component.removeSurfaceRepresentation();
    }

    // 3. Record whether the surface should be restored once the reload completes
    const { volumeId: labelmapInstanceUID } = component._segVol();
    component._pendingSurfaceRestore = component.props.segmentationSurfaceEnabled && !!labelmapInstanceUID;

    // 4. Remove all C3D segmentation representations and state for this volume
    if (labelmapInstanceUID) {
      component.purgeSegmentationRepresentations(labelmapInstanceUID);
      c3dSegmentations.removeSegmentation(labelmapInstanceUID);
    }

    // 5. Release this view's hold on the image volume. The volume
    //    and its derived labelmaps go only if nothing else is displaying them; the reload below
    //    re-acquires or re-creates as needed. The global cache.purgeCache() this replaces also
    //    destroyed M3D geometry and other subsystems' cache entries.
    component.releaseImageVolume();

    // 6. Reset loading-state flags. Cornerstone3DBaseView.componentDidUpdate drives
    //    the entire load/render lifecycle from these flags, so clearing them is
    //    sufficient to restart the sequence without re-mounting the component.
    component.setState({
      imgRenderInit: false,
      segInit: false,
      segRenderInit: false,
      surfaceModelInit: false,
      surfaceRendering: false,
      surfaceRenderProgress: 0,
    });
  }

  async componentDidMount() {
    // Initialize 3D viewer attributes

    const component = this;
    component._isMounted = true;

    // Subscribe to displaySetApi DataSync events
    component.displayset_apisync = DisplaySetApi.Instance.displaySetService.subscribe(
      DisplaySetApi.Instance.displaySetService.EVENTS.DISPLAY_SET_DATASYNC,
      component._evtDisplaySetApi.bind(component));

    await c3dUtils.initCornerstone3d();
    await super.componentDidMount();
  }

  async componentDidUpdate(prevProps, prevState) {
    // Apply updates to viewport
    const component = this;
    const { props, state } = component;
    const { imgRenderInit } = state;

    await super.componentDidUpdate(prevProps, prevState);

    // Toggle volume rendering on/off
    if (imgRenderInit && prevProps.imageVolumeRenderingEnabled && !props.imageVolumeRenderingEnabled) {

      // Toggle image rendering off. Cropping depends on the volume rendering, so it is
      // force-disabled first (the toolbar button hides; tool-state event fires with 'hidden').
      component._forceDisableVolumeCropping('hidden');
      component.disableVolumeRendering();
    } else if (imgRenderInit && !prevProps.imageVolumeRenderingEnabled && props.imageVolumeRenderingEnabled) {

      // Toggle image rendering on
      component._setImageVolume();

      // setVolumes() reinitializes the viewport actor list, which clears any surface mesh actors
      // that were previously added to the scene. Re-fire SEGMENTATION_DATA_MODIFIED so that
      // updateSurfaceData re-adds the surface actors for the now-active viewport.
      if (props.segmentationSurfaceEnabled && state.surfaceModelInit) {
        component.triggerSegmentationUpdate();
      }
    }

    // Toggle segmentation surface on/off
    if (!prevProps.segmentationSurfaceEnabled && props.segmentationSurfaceEnabled) {
      component.createSurfaceRepresentation();
    } else if (prevProps.segmentationSurfaceEnabled && !props.segmentationSurfaceEnabled) {
      component.removeSurfaceRepresentation();
      c3dUtils.terminateWorkerComputeJobs();
      console.log('[Cornerstone3DVolumeViewport:componentDidUpdate] toggle segmentation surface off');
    }

    // After a full reset (_resetVolumeViewerState), restore the surface representation
    // once the segmentation has finished re-rendering. The flag is set by _resetVolumeViewerState
    // before the state is cleared, so it persists across the reload cycle.
    if (state.segRenderInit && !prevState.segRenderInit && component._pendingSurfaceRestore) {
      component._pendingSurfaceRestore = false;
      await component.createSurfaceRepresentation();
    }
  }

  unsubscribeEvents() {
    // Unsubscribe event handlers
    const component = this;

    if (component.worker_progress) {

      // Background updates from worker progress
      c3dEventTarget.removeEventListener(c3dEnums.Events.WEB_WORKER_PROGRESS, component.worker_progress);
    }

    // displaySet API events
    component.displayset_apisync?.unsubscribe();
  }

  async componentWillUnmount() {
    // Remove event handlers and reactive logic for viewport

    // 1. Destroy tool groups and remove viewports from the tools
    // 2. Destroy viewports and DOM references
    // 3. Clear loaded volumes
    // 4. Destroy the render engine

    const component = this;
    const { renderId, toolGroupId } = component.props;
    const { viewportId: _v3d_id, viewport: _view3d } = component._checkViewportActive();

    // Unsubscribe events and cancel background operations
    component.unsubscribeEvents();
    component._isMounted = false;

    // Remove imaging and segmentation tools
    if (component.volumeTools) {

      // Remove viewport and destroy tool group
      component.volumeTools.removeViewports(_v3d_id);
      C3dToolGroupManager.destroyToolGroup(toolGroupId);
      component.volumeTools = undefined;
    }

    await super.componentWillUnmount();
    c3dUtils.terminateWorkerComputeJobs();

    // Set component state
    component.setState({ imgRenderInit: false, imgToolsInit: false });

    if (component.props.onDestroyed && _.isFunction(component.props.onDestroyed)) {
      component.props.onDestroyed();
    }

    console.log("VolumeViewer-componentWillUnmount: Cornerstone3D cleanup complete");
  }

  render() {
    // Render 3D volume viewport with volume rendering menu button in the lower-left
    const component = this;
    const viewportId = component.getViewportId();
    const {
      imageVolumeRenderingEnabled, segmentationSurfaceEnabled, uiMessageSurfaceInitializing, uiMessageSurfaceRendering,
    } = component.props;
    const { surfaceRendering, surfaceRenderProgress, surfaceModelInit } = component.state;

    let loadingMessage;
    if (!surfaceModelInit) {
      loadingMessage = uiMessageSurfaceInitializing;
    } else {
      loadingMessage = uiMessageSurfaceRendering;
    }

    return (
      <div className="root">
        <div className="modalContent">
          <div className="viewportWrapper">
            {segmentationSurfaceEnabled && surfaceRendering && (
              <LoadingIndicator loadingMessage={loadingMessage} percentageComplete={surfaceRenderProgress} />
            )}
            <div className="viewportElement" ref={component.container} />
            {imageVolumeRenderingEnabled && (
              <div className="absolute bottom-2 left-2 z-10">
                <VolumeRenderingMenuButton viewportId={viewportId} />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
}


// Export both the base viewport (plain JS class which can be extended) and a wrapped viewport
// providing translation utilities. Views which utilize the viewer directly should use the wrapper version.
export default withTranslation('Common')(Cornerstone3DVolumeViewport);
export { Cornerstone3DVolumeViewport };
