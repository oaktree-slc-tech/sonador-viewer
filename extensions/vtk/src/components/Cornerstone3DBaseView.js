import _ from "lodash";

import React, { Component, createRef } from "react";
import PropTypes from 'prop-types';

import {
  init as c3dCoreInit,

  RenderingEngine as C3dRenderingEngine,
  getRenderingEngine as c3dGetRenderingEngine,
  Enums as c3dEnums,
  volumeLoader as c3dVolumeLoader,
  cache as c3dCache,
  eventTarget as c3dEventTarget,
} from "@cornerstonejs/core";

import {
  init as c3dToolsInit,

  ToolGroupManager as C3dToolGroupManager,
  SynchronizerManager as C3dSynchronizerManager,
  WindowLevelTool as C3dWindowLevelTool,
  ZoomTool as C3dZoomTool,
  PanTool as C3dPanTool,
  StackScrollTool as C3dStackScrollTool,
  Enums as c3dToolsEnums,
  addTool as c3dAddTool,
} from '@cornerstonejs/tools';

import {
  assessDisplaySetVolumeFit,
  createImageVolumeForDisplaySet,
  getVolumeIdForDisplaySet,
  suggestDecimationAfterFailure,
  volumeLease,
} from '../utils/cornerstone3d.js';
import styles from './Cornerstone3DBaseView.css';

const { ViewportType, Events } = c3dEnums;


class Cornerstone3DBaseView extends Component {
  // Cornerstone 3D view which initializes a render engine and displays the Cornerstone3D streaming
  // image volume built from a display set's imageIds.
  
  static id = 'Cornerstone3DBaseView';

  constructor(props) {
    super(props);

    // Maintain persistent references to image/volume tools and components
    this.container = createRef();
    this._initViewProps();
  }

  state = {
    uiInit: false,
    imgViewportInit: false,
    imgRenderInit: false,
    imgToolsInit: false,
    toolMode: null,

    // Cornerstone3D streaming volume state
    volumeId: null,
    fit: null,
    loadProgress: null,
    loadError: null,
  }

  static propTypes = {
    renderId: PropTypes.string,
    sep: PropTypes.string,
    viewportData: PropTypes.object.isRequired,
    // Stack imageIds for the display set. The view builds the Cornerstone3D volume from these
    // rather than receiving a prebuilt vtkVolume actor.
    imageIds: PropTypes.array.isRequired,
    isLoaded: PropTypes.bool.isRequired,
    onLoadProgress: PropTypes.func,
    onLoadError: PropTypes.func,
    onVolumeFit: PropTypes.func,
    cornerstone3dViewProps: PropTypes.object,
    eventTimeout: PropTypes.number,
    orientation: PropTypes.string,
    onImageLoad: PropTypes.func,
    volumeCleanup: PropTypes.bool,
    engineCleanup: PropTypes.bool,
  }

  static defaultProps = {
    renderId: 'sonadorCornerstone3dBaseViewport',
    sep: '-',
    orientation: c3dEnums.OrientationAxis.AXIAL,
    cornerstone3dViewProps: {
      type: ViewportType.ORTHOGRAPHIC, defaultOptions: {},
    },
    eventTimeout: 50,
    volumeCleanup: true,
    engineCleanup: true,
  }

  _initViewProps() {
    // Initialize properties for the view
    
    this.cornerstone3dViewProps = _.cloneDeep(this.props.cornerstone3dViewProps);
    this.cornerstone3dViewProps.defaultOptions.orientation = this.props.orientation;
  }

  _checkViewportActive(options) {
    // Check to see if the viewport is active.
    // Returns the viewport ID and viewport reference if active and undefined otherwise.

    const _v3d_id = this.getViewportId(options);
    const _view3d = this.renderEngine.getViewport(_v3d_id);

    if (_view3d) {
      return { viewportId: _v3d_id, viewport: _view3d };
    }

    return {};
  }

  getViewportId() {
    // Retrieve the viewport ID for the class

    const { renderId, sep } = this.props;
    return renderId+sep+'viewport';
  }

