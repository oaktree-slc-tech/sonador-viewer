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
  Enums as c3dToolsEnums,

  // Inspection tools
  WindowLevelTool as C3dWindowLevelTool,
  ZoomTool as C3dZoomTool,
  PanTool as C3dPanTool,
  StackScrollTool as C3dStackScrollTool,
  AngleTool as C3dAngleTool,
  CobbAngleTool as C3dCobbAngleTool,
  LengthTool as C3dLengthTool,
  ReferenceLinesTool as C3dReferenceLinesTool,
  OverlayGridTool as C3dOverlayGridTool,
  OrientationMarkerTool as C3dOrientationMarkerTool,
  ScaleOverlayTool as C3dScaleOverlayTool,
  
  // Tool management utilities
  addTool as c3dAddTool,
  ToolGroupManager as C3dToolGroupManager,

  // Annotation management
  annotation as c3dAnnotations,
  cancelActiveManipulations, 

  // Segmentations
  segmentation as c3dSegmentations,
} from '@cornerstonejs/tools';

const { selection: c3dAnnotationSelection } = c3dAnnotations;

import { OHIFModal } from '@ohif/ui';
import { Icon, ToolbarButton } from '@ohif/ui';

import {
  cacheVtkImage, 
  cacheVtkLabelmapImage,
  purgeLocalVolume,
  inspectVtkLabelmapImage,
} from '../utils/cornerstone3d.js';

import Cornerstone3DBaseView from './Cornerstone3DBaseView.js';
import Cornerstone3DLabelmapBaseView from './Cornerstone3DLabelmapBaseView.js';
import styles from './Cornerstone3DInspectionView.css';

import ViewportGridOverlayTool from './tools/ViewportGridOverlayTool.js';

const { ViewportType, Events } = c3dEnums;


class Cornerstone3DInspectionView extends Cornerstone3DLabelmapBaseView {
  // VTK viewport which renders the provided volume and allows inspection of its properties.
  // Allows access to zoon, levels, pan, length, and angle tools.

  static id = 'Cornerstone3DInspectionView';

  constructor(props) {
    super(props);

    this.boundKeyboardEvent = this.keyboardEvent.bind(this);
  }

  state = {
    ...Cornerstone3DLabelmapBaseView.state,

    // Selection tools
    stackScrollActive: false,
    zoomActive: false,
    levelsActive: true,
    panActive: false,
    lengthToolActive: false,
    angleToolActive: false,
    cobbAngleToolActive: false,

    // Display tools
    gridActive: false,
    segDisplayActive: true,
  }

  static defaultProps = {
    ..._.omit(Cornerstone3DLabelmapBaseView.defaultProps, 'renderId'),
    renderId: 'sonadorCornerstone3dInspectionViewport',
    toolGroupId: 'sonadorCornerstone3dInspectionViewport',
  }

  async loadSegImageVolume() {
    // Load segmentation data and inspect structure
    
    const component = this;
    await super.loadSegImageVolume();
  }

  async renderSegImageData() {
    // Retrieve details from the segmentation

    const component = this;
    await super.renderSegImageData();
  }

  _registerTools() {
    // Register tools with Cornerstone3D

    // Initialize interaction tool instance with Cornerstone3D
    c3dAddTool(C3dZoomTool);
    c3dAddTool(C3dWindowLevelTool);
    c3dAddTool(C3dPanTool);
    c3dAddTool(C3dStackScrollTool);
    c3dAddTool(C3dAngleTool);
    c3dAddTool(C3dLengthTool);
    c3dAddTool(C3dCobbAngleTool);

    // Add anatomical orientation and scale overlay indicators as part of the inspection "grid".
    // The grid tools are enabled/disabled as a single unit.
    c3dAddTool(C3dOrientationMarkerTool);
    c3dAddTool(C3dScaleOverlayTool);
    c3dAddTool(ViewportGridOverlayTool);
  }

  initTools() {
    // Initialize interaction tools for inspection view

    const component = this;

    if (!component.imgTools) {
      const { toolGroupId } = component.props;

      // Register tool instances with Cornerstone3D
      component._registerTools();

      // Initialize tool group and add window/zoom interaction. The interaction tools
      // are initailized and managed as a distinct "state group". If one
      // interaction tool is active, the others need to be in a "passive" state.
      component.imgTools = C3dToolGroupManager.createToolGroup(toolGroupId);

      // Add tools to the group
      component.imgTools.addTool(C3dZoomTool.toolName);
      component.imgTools.addTool(C3dWindowLevelTool.toolName);
      component.imgTools.addTool(C3dPanTool.toolName);
      component.imgTools.addTool(C3dStackScrollTool.toolName);
      component.imgTools.addTool(C3dAngleTool.toolName);
      component.imgTools.addTool(C3dLengthTool.toolName);
      component.imgTools.addTool(C3dReferenceLinesTool.toolName);
      component.imgTools.addTool(C3dOrientationMarkerTool.toolName);
      component.imgTools.addTool(C3dScaleOverlayTool.toolName);
      component.imgTools.addTool(ViewportGridOverlayTool.toolName);
      component.imgTools.addTool(C3dCobbAngleTool.toolName);

      // Add viewports to tool group
      const _v3d_id = component.getViewportId();
      const _view3d = component.renderEngine.getViewport(_v3d_id);
      if (_view3d) {

        // Add viewport to the pool
        component.imgTools.addViewport(_v3d_id);
      }

      // Activate tools
      component.activateTools('default');

      // Re-render viewports and udpate state
      component.renderEngine.render();
    }

    super.initTools();
  }

  activate3dViewports() {
    // Activate 3D viewport and keyboard bindings
    const component = this;

    super.activate3dViewports();
    const { uiInit, imgViewportInit } = this.state;

    if (uiInit && component.cornerstone3dViewProps.element) {
      component.initKeyboardBindings();
    }    
  }

  initKeyboardBindings() {
    // Initialize keyboard bindings for tools
    const component = this;

    if (component.cornerstone3dViewProps && component.cornerstone3dViewProps.element) {

      // Add event handler for key down
      component.cornerstone3dViewProps.element.addEventListener(
        c3dToolsEnums.Events.KEY_DOWN, component.boundKeyboardEvent);
    }
  }

  deactivateTools(options) {
    // Deactivate all tools in preparation of applyling new bindings

    options = options || {};
    _.defaults(options, { removeAllBindings: true });

    const component = this;
    const { toolGroupId } = component.props;

    const imgTools = C3dToolGroupManager.getToolGroup(toolGroupId);
    if (imgTools) {
      imgTools.setToolPassive(C3dStackScrollTool.toolName, options);
      imgTools.setToolPassive(C3dZoomTool.toolName, options);
      imgTools.setToolPassive(C3dWindowLevelTool.toolName, options);
      imgTools.setToolPassive(C3dPanTool.toolName, options);
      imgTools.setToolPassive(C3dAngleTool.toolName, options);
      imgTools.setToolPassive(C3dCobbAngleTool.toolName, options);
    }
  }

  activateTools(mode) {
    // Activate tool bingings

    const component = this;
    const { toolGroupId } = this.props;
    const { toolMode } = this.state;

    // Deactivate all tools before setting new mode
    component.deactivateTools();
    const imgTools = C3dToolGroupManager.getToolGroup(toolGroupId);

    // Set default mode
    if (imgTools) {

      if (!mode || (mode == 'default')) {

        // Window Level tool: left click
        imgTools.setToolActive(C3dWindowLevelTool.toolName, {
          bindings: [
            { mouseButton: c3dToolsEnums.MouseBindings.Primary }, // Left click
          ]
        });

        // Zoom: right click
        imgTools.setToolActive(C3dZoomTool.toolName, {
          bindings: [
            { mouseButton: c3dToolsEnums.MouseBindings.Secondary }, // Right click
          ]
        });

        // Pan: middle mouse button
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
      } else if (mode == 'stack-scroll') {

        // Set stack-scroll to left mouse button
        imgTools.setToolActive(C3dStackScrollTool.toolName, {
          bindings: [
            { mouseButton: c3dToolsEnums.MouseBindings.Primary }, // Left click
          ]
        });
      } else if (mode == 'zoom') {

        // Set zoom to left mouse button
        imgTools.setToolActive(C3dZoomTool.toolName, {
          bindings: [
            { mouseButton: c3dToolsEnums.MouseBindings.Primary }, // Left click
          ]
        });
      } else if (mode == 'pan') {

        // Set pan tool active
        imgTools.setToolActive(C3dPanTool.toolName, {
          bindings: [
            { mouseButton: c3dToolsEnums.MouseBindings.Primary }, // Left click
          ]
        });
      } else if (mode == 'angle-tool') {

        // Set angle tool to left mouse button
        imgTools.setToolActive(C3dAngleTool.toolName, {
          bindings: [
            { mouseButton: c3dToolsEnums.MouseBindings.Primary }, // Left click
          ]
        });
      } else if (mode == 'length-tool') {

        // Set length tool to left mouse button
        imgTools.setToolActive(C3dLengthTool.toolName, {
          bindings: [
            { mouseButton: c3dToolsEnums.MouseBindings.Primary }, // Left click
          ]
        });
      } else if (mode == 'cobb-angle-tool') {

        // Set Cobb Angle Tool to left mouse button
        imgTools.setToolActive(C3dCobbAngleTool.toolName, {
          bindings: [
            { mouseButton: c3dToolsEnums.MouseBindings.Primary }, // Left click
          ]
        })
      }

      // Update the state if tool mode is different than current mode
      if (mode && (mode != toolMode)) {

        // Set current tool mode and re-render viewport    
        component.setState({ toolMode: mode });
        component.render3d();
      }
    }
  }

  selectionToolState(options) {
    // Set state flags for viewport selection tools: stack scroll, zoom, levels, pan,
    // length tool, angle tool, and cobb angle tool. Only a single selection tool
    // can be active at a time.
    
    options = options || {};
    _.defaults(options, {
      stackScrollActive: false, 
      zoomActive: false, 
      levelsActive: false, 
      panActive: false,
      lengthToolActive: false, 
      angleToolActive: false,
      cobbAngleToolActive: false,
    });

    this.setState(options);
  }

  activateStackScroll() {
    // Activate the stack scroll tool

    const component = this;
    component.selectionToolState({ stackScrollActive: true });
    component.activateTools('stack-scroll');
  }

  activateZoomTool() {
    // Activate left click mouse zoom

    const component = this;
    component.selectionToolState({ zoomActive: true });
    component.activateTools('zoom');
  }

  activateLevelTool() {
    // Activate window leveling tool

    const component = this;
    component.selectionToolState({ levelsActive: true });
    component.activateTools('default');
  }

  activatePanTool() {
    // Activate pan tool

    const component = this;
    component.selectionToolState({ panActive: true });
    component.activateTools('pan');
  }

  activateLengthTool() {
    // Activate length tool
    
    const component = this;
    component.selectionToolState({ lengthToolActive: true });
    component.activateTools('length-tool');
  }

  activateAngleTool() {
    // Activate angle tool

    const component = this;
    component.selectionToolState({ angleToolActive: true });
    component.activateTools('angle-tool');
  }

  activateCobbAngleTool() {
    // Activate Cobb angle tool

    const component = this;
    component.selectionToolState({ cobbAngleToolActive: true });
    component.activateTools('cobb-angle-tool');
  }

  toggleGrid() {
    // Toggle the state of the overlay grid
    
    const component = this;
    const { gridActive } = component.state;
    const { toolGroupId } = component.props;

    const imgTools = C3dToolGroupManager.getToolGroup(toolGroupId);
    if (imgTools) {

      // Toggle state of the grid
      if (imgTools && gridActive) {
        imgTools.setToolDisabled(C3dOrientationMarkerTool.toolName);
        imgTools.setToolDisabled(C3dScaleOverlayTool.toolName)
        imgTools.setToolDisabled(ViewportGridOverlayTool.toolName);
      } else {

        imgTools.setToolEnabled(C3dOrientationMarkerTool.toolName);
        imgTools.setToolEnabled(C3dScaleOverlayTool.toolName);
        imgTools.setToolEnabled(ViewportGridOverlayTool.toolName);
      }

      // Toggle state of the grid
      component.setState({
        gridActive: !gridActive,
      });
    }
  }

  toggleSegDisplay() {
    // Toggle the display state of the segmentations

    const component = this;
    const { paintFilterLabelMapDetails } = component.props;
    const { segDisplayActive } = component.state;    
    
    if (paintFilterLabelMapDetails.labelmapInstanceUID) {

      const _v3d_id = component.getViewportId();
      const _view3d = component.renderEngine.getViewport(_v3d_id);

      if (_view3d) {

        // Toggle segmentation layers off        
        if (component.labelmapDetails && component.labelmapDetails.uniqueLabels) {
          _.each(component.labelmapDetails.uniqueLabels, (i) => {
            
            // Toggle state of the segmentations via index
            c3dSegmentations.config.visibility.setSegmentIndexVisibility(
              _v3d_id, { segmentationId: paintFilterLabelMapDetails.labelmapInstanceUID }, i, !segDisplayActive);
          });
        }
        
        component.setState({
          segDisplayActive: !segDisplayActive,
        });
      }
    }
  }

  keyboardEvent(evt) {
    // Dispatch annotation events in response to keyboard events
    
    const component = this;
    const { element, key } = evt.detail;

    if (key == 'Escape') {

      // Cancel an active draw operation and remove the annotation
      const annotationUid = cancelActiveManipulations(element);
      c3dAnnotations.state.removeAnnotation(annotationUid);

    } else if (key == 'Delete') {

      // Remove selected annotations
      _.each(c3dAnnotationSelection.getAnnotationsSelected(), (a) => {
        c3dAnnotations.state.removeAnnotation(a);
        component.render3d();
      });
    }
  }

  async componentDidMount() {
    // Load segmentation data
    
    const component = this;
    await super.componentDidMount();
  }

  async componentDidUpdate() {
    // Mnage lifecylce of the view

    const component = this;
    super.componentDidUpdate();
  }

  componentWillUnmount() {
    // Deactivate tool bindings
    
    const component = this;
    const { toolGroupId } = component.props;

    if (component.imgTools) {

      // Remove viewport from tools
      component.imgTools.removeViewports(component.getViewportId());
      C3dToolGroupManager.destroyToolGroup(toolGroupId);
    }
    
    if (component.cornerstone3dViewProps && component.cornerstone3dViewProps.element) {

      // Remove keyboard event handlers
      component.cornerstone3dViewProps.element.removeEventListener(
        c3dToolsEnums.Events.KEY_DOWN, container.boundKeyboardEvent);
    }

    super.componentWillUnmount();
  }

  render() {
    // Render 3D inspection view with toolbars
    const component = this;
    const { paintFilterLabelMapDetails } = component.props;
    const { stackScrollActive, zoomActive, levelsActive, panActive, lengthToolActive, 
      angleToolActive, cobbAngleToolActive, gridActive, segDisplayActive } = component.state;

    return (
      <div className="root"><div className="modalContent" >
        <div className="modal-toolbar">
          <ToolbarButton label="Stack Scroll" icon="bars" 
            isActive={stackScrollActive} onClick={component.activateStackScroll.bind(component)}
          />
          <ToolbarButton label="Zoom" icon="search-plus"
            isActive={zoomActive} onClick={component.activateZoomTool.bind(component)}
          />
          <ToolbarButton label="Levels" icon="level"
            isActive={levelsActive} onClick={component.activateLevelTool.bind(component)}
          />
          <ToolbarButton label="Pan" icon="arrows"
            isActive={panActive} onClick={component.activatePanTool.bind(component)}
          />
          <ToolbarButton label="Length" icon="measure-temp"
            isActive={lengthToolActive} onClick={component.activateLengthTool.bind(component)}
          />
          <ToolbarButton label="Angle" icon="angle-left"
            isActive={angleToolActive} onClick={component.activateAngleTool.bind(component)}
          />
          <ToolbarButton label="Cobb Angle" icon="cobb-angle"
            isActive={cobbAngleToolActive} onClick={component.activateCobbAngleTool.bind(component)}
          />
          <ToolbarButton icon="grid-multi" label='Grid'
            isActive={gridActive} onClick={component.toggleGrid.bind(component)}
          />
          {paintFilterLabelMapDetails && (
            <ToolbarButton icon='cube' iconWhenActive='cube-3d-solid' label='Segmentations'
              isActive={segDisplayActive} onClick={component.toggleSegDisplay.bind(component)}
            />
          )}
        </div>
        <div className="viewportWrapper" >
          <div className="viewportElement" ref={component.container} 
            onClick={() => component.container.current?.focus()} />
        </div>
      </div></div>
    );
  }
}


Cornerstone3DInspectionView.propTypes = {
  ...Cornerstone3DLabelmapBaseView.propTypes,
  toolGroupId: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  servicesManager: PropTypes.object.isRequired,
};


export default Cornerstone3DInspectionView;
