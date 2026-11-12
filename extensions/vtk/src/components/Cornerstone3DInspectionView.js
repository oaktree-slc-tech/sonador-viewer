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
  CircleROITool as C3dCircleROITool,
  LengthTool as C3dLengthTool,
  ArrowAnnotateTool as C3dArrowAnnotateTool,
  BidirectionalTool as C3dBidirectionalTool,
  EllipticalROITool as C3dEllipticalROITool,
  RectangleROITool as C3dRectangleROITool,
  PlanarFreehandROITool as C3dPlanarFreehandROITool,
  ProbeTool as C3dProbeTool,
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

import OHIF from '@ohif/core';
import { OHIFModal } from '@ohif/ui';
import { Icon, ToolbarButton } from '@ohif/ui';

import {
  getVolumeIdForDisplaySet,
  inspectVtkLabelmapImage,
} from '../utils/cornerstone3d.js';

import vtkEnums from '../enums';
import Cornerstone3DLabelmapBaseView from './Cornerstone3DLabelmapBaseView.js';
import styles from './Cornerstone3DInspectionView.css';

import ViewportGridOverlayTool from './tools/ViewportGridOverlayTool.js';
import { addSRDisplayToolToGroup } from './tools/DICOMSRDisplayTool';
import { applyCameraPlacement, snapToNearestSlice } from '../utils/inspectionCamera';
import { isDecimatedVolumeId } from '../utils/cornerstone3d';

const { ViewportType, Events } = c3dEnums;
const { DisplaySetApi } = OHIF.display;

// Measurement tools of the 2D toolbar whose measurements stay in the session's 3D views: they
// have no DICOM-SR mapping here, so they are marked unsaved and announced as not saved
// (measurementAnnotationSync). Tool, mode, state flag, toolbar label and icon.
const SESSION_TOOLS = [
  { tool: C3dBidirectionalTool, mode: 'bidirectional-tool', stateKey: 'bidirectionalToolActive', label: 'Bidirectional', icon: 'measure-target' },
  { tool: C3dEllipticalROITool, mode: 'ellipse-tool', stateKey: 'ellipseToolActive', label: 'Ellipse', icon: 'circle-o' },
  { tool: C3dRectangleROITool, mode: 'rectangle-tool', stateKey: 'rectangleToolActive', label: 'Rectangle', icon: 'square-o' },
  { tool: C3dPlanarFreehandROITool, mode: 'freehand-tool', stateKey: 'freehandToolActive', label: 'Freehand', icon: 'inline-edit' },
  { tool: C3dProbeTool, mode: 'probe-tool', stateKey: 'probeToolActive', label: 'Probe', icon: 'dot-circle' },
];
const SESSION_TOOL_STATE = _.fromPairs(SESSION_TOOLS.map(({ stateKey }) => [stateKey, false]));


class Cornerstone3DInspectionView extends Cornerstone3DLabelmapBaseView {
  // VTK viewport which renders the provided volume and allows inspection of its properties.
  // Allows access to zoom, levels, pan, and the length, angle, Cobb angle, circle and arrow
  // annotation tools. Measurements drawn on an acquired image are saved like those drawn in 2D (the
  // cornerstone extension's measurementAnnotationSync). The bidirectional, ellipse, rectangle,
  // freehand and probe tools measure in this session's 3D views; those measurements are not saved.

  static id = 'Cornerstone3DInspectionView';

  static propTypes = {
    ...Cornerstone3DLabelmapBaseView.propTypes,
    // The camera of the MPR pane the Inspector opens from (utils/inspectionCamera.js): the view
    // opens on that pane's plane and slice, with the image fitted to the view
    initialCamera: PropTypes.object,
  }

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
    circleToolActive: false,
    arrowToolActive: false,
    ...SESSION_TOOL_STATE,

    // Display tools
    gridActive: false,
    segDisplayActive: true,
  }

  static defaultProps = {
    ..._.omit(Cornerstone3DLabelmapBaseView.defaultProps, 'renderId'),
    renderId: 'sonadorCornerstone3dInspectionViewport',
    toolGroupId: 'sonadorCornerstone3dInspectionViewport',
    removeAllSegRepresentations: false,
  }

  _volumeIdOptions() {
    // The inspection modal renders in its own rendering engine, and therefore its own WebGL
    // context, so it needs its own volume: a Cornerstone3D volume owns one vtkOpenGLTexture and
    // that texture can only be bound to one render window at a time. Sharing the MPR panes' volume
    // made the modal draw black (the texture was rebound to the modal's context) and then, once the
    // modal's engine was destroyed, left the panes rendering through a dead render window --
    // `model._textureResourceIds is undefined` on the next MPR render.
    //
    // This is a deliberate departure from ohif-viewers#134 FR-1, which asks for one volume shared
    // across every viewport AND rendering engine: the second half is not achievable at the pinned
    // Cornerstone3D/vtk.js versions. It is cheap, though -- the streaming volume holds no CPU
    // scalar array and the decoded slices stay shared in the image cache, so the cost is one more
    // GPU texture rather than a second copy of the series.
    return { view: 'inspection' };
  }

  _getSegImageVolumeId(options) {
    // The labelmap derives from this view's own image volume, so it needs its own id too.
    options = options || {};
    _.defaults(options, { suffix: '::inspection' });

    const segVolumeId = super._getSegImageVolumeId();
    return segVolumeId ? segVolumeId + options.suffix : segVolumeId;
  }

  async _setImageVolume(options) {
    // Set the image volume, then open on the MPR pane's plane and slice (setVolumes resets the
    // camera), with the image fitted to the view at its full size. A view parallel to the
    // acquisition opens on the nearest acquired slice.
    const component = this;
    await super._setImageVolume(options);

    const { initialCamera, imageIds } = component.props;
    const { viewport } = component._checkViewportActive(options);
    if (initialCamera) {
      if (component.renderEngine && typeof component.renderEngine.resize === 'function') {
        component.renderEngine.resize(true, true);
      }
      applyCameraPlacement(viewport, initialCamera);
    }
    if (snapToNearestSlice(viewport, imageIds) && typeof viewport.render === 'function') {
      viewport.render();
    }
    component._registerDrawingVolume();
  }

  _registerDrawingVolume() {
    // Drawings made here on any plane become out-of-plane measurements of this series (not when the
    // volume is at reduced resolution); see DICOMSR utils/outOfPlane.js
    const component = this;
    if (component._unregisterDrawingVolume) {
      component._unregisterDrawingVolume();
    }
    const volumeId = component._getImageVolumeId();
    const { displaySet } = component.props.viewportData || {};
    const volume = component._volume || c3dCache.getVolume(volumeId);
    component._unregisterDrawingVolume = OHIF.DICOMSR.outOfPlane.registerDrawingVolume(volumeId, {
      StudyInstanceUID: displaySet && displaySet.StudyInstanceUID,
      SeriesInstanceUID: displaySet && displaySet.SeriesInstanceUID,
      FrameOfReferenceUID: volume && volume.metadata && volume.metadata.FrameOfReferenceUID,
      reducedResolution: isDecimatedVolumeId(volumeId),
    });
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
    c3dAddTool(C3dCircleROITool);
    c3dAddTool(C3dArrowAnnotateTool);
    SESSION_TOOLS.forEach(({ tool }) => c3dAddTool(tool));

    // Add anatomical orientation and scale overlay indicators as part of the inspection "grid".
    // The grid tools are enabled/disabled as a single unit.
    c3dAddTool(C3dReferenceLinesTool);
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
      component.imgTools.addTool(C3dCircleROITool.toolName);
      component.imgTools.addTool(C3dArrowAnnotateTool.toolName);
      SESSION_TOOLS.forEach(({ tool }) => component.imgTools.addTool(tool.toolName));

      // Add viewports to tool group
      const _v3d_id = component.getViewportId();
      const _view3d = component.renderEngine.getViewport(_v3d_id);
      if (_view3d) {

        // Add viewport to the pool
        component.imgTools.addViewport(_v3d_id);
      }

      // Activate tools
      component.activateTools('default');

      // Read-only DICOM-SR measurements
      addSRDisplayToolToGroup(component.imgTools);

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
      imgTools.setToolPassive(C3dLengthTool.toolName, options);
      imgTools.setToolPassive(C3dAngleTool.toolName, options);
      imgTools.setToolPassive(C3dCobbAngleTool.toolName, options);
      imgTools.setToolPassive(C3dCircleROITool.toolName, options);
      imgTools.setToolPassive(C3dArrowAnnotateTool.toolName, options);
      SESSION_TOOLS.forEach(({ tool }) => imgTools.setToolPassive(tool.toolName, options));
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
      } else if (mode == 'circle-tool') {

        // Set Circle Tool to left mouse button
        imgTools.setToolActive(C3dCircleROITool.toolName, {
          bindings: [
            { mouseButton: c3dToolsEnums.MouseBindings.Primary }, // Left click
          ]
        })
      } else if (mode == 'arrow-tool') {

        // Set Arrow Annotate Tool to left mouse button
        imgTools.setToolActive(C3dArrowAnnotateTool.toolName, {
          bindings: [
            { mouseButton: c3dToolsEnums.MouseBindings.Primary }, // Left click
          ]
        });
      } else {
        const sessionTool = SESSION_TOOLS.find(entry => entry.mode == mode);
        if (sessionTool) {

          // Set the measurement tool to left mouse button
          imgTools.setToolActive(sessionTool.tool.toolName, {
            bindings: [
              { mouseButton: c3dToolsEnums.MouseBindings.Primary }, // Left click
            ]
          });
        }
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
      circleToolActive: false,
      arrowToolActive: false,
      ...SESSION_TOOL_STATE,
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

  activateCircleTool() {
    // Activate circle tool

    const component = this;
    component.selectionToolState({ circleToolActive: true });
    component.activateTools('circle-tool');
  }

  activateArrowTool() {
    // Activate arrow annotation tool

    const component = this;
    component.selectionToolState({ arrowToolActive: true });
    component.activateTools('arrow-tool');
  }

  activateSessionTool(mode) {
    // Activate a measurement tool whose measurements stay in this session's 3D views

    const component = this;
    const sessionTool = SESSION_TOOLS.find(entry => entry.mode == mode);
    if (sessionTool) {
      component.selectionToolState({ [sessionTool.stateKey]: true });
      component.activateTools(mode);
    }
  }

  toggleGrid() {
    // Toggle the state of the overlay grid
    
    const component = this;
    const { gridActive } = component.state;
    const { toolGroupId } = component.props;

    const _active = !gridActive;

    const imgTools = C3dToolGroupManager.getToolGroup(toolGroupId);
    if (imgTools) {

      // Toggle state of the grid
      if (imgTools && !_active) {
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
        gridActive: _active,
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
        const { segMeta } = component._segMeta();

        // Toggle segmentation layers off        
        if (segMeta && segMeta.segments) {
          _.each(_.values(segMeta.segments), (s) => {
            
            // Toggle state of the segmentations via index
            c3dSegmentations.config.visibility.setSegmentIndexVisibility(
              _v3d_id, _.pick(segMeta, 'segmentationId'), s.segmentIndex, !segDisplayActive);
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

  async componentDidUpdate(prevProps, prevState) {
    // Manage lifecycle of the view

    const component = this;
    await super.componentDidUpdate(prevProps, prevState);

    const { isLoaded } = component.props;
    const { imgRenderInit, segInit, segRenderInit, segRepUpdatePaused } = component.state;

    console.log(`[Cornerstone3DInspectionView:componentDidUpdate] segInit=${segInit} segRenderInit=${segRenderInit}`);
  }

  componentWillUnmount() {
    // Deactivate tool bindings
    
    const component = this;
    const { toolGroupId, eventTimeout } = component.props;
    const { displaySet } = component.props.viewportData;

    if (component.imgTools) {

      // Remove viewport from tools
      component.imgTools.removeViewports(component.getViewportId());
      C3dToolGroupManager.destroyToolGroup(toolGroupId);
    }
    
    if (component.cornerstone3dViewProps && component.cornerstone3dViewProps.element) {

      // Remove keyboard event handlers
      component.cornerstone3dViewProps.element.removeEventListener(
        c3dToolsEnums.Events.KEY_DOWN, component.boundKeyboardEvent);
    }

    if (component._unregisterDrawingVolume) {
      component._unregisterDrawingVolume();
      component._unregisterDrawingVolume = null;
    }

    super.componentWillUnmount();
  }

  render() {
    // Render 3D inspection view with toolbars
    const component = this;
    const { paintFilterLabelMapDetails } = component.props;
    const { stackScrollActive, zoomActive, levelsActive, panActive, lengthToolActive, 
      angleToolActive, cobbAngleToolActive, circleToolActive, arrowToolActive, gridActive, segDisplayActive } = component.state;

    return (
      <div className="inspectionViewRoot"><div className="inspectionViewModalContent" >
        <div className="inspectionViewModalToolbar">
          <ToolbarButton isToggle label="Stack Scroll" icon="bars" 
            isActive={stackScrollActive} onClick={component.activateStackScroll.bind(component)}
          />
          <ToolbarButton isToggle label="Zoom" icon="search-plus"
            isActive={zoomActive} onClick={component.activateZoomTool.bind(component)}
          />
          <ToolbarButton isToggle label="Levels" icon="level"
            isActive={levelsActive} onClick={component.activateLevelTool.bind(component)}
          />
          <ToolbarButton isToggle label="Pan" icon="arrows"
            isActive={panActive} onClick={component.activatePanTool.bind(component)}
          />
          <ToolbarButton isToggle label="Length" icon="measure-temp"
            isActive={lengthToolActive} onClick={component.activateLengthTool.bind(component)}
          />
          <ToolbarButton isToggle label="Angle" icon="angle-left"
            isActive={angleToolActive} onClick={component.activateAngleTool.bind(component)}
          />
          <ToolbarButton isToggle label="Cobb Angle" icon="cobb-angle"
            isActive={cobbAngleToolActive} onClick={component.activateCobbAngleTool.bind(component)}
          />
          <ToolbarButton isToggle label="Circle" icon="circle-radius"
            isActive={circleToolActive} onClick={component.activateCircleTool.bind(component)}
          />
          <ToolbarButton isToggle label="Annotate" icon="measure-non-target"
            isActive={arrowToolActive} onClick={component.activateArrowTool.bind(component)}
          />
          {SESSION_TOOLS.map(({ mode, stateKey, label, icon }) => (
            <ToolbarButton isToggle key={mode} label={label} icon={icon}
              isActive={component.state[stateKey]} onClick={() => component.activateSessionTool(mode)}
            />
          ))}
          <ToolbarButton isToggle icon="grid-multi" label='Grid'
            isActive={gridActive} onClick={component.toggleGrid.bind(component)}
          />
          {paintFilterLabelMapDetails && (
            <ToolbarButton isToggle icon='cube' iconWhenActive='cube-3d-solid' label='Segmentations'
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
