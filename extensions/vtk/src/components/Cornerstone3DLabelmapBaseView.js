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
    segRepUpdatePaused: false,
  }

  static defaultProps = {
  	..._.omit(Cornerstone3DBaseView.defaultProps, 'renderId'),
    renderId: 'sonadorCornerstone3dLabelmapBaseViewport',
    segVolumeCleanup: true,
    removeAllSegRepresentations: true,
  }

  _getSegImageVolumeId() {
    // Retrieve the segmentation volumeId to be used by the view
    const component = this;

    const { paintFilterLabelMapDetails } = component.props;
    const { labelmapInstanceUID  } = paintFilterLabelMapDetails;

    return labelmapInstanceUID;
  }

  _segVol(options) {
    // Retrieve segmentation volume and identifiers.

    // @input options
    //  - volumeId: the volumeId to retrieve. If no volume specified, the labelmapInstanceUID
    //    provided in paintFilterBackgroundImageData will be used.

    // @returns volumeId and segmentation labelmap volume

    options = options || {};
    const component = this;

    if (!options.volumeId) {

      // By default, use labelmapInstanceUID.
      const { paintFilterLabelMapDetails } = component.props;
      const { labelmapInstanceUID, metadata: labelmapMetadata } = paintFilterLabelMapDetails;  
      
      if (labelmapInstanceUID) {
        _.defaults(options, { volumeId: component._getSegImageVolumeId(), metadata: labelmapMetadata });
      }
    }
    
    return _.extend(_.pick(options, 'volumeId', 'metadata'), {
      segVol: options.volumeId ? c3dCache.getVolume(options.volumeId) : undefined,
    });
  }

  _segMeta(options) {
    // Retrieve metadata for the specified volumeId
    const component = this;

    // Retrieve segmentation metadata from Cornerstone3D
    const { volumeId: labelmapInstanceUID, metadata: labelmapMetadata } = component._segVol(options);
    const _segMeta = c3dSegmentations.state.getSegmentation(labelmapInstanceUID);

    let labelmapDetails;
    if (!_segMeta) {

      // Parse labelmapDetails from paintFilterLabelMapDetails and combine with labelmap metadata
      const { paintFilterLabelMapImageData } = component.props;
      labelmapDetails = paintFilterLabelMapImageData ? inspectVtkLabelmapImage(paintFilterLabelMapImageData) : undefined;
    }

    return {
      volumeId: labelmapInstanceUID, segMeta: _segMeta, labelmapDetails, labelmapMetadata,
    }
  }

  async loadSegImageVolume(options) {
    // Load image volume and segmentation data

    // @input options
    //  - volumeId: the volumeId for which the metadata should be retrieved

    options = options || {};
    _.defaults(options, { setState: true });

    const component = this;
    const { paintFilterLabelMapImageData, labelmapRenderingOptions, onLabelmapImageLoad } = component.props;

    if (paintFilterLabelMapImageData) {

      // Retrieve display set and segmentation UIDs
      const { displaySet } = component.props.viewportData;
      const { colorLUT, segmentsDefaultProperties } = labelmapRenderingOptions;

      // Create segmentation volume
      let { volumeId: labelmapInstanceUID, segVol } = component._segVol();
      if (!segVol) {

        // Initialize and cache labelmap image from VTK data
        segVol = await cacheVtkLabelmapImage(component._getImageVolumeId(), labelmapInstanceUID, paintFilterLabelMapImageData);
      }

      // Inspect labelmap data to ensure that the segments will be populated correctly
      const { labelmapDetails, labelmapMetadata } = component._segMeta();

      // Add segmentation to display state
      let segments;
      if (labelmapDetails && labelmapDetails.uniqueLabels) {

        // Create segments object from unique labels
        segments = _.reduce(labelmapDetails.uniqueLabels, (acc, i) => {

          // Parse segment label from labelmapMetadata (if available)
          let segmentLabel;
          if (labelmapMetadata && labelmapMetadata.data && labelmapMetadata.data.length == labelmapDetails.uniqueLabels.length) {            
            segmentLabel = (_.find(labelmapMetadata.data, (s) => s.SegmentNumber == i) || {}).SegmentLabel;
          }

          acc[i] = { segmentIndex: i, label: segmentLabel || `Segment ${i}`, isVisible: true, active: true };
          return acc;
        }, {});
      }      
      
      // Create representation structure
      const _rep = {
        type: c3dToolsEnums.SegmentationRepresentations.Labelmap,
        data: {
          volumeId: labelmapInstanceUID, 
          referenceVolumeId: component._getImageVolumeId(),
        },
      }

      // Create config structure
      const _config = { label: labelmapMetadata?.SeriesDescription ? labelmapMetadata.SeriesDescription : undefined, }
      if (segments) {
        _config['segments'] = segments;
      }

      const _seg = {
        segmentationId: labelmapInstanceUID,
        representation: _rep,
        config: _config,
      }      

      await c3dSegmentations.state.addSegmentations([_seg]);

      // Set state flags to trigger next step in loading workflow
      if (options.setState) {
        component.setState({ segInit: true });
      }

      if (_.isFunction(onLabelmapImageLoad)) {
        onLabelmapImageLoad({
          volumeId: labelmapInstanceUID, segmentationId: labelmapInstanceUID, meta: labelmapMetadata, vol: segVol,
        });
      }
    }
  }

  async _activateSegmentationRepresentation() {
    // Activate the segmentation representation

    const component = this;
    const { paintFilterLabelMapImageData, paintFilterLabelMapDetails } = component.props;

    if (paintFilterLabelMapImageData) {

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

    const { paintFilterLabelMapImageData, labelmapRenderingOptions } = component.props;
    const { uiInit, imgRenderInit } = component.state;

    if (uiInit && paintFilterLabelMapImageData) {
      const { viewportId: _v3d_id } = component._checkViewportActive();
      const { colorLUT } = labelmapRenderingOptions;
      const { volumeId: labelmapInstanceUID } = component._segVol();

      if (_v3d_id && colorLUT && labelmapInstanceUID) {

        // Create a cloned copy of the lookup table to prevent changes from 
        // corrupting the source data.
        const _lut = _.cloneDeep(colorLUT);

        // Add color LUT to Cornerstone
        component.lutIdx = c3dSegmentations.config.color.addColorLUT(_lut);
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
    const { volumeId: labelmapInstanceUID } = component._segVol(options);

    if (labelmapInstanceUID) {

      // Add labelmap instance UID to the options for the segmentation ID
      _.defaults(options, { segmentationId: labelmapInstanceUID });
      return _.pick(options, 'segmentationId', 'type');
    }

    return {};
  }

  async renderSegImageData(options) {
    // Render labelmap
    options = options || {};
    _.defaults(options, { setState: true });

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
        component.render3d();
        if (options.setState) {
          component.setState({ segRenderInit: true });  
        }
      }
    }
  }

  triggerSegmentationUpdate(options) {
    // Trigger an update on the provided segmentation
    const component = this;

    const { volumeId: labelmapInstanceUID } = component._segVol(options);
    if (labelmapInstanceUID) {        
      c3dSegmentations.triggerSegmentationEvents.triggerSegmentationDataModified(labelmapInstanceUID);
    }
  }

  async componentDidUpdate(prevProps, prevState) {
    // Mnage lifecylce of the view

    const component = this;
    await super.componentDidUpdate(prevProps, prevState);

    const { isLoaded, paintFilterLabelMapDetails, paintFilterLabelMapImageData } = this.props;
    const { imgRenderInit, segInit, segRenderInit, segRepUpdatePaused } = this.state;

    // Load and render segmentations
    if (paintFilterLabelMapDetails) {
      const { labelmapInstanceUID } = paintFilterLabelMapDetails;

      if (labelmapInstanceUID) {
        const { segVol } = component._segVol();

        // Load segmentation data
        if (isLoaded && imgRenderInit && !segInit && !segVol) {
          await component.loadSegImageVolume();
        }

        // Render segmentation data to viewport
        if (isLoaded && segInit && segVol && !segRenderInit) {
          await component.renderSegImageData();
        }

        // Trigger segmentation update only when labelmap data actually changes, not on every render cycle
        if (!segRepUpdatePaused && isLoaded && segInit && segVol && segRenderInit &&
            prevProps.paintFilterLabelMapImageData !== paintFilterLabelMapImageData) {
          component.triggerSegmentationUpdate();
        }
      }
    }
  }

  purgeSegmentationRepresentations(labelmapInstanceUID) {
    // Remove the segmentation representations from the specified labelmapInstance
    const component = this;
    const { removeAllSegRepresentations } = component.props;

    if (removeAllSegRepresentations) {

      // Remove all segmentation representations from all active viewports
      const active_viewports = c3dSegmentations.state.getViewportIdsWithSegmentation(labelmapInstanceUID);
      console.log('[Cornerstone3DLabelmapBaseView-purgeSegmentationRepresentations]: remove viewports for segmentation', 
        labelmapInstanceUID, active_viewports)
      
      for (const _v3d_id of active_viewports) {
        const _reps = c3dSegmentations.state.getSegmentationRepresentations(_v3d_id, labelmapInstanceUID);
        for (const _rep of _reps) {

          // Remove seg representation
          c3dSegmentations.removeSegmentationRepresentation(_v3d_id, {
            segmentationId: labelmapInstanceUID, type: _rep.type
          });

          console.log('[Cornerstone3DLabelmapBaseView-purgeSegmentationRepresentations] remove seg rep', 
            _v3d_id, labelmapInstanceUID, _rep);
        }
        
        console.log('[Cornerstone3DLabelmapBaseView-purgeSegmentationRepresentations]: active segmentation viewports', _v3d_id);
      }
    } else {

      // Only remove segmentations from the active viewport.
      // If the viewport was already disabled (e.g. from onClose before unmount),
      // _checkViewportActive returns {} — skip cleanup rather than passing
      // undefined to Cornerstone3D seg state queries.
      const { viewportId: _v3d_id } = component._checkViewportActive();
      if (!_v3d_id) {
        console.log('[Cornerstone3DLabelmapBaseView-purgeSegmentationRepresentations] viewport already disabled, skipping cleanup');
        return;
      }
      const _reps = c3dSegmentations.state.getSegmentationRepresentations(_v3d_id, labelmapInstanceUID) || [];
      for (const _rep of _reps) {
        c3dSegmentations.removeSegmentationRepresentation(_v3d_id, {
          segmentationId: labelmapInstanceUID, type: _rep.type,
        });
      }

      console.log('[Cornerstone3DLabelmapBaseView-componentWillUnmount] removed seg representations for viewport', _v3d_id);
    }
  }

  async componentWillUnmount() {
    const component = this;
    const { segVolumeCleanup } = component.props;

    console.log('[Cornerstone3DLabelmapBaseView-componentWillUnmount] begin cleanup');

    // Remove this viewport's segmentation representations only. Removing all viewports'
    // representations (via purgeSegmentationRepresentations) fires events that schedule
    // deferred re-renders on still-live viewports, which race against engine cleanup.
    const { volumeId: labelmapInstanceUID } = component._segVol();
    if (labelmapInstanceUID) {
      if (segVolumeCleanup) component.purgeSegmentationRepresentations(labelmapInstanceUID);
    }

    await super.componentWillUnmount();
    component._clearColorLUT();

    console.log('[Cornerstone3DLabelmapBaseView-componentWillUnmount] cleanup complete');
  }
}


Cornerstone3DLabelmapBaseView.propTypes = {
	...Cornerstone3DBaseView.propTypes,
	paintFilterBackgroundImageData: PropTypes.object,
  paintFilterLabelMapImageData: PropTypes.object,
  paintFilterLabelMapDetails: PropTypes.object,
  labelmapRenderingOptions: PropTypes.object,
  onLabelmapImageLoad: PropTypes.func,
  segVolumeCleanup: PropTypes.bool,
  removeAllSegRepresentations: PropTypes.bool,
}


export default Cornerstone3DLabelmapBaseView;