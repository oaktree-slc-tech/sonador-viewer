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

import { vtkImage2CornerstoneImageOptions, cacheVtkImage, purgeLocalVolume } from '../utils/cornerstone3d.js';
import styles from './Cornerstone3DBaseView.css';

const { ViewportType, Events } = c3dEnums;


class Cornerstone3DBaseView extends Component {
  // Cornerstone 3D view which provides properties to initialize a render engine and load data from VTK volumes.
  
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
  }

  static propTypes = {
    renderId: PropTypes.string,
    sep: PropTypes.string,
    viewportData: PropTypes.object.isRequired,
    volumes: PropTypes.array.isRequired,
    isLoaded: PropTypes.bool.isRequired,
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
    // Retrieve the volumeId

    const component = this;
    const { displaySet } = component.props.viewportData;

    return displaySet.displaySetInstanceUID; 
  }

  _getImageVolumeMeta() {
    // Retrieve the metadata to be cached alongside the image volume
    const component = this;
    const { displaySet } = component.props.viewportData;

    return displaySet;
  }

  _initImageVolume() {
    // Retrieve and initialize the image volume to be used by the view
    const component = this;

    if (component.props?.volumes && component.props?.volumes.length) {
      return component.props.volumes[0];
    }

    return undefined;
  }

  loadImageVolume() {
    // Initialize Cornerstone volume and load image volume to Cornerstone3D
    const component = this;
    const { onImageLoad } = component.props;
    const { displaySet } = component.props.viewportData;

    // Create volume
    const vol = c3dCache.getVolume(component._getImageVolumeId());
    if (!vol) {
      if (component.props.volumes) {
        const img = component._initImageVolume();
        const meta = component._getImageVolumeMeta();

        // Volume not yet initialized, create instance and add to cache
        cacheVtkImage(component._getImageVolumeId(), displaySet, img);

        // Trigger callback
        if (_.isFunction(onImageLoad)) {
          onImageLoad({ volumeId: component._getImageVolumeId(), meta, vol: img, });
        }
      }
    }
  }

  async _setImageVolume(options) {
    // Set the image volume for the view
    const component = this;
    const { displaySet } = component.props.viewportData;

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

    if (uiInit && !imgRenderInit) {

      // Load image volume
      component.loadImageVolume();

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
      }
      
    }
  }

  async componentDidMount() {
    // Load model and segmentation data for rendering

    const component = this;
    const { renderId, isLoaded } = this.props;
    const { imgRenderInit, imgToolsInit } = this.state;
    
    // Initialize render engine 
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
    // 3. Clear loaded volumes
    // 4. Destroy the render engine (or just disable the viewport when engineCleanup=false)

    console.log('[Cornerstone3DBaseView-componentWillUnmount] begin cleanup');

    const component = this;
    const { renderId, volumes, volumeCleanup, engineCleanup } = component.props;
    const { displaySet } = component.props.viewportData;

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

    // Remove local volume from Cornerston3D cache
    if (volumeCleanup) {
      component.purgeLocalVolume();
    }

    console.log('[Cornerstone3DBaseView-componentWillUnmount] cleanup complete');
  }

  purgeLocalVolume() {
    // Remove local volume from Cornerstone3D cache
    const component = this;
    const { displaySet } = this.props.viewportData;

    // Retrieve image volumeId
    const imgVolumeId = component._getImageVolumeId();
    
    if (displaySet && displaySet.displaySetInstanceUID && c3dCache.getVolume(imgVolumeId)) {
      purgeLocalVolume(imgVolumeId);
    }
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