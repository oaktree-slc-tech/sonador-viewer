import _ from "lodash";

import React, { Component, createRef } from "react";
import PropTypes from 'prop-types';

import {
  RenderingEngine as C3dRenderingEngine,
  Enums as c3dEnums,
  init as c3dCoreInit,
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

import { OHIFModal } from '@ohif/ui';

import { vtkImage2CornerstoneImageOptions, cacheVtkImage, purgeLocalVolume } from '../utils/cornerstone3d.js';

import styles from './Cornerstone3DInspectionView.css';

const { ViewportType, Events } = c3dEnums;


class Cornerstone3DBaseView extends Component {
  // Cornerstone 3D view which provides properties to initialize a render engine and load data from VTK volumes.
  
  static id = 'Cornerstone3DBaseView';

  constructor(props) {
    super(props);

    // Maintain persistent references to image/volume tools and components
    this.container = createRef();
    this.cornerstone3dViewProps = _.clone(this.props.cornerstone3dViewProps);
    this.cornerstone3dViewProps.defaultOptions.orientation = this.props.orientation;
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
    toolGroupId: PropTypes.string,
    sep: PropTypes.string,
    viewportData: PropTypes.object.isRequired,
    volumes: PropTypes.array.isRequired,
    isLoaded: PropTypes.bool.isRequired,
    cornerstone3dViewProps: PropTypes.object,
    eventTimeout: PropTypes.number,
    orientation: PropTypes.string,
  }

  static defaultProps = {
    renderId: 'sonadorCornerstone3dInspectionViewport',
    toolGroupId: 'sonadorCornerstone3dInspectionViewport',
    sep: '-',
    orientation: c3dEnums.OrientationAxis.AXIAL,
    cornerstone3dViewProps: {
      type: ViewportType.ORTHOGRAPHIC, defaultOptions: {},
    },
    eventTimeout: 50,
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

  loadImageVolume() {
    // Initialize Cornerstone volume and load image volume to Cornerstone3D
    const component = this;
    const { displaySet } = component.props.viewportData;

    // Create volume
    const vol = c3dCache.getVolume(displaySet.displaySetInstanceUID);
    if (!vol) {
      if (component.props.volumes) {
        const img = component.props.volumes[0]  

        // Volume not yet initialized, create instance and add to cache
        cacheVtkImage(displaySet.displaySetInstanceUID, displaySet, img);
      }
    }
  }

  renderImageData() {
    // Render image data

    const component = this;    
    const { uiInit, imgRenderInit } = component.state;
    const { displaySet } = component.props.viewportData;
    const { orientation } = component.props;

    if (uiInit && !imgRenderInit) {

      // Load image volume
      component.loadImageVolume();

      // Set viewport instance
      const _v3d_id = component.getViewportId();
      const _view3d = component.renderEngine.getViewport(_v3d_id);

      if (_view3d) {

        // Set volumes for viewport
        _view3d.setVolumes([ { volumeId: displaySet.displaySetInstanceUID } ]);

        // Render viewport
        component.renderEngine.render();
        component.setState({ imgRenderInit: true });
      }
      
    }
  }

  async componentDidMount() {
    // Load model and segmentation data for rendering

    const component = this;
    const { renderId, isLoaded } = this.props;
    const { imgRenderInit, imgToolsInit } = this.state;

    await c3dCoreInit();
    await c3dToolsInit();

    // Initialize render engine
    component.renderEngine = new C3dRenderingEngine(renderId);
    component.initUi();
  }

  componentDidUpdate(prevProps, prevState) {
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

    // Resize and re-render
    if (isLoaded && imgViewportInit && imgRenderInit && imgToolsInit) {
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
    // 4. Destroy the render engine

    const component = this;
    const { renderId, toolGroupId, volumes } = component.props;
    const { displaySet } = component.props.viewportData;

    if (component.renderEngine) {

      // Destroy render engine
      component.renderEngine.destroy();
      component.renderEngine = undefined;
    }

    // Remove volumes
    purgeLocalVolume(displaySet.displaySetInstanceUID);
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