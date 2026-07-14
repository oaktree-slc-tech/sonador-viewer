import _ from "lodash";

import React, { Component, createRef } from "react";
import { withTranslation } from 'react-i18next';
import PropTypes from "prop-types";

import { Layout, Model } from "flexlayout-react";
import "flexlayout-react/style/dark.css";

import {
  RenderingEngine as C3dRenderingEngine,
  Enums as c3dEnums,
  init as c3dCoreInit,
  volumeLoader as c3dVolumeLoader,
  cache as c3dCache,
  eventTarget as c3dEventTarget,

  getWebWorkerManager as c3dGetWebWorkerManager,
} from "@cornerstonejs/core";

import {
  ToolGroupManager as C3dToolGroupManager,
  SynchronizerManager as C3dSynchronizerManager,

  // Viewport Tools
  WindowLevelTool as C3dWindowLevelTool,
  ZoomTool as C3dZoomTool,
  PanTool as C3dPanTool,
  StackScrollTool as C3dStackScrollTool,
  TrackballRotateTool as C3dTrackballRotateTool,
  Enums as c3dToolsEnums,
  addTool as c3dAddTool,

  // Annotation management
  annotation as c3dAnnotations,
  cancelActiveManipulations,

  // Segmentations
  segmentation as c3dSegmentations,
  utilities as c3dToolsUtilities,
} from '@cornerstonejs/tools';

import {
  createVOISynchronizer as c3dCreateVOISynchronizer,
} from '@cornerstonejs/tools/synchronizers';

import {
  init as c3dPolySegInit,
  computeSurfaceData as c3dComputeSurfaceData,
  updateSurfaceData as c3dUpdateSurfaceData,
} from '@cornerstonejs/polymorphic-segmentation';


import OHIF from "@ohif/core";
import {
  cornerstone3dUtils as c3dUtils,
  Cornerstone3DLabelmapBaseView,
  LoadingIndicator,
  VolumeRenderingMenuButton,
} from '@ohif/extension-vtk';

import { eventTypes as uiEvents } from '@ohif/ui';

import { Enums as SonadorSegEnums } from '../enums';

const { ViewportType, Events: c3dEvents } = c3dEnums;
const { SonadorZoomTool } = c3dUtils.viewportTools;

const { DisplaySetApi } = OHIF.display;


var SEGVIEWER_LAYOUT = {

  // Two column layout with visible work panels for axial, coronal, and saggital views
  // of the imaging and segmentation.
  global: {},
  borders: [],
  layout: {
    type: "row",
    weight: 100,
    children: [
      { type: "tabset", weight: 60, children: [
        // { type: "tab", name: "Editor", component: "placeholder", enableClose: false, enableRename: false, },
        { type: "tab", name: "3D", component: "placeholder", enableClose: false, enableRename: false, },
      ]},
      { type: "column", weight: 40, children: [
      { type: "tabset", weight: 33, children: [
        { type: "tab", name: "Axial", component: "seg3dview", enableClose: false, enableRename: false, },
      ]},
      { type: "tabset", weight: 33, children: [
        { type: "tab", name: "Coronal", component: "seg3dview", enableClose: false, enableRename: false, },
      ]},
      { type: "tabset", weight: 33, children: [
        { type: "tab", name: "Sagittal", component: "seg3dview", enableClose: false, enableRename: false, },
      ]},
    ]},
  ]},
};


class Cornerstone3DSegmentationViewerBaseViewport extends Cornerstone3DLabelmapBaseView {
  // React component that can be used to load and view DICOM or NIFTI segmentations. (Uses VTK.js components
  // and Cornerstone3D.) The viewport tracks two versions of the segmentation, one for 3D views
  // and a second instance for 2D views. This is done to ensure efficient rendering of 2D and 3D data.

  static id = "Cornerstone3DSegmentationViewerViewport";

  constructor(props) {
    super(props);
    this._surfaceEpoch = 0;
    // Synchronous re-entry guard: createSurfaceRender() may be invoked again by a
    // componentDidUpdate re-render (e.g. worker-progress setState) before the first call's
    // setState({ surfaceModelInit: true }) lands. Without this flag, both calls clear the
    // `!surfaceModelInit` check and each fires addSegmentationRepresentations, producing
    // duplicate Surface representations and duplicate computeSurfaceData fan-out.
    this._surfaceCreateStarted = false;

    // One-shot reveal latch + bounded-poll handle. The "Rendering" overlay must clear the
    // moment the surface geometry is actually stored on the segmentation — not when a fragile
    // worker-progress heuristic guesses completion. _surfaceShown ensures the reveal (force a
    // renderEngine.render() + setState({ surfaceRendering: false })) runs exactly once; the
    // poll timer is the backstop that detects availability even if no event fires after the
    // surface store (SEGMENTATION_RENDERED fires before the store; worker-progress can be lost).
    this._surfaceShown = false;
    this._surfacePollTimer = null;
    this._lastSurfacePokeAt = 0;
  }

  state = {
    tabUiInit: false,
    ...Cornerstone3DLabelmapBaseView.state,
    segRepUpdatePaused: true,
    surfaceModelInit: false,
    surfaceModelToolsInit: false,
    surfaceRendering: true,
    surfaceRenderProgress: 0,
  };

  static propTypes = {
    ..._.omit(Cornerstone3DLabelmapBaseView.propTypes, 'orientation'),
    toolGroupId: PropTypes.string,
    surfaceToolGroupId: PropTypes.string,
    voiSyncId: PropTypes.string,
    views2d: PropTypes.array.isRequired,
    views3d: PropTypes.array.isRequired,
    onCreated: PropTypes.func,
    onDestroyed: PropTypes.func,
    segViewerLayout: PropTypes.object.isRequired,
    uiMessageSurfaceInitializing: PropTypes.string.isRequired,
    uiMessageSurfaceRendering: PropTypes.string.isRequired,
    onVolumeLabelmapImageLoad: PropTypes.func,
    segEditorVolumeRenderingEnabled: PropTypes.bool,
    segEditorSurfaceRenderingEnabled: PropTypes.bool,
    defaultVolumeRenderPresetMR: PropTypes.string,
    defaultVolumeRenderPresetCT: PropTypes.string,
  }

  static defaultProps = {
    ... _.omit(Cornerstone3DLabelmapBaseView.defaultProps, 'renderId', 'toolGroupId', 'cornerstone3dViewProps', 'orientation'),
    renderId: SonadorSegEnums.SEGVIEWER_RENDER_ID,
    toolGroupId: SonadorSegEnums.SEGVIEWER_TOOLGROUP_ID,
    surfaceToolGroupId: SonadorSegEnums.SEGVIEWER_TOOLGROUP_ID_SURFACE,
    voiSyncId: SonadorSegEnums.SEGVIEWER_VOI_SYNC_ID,
    views2d: [SonadorSegEnums.SEGVIEWER_AXIAL, SonadorSegEnums.SEGVIEWER_CORONAL, SonadorSegEnums.SEGVIEWER_SAGITTAL],
    views3d: [SonadorSegEnums.SEGVIEWER_3D],
    cornerstone3dViewProps: {
      '3D': {
        type: ViewportType.VOLUME_3D,
        defaultOptions: {
          background: [0, 0, 0],
        }
      },
      Axial: {
        type: ViewportType.ORTHOGRAPHIC,
        defaultOptions: {
          orientation: c3dEnums.OrientationAxis.AXIAL,
        },
      },
      Coronal: {
        type: ViewportType.ORTHOGRAPHIC,
        defaultOptions: {
          orientation: c3dEnums.OrientationAxis.CORONAL,
        },
      },
      Sagittal: {
        type: ViewportType.ORTHOGRAPHIC,
        defaultOptions: {
          orientation: c3dEnums.OrientationAxis.SAGITTAL,
        },
      }
    },
    segViewerLayout: SEGVIEWER_LAYOUT,
    uiMessageSurfaceInitializing: 'Initializing ...',
    uiMessageSurfaceRendering: 'Rendering ...',

    // 3D-viewport rendering toggles (FR-3 defaults: Surface on, 3D Volume off) and the modality
    // default presets applied when volume rendering is enabled (volume viewer convention; note
    // there is no 'CT-Default' Cornerstone3D preset, hence CT-Bone).
    segEditorVolumeRenderingEnabled: false,
    segEditorSurfaceRenderingEnabled: true,
    defaultVolumeRenderPresetMR: 'MR-Default',
    defaultVolumeRenderPresetCT: 'CT-Bone',
  }

  _initViewProps() {
    // Maintain persistent references to tab components and references

    const component = this;

    component.cached3dTabs = {};
    component.tabRefs = {
      '3D': createRef(),
      Axial: createRef(),
      Coronal: createRef(),
      Sagittal: createRef(),
    };
    component.cornerstone3dViewProps = _.clone(component.props.cornerstone3dViewProps);

    // Initialize layout model
    component.model = Model.fromJson(component.props.segViewerLayout);

    // Bind tab factory
    component.tabFactory = component.tabFactory.bind(this);
    component.onTabAction = component.onTabAction.bind(this);
    component.onTabModelChange = component.onTabModelChange.bind(this);
  }

  getViewportId(options) {
    // Retrieve the viewport ID for the provided tab
    options = options || {};
    if (!options.tab) {
      throw new Error('Unable to retrieve viewport ID, please specify active tab name');
    }

    const { renderId, sep } = this.props;
    return renderId+sep+options.tab;
  }

  init3dViewport(tab) {
    // Initialize 3D viewport for tab

    const component = this;
    const { renderId, eventTimeout } = component.props;

    if (component.renderEngine) {
      const { viewportId: _v3d_id } = component.getViewportId({ tab });

      // Check to determine if the viewport has already been created
      if (!_v3d_id) {

        // Initialize Cornerstone 2D viewport
        if (component.cornerstone3dViewProps[tab]) {

          // Create viewport element and add to the current container
          const _el = document.createElement("div");

          // Disable the default context menu
          _el.oncontextmenu = (e) => e.preventDefault();

          // Set element styles to grow to the full size of the tab
          _el.style.width = "100%";
          _el.style.height = "100%";

          // Add viewport ID and other attributes to cornerstone viewport properties
          component.cornerstone3dViewProps[tab].viewportId = component.getViewportId({ tab });
          component.cornerstone3dViewProps[tab].element = _el;

          // Add the viewport to the tab
          if (component.tabRefs[tab].current) {
            component.tabRefs[tab].current.appendChild(_el);
          }

          // Trigger check of tabbed UI init
          setTimeout(component._checkTabUiInit.bind(component), eventTimeout);
        }
      }
    }
  }

  _isSurfaceReady() {
    // True once Cornerstone3D has actually computed and stored the Surface geometry for the
    // 3D labelmap. This is the only authoritative "surface is on screen now" signal: the
    // lazy surfaceDisplay.render() path stores representationData.Surface.geometryIds when the
    // marching-cubes job resolves, and viewport.render() draws it on the same tick.
    const component = this;

    const { volumeId: labelmapInstance3dUID } = component._segVol3d();
    if (!labelmapInstance3dUID) return false;

    const _seg = c3dSegmentations.state.getSegmentation(labelmapInstance3dUID);
    const surface = _seg?.representationData?.Surface;
    return !!(surface?.geometryIds && surface.geometryIds.size > 0);
  }

  _showSurfaceWhenReady() {
    // One-shot reveal. When the surface geometry is available, force a render so the viewport
    // isn't left in the "surface computed but never drawn" in-between state, and clear the
    // loading overlay. Idempotent via _surfaceShown; safe to call from multiple triggers
    // (worker progress, SEGMENTATION_RENDERED, the poll backstop).
    const component = this;
    if (component._surfaceShown || !component._isMounted) return;
    if (!component._isSurfaceReady()) return;

    component._surfaceShown = true;
    component._stopSurfacePolling();

    // Force a draw: the surface may have been stored between render engine ticks, so the
    // viewport could still be showing nothing until we explicitly render.
    if (component.renderEngine) {
      component.renderEngine.render();
    }

    component.setState({ surfaceRendering: false });
  }

  _pokeSegmentationRender() {
    // Safe nudge: ask Cornerstone3D's SegmentationRenderingEngine to (re)schedule a render of
    // every viewport that currently has this 3D segmentation registered. That render runs
    // surfaceDisplay.render(), which — while representationData.Surface is still empty — kicks
    // the lazy (single-flighted) computeSurfaceData and, once it exists, draws the surface actor.
    //
    // This reaches the SAME render path as the user's proven manual poke (clicking the
    // segmentation side panel: setActiveSegmentIndex -> triggerSegmentationModified ->
    // SEGMENTATION_MODIFIED -> triggerSegmentationRenderBySegmentationId), but deliberately uses
    // the render trigger DIRECTLY. So it does NOT mutate active-segment state and does NOT emit
    // SEGMENTATION_MODIFIED — no tools, no UI/side-panel listeners, and no segment selection are
    // disturbed while the user may be reaching for a tool. The single-flight polySeg wrapper
    // coalesces the compute to one marching-cubes job, so repeated nudges start no extra
    // background work — only cheap re-renders.
    const component = this;
    if (!component._isMounted) return;

    const { volumeId: labelmapInstance3dUID } = component._segVol3d();
    if (!labelmapInstance3dUID) return;

    component._lastSurfacePokeAt = Date.now();
    c3dToolsUtilities.segmentation.triggerSegmentationRenderBySegmentationId(labelmapInstance3dUID);
  }

  _startSurfacePolling() {
    // Bounded backstop that BOTH (a) retries the safe render poke until one lands — the library's
    // SegmentationRenderingEngine._triggerRender no-ops without retry if the viewport/rep are not
    // ready, so a single early poke can be lost — and (b) watches for surface availability to
    // reveal it. SEGMENTATION_RENDERED fires once per trigger BEFORE the async surface store
    // completes, and worker-progress events can be missed, so neither reliably catches the moment
    // the geometry lands; polling guarantees the overlay clears as soon as the surface exists.
    const component = this;
    if (component._surfaceShown || component._surfacePollTimer) return;

    const { eventTimeout } = component.props;
    const interval = Math.max(eventTimeout || 0, 100);

    // Throttle the poke independently of the (faster) readiness check: each landed poke schedules
    // a viewport render, so re-poking on every tick would add needless render churn (and cosmetic
    // "overwriting" store warnings). One poke per ~500ms reliably kicks compute without spamming.
    // _lastSurfacePokeAt is owned by _pokeSegmentationRender(), so the immediate kick fired from
    // _activateSurfaceRepresentation already counts against this throttle.
    const pokeIntervalMs = 500;

    component._surfacePollTimer = setInterval(() => {
      if (!component._isMounted || component._surfaceShown) {
        component._stopSurfacePolling();
        return;
      }

      // Reveal as soon as the surface geometry is actually stored.
      if (component._isSurfaceReady()) {
        component._showSurfaceWhenReady();
        return;
      }

      // Not ready yet: re-poke (throttled) so a lost initial trigger is retried until one lands.
      if (Date.now() - (component._lastSurfacePokeAt || 0) >= pokeIntervalMs) {
        component._pokeSegmentationRender();
      }
    }, interval);
  }

  _stopSurfacePolling() {
    const component = this;
    if (component._surfacePollTimer) {
      clearInterval(component._surfacePollTimer);
      component._surfacePollTimer = null;
    }
  }

  _evtWorkerProgress(evt) {
    // Track background worker progress and trigger UI updates / state changes
    const component = this;
    if (!component._isMounted || !component.props.segEditorSurfaceRenderingEnabled) return;

    // Unpack event details and update component state
    const { detail: msg } = evt;

    if (msg.type == SonadorSegEnums.CORNERSTONE3D_WORKER_EVENT_TYPE_LABELMAP) {

      // Labelmap <-> Surface update
      const { progress } = msg;

      // Update progress state — setState triggers componentDidUpdate which calls
      // _surfaceRenderStatus() only when surface state has actually changed.
      component.setState({ surfaceRenderProgress: progress });

      // Worker progress is a useful nudge, but it is NOT a reliable completion signal: the
      // previous code guessed "done" from the last segment's progress==100 using a lexicographic
      // _.max over segment keys (wrong for >= 10 segments) plus an artificial 3*eventTimeout
      // delay, which left the overlay stuck for 30s-3min. Instead, attempt the reveal here — it
      // only fires once the surface geometry is actually stored on the segmentation.
      component._showSurfaceWhenReady();
    }
  }

  _evtDisplaySetApi({ apiEvent, uiEvent, ...apiData }) {
    // Manage displaySetApi events
    const component = this;

    if (apiEvent == OHIF.display.Enums.EVENTS.UI && uiEvent == uiEvents.sidebar.toggle && component.renderEngine) {
      const { eventTimeout } = component.props;

      setTimeout(() => {
        // Resize and render viewports after sidebar toggle event changes display size

        component.renderEngine.resize();
        component.renderEngine.render();
      }, eventTimeout);
    }
  }

  subscribeEventListeners() {
    // Create event listeners
    const component = this;

    // Web worker updates. Store the bound handler so it can be removed on unmount —
    // addEventListener returns undefined, so the bound reference must be captured here.
    component._workerProgressHandler = component._evtWorkerProgress.bind(component);
    c3dEventTarget.addEventListener(
      c3dEnums.Events.WEB_WORKER_PROGRESS, component._workerProgressHandler, { capture: true });

    // Segmentation render completion. Fires after Cornerstone3D draws the 3D segmentation
    // representation; we use it as a prompt to check whether the surface geometry has landed
    // and the overlay can be cleared. (The poll backstop covers the case where the surface
    // store completes after this event has already fired.)
    component._segRenderedHandler = component._showSurfaceWhenReady.bind(component);
    c3dEventTarget.addEventListener(
      c3dToolsEnums.Events.SEGMENTATION_RENDERED, component._segRenderedHandler);
  }

  initUi() {
    // Initialize 3D viewports
    const component = this;

    // Check to see if the rendering engine has been created
    if (component.renderEngine) {

      // Initialize 2D viewports
      _.keys(component.tabRefs).forEach((tab) => {
        component.init3dViewport(tab);
      });
    }

    // Check initialization of tabbed UI components
    component._checkTabUiInit();
    component.subscribeEventListeners();

    console.log('SegViewer-initUI: UI initialized');
  }

  _checkTabUiInit() {
    // Check state of tab UI init

    const component = this;
    const { eventTimeout } = this.props;

    const _init = _.every(component.views2d, (t) => {
      const _v3 = component.cornerstone3dViewProps[t];
      return _.has(_v3d, 'element');
    });

    if (_init) {
      component.setState({ tabUiInit: true, uiInit: true });
    }
  }

  async _activateSegmentationRepresentation() {
    // Activate segmentation representation for editor viewports

    const component = this;
    const { paintFilterLabelMapImageData, paintFilterLabelMapDetails } = component.props;
    const { uiInit } = component.state;

    if (uiInit && paintFilterLabelMapImageData) {

      // Retrieve semgentation representation
      const _ref = component._getSegmentationRepresentation();

      for (const tab of _.keys(component.cornerstone3dViewProps)) {

        // Retrieve viewport to ensure it is active
        const { viewportId: _v3d_id, viewport: _v3d } = component._checkViewportActive({ tab });
        if (_v3d_id && _v3d?.type != ViewportType.VOLUME_3D && _ref) {

          // Add viewport to the tool
          await c3dSegmentations.addSegmentationRepresentations(_v3d_id, [_ref]);
        }
      }
    }
  }

  _applyColorLUT() {
    // Apply the color lookup table for the labelmap

    const component = this;

    const { paintFilterLabelMapImageData, paintFilterLabelMapDetails, labelmapRenderingOptions, views2d } = component.props;
    const { uiInit, imgRenderInit } = component.state;

    if (uiInit && paintFilterLabelMapImageData) {
      let _lut;
      const { colorLUT } = labelmapRenderingOptions;
      const { labelmapInstanceUID } = paintFilterLabelMapDetails;

      if (colorLUT) {

        // Add LUT to the segmentations configuration. The method creates a deep clone to prevent
        // editor changes to the LUT from modifying the underlying source data.
        component.lutIdx = c3dSegmentations.config.color.addColorLUT(_.cloneDeep(colorLUT));
      }

      _.each(views2d, (tab) => {

        // Retrieve viewport instance
        const { viewportId: _v3d_id } = component._checkViewportActive({ tab });
        if (_v3d_id && colorLUT && labelmapInstanceUID) {

          // Add color LUT to Cornerstone
          c3dSegmentations.config.color.setColorLUT(_v3d_id, labelmapInstanceUID, component.lutIdx);
        }
      });
    }
  }

  tabFactory(node) {
    // Initialize tab content when tab layout changes: if a 3D viewport already exists
    // it will be returned.

    const component = this;
    const tab = node.getName();
    const tab_component = node.getComponent();

    if (component.tabRefs[tab]) {

      // Tab content already initialized
      if (component.tabRefs[tab].current) {
        return component.updateTab3dView(tab);
      }
    }

    return this.createTab3dView(tab);
  }

  onTabAction(action) {
    // Trigger editor updates on tab events
    console.log('SegViewer-onTabAction', action);

    const component = this;
    const { isLoaded, eventTimeout } = component.props;
    const { imgViewportInit, imgRenderInit } = component.state;

    // Attach viewport (if not already present)
    if (isLoaded && imgViewportInit && imgRenderInit) {

      // Call timeout asynchronously to ensure that viewport is visible when rendering occurs
      setTimeout(component.render3d.bind(component), eventTimeout);
    }

    return action;
  }

  onTabModelChange(model, action) {
    // Trigger editor updates on changes to the tab model
    const component = this;

    const activeTabset = model.getActiveTabset();
    const activeTab = activeTabset?.getSelectedNode();
    const tab = activeTab?._attributes?.name;
    const tabRef = component.tabRefs[tab];

    if (tabRef && tabRef?.current && tabRef.current.children.length == 0) {

      // Append Cornerstone3D element to the tab if it is not currently visible.
      // flexlayout-react does not initialize the current element until a tab
      // has been made visible for the first time.
      tabRef.current.appendChild(component.cornerstone3dViewProps[tab].element);
      component.view3dUpdate(tab);
    }
  }

  view3dUpdate(tab) {
    // Update 3D view for the provided tab

    const component = this;
    const { imgRenderInit, imgToolsInit } = component.state;

    if (imgRenderInit && component.renderEngine) {

      const { viewportId: _v3d_id, viewport: _view3d } = component._checkViewportActive({ tab });
      if (_v3d_id) {

        // Respond to resize events
        component.renderEngine.resize();
        component.renderEngine.render();
      }
    }
  }

  _surfaceRenderTabViewHelper(tab) {
    // Initialize the 3D viewport for the provided tab. This method manages loading messages
    // state updates (via a lodaing indicator) and progress to help communicate background state
    // to the user.

    const component = this;
    const {
      t, uiMessageSurfaceInitializing, uiMessageSurfaceRendering, segEditorVolumeRenderingEnabled,
    } = component.props;
    const { surfaceRendering, surfaceRenderProgress, surfaceModelInit, } = component.state;

    let loadingMessage;
    if (!surfaceModelInit) {
      loadingMessage = uiMessageSurfaceInitializing;
    } else {
      loadingMessage = uiMessageSurfaceRendering;
    }

    return (<>
      {surfaceRendering && (
        <LoadingIndicator loadingMessage={t(loadingMessage)} percentageComplete={surfaceRenderProgress} />
      )}
      <div ref={component.tabRefs[tab]} style={{ width: "100%", height: "100%" }} />
      {segEditorVolumeRenderingEnabled && (
        <div className="absolute bottom-2 left-2 z-10">
          <VolumeRenderingMenuButton viewportId={component.getViewportId({ tab })} />
        </div>
      )}
    </>);
  }

  _surfaceRenderStatus() {
    // Update the 3D viewport render status based on the component state
    const component = this;
    const { views3d } = component.props;

    _.each(views3d, (tab) => {

      // If viewport is active, update the cached UI to reflect change in loading <-> rendering state
      const { viewportId: _v3d_id } = component._checkViewportActive({ tab });
      if (_v3d_id) { component.createTab3dView(tab); }
    });
  }

  createTab3dView(tab) {
    // Initialize 3D view
    const component = this;
    const { views2d, views3d } = component.props;

    let _el;
    if (_.includes(views3d, tab)) {

      // Add loading indicator in front of the viewport
      _el = component._surfaceRenderTabViewHelper(tab);

    } else {

      // 2D viewport without loading indicator or state management
      _el = (
        <div ref={component.tabRefs[tab]} style={{ width: "100%", height: "100%" }} />
      );
    }

    // Create cached reference to React component
    this.cached3dTabs[tab] = _el;
    return _el;
  }

  updateTab3dView(tab, options) {
    // Updated 3D view

    const component = this;

    // Update view3d and return tab element
    component.view3dUpdate(tab);
    const _tab3d = component.cached3dTabs[tab];
    return _tab3d;
  }

  activate3dViewports () {
    // Activate render engine viewports

    const component = this;
    const { uiInit, imgViewportInit } = this.state;

    // Only attempt to activate viewports after full init of container elements
    if (uiInit && !imgViewportInit) {

      // Set viewports for engine
      component.renderEngine.setViewports(_.filter(
        _.values(component.cornerstone3dViewProps), _v3d => _v3d.element));
      component.setState({ imgViewportInit: true });
    }
  }

  _segVol3d(options) {
    // Retrieve image volume for the 3D segmentation volume.
    options = options || {}
    _.defaults(options, { prefix: 'vol3d:' });

    // Retrieve default segVolumeId
    const { volumeId: segVolId } = this._segVol(options)
    const volumeId = options.prefix+segVolId;

    return { volumeId, segVol: c3dCache.getVolume(volumeId), }
  }

  async loadSegImageVolume() {
    // Load the image volume and segmentation. To be able to support both 2D and 3D
    // editing of segmentations, this method creates a second copy of the labelmap
    // image data.
    const component = this;
    const { onVolumeLabelmapImageLoad } = component.props;
    const { displaySet } = component.props.viewportData;

    // Load 2D segmentation volume
    await super.loadSegImageVolume({ setState: false });

    // Retrieve primary (2D) volume and volumeId
    const { volumeId: labelmapInstanceUID, segVol } = component._segVol();

    // Create cached volume for 3D viewports to isolate rendering changes
    let { volumeId: labelmapInstance3dUID, segVol: segVol3d } = component._segVol3d();
    if (!segVol3d) {

      // Segmentation volume not yet active, retrieve a copy of the 2D volume and cache a copy
      // under the 3D label map UID.
      const { segVol } = component._segVol();
      segVol3d = c3dVolumeLoader.createAndCacheDerivedLabelmapVolume(segVol.volumeId, { volumeId: labelmapInstance3dUID });

      // Copy source voxels to segVol3d to enable editing of the new volume
      const segVol_voxels = segVol.voxelManager.getCompleteScalarDataArray();
      const segVol3d_voxels = segVol3d.voxelManager.getCompleteScalarDataArray();
      segVol3d_voxels.set(segVol_voxels);
      segVol3d.voxelManager.setCompleteScalarDataArray(segVol3d_voxels);

      // Duplicate 2D segmentation
      const _seg0 = c3dSegmentations.state.getSegmentation(labelmapInstanceUID);

      // Create labelmap representation structure
      const _rep = {
        type: c3dToolsEnums.SegmentationRepresentations.Labelmap,
        data: {
          volumeId: labelmapInstance3dUID,
          referenceVolumeId: displaySet?.displaySetInstanceUID,
        }
      }

      // Clone config structure from 2D segmentation
      let segments;
      if (_seg0.segments) {

        // Map 2D seg components to 3D seg
        segments = _.transform(_seg0.segments, (result, value, key) => {
          result[key] = _.pick(value, 'segmentIndex', 'label', 'isVisible', 'active');
        });
      }

      // Create seg config
      const _config = {};
      if (segments) {
        _config['segments'] = segments
      }
      const _seg3d = { segmentationId: labelmapInstance3dUID, representation: _rep, config: _config, }

      // Add segmentation to state
      await c3dSegmentations.state.addSegmentations([ _seg3d, ]);
      component.setState({ segInit: true });
    }

    if (_.isFunction(onVolumeLabelmapImageLoad)) {
      onVolumeLabelmapImageLoad({
        volumeId: labelmapInstance3dUID, segmentationId: labelmapInstance3dUID, vol: segVol3d,
      });
    }
  }

  renderImageData() {
    // Render image data

    const component = this;
    const { views2d, eventTimeout } = component.props;
    const { displaySet } = component.props.viewportData;
    const { imgViewportInit, imgRenderInit } = component.state;

    if (imgViewportInit && !imgRenderInit) {

      // Load image volume
      component.loadImageVolume();

      // Set viewport volume references and render
      _.each(views2d, (tab) => {

        // Retrieve viewport instance
        const { viewportId: _v3d_id, viewport: _view3d } = component._checkViewportActive({ tab });
        if (_view3d) {

          // Set volumes for viewport
          _view3d.setVolumes([ { volumeId: displaySet.displaySetInstanceUID } ]);
        }
      });

      // Render all viewports
      setTimeout(component.render3d.bind(component), eventTimeout);
      component.setState({ imgRenderInit: true });
    }
  }

  async renderSegImageData() {
    // Render labelmap

    const component = this;

    const { paintFilterLabelMapImageData, views2d, eventTimeout } = component.props;
    const { uiInit, imgRenderInit, segInit } = component.state;

    if (uiInit && imgRenderInit && segInit && paintFilterLabelMapImageData) {

      // Check that all viewports have been initialized. This like a triple check, since we are also
      // checking that the UI has been initialized and the image rendering has been initialized,
      // but we have seen some bizarre issues in testing and only attempting an init of the seg data
      // if the elements are present fixes it.
      const _init = _.every(component.views2d, (t) => _.has(component.cornerstone3dViewProps[t], 'element'));
      if (_init) {

        // Set segmentation volume to viewport
        await component._activateSegmentationRepresentation();
        component._applyColorLUT();

        // Render
        setTimeout(component.render3d.bind(component), eventTimeout);
        component.setState({ segRenderInit: true });
      }
    }
  }

  _registerTools() {
    // Reigster tools with Cornerstone3D

    c3dAddTool(SonadorZoomTool);
    c3dAddTool(C3dZoomTool);
    c3dAddTool(C3dWindowLevelTool);
    c3dAddTool(C3dPanTool);
    c3dAddTool(C3dStackScrollTool);
    c3dAddTool(C3dTrackballRotateTool);
  }

  initTools() {
    // Initialize viewport interaction tools

    const component = this;

    if (!component.imgTools) {
      const { toolGroupId, views2d, eventTimeout } = component.props;

      // Register tool instances with Cornerstone3D
      component._registerTools();

      // Initialize tool group and add window/zoom interaction
      component.imgTools = C3dToolGroupManager.createToolGroup(toolGroupId);

      // Add tools to the group
      component.imgTools.addTool(C3dZoomTool.toolName);
      component.imgTools.addTool(C3dWindowLevelTool.toolName);
      component.imgTools.addTool(C3dPanTool.toolName);
      component.imgTools.addTool(C3dStackScrollTool.toolName);

      // Add viewports to tool group
      _.each(views2d, (tab) => {

        // Retrieve viewport to ensure it is active
        const { viewportId: _v3d_id } = component._checkViewportActive({ tab });
        if (_v3d_id) {

          // Add viewport to the tool
          component.imgTools.addViewport(_v3d_id);
        }
      });

      // Activate tools
      component.activateTools('default');

      // Re-render viewports and udpate state
      setTimeout(component.render3d.bind(component), eventTimeout);
      component.setState({ imgToolsInit: true, toolMode: 'default' });
    }
  }

  deactivateTools(options) {
    // Deactivate all tools in preparation of applying new bindings

    options = options || {};
    _.defaults(options, { removeAllBindings: true });

    const component = this;
    const { toolGroupId } = component.props

    const imgTools = C3dToolGroupManager.getToolGroup(toolGroupId);
    if (imgTools && options.removeAllBindings) {
      imgTools.setToolPassive(C3dStackScrollTool.toolName);
      imgTools.setToolPassive(C3dPanTool.toolName);
      imgTools.setToolPassive(C3dWindowLevelTool.toolName);
      imgTools.setToolPassive(C3dZoomTool.toolName);
    }
  }

  activateTools(mode) {
    // Activate tool bindings

    const component = this;
    const { toolGroupId } = this.props;
    const { toolMode } = this.state;

    // Deactivate all tols before setting new mode
    component.deactivateTools();
    const imgTools = C3dToolGroupManager.getToolGroup(toolGroupId);

    // Set default mode
    if (imgTools) {
      if (!mode || (mode == 'default')) {

        // Set tools active
        imgTools.setToolActive(C3dWindowLevelTool.toolName, {
          bindings: [
            { mouseButton: c3dToolsEnums.MouseBindings.Primary }, // Left click
          ]
        });

        imgTools.setToolActive(C3dZoomTool.toolName, {
          bindings: [
            { mouseButton: c3dToolsEnums.MouseBindings.Secondary }, // Right click
          ]
        });

        imgTools.setToolActive(C3dPanTool.toolName, {
          bindings: [
            { mouseButton: c3dToolsEnums.MouseBindings.Auxiliary }, // Middle mouse button
          ]
        });

        // Bind stack scroll to mouse scroll
        imgTools.setToolActive(C3dStackScrollTool.toolName, {
          bindings: [
            { mouseButton: c3dToolsEnums.MouseBindings.Wheel }, // Change slice position on stack scroll
          ]
        });
      }

      // Update the state if tool mode is different than current mode
      if (mode && (mode != toolMode)) {
        this.setState({ toolMode: mode });
      }
    }
  }

  initImageSync() {
    // Initialize window level synchronization between viewports
    const component = this;
    const { renderId, voiSyncId, isLoaded, views2d } = component.props;
    const { imgToolsInit } = component.state;

    if (component.renderEngine && component.imgTools) {

      // Initialize image synchronizer
      component.imgSync = c3dCreateVOISynchronizer(voiSyncId);
      _.each(views2d, (tab) => {

        const { viewportId: _v3d_id } = component._checkViewportActive({ tab });
        if (_v3d_id) {

          // Add volume viewports
          component.imgSync.add({
            renderingEngineId: renderId, viewportId: _v3d_id,
          });
        }
      });

      component.setState({ imgSyncInit: true });
    }
  }

  async _activateSurfaceRepresentation() {
    // Activate the segmentation surface representation for the volume associated with the editor

    const component = this;

    const { viewportId: _v3d_id, viewport: _view3d } = component._checkViewportActive({ tab: SonadorSegEnums.SEGVIEWER_3D });
    if (_v3d_id) {
      const { volumeId: labelmapInstanceUID } = component._segVol();
      const { volumeId: labelmapInstance3dUID } = component._segVol3d();

      if (labelmapInstance3dUID) {

        // Attach the Surface representation to the 3D viewport and let Cornerstone3D's lazy
        // surfaceDisplay.render() path compute the surface from the 3D labelmap.
        //
        // The surface CANNOT be pre-computed and stored before the representation is attached:
        // computeSurfaceData -> createAndCacheSurfacesFromRaw resolves each segment's colour via
        // getSegmentIndexColor(options.viewport.id, segmentationId, segmentIndex), which reads the
        // viewport-scoped representation. With no viewport (or no representation registered on it)
        // it throws ("Cannot read properties of undefined (reading 'id')" / "No color found").
        // The representation must exist on the viewport first to establish the colour context.
        //
        // De-duplication of the lazy compute is handled globally, not here: surfaceDisplay.render()
        // is scheduled fire-and-forget on requestAnimationFrame and re-fires on every re-render
        // while representationData.Surface is still empty, each call hitting
        // getPolySeg().computeSurfaceData. The single-flight wrapper (platform/core
        // polySegSingleFlight, installed at cornerstoneTools.init) coalesces all of those calls onto
        // one in-flight marching-cubes job per segmentation — the same mechanism that fixed the 3D
        // volume viewer. The _surfaceCreateStarted latch above keeps the representation itself from
        // being registered more than once.
        const _rep = component._getSegmentationRepresentation({
          volumeId: labelmapInstance3dUID,
          type: c3dToolsEnums.SegmentationRepresentations.Surface,
        });

        await c3dSegmentations.addSegmentationRepresentations(_v3d_id, [ _rep ]);

        // Kick the lazy surface compute immediately. _pokeSegmentationRender() asks the
        // SegmentationRenderingEngine to (re)render the viewports carrying this 3D segmentation,
        // which runs surfaceDisplay.render() -> the single-flighted computeSurfaceData.
        //
        // This first poke can no-op: SegmentationRenderingEngine._triggerRender silently returns
        // if the 3D viewport is not yet enabled or the representation is not yet resolved at this
        // rAF tick. There is no library-level retry, which is exactly why "open the editor, walk
        // away, and the surface never renders" happened. The bounded poke loop in
        // _startSurfacePolling() retries the same safe poke until one lands.
        component._pokeSegmentationRender();
      }
    }
  }

  _applySurfaceColorLUT () {
    // Apply the ColorLUT of the segmentation to the surface representation

    const component = this;

    // Retrieve 3D viewport ID and the 3D volumeId
    const { viewportId: _v3d_id, viewport: _view3d } = component._checkViewportActive({ tab: SonadorSegEnums.SEGVIEWER_3D });
    const { volumeId: labelmapInstance3dUID } = component._segVol3d();

    if (_v3d_id && labelmapInstance3dUID) {

      // Check lutIdx (set during the setup of the 2D volume labelmap)
      if (!component.lutIdx) {
        throw new Error('Unable to apply colorLut to surface, invalid component lutIdx');
      }

      // Attach colorLUT of 2D view to 3D surface
      c3dSegmentations.config.color.setColorLUT(_v3d_id, labelmapInstance3dUID, component.lutIdx);
    }
  }

  _getDefaultVolumeRenderPreset() {
    // Resolve the modality default rendering preset for the image volume (CT/MR prop
    // convention shared with the volume viewer)

    const component = this;
    const { defaultVolumeRenderPresetCT, defaultVolumeRenderPresetMR } = component.props;
    const { displaySet } = component.props.viewportData;

    return /^MR/i.test(displaySet?.Modality || '') ? defaultVolumeRenderPresetMR : defaultVolumeRenderPresetCT;
  }

  async enableVolumeRendering() {
    // Set the image volume on the editor's 3D viewport and apply the modality default rendering
    // preset. Presentation-only: the 2D views and labelmap data are unaffected. Mirrors the
    // volume-on transition of Cornerstone3DVolumeViewport.componentDidUpdate.

    const component = this;
    const { viewportId: _v3d_id, viewport: _view3d } = component._checkViewportActive({ tab: SonadorSegEnums.SEGVIEWER_3D });
    if (!_view3d) {
      return;
    }

    // Set the cached image volume on the 3D viewport and apply the default preset
    await component._setImageVolume({ tab: SonadorSegEnums.SEGVIEWER_3D });
    _view3d.setProperties({ preset: component._getDefaultVolumeRenderPreset() });

    // setVolumes() reinitializes the viewport actor list, which clears any surface mesh actors
    // previously added to the scene. Re-fire SEGMENTATION_DATA_MODIFIED for the 3D labelmap so
    // updateSurfaceData re-adds the surface actors.
    const { segEditorSurfaceRenderingEnabled } = component.props;
    const { surfaceModelInit } = component.state;
    if (segEditorSurfaceRenderingEnabled && surfaceModelInit) {
      const { volumeId: labelmapInstance3dUID } = component._segVol3d();
      if (labelmapInstance3dUID) {
        c3dSegmentations.triggerSegmentationEvents.triggerSegmentationDataModified(labelmapInstance3dUID);
      }
    }

    component.render3d();
  }

  disableVolumeRendering(options) {
    // Remove the image volume actors from the editor's 3D viewport and re-render. Surface
    // actors are unaffected. Mirrors Cornerstone3DVolumeViewport.disableVolumeRendering.

    const component = this;
    const { viewportId: _v3d_id, viewport: _view3d } = component._checkViewportActive({ tab: SonadorSegEnums.SEGVIEWER_3D });
    if (_view3d) {
      c3dUtils.removeVolumeActors(_v3d_id, options);
      component.render3d();
    }
  }

  removeSurfaceRender() {
    // Remove the surface representation from the editor's 3D viewport and cancel in-flight
    // surface computation. Mirrors Cornerstone3DVolumeViewport.removeSurfaceRepresentation +
    // the worker discipline of its toggle-off branch.

    const component = this;
    const { viewportId: _v3d_id } = component._checkViewportActive({ tab: SonadorSegEnums.SEGVIEWER_3D });
    const { volumeId: labelmapInstance3dUID } = component._segVol3d();

    // Invalidate the epoch first so any in-flight createSurfaceRender aborts before it updates
    // state or re-adds the representation, then release the create latch and reveal state so a
    // later re-enable can run the full create + reveal cycle again.
    component._surfaceEpoch += 1;
    component._surfaceCreateStarted = false;
    component._surfaceShown = false;
    component._stopSurfacePolling();

    if (_v3d_id && labelmapInstance3dUID) {
      c3dSegmentations.removeSurfaceRepresentation(_v3d_id, labelmapInstance3dUID);
    }

    // Cancel queued/running marching-cubes jobs (AR-5 worker discipline)
    c3dUtils.terminateWorkerComputeJobs();

    component.setState({ surfaceModelInit: false, surfaceRendering: false, surfaceRenderProgress: 0 });
    component.render3d();
  }

  async createSurfaceRender(options) {
    // Create a surface representation of loaded labelmaps for display in the 3D viewport.
    // This method only creates the segmentation representation. The surface must be
    // generated using the Polymorphic segmentation background worker package
    // by calling renderSegSurfaceData.

    // @param options.recompute: recompute the surface geometry from the current labelmap after
    //  the representation is attached. Used when the surface is re-enabled after being toggled
    //  off — segments edited or added while the surface was disabled leave the previously stored
    //  geometry stale, so the full surface must be regenerated (the single-flight wrapper
    //  coalesces the recomputation).

    options = options || {};
    _.defaults(options, { recompute: false });

    const component = this;
    const { surfaceModelInit } = component.state;

    const { viewportId: _v3d_id } = component._checkViewportActive({ tab: SonadorSegEnums.SEGVIEWER_3D });
    if (_v3d_id) {
      const { volumeId: labelmapInstanceUID } = component._segVol();
      const { volumeId: labelmapInstance3dUID } = component._segVol3d();

      if (labelmapInstance3dUID && !surfaceModelInit && !component._surfaceCreateStarted) {

        // Latch synchronously, before any await, so a re-render-driven re-invocation
        // cannot pass the guard while this call is still in flight. setState({ surfaceModelInit })
        // below is async, so the boolean state alone is not enough to prevent re-entry.
        component._surfaceCreateStarted = true;

        // Capture epoch before the async wait. Any concurrent call (re-render while
        // _activateSurfaceRepresentation is in flight) or unmount will increment
        // _surfaceEpoch, letting us detect and abort stale completions.
        component._surfaceEpoch += 1;
        const epoch = component._surfaceEpoch;

        try {
          // Create surface segmentation representation
          await component._activateSurfaceRepresentation();
        } catch (err) {
          // Release the latch so a later legitimate retry can run.
          component._surfaceCreateStarted = false;
          throw err;
        }

        // Abort if the component unmounted or this call was superseded during the await
        if (epoch !== component._surfaceEpoch || !component._isMounted) {

          // If the surface toggle was turned off while the representation was being attached,
          // the representation that just landed must be detached again (removeSurfaceRender ran
          // before the await resolved, so its removal saw nothing to remove).
          if (component._isMounted && !component.props.segEditorSurfaceRenderingEnabled) {
            c3dSegmentations.removeSurfaceRepresentation(_v3d_id, labelmapInstance3dUID);
          }
          return;
        }

        component._applySurfaceColorLUT();

        // Log state of segmentations: 2D and 3D (surface)
        const _seg0 = c3dSegmentations.state.getSegmentation(labelmapInstanceUID);
        const _seg3d = c3dSegmentations.state.getSegmentation(labelmapInstance3dUID);
        console.log('[SegViewer-createSurfaceRender] 3D seg', _seg3d, component.lutIdx);

        // Mark surface as initialised and resume segmentation update events.
        // setState triggers a re-render; componentDidUpdate then calls _surfaceRenderStatus()
        // because surfaceModelInit changed — no forceUpdate() needed.
        component.setState({ surfaceModelInit: true, segRepUpdatePaused: false });

        // Recompute the surface geometry from the current labelmap before revealing, so the
        // progress indicator stays up while stale geometry (from edits made with the surface
        // disabled) is regenerated. A failure falls through to the lazy compute path: the poll
        // backstop below re-pokes the render until the single-flighted computeSurfaceData runs.
        if (options.recompute) {
          try {
            await c3dUpdateSurfaceData(labelmapInstance3dUID);
          } catch (err) {
            console.error('[SegViewer-createSurfaceRender] Unable to update surface data on re-enable. '
              + 'segmentationId='+labelmapInstance3dUID, err);
          }

          // Abort if toggled off or unmounted while the recompute was in flight
          if (epoch !== component._surfaceEpoch || !component._isMounted) return;
        }

        // Start the bounded poll backstop and attempt an immediate reveal: the surface may
        // already be cached (e.g. computed for the volume viewer), in which case it is ready now.
        component._showSurfaceWhenReady();
        component._startSurfacePolling();
      }
    }
  }

  async initSurfaceTools() {
    // Render surface from labelmap data in the 3D viewport. This method defers
    // to the computeSurfaceData of the Polymorphic segmentation package from Cornerstone3D.

    const component = this;
    const { paintFilterLabelMapDetails, eventTimeout } = component.props;

    const { viewportId: _v3d_id, viewport: _view3d } = component._checkViewportActive({ tab: SonadorSegEnums.SEGVIEWER_3D, });
    if (_v3d_id && paintFilterLabelMapDetails) {
      const { labelmapInstanceUID } = paintFilterLabelMapDetails;

      if (labelmapInstanceUID)  {

        if (!component.surfaceTools) {
          const { surfaceToolGroupId, views3d, eventTimeout } = component.props;

          // Initialize surface tool group and 3D components
          component.surfaceTools = C3dToolGroupManager.createToolGroup(surfaceToolGroupId);

          // Add tools to the group
          component.surfaceTools.addTool(SonadorZoomTool.toolName);
          component.surfaceTools.addTool(C3dPanTool.toolName);
          component.surfaceTools.addTool(C3dTrackballRotateTool.toolName);

          // Add viewports to the tool group
          _.each(views3d, (tab) => {

            // Retrieve viewport to ensure it is active
            const { viewportId: _v3d_id } = component._checkViewportActive({ tab });
            if (_v3d_id) {

              // Add viewport to the tool
              component.surfaceTools.addViewport(_v3d_id);
            }
          });

          // Activate surface tools
          component.activateSurfaceTools('default');
        }

        component.setState({ surfaceModelToolsInit: true, surfaceToolMode: 'default' });
      }
    }
  }

  deactivateSurfaceTools(options) {
    // Deactivate all surface tools in preparation of applying new bindings
    options = options || {};
    _.defaults(options, { removeAllBindings: true });

    const component = this;
    const { surfaceToolGroupId } = component.props;

    const surfaceTools = C3dToolGroupManager.getToolGroup(surfaceToolGroupId);

    if (surfaceTools) {
      surfaceTools.setToolPassive(C3dPanTool.toolName);
      surfaceTools.setToolPassive(SonadorZoomTool.toolName);
      surfaceTools.setToolPassive(C3dTrackballRotateTool.toolName);
    }
  }

  activateSurfaceTools(mode) {
    // Activate surface tool bindings

    const component = this;
    const { surfaceToolGroupId } = this.props;
    const { surfaceToolMode } = this.state;

    // Deactivate surface tool bindings before setting new mode
    component.deactivateSurfaceTools();
    const surfaceTools = C3dToolGroupManager.getToolGroup(surfaceToolGroupId);

    // Set default mode
    if (surfaceTools) {
      if (!mode || (mode == 'default')) {

        // Rotate volume
        surfaceTools.setToolActive(C3dTrackballRotateTool.toolName, {
          bindings: [
            { mouseButton: c3dToolsEnums.MouseBindings.Primary }, // Left click
          ]
        });

        // Pan volume (right click — matches Three.js convention)
        surfaceTools.setToolActive(C3dPanTool.toolName, {
          bindings: [
            { mouseButton: c3dToolsEnums.MouseBindings.Secondary }, // Right mouse button press
          ]
        });

        // Zoom volume (middle click + scroll wheel — matches Three.js convention)
        surfaceTools.setToolActive(SonadorZoomTool.toolName, {
          bindings: [
            { mouseButton: c3dToolsEnums.MouseBindings.Auxiliary }, // Middle mouse button press
            { mouseButton: c3dToolsEnums.MouseBindings.Wheel },     // Scroll wheel
          ]
        });
      }

      // Update state if tool mode is different than current mode
      if (mode && (mode != surfaceToolMode)) {

        // Set current surface tool mode and re-render viewport
        component.setState({ surfaceToolMode: mode });
        component.render3d();
      }
    }
  }

  onInteractionStart() {
    // Begin trcking model interaction events
    const component = this;
    console.log("[SegViewer-onInterationStart] Initialize segmentation components, windows, and UI");
  }

  async componentDidMount() {
    // Initialize poly segmentation and other supporting utilities
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
    // Manage lifecycle updates to the segmentation editor
    const component = this;

    const {
      isLoaded, views3d, views2d, segEditorVolumeRenderingEnabled, segEditorSurfaceRenderingEnabled,
    } = component.props;
    const {
      tabUiInit, uiInit, imgViewportInit, imgRenderInit, imgToolsInit, imgSyncInit,
      segInit, segRenderInit, surfaceModelInit, surfaceRendering, surfaceRenderProgress, surfaceModelToolsInit
    } = component.state;

    await super.componentDidUpdate(prevProps, prevState);

    // Update the 3D viewport loading UI only when surface-related state actually changes.
    // Previously this ran on every componentDidUpdate (including per-frame progress events),
    // rebuilding React elements for all 3D tabs on each render cycle.
    const surfaceStateChanged =
      prevState.surfaceRendering !== surfaceRendering ||
      prevState.surfaceRenderProgress !== surfaceRenderProgress ||
      prevState.surfaceModelInit !== surfaceModelInit;
    if (surfaceStateChanged) {
      component._surfaceRenderStatus();
    }

    // Initialize image synchronizer
    if (isLoaded && imgToolsInit && !imgSyncInit) {
      component.initImageSync();
    }

    // Toggle image volume rendering on/off in the 3D viewport (presentation-only; follows the
    // transition logic of Cornerstone3DVolumeViewport.componentDidUpdate)
    if (imgRenderInit && prevProps.segEditorVolumeRenderingEnabled !== segEditorVolumeRenderingEnabled) {
      if (segEditorVolumeRenderingEnabled) {
        await component.enableVolumeRendering();
      } else {
        component.disableVolumeRendering();
      }

      // Rebuild the 3D tab view so the rendering menu button visibility follows the toggle,
      // then force a render pass — the flexlayout tab factory serves the cached element, so a
      // rebuild without a subsequent React render would not become visible until the next update.
      component._surfaceRenderStatus();
      component.forceUpdate();
    }

    // Toggle surface rendering on/off in the 3D viewport
    if (prevProps.segEditorSurfaceRenderingEnabled && !segEditorSurfaceRenderingEnabled) {
      component.removeSurfaceRender();
    } else if (segRenderInit && !prevProps.segEditorSurfaceRenderingEnabled && segEditorSurfaceRenderingEnabled) {

      // Re-enable: show the progress indicator and recreate the representation, recomputing the
      // surface so segments edited or added while the surface was off are included (FR-5)
      component.setState({ surfaceRendering: true, surfaceRenderProgress: 0 });
      await component.createSurfaceRender({ recompute: true });
    }

    // Create surface version of the labelmap and add it to the segmentations. Gated on the
    // surface toggle: while the surface is disabled, surfaceModelInit stays false and this
    // branch must not re-create the representation.
    if (isLoaded && segRenderInit && !surfaceModelInit && segEditorSurfaceRenderingEnabled) {
      await component.createSurfaceRender();
    }

    // Render and display surface data
    if (isLoaded && segRenderInit && surfaceModelInit && !surfaceModelToolsInit && !component.surfaceTools) {
      await component.initSurfaceTools();
    }
  }

  unsubscribeEvents() {
    // Unsubscribe event handlers
    const component = this;

    // Stop the surface availability poll backstop
    component._stopSurfacePolling();

    if (component._workerProgressHandler) {

      // Background updates from worker progress
      c3dEventTarget.removeEventListener(
        c3dEnums.Events.WEB_WORKER_PROGRESS, component._workerProgressHandler, { capture: true });
      component._workerProgressHandler = null;
    }

    if (component._segRenderedHandler) {

      // Segmentation render completion
      c3dEventTarget.removeEventListener(
        c3dToolsEnums.Events.SEGMENTATION_RENDERED, component._segRenderedHandler);
      component._segRenderedHandler = null;
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
    const { renderId, toolGroupId, surfaceToolGroupId, voiSyncId, views2d, views3d } = component.props;
    const { img, meta } = component.props.volumes[0];

    // Unsubscribe Events
    component.unsubscribeEvents();
    component._isMounted = false;

    // Cancel background operations
    c3dUtils.terminateWorkerComputeJobs();

    // Remove imaging and segmentation tools
    if (component.imgTools) {
      _.each(views2d, (tab) => {

        // Remove viewports from tools
        component.imgTools.removeViewports(component.getViewportId({ tab }));
      });

      // Destroy tool group
      C3dToolGroupManager.destroyToolGroup(toolGroupId);
      component.imgTools = undefined;
    }

    if (component.surfaceTools) {
      _.each(views3d, (tab) => {

        // Remove surface tools from viewports
        component.surfaceTools.removeViewports(component.getViewportId({ tab }));
      });

      // Destroy tool group
      C3dToolGroupManager.destroyToolGroup(surfaceToolGroupId);
      component.surfaceTools = undefined;
    }

    if (component.imgSync) {
      _.each(views2d, (tab) => {

        // Remove viewports from tools
        component.imgSync.remove({ renderingEngineId: renderId, viewportId: component.getViewportId({ tab }) });
      });

      // Destroy synchronizer
      C3dSynchronizerManager.destroySynchronizer(voiSyncId);
      component.imgSync = undefined;
    }

    // Purge data from the local cache
    const { volumeId: labelmapInstance3dUID } = component._segVol3d();
    if (labelmapInstance3dUID) {
      component.purgeSegmentationRepresentations(labelmapInstance3dUID);
    }
    await super.componentWillUnmount();

    // Set component state
    component.setState({ imgRenderInit: false, imgToolsInit: false });

    if (component.props.onDestroyed && _.isFunction(component.props.onDestroyed)) {
      component.props.onDestroyed();
    }

    await c3dCache.purgeCache();
    console.log("SegViewer-componentWillUnmount: Cornerstone3D cleanup complete");
  }

  purgeLocalVolume() {
    // Remove 2D and 3D volumes from cache
    const component = this;
    return super.purgeLocalVolume();
  }

  render() {
    // Render segmentation editor

    const component = this;
    const style = {
      width: "100%",
      height: "100%",
      position: "relative",
      color: "white",
    };

    return (
      <div className="sonador-segmentation-editor" style={style}>
        <Layout
          model={component.model}
          factory={component.tabFactory.bind(component)}
          onAction={component.onTabAction.bind(component)}
          onModelChange={component.onTabModelChange.bind(component)}
          rootOrientationVertical={true}
        />
      </div>
    );
  }
}


// Export both the base viewport (plain JS class which can be extended) and a wrapped viewport providing
// translation utilitites. Views which utilize the viewer directly should use the wrapped version.
export default withTranslation('Common')(Cornerstone3DSegmentationViewerBaseViewport);
export { Cornerstone3DSegmentationViewerBaseViewport };
