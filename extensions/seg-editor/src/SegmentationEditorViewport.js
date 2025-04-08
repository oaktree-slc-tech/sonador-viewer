import _ from "lodash";

import React, { Component, createRef } from "react";
import PropTypes from "prop-types";

import { Layout, Model } from "flexlayout-react";
import "flexlayout-react/style/dark.css";

import {
  RenderingEngine as C3dRenderingEngine,
  Enums as C3dEnums,
  init as c3dCoreInit,
  volumeLoader as c3dVolumeLoader,
  cache as c3dCache,
  eventTarget as c3dEventTarget,
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
} from '@cornerstonejs/tools';

import {
  createVOISynchronizer as c3dCreateVOISynchronizer,
} from '@cornerstonejs/tools/synchronizers';

import { 
  init as c3dPolySegInit,
  computeSurfaceData as c3dComputeSurfaceData,
} from '@cornerstonejs/polymorphic-segmentation';


import OHIF from "@ohif/core";
import { cornerstone3dUtils as c3dUtils, Cornerstone3DLabelmapBaseView } from '@ohif/extension-vtk';

const { ViewportType, Events: c3dEvents } = C3dEnums;


const SEGEDITOR_AXIAL = 'Axial';
const SEGEDITOR_CORONAL = 'Coronal';
const SEGEDITOR_SAGITTAL = 'Sagittal';
const SEGEDITOR_3D = '3D';


var SEGEDITOR_LAYOUT = {
  
  // Two column layout with visible work panels for axial, coronal, and saggital views
  // of the imaging and segmentation.
  global: {},
  borders: [],
  layout: {
    type: "row",
    weight: 100,
    children: [
      { type: "tabset", weight: 60, children: [
          { type: "tab", name: "3D", component: "placeholder", enableClose: false, enableRename: false, },
      ]},
      { type: "column", weight: 40, children: [
        { type: "tabset", weight: 33, children: [
          { type: "tab", name: "Axial", component: "seg3dview", enableClose: false, enableRename: false, },
      ]},
      { type: "tabset", weight: 34, children: [
        { type: "tab", name: "Coronal", component: "seg3dview", enableClose: false, enableRename: false, },
      ]},
      { type: "tabset", weight: 33, children: [
        { type: "tab", name: "Sagittal", component: "seg3dview", enableClose: false, enableRename: false, },
      ]},
    ]},
  ]},
};


class SegmentationEditorViewport extends Cornerstone3DLabelmapBaseView {
  // React component that can be used to edit DICOM or NIFTI segmentations. (Uses VTK.js components
  // and Cornerstone3D.)
  static id = "SegmentationEditorViewport";

  constructor(props) {
    super(props);
  }

  state = {
    tabUiInit: false,
    ...Cornerstone3DLabelmapBaseView.state,
    surfaceModelInit: false,
    surfaceModelToolsInit: false,
    surfaces: [],
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
  }
  
  static defaultProps = {
    ... _.omit(Cornerstone3DLabelmapBaseView.defaultProps, 'renderId', 'toolGroupId', 'cornerstone3dViewProps', 'orientation'),
    renderId: "sonadorSegEditor",
    toolGroupId: 'sonadorSegEditor',
    surfaceToolGroupId: 'sonadorSegEditor-Surface',
    voiSyncId: 'sonadorSegEditor',
    views2d: [SEGEDITOR_AXIAL, SEGEDITOR_CORONAL, SEGEDITOR_SAGITTAL],
    views3d: [SEGEDITOR_3D],
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
          orientation: C3dEnums.OrientationAxis.AXIAL,
        },
      },
      Coronal: {
        type: ViewportType.ORTHOGRAPHIC,
        defaultOptions: {
          orientation: C3dEnums.OrientationAxis.CORONAL,
        },
      },
      Sagittal: {
        type: ViewportType.ORTHOGRAPHIC,
        defaultOptions: {
          orientation: C3dEnums.OrientationAxis.SAGITTAL,
        },
      }
    },
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
    component.model = Model.fromJson(SEGEDITOR_LAYOUT);

    // Bind tab factory
    component.tabFactory = component.tabFactory.bind(this);
    component.onTabAction = component.onTabAction.bind(this);
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
      if (!_v3d_id && component.tabRefs[tab].current) {

        // Initialize Cornerstone 2D viewport
        if (component.cornerstone3dViewProps[tab]) {

          // Create viewport element and add to the current container
          const _el = document.createElement("div");

          // Disable the default context menu
          _el.oncontextmenu = (e) => e.preventDefault();

          // Set element styles to grow to the full size of the tab
          _el.style.width = "100%";
          _el.style.height = "100%";
          component.tabRefs[tab].current.appendChild(_el);

          // Add viewport ID and other attributes to cornerstone viewport properties
          component.cornerstone3dViewProps[tab].viewportId = component.getViewportId({ tab });
          component.cornerstone3dViewProps[tab].element = _el;

          // Trigger check of tabbed UI init
          setTimeout(component._checkTabUiInit.bind(component), eventTimeout);
        }        
      }
    }
  }

  initUi() {
    // Initialize 3D viewports
    const component = this;

    // Check to see if the rendering has been created
    if (component.renderEngine) {

      // Initialize 2D viewports
      _.keys(component.tabRefs).forEach((tab) => {
        component.init3dViewport(tab);
      });
    }

    // Check initialization of tabbed UI components
    component._checkTabUiInit();
  }

  _checkTabUiInit() {
    // Check state of tab UI init

    const component = this;
    const { eventTimeout } = this.props;

    const _init = _.every(_.values(component.cornerstone3dViewProps), (_v3d) => _.has(_v3d, 'element'));
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
        const { viewportId: _v3d_id } = component._checkViewportActive({ tab });        
        if (_v3d_id && _ref) {

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
      const { colorLUT } = labelmapRenderingOptions;
      const { labelmapInstanceUID } = paintFilterLabelMapDetails;

      if (colorLUT) {

        // Add LUT to the segmentations configuration
        component.lutIdx = c3dSegmentations.config.color.addColorLUT(colorLUT);
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
    console.log('segEditor-onTabAction');

    const component = this;
    const { isLoaded, eventTimeout } = component.props;
    const { imgViewportInit, imgRenderInit } = component.state;

    if (isLoaded && imgViewportInit && imgRenderInit) {

      // Call timeout asynchronously to ensure that viewport is visible when rendering occurs
      setTimeout(component.render3d.bind(component), eventTimeout);
    }

    return action;
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

  createTab3dView(tab) {
    // Initialize 3D view 
    const component = this;

    var _el = (
      <div ref={component.tabRefs[tab]} style={{ width: "100%", height: "100%" }} />
    );

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
      component.renderEngine.setViewports(_.values(component.cornerstone3dViewProps));
      component.setState({ imgViewportInit: true });
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
      setTimeout(component.renderEngine.render.bind(component.renderEngine), eventTimeout);      
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
      const _init = _.every(_.values(component.cornerstone3dViewProps), (_v3d) => _.has(_v3d, 'element'));
      if (_init) {

        // Set segmentation volume to viewport
        await component._activateSegmentationRepresentation();
        component._applyColorLUT();        

        // Render
        setTimeout(component.renderEngine.render.bind(component.renderEngine), eventTimeout);
        component.setState({ segRenderInit: true });
      }
    }
  }

  _registerTools() {
    // Reigster tools with Cornerstone3D
    
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
      setTimeout(component.renderEngine.render.bind(component.renderEngine), eventTimeout);
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
    if (imgTools) {
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

  async createSurfaceRender() {
    // Create a surface representation of loaded labelmaps for display in the 3D viewport.
    // This method only creates the segmentation representation. The surface must be 
    // generated using the Polymorphic segmentation background worker package
    // by calling renderSegSurfaceData.

    const component = this;
    const { paintFilterLabelMapDetails, eventTimeout } = component.props;
    const { displaySet } = component.props.viewportData;

    const { viewportId: _v3d_id, viewport: _view3d } = component._checkViewportActive({ tab: SEGEDITOR_3D });
    if (_v3d_id && paintFilterLabelMapDetails) {
      const { labelmapInstanceUID } = paintFilterLabelMapDetails;

      if (labelmapInstanceUID) {

        // Add surface representation to the 3D viewport for the segmentation. This needs to be done
        // prior to creating the surfaces via Polysegmentation.
        const _rep = component._getSegmentationRepresentation({ type: c3dToolsEnums.SegmentationRepresentations.Surface });
        await c3dSegmentations.addSegmentationRepresentations(_v3d_id, [ _rep ]);

        // Initialize surface representation of segmentation and attach it to the 3D viewport
        c3dSegmentations.config.color.setColorLUT(_v3d_id, labelmapInstanceUID, component.lutIdx);

        // Convert segmentation labelmaps to surface for display
        const seg_surfaces = await c3dComputeSurfaceData(labelmapInstanceUID, {
          viewport: _view3d,
        });

        component.triggerSegmentationUpdate();
        component.setState({ surfaceModelInit: true, surfaces: seg_surfaces });
      }
    }
  }

  async initSurfaceTools() {
    // Render surface from labelmap data in the 3D viewport. This method defers
    // to the computeSurfaceData of the Polymorphic segmentation package from Cornerstone3D.

    const component = this;
    const { paintFilterLabelMapDetails, eventTimeout } = component.props;

    const { viewportId: _v3d_id, viewport: _view3d } = component._checkViewportActive({ tab: SEGEDITOR_3D, });
    if (_v3d_id && paintFilterLabelMapDetails) {
      const { labelmapInstanceUID } = paintFilterLabelMapDetails;

      if (labelmapInstanceUID)  {

        if (!component.surfaceTools) {
          const { surfaceToolGroupId, views3d, eventTimeout } = component.props;

          // Initialize surface tool group and 3D components
          component.surfaceTools = C3dToolGroupManager.createToolGroup(surfaceToolGroupId);

          // Add tools to the group
          component.surfaceTools.addTool(C3dZoomTool.toolName);
          component.surfaceTools.addTool(C3dPanTool.toolName);
          component.surfaceTools.addTool(C3dTrackballRotateTool.toolName);

          // Add viewports to the tool group
          _.each(views3d, (tab) => {

            // Retrieve viewport to ensure it is active
            const { viewportId: _v3d_id } = component._checkViewportActive({ tab });
            if (_v3d_id) {

              // Add viewport to the tool
              console.log('Add 3D viewport to surface tools!', _v3d_id);
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
      surfaceTools.setToolPassive(C3dZoomTool.toolName);
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

        // Pan volume
        surfaceTools.setToolActive(C3dPanTool.toolName, {
          bindings: [
            { mouseButton: c3dToolsEnums.MouseBindings.Auxiliary }, // Middle mouse button press
          ]
        });

        // Zoom volume
        surfaceTools.setToolActive(C3dZoomTool.toolName, {
          bindings: [
            { mouseButton: c3dToolsEnums.MouseBindings.Secondary }, // Right mouse button press            
          ]
        });       
      }

      // Stack scroll tool
      surfaceTools.setToolActive

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
    console.log("segEditor-onInterationStart: Initialize segmentation components, windows, and UI");
  }

  async componentDidMount() {
    // Initialize poly segmentation and other supporting utilities
    const component = this;

    await c3dUtils.initCornerstone3d();
    await super.componentDidMount();    
  }

  async componentDidUpdate(prevProps, prevState) {
    // Manage lifecycle updates to the segmentation editor
    const component = this;

    const { isLoaded, eventTimeout } = component.props;
    const {
      tabUiInit, uiInit, imgViewportInit, imgRenderInit, imgToolsInit, imgSyncInit, 
      segInit, segRenderInit, surfaceModelInit, surfaceModelToolsInit
    } = component.state;

    console.log('segEditor-componentDidUpdate: ', 'tabUi='+tabUiInit, 'ui='+uiInit, 'viewport='+imgViewportInit, 
      'render='+imgRenderInit, 'tools='+imgToolsInit, 'sync='+imgSyncInit, 'seg='+segInit, 'seg-render='+segRenderInit,
      'surface='+surfaceModelInit, 'surface-tools='+surfaceModelToolsInit);

    await super.componentDidUpdate(prevProps, prevState);

    // Initialize image synchronizer
    if (isLoaded && imgToolsInit && !imgSyncInit) {
      component.initImageSync();
    }

    // Create surface version of the labelmap and add it to the segmentations
    if (isLoaded && segRenderInit && !surfaceModelInit) {
      await component.createSurfaceRender();      
    }

    // Render and display surface data
    if (isLoaded && segRenderInit && surfaceModelInit && !surfaceModelToolsInit && !component.surfaceTools) {
      await component.initSurfaceTools()
    }
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

    super.componentWillUnmount();

    // Set component state
    component.setState({ imgRenderInit: false, imgToolsInit: false });

    if (component.props.onDestroyed && _.isFunction(component.props.onDestroyed)) {
      component.props.onDestroyed();
    }

    console.log("segEditor-componentWillUnmount: Cornerstone3D cleanup complete");
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
          rootOrientationVertical={true}
        />
      </div>
    );
  }
}


export default SegmentationEditorViewport;