  init3dViewport() {
    // Initialize 3D viewport for the class

    const component = this;
    const { renderId, eventTimeout } = component.props;

    if (component.renderEngine) {
      const _v3d_id = component.getViewportId();
      const _view3d = component.renderEngine.getViewport(_v3d_id);

      // Initialize Cornerstone 2D viewport
      if (!_view3d && component.container.current) {

        // Create viewport element and add to the current container
        const _el = document.createElement('div');

        // Disable the current context meu
        _el.oncontextmenu = (e) => e.preventDefault();

        // Set element styles to grow to the full size of the parent
        _el.style.width = '100%';
        _el.style.height = '100%';
        component.container.current.appendChild(_el);

        // Add viewport ID and other attributes to the cornerstone viewport properties
        component.cornerstone3dViewProps.viewportId = _v3d_id;
        component.cornerstone3dViewProps.element = _el;

        // Set state of 3D uiInit as true
        component.setState({ uiInit: true });
      }
    }
  }

  activate3dViewports() {
    // Activate render engine components
    const component = this;
    const { uiInit, imgViewportInit } = this.state;

    // Only attempt to activate viewports after full init of container elements
    if (uiInit && !imgViewportInit) {

      // Add viewport to the engine
      component.renderEngine.enableElement(component.cornerstone3dViewProps);
      component.setState({ imgViewportInit: true });
    }
  }

  initUi() {
    // Initialize 3D viewport and UI components    
    
    const component = this;
    component.init3dViewport();
  }

  initTools() {
    // Initialize tools for the viewport
    const component = this;
    component.setState({ imgToolsInit: true, toolMode: 'default' });
  }

  _getImageVolumeId() {
    // Retrieve the volumeId of the image volume this view displays.
    //
    // Once the pre-flight has run this is the id actually in the cache, which may be the
    // reduced-resolution navigation volume; before that it is the
    // full-resolution id the display set would normally get.

    const component = this;
    const { displaySet } = component.props.viewportData;

    return component.state.volumeId
      || getVolumeIdForDisplaySet(displaySet, component._volumeIdOptions());
  }

  _volumeIdOptions() {
    // Extra options for `getVolumeIdForDisplaySet`. Views that render in their own rendering
    // engine -- and so their own WebGL context -- override this with a `view` discriminator,
    // because a Cornerstone3D volume's single vtkOpenGLTexture cannot be bound to two contexts.
    return {};
  }

  _getImageVolumeMeta() {
    // Retrieve the metadata to be cached alongside the image volume
    const component = this;
    const { displaySet } = component.props.viewportData;

    return displaySet;
  }

  _reportLoadProgress(loadProgress) {
    // Publish load progress to the view's own state and up to the hosting viewport, which owns the
    // loading indicator.
    //
    // Throttled to one update per whole percentage point, and always on completion.
    // IMAGE_VOLUME_MODIFIED fires once per SLICE -- 1,600 times for the series this phase targets,
    // and once per view, so three MPR panes made ~4,800 setState calls for one series. Each one
    // cascades a componentDidUpdate through every subclass in the chain (labelmap render checks,
    // the surface reveal, tool/sync init guards), which is far more work than the indicator that
    // consumes it needs. Cornerstone3D redraws the volume itself every 2% of frames, so nothing
    // visible depends on the finer granularity.

    const component = this;
    const { onLoadProgress } = component.props;

    if (!component._isViewMounted) {
      return;
    }

    const { framesProcessed = 0, numberOfFrames = 0, complete } = loadProgress || {};
    const percentComplete = numberOfFrames
      ? Math.floor((framesProcessed * 100) / numberOfFrames)
      : 0;

    if (!complete && percentComplete === component._lastLoadPercent) {
      return;
    }
    component._lastLoadPercent = percentComplete;

    component.setState({ loadProgress });
    if (_.isFunction(onLoadProgress)) {
      onLoadProgress(loadProgress);
    }
  }

  _reportLoadError(error) {
    // Surface a load failure once per volume.

    const component = this;
    const { onLoadError } = component.props;

    if (component._loadErrorReported) {
      return;
    }
    component._loadErrorReported = true;

    if (component._isViewMounted) {
      component.setState({ loadError: error });
    }
    if (_.isFunction(onLoadError)) {
      onLoadError(error);
    }
  }

  _subscribeVolumeEvents(volumeId, volume) {
    // Watch the streaming volume's progress. IMAGE_VOLUME_MODIFIED and
    // IMAGE_VOLUME_LOADING_COMPLETED carry the volumeId; IMAGE_LOAD_ERROR does not, so a failing
    // imageId is matched against this volume's own imageId index instead.

    const component = this;

    component._onVolumeModified = ({ detail }) => {
      if (detail?.volumeId !== volumeId) {
        return;
      }
      component._reportLoadProgress({
        framesProcessed: detail.framesProcessed,
        numberOfFrames: detail.numberOfFrames,
        complete: false,
      });
    };

    component._onVolumeLoadingCompleted = ({ detail }) => {
      if (detail?.volumeId !== volumeId) {
        return;
      }
      component._reportLoadProgress({
        framesProcessed: volume.imageIds.length,
        numberOfFrames: volume.imageIds.length,
        complete: true,
      });
      component.onImageVolumeLoadingCompleted({ volumeId, volume });
    };

    component._onImageLoadError = ({ detail }) => {
      // IMAGE_LOAD_ERROR is global and carries no volumeId, so membership is decided by imageId.
      // At this pin `getImageIdIndex` is a Map lookup and answers `undefined` for a miss, but a
      // numeric -1 is the conventional "not found" and would read as truthy membership, so both
      // are rejected -- attributing another volume's failure here would raise a sticky error and
      // an exit prompt on an unrelated series.
      if (!detail?.imageId) {
        return;
      }

      const imageIdIndex = volume.getImageIdIndex(detail.imageId);
      if (imageIdIndex === undefined || imageIdIndex === null || imageIdIndex < 0) {
        return;
      }

      component._reportLoadError(detail.error || new Error(`Failed to load ${detail.imageId}`));
    };

    c3dEventTarget.addEventListener(Events.IMAGE_VOLUME_MODIFIED, component._onVolumeModified);
    c3dEventTarget.addEventListener(
      Events.IMAGE_VOLUME_LOADING_COMPLETED, component._onVolumeLoadingCompleted);
    c3dEventTarget.addEventListener(Events.IMAGE_LOAD_ERROR, component._onImageLoadError);
  }

  _unsubscribeVolumeEvents() {
    // Remove the streaming-volume listeners. addEventListener returns undefined, so the bound
    // handlers are kept on the component; without that they leak across mounts.

    const component = this;

    if (component._onVolumeModified) {
      c3dEventTarget.removeEventListener(Events.IMAGE_VOLUME_MODIFIED, component._onVolumeModified);
      component._onVolumeModified = null;
    }
    if (component._onVolumeLoadingCompleted) {
      c3dEventTarget.removeEventListener(
        Events.IMAGE_VOLUME_LOADING_COMPLETED, component._onVolumeLoadingCompleted);
      component._onVolumeLoadingCompleted = null;
    }
    if (component._onImageLoadError) {
      c3dEventTarget.removeEventListener(Events.IMAGE_LOAD_ERROR, component._onImageLoadError);
      component._onImageLoadError = null;
    }
  }

  onImageVolumeLoadingCompleted() {
    // Hook for work that needs a complete volume: surface extraction in
    // the editor, and 3D presets that read the scalar range. Slice views need nothing here.
  }

  async _createImageVolume() {
    // Pre-flight, create, and start loading the Cornerstone3D streaming volume for this display
    // set.

    const component = this;
    const { imageIds, onImageLoad } = component.props;
    const { displaySet } = component.props.viewportData;

    // The fit assessment is made once, per display set, before anything is allocated. An
    // over-size 3D texture is not reported by WebGL: it samples as zero and renders as a uniform
    // grey field, so this decision cannot be made by trying and catching.
    const fit = assessDisplaySetVolumeFit(imageIds);

    if (fit.reason === 'no-webgl') {
      throw new Error(
        'This client has no WebGL2 context, so volumes cannot be rendered.');
    }

    const volumeIdOptions = component._volumeIdOptions();

    let created;
    // The assessment that actually describes what got built. It diverges from `fit` only when the
    // pre-flight passed and the allocation then failed anyway, in which case the reduced-resolution
    // volume below is what the user is looking at and the notice has to say so.
    let effectiveFit = fit;

    try {
      created = await createImageVolumeForDisplaySet({ imageIds, displaySet, fit, volumeIdOptions });
    } catch (error) {
      // A cache or allocation failure (CACHE_SIZE_EXCEEDED among them) is retried ONCE at reduced
      // resolution, never again at full resolution.
      const attempted = fit.fits ? null : fit.suggestedDecimation;
      const suggestedDecimation = suggestDecimationAfterFailure(fit) || fit.suggestedDecimation;

      // Nothing smaller to try, or the only suggestion is the decimation that just failed.
      const exhausted =
        !suggestedDecimation ||
        (attempted && attempted.every((factor, i) => factor === suggestedDecimation[i]));

      if (exhausted) {
        component._reportLoadError(error);
        throw error;
      }

      effectiveFit = {
        ...fit,
        fits: false,
        // The client refused the allocation, whatever the pre-flight predicted.
        reason: fit.fits ? 'budget' : fit.reason,
        suggestedDecimation,
      };

      try {
        created = await createImageVolumeForDisplaySet({
          imageIds, displaySet, fit: effectiveFit, volumeIdOptions,
        });
      } catch (retryError) {
        // Only now is this a failure the user can do nothing about. Reporting the original error
        // before the retry would have shown a hard failure over a working reduced-resolution view.
        component._reportLoadError(error);
        throw retryError;
      }
    }

    const { volumeId, volume, decimated } = created;

    if (!component._isViewMounted) {
      // Unmounted while creation was in flight. componentWillUnmount has already run and found no
      // lease to release, so the volume would sit in the cache owned by nobody. Take a lease and
      // give it straight back: net zero for any other view still holding it, and eviction if this
      // was the only claim. Nothing is subscribed and nothing is loaded.
      volumeLease.acquire(volumeId);
      volumeLease.release(volumeId);
      return { volumeId, volume };
    }

    volumeLease.acquire(volumeId);
    component._leasedVolumeId = volumeId;
    component._volume = volume;

    component._subscribeVolumeEvents(volumeId, volume);

    const resolvedFit = { ...effectiveFit, decimated };
    component.setState({ volumeId, fit: resolvedFit });

    if (_.isFunction(component.props.onVolumeFit)) {
      component.props.onVolumeFit(resolvedFit);
    }

    // Start streaming. The viewport is enabled and setVolumes is called without waiting for this
    // to finish, so slices appear as they arrive.
    try {
      volume.load();
    } catch (error) {
      component._reportLoadError(error);
    }

    // A volume already in the cache from an earlier mount never fires the completion event, so the
    // completion hook is called directly for it.
    if (volume.loadStatus?.loaded) {
      component._reportLoadProgress({
        framesProcessed: volume.imageIds.length,
        numberOfFrames: volume.imageIds.length,
        complete: true,
      });
      component.onImageVolumeLoadingCompleted({ volumeId, volume });
    }

    if (_.isFunction(onImageLoad)) {
      onImageLoad({ volumeId, meta: component._getImageVolumeMeta(), vol: volume });
    }

    return { volumeId, volume };
  }

  loadImageVolume() {
    // Single-flight the volume creation for this view. `componentDidUpdate` can re-enter before the
    // first await resolves, so the in-flight promise -- not an async state flag -- is the latch.

    const component = this;

    if (!component._volumePromise) {
      component._volumePromise = component._createImageVolume().catch((error) => {
        component._volumePromise = null;
        component._reportLoadError(error);
        throw error;
      });
    }

    return component._volumePromise;
  }

  async _setImageVolume(options) {
    // Set the image volume for the view
    const component = this;

    const { viewportId: _v3d_id, viewport: _view3d } = component._checkViewportActive(options);
    if (_view3d) {
      await _view3d.setVolumes([ { volumeId: component._getImageVolumeId() } ]);
    }
  }

  async renderImageData(options) {
    // Render image data
    options = options || {};
    _.defaults(options, { setState: true, });

    const component = this;    
    const { uiInit, imgRenderInit } = component.state;
    const { displaySet, eventTimeout } = component.props.viewportData;
    const { orientation } = component.props;

    if (uiInit && !imgRenderInit && !component._renderRequested) {

      // Synchronous latch: componentDidUpdate re-enters before the awaits below resolve, and the
      // imgRenderInit state flag lands too late to block it.
      component._renderRequested = true;

      // Create the streaming volume and start it loading. Released on failure so a later update
      // can retry.
      try {
        await component.loadImageVolume();
      } catch (error) {
        component._renderRequested = false;
        return;
      }

      // Set viewport instance
      const { viewportId: _v3d_id, viewport: _view3d } = component._checkViewportActive();
      if (_view3d) {

        // Set volumes for viewport
        await component._setImageVolume();

        // Render viewport
        setTimeout(component.render3d.bind(component), eventTimeout);

        if (options.setState) {
          component.setState({ imgRenderInit: true });
        }
      } else {
        component._renderRequested = false;
      }
    }
  }

  async componentDidMount() {
    // Load model and segmentation data for rendering

    const component = this;
    const { renderId, isLoaded } = this.props;
    const { imgRenderInit, imgToolsInit } = this.state;
    
    // Initialize render engine 
    component._isViewMounted = true;
    component.renderEngine = c3dGetRenderingEngine(renderId) || new C3dRenderingEngine(renderId);
    component.initUi();
  }

  async componentDidUpdate(prevProps, prevState) {
    // Manage lifecycle to the viewport
    
    const component = this;
    const { isLoaded, eventTimeout } = component.props;
    const { uiInit, imgViewportInit, imgRenderInit, imgToolsInit } = component.state;

    // Activate viewports
    if (isLoaded && uiInit && !imgViewportInit) {
      component.activate3dViewports();
    }

    // Trigger viewport init when UI has finished initializing
    if (isLoaded && imgViewportInit && !imgRenderInit) {
      component.renderImageData();
    }

    // Initialize tools
    if (isLoaded && imgRenderInit && !imgToolsInit) {
      component.initTools();
    }

    // Resize and re-render once when all init flags first become true
    const wasFullyInit = prevState.imgViewportInit && prevState.imgRenderInit && prevState.imgToolsInit;
    if (isLoaded && !wasFullyInit && imgViewportInit && imgRenderInit && imgToolsInit) {
      setTimeout(component.render3d.bind(component), eventTimeout);
    }
  }

  render3d() {
    // Render inspection 3D data
    const component = this;

    if (component.renderEngine) {

      component.renderEngine.resize();
      component.renderEngine.render();
    }
  }

  async componentWillUnmount() {
    // Remove event handlers and reactive logic for the viewport

    // 1. Destroy tool groups and remove viewport references
    // 2. Destroy DOM references
    // 3. Release this view's hold on the image volume
    // 4. Destroy the render engine (or just disable the viewport when engineCleanup=false)

    console.log('[Cornerstone3DBaseView-componentWillUnmount] begin cleanup');

    const component = this;
    const { renderId, volumeCleanup, engineCleanup } = component.props;

    component._isViewMounted = false;
    component._unsubscribeVolumeEvents();

    if (component.renderEngine) {

      if (engineCleanup !== false) {

        // Destroy render engine
        await component.renderEngine.destroy();
      } else {

        // Engine is shared with other viewports — only remove this viewport.
        // disableElement may throw if the viewport was already disabled from the onClose
        // callback or was never fully initialized; use a separate try/catch so the
        // resize+render that follows always executes regardless.
        try {
          component.renderEngine.disableElement(component.getViewportId());
        } catch(e) {
          console.warn('[Cornerstone3DBaseView-componentWillUnmount] Failed to disable viewport element:', e);
        }
        try {
          component.renderEngine.resize();
          component.renderEngine.render();
        } catch(re) {
          console.warn('[Cornerstone3DBaseView-componentWillUnmount] Failed to refresh viewports after element disable:', re);
        }
      }
      component.renderEngine = undefined;
    }

    // Release this view's lease on the image volume. The volume is evicted only when the last
    // view holding it lets go, so views sharing a rendering engine share one volume -- the three
    // MPR panes take three leases on a single entry. The inspection modal renders in its own
    // WebGL context and so holds, and releases, a volume of its own.
    if (volumeCleanup) {
      component.releaseImageVolume();
    }

    console.log('[Cornerstone3DBaseView-componentWillUnmount] cleanup complete');
  }

  releaseImageVolume() {
    // Give up this view's hold on the image volume.

    const component = this;
    const volumeId = component._leasedVolumeId;

    if (!volumeId) {
      return;
    }
    component._leasedVolumeId = null;
    component._volumePromise = null;
    // Cleared so a view that is reset in place (the 3D viewer's _resetVolumeViewerState) can run
    // the load sequence again rather than sitting behind a stale latch.
    component._renderRequested = false;
    component._loadErrorReported = false;
    component._lastLoadPercent = undefined;
    // Subclasses gate work that needs a complete volume on this; a view that is reset in
    // place must wait for the reloaded volume again.
    component._imageVolumeComplete = false;
    component._surfaceRenderDeferred = false;

    // Stop streaming when this was the last holder and the volume never finished; the pool filters
    // its queued requests by volumeId, so a partly-loaded volume does not keep the pool busy.
    const incomplete = component._volume && !component._volume.loadStatus?.loaded;
    if (incomplete && volumeLease.count(volumeId) <= 1) {
      try {
        component._volume.cancelLoading();
      } catch (error) {
        console.warn('[Cornerstone3DBaseView-releaseImageVolume] Failed to cancel volume load:', error);
      }
    }
    component._volume = null;

    volumeLease.release(volumeId);
  }

  render() {
    // Render 3D view
    const component = this;

    return (
      <div className="root">
        <div className="modalContent" >        
        <div className="viewportWrapper" >
          <div className="viewportElement" ref={component.container} />
        </div>
        </div>
      </div>
    );
  }
}


export default Cornerstone3DBaseView;