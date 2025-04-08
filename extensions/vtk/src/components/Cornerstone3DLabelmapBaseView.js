import _ from 'lodash';

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

import Cornerstone3DBaseView from './Cornerstone3DBaseView.js';

import {
  cacheVtkImage, 
  cacheVtkLabelmapImage,
  purgeLocalVolume,
  inspectVtkLabelmapImage,
} from '../utils/cornerstone3d.js';



class Cornerstone3DLabelmapBaseView extends Cornerstone3DBaseView {
	// VTK viewport which provides tools to load and render segmentation data.
	// Extends the workflow provided by Cornerstone3DBaseView with further methods, 
	// state properties, and event handlers needed to manage the workflow and cleanup.

	static id = 'Cornerstone3DLabelmapBaseView';

	state = {
    ...Cornerstone3DBaseView.state,

    // Segmentation loading state
    segInit: false,
    segRenderInit: false,
  }

  static defaultProps = {
  	..._.omit(Cornerstone3DBaseView.defaultProps, 'renderId'),
    renderId: 'sonadorCornerstone3dLabelmapBaseViewport',
  }

  async loadSegImageVolume() {
    // Load image volume and segmentation data

    const component = this;

    const { 
      paintFilterBackgroundImageData, 
      paintFilterLabelMapImageData, paintFilterLabelMapDetails, 
      labelmapRenderingOptions
    } = component.props;

    if (paintFilterLabelMapImageData) {

      // Retrieve display set and segmentation UIDs
      const { displaySet } = component.props.viewportData;
      const { labelmapInstanceUID } = paintFilterLabelMapDetails;
      const { colorLUT, segmentsDefaultProperties } = labelmapRenderingOptions;

      // Create segmentation volume
      let segVol = c3dCache.getVolume(labelmapInstanceUID);
      if (!segVol) {

        // Initialize and cache labelmap image from VTK data
        segVol = await cacheVtkLabelmapImage(
          displaySet.displaySetInstanceUID, labelmapInstanceUID, paintFilterLabelMapImageData);
      }

      // Inspect labelmap data to ensure that the segments will be populated correctly
      component.labelmapDetails = inspectVtkLabelmapImage(paintFilterLabelMapImageData);

      // Add segmentation to display state
      let segments;
      if (component.labelmapDetails && component.labelmapDetails.uniqueLabels) {

        // Create segments object from unique labels
        segments = _.reduce(component.labelmapDetails.uniqueLabels, (acc, i) => {
          acc[i] = { segmentIndex: i, label: `Segment ${i}`, isVisible: true, active: true };
          return acc;
        }, {});
      }
      
      // Create representation structure
      const _rep = {
        type: c3dToolsEnums.SegmentationRepresentations.Labelmap, 
        data: {
          volumeId: labelmapInstanceUID, 
          referenceVolumeId: displaySet.displaySetInstanceUID,
        },
      }

      // Create config structure
      const _config = {}
      if (segments) {
        _config['segments'] = segments;
      }

      await c3dSegmentations.state.addSegmentations([
        {  segmentationId: labelmapInstanceUID, representation: _rep, config: _config }
      ]);

      component.setState({ segInit: true });
    }
  }

  async _activateSegmentationRepresentation() {
    // Activate the segmentation representation

    const component = this;
    const { paintFilterLabelMapImageData, paintFilterLabelMapDetails } = component.props;
    const { uiInit } = component.state;

    if (uiInit && paintFilterLabelMapImageData) {

      // Retrieve viewport instance
      const { viewportId: _v3d_id } = component._checkViewportActive();
      const _rep = component._getSegmentationRepresentation();

      if (_v3d_id && _rep) {

        // Set segmentation volume to viewport
        await c3dSegmentations.addSegmentationRepresentations(_v3d_id, [_rep]);
      }
    }
  }

  _applyColorLUT() {
    // Apply the color lookup table (LUT) for the labelmap

    const component = this;

    const { paintFilterLabelMapImageData, paintFilterLabelMapDetails, labelmapRenderingOptions } = component.props;
    const { uiInit, imgRenderInit } = component.state;

    if (uiInit && paintFilterLabelMapImageData) {
      const { viewportId: _v3d_id } = component._checkViewportActive();
      const { colorLUT } = labelmapRenderingOptions;
      const { labelmapInstanceUID } = paintFilterLabelMapDetails;

      if (_v3d_id && colorLUT && labelmapInstanceUID) {

        // Add color LUT to Cornerstone
        component.lutIdx = c3dSegmentations.config.color.addColorLUT(colorLUT);
        c3dSegmentations.config.color.setColorLUT(_v3d_id, labelmapInstanceUID, component.lutIdx);
      }
    }
  }

  _clearColorLUT() {
    // Remove the color lookup table (LUT) for the labelmap. Called during cleanup.

    const component = this;

    // Unset the colorLUT (if defined)
    if (component.lutIdx) {
      c3dSegmentations.state.removeColorLUT(component.lutIdx);
    }
  }

  _getSegmentationRepresentation(options) {
    // Retrieve the segmentation representation for the view labelmap.
    //
    //  @returns If a labelmap for the viewport is defined, it will retrieve the type and UID.
    //    If no labelmap is provided, or there aren't any details associated with it
    //    an empty object is returned.
    options = options || {};
    _.defaults(options, {
      type: c3dToolsEnums.SegmentationRepresentations.Labelmap
    });

    const component = this;

    const { paintFilterLabelMapDetails } = component.props;
    if (paintFilterLabelMapDetails) {
      const { labelmapInstanceUID } = paintFilterLabelMapDetails;

      // Add labelmap instance UID to the options for the segmentation ID
      _.defaults(options, { segmentationId: labelmapInstanceUID });

      if (labelmapInstanceUID) {
        return _.pick(options, 'segmentationId', 'type');
      }
    }

    return {};
  }

  async renderSegImageData() {
    // Render labelmap

    const component = this;

    const { paintFilterLabelMapImageData } = component.props;
    const { uiInit, imgRenderInit, segInit } = component.state;

    if (uiInit && imgRenderInit && segInit && paintFilterLabelMapImageData) {

      // Retrieve viewport instance
      const { viewportId: _v3d_id } = component._checkViewportActive();
      if (_v3d_id) {

        // Set segmentation volume to viewport
        await component._activateSegmentationRepresentation();
        component._applyColorLUT();

        // Render
        component.renderEngine.render();
        component.setState({ segRenderInit: true });
      }
    }
  }

  triggerSegmentationUpdate() {
    const { paintFilterLabelMapDetails } = this.props;

    if (paintFilterLabelMapDetails) {
      const { labelmapInstanceUID } = paintFilterLabelMapDetails;

      if (labelmapInstanceUID) {
        c3dSegmentations.triggerSegmentationEvents.triggerSegmentationDataModified(labelmapInstanceUID);
      }
    }
  }

  async componentDidUpdate() {
    // Mnage lifecylce of the view

    const component = this;
    await super.componentDidUpdate();
    
    const { isLoaded, eventTimeout, paintFilterLabelMapDetails } = this.props;
    const { imgRenderInit, segInit, segRenderInit } = this.state;

    // Load and render segmentations
    if (paintFilterLabelMapDetails) {
      const { labelmapInstanceUID } = paintFilterLabelMapDetails;

      if (labelmapInstanceUID) {
        const segVol = c3dCache.getVolume(labelmapInstanceUID);

        // Load segmentation data
        if (isLoaded && imgRenderInit && !segInit && !segVol) {
          await component.loadSegImageVolume();
        }

        // Render segmentation data to viewport
        if (isLoaded && segInit && segVol && !segRenderInit) {
          await component.renderSegImageData();
        }

        // Trigger segmentation updated events
        if (isLoaded && segInit && segVol && segRenderInit) {
          component.triggerSegmentationUpdate();
        }
      }
    }
  }

  componentWillUnmount() { 
    const component = this;

    super.componentWillUnmount();
    component._clearColorLUT();
  }
}


Cornerstone3DLabelmapBaseView.propTypes = {
	...Cornerstone3DBaseView.propTypes,
	paintFilterBackgroundImageData: PropTypes.object,
  paintFilterLabelMapImageData: PropTypes.object,
  paintFilterLabelMapDetails: PropTypes.object,
  labelmapRenderingOptions: PropTypes.object,
}


export default Cornerstone3DLabelmapBaseView;