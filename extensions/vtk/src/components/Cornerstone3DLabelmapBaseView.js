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

import { inspectVtkLabelmapImage } from '../utils/cornerstone3d.js';

import {
  attachDerivedSegmentationDisplay,
  attachSegmentationDisplay,
  attachSegmentationService,
  detachDerivedSegmentationDisplay,
  detachSegmentationDisplay,
  getCanonicalSegmentation,
  mirrorLegacyMetadataToCornerstone3d,
  noteReferencedVolume,
} from '../utils/labelmapBridge.js';



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
    //    provided in paintFilterLabelMapDetails will be used.

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
      segVol: options.volumeId ? component._resolveSegVolume(options.volumeId) : undefined,
    });
  }

  _resolveSegVolume(volumeOrSegmentationId) {
    // Resolve the Cornerstone3D volume behind a segmentation identifier.
    //
    // A segmentation's display volume carries a per-generation volumeId (`<id>::display-N`), so a
    // cache lookup by segmentationId alone finds nothing. Resolution order: a direct cache hit
    // (explicit ids like the editor's `vol3d:` volumes), then the segmentation entry's own
    // `representationData.Labelmap.volumeId` -- the same route Cornerstone3D's internals take --
    // then the bridge's record.

    const direct = c3dCache.getVolume(volumeOrSegmentationId);
    if (direct) {
      return direct;
    }

    const _seg = c3dSegmentations.state.getSegmentation(volumeOrSegmentationId);
    const _labelmapData = _seg && _seg.representationData
      && _seg.representationData[c3dToolsEnums.SegmentationRepresentations.Labelmap];

    if (_labelmapData && _labelmapData.volumeId) {
      const viaRepresentation = c3dCache.getVolume(_labelmapData.volumeId);
      if (viaRepresentation) {
        return viaRepresentation;
      }
    }

    const record = getCanonicalSegmentation(volumeOrSegmentationId);
    return record ? record.volume : undefined;
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
      labelmapDetails = paintFilterLabelMapImageData
        ? inspectVtkLabelmapImage(component._labelmapScalarData())
        : undefined;
    }

    return {
      volumeId: labelmapInstanceUID, segMeta: _segMeta, labelmapDetails, labelmapMetadata,
    }
  }

  _labelmapScalarData() {
    // The canonical labelmap scalars, straight from the Cornerstone3D segmentation.
    //
    // The view no longer derives, re-orders or copies anything: the segmentation was created by
    // the importer and Cornerstone3D owns its voxel store. Read by the CANONICAL id, not
    // `_getSegImageVolumeId()` -- a derived-display view (the inspection modal) reads the same
    // voxels; only its volume and segmentation entry are its own.

    const component = this;
    const { paintFilterLabelMapDetails } = component.props;
    const { labelmapInstanceUID } = paintFilterLabelMapDetails || {};
    const record = labelmapInstanceUID ? getCanonicalSegmentation(labelmapInstanceUID) : undefined;

    return record ? record.scalarData : undefined;
  }

  _ensureLabelmapRegistration() {
    // Take this view's hold on a display materialisation.
    //
    // The segmentation itself was created by the importer and lives in Cornerstone3D state. A view
    // only attaches. A view whose `_getSegImageVolumeId()` is the segmentationId shares the
    // canonical display; a view that derives its own id (the inspection modal appends
    // `::inspection` because it renders in its own rendering engine, and a Cornerstone3D volume's
    // one GL texture cannot serve two WebGL contexts) gets a DERIVED display: its own segmentation
    // entry and volume over the same durable stack images.

    // @returns this view's display volume

    const component = this;
    const { paintFilterLabelMapImageData, paintFilterLabelMapDetails } = component.props;

    const { labelmapInstanceUID } = paintFilterLabelMapDetails || {};
    if (!paintFilterLabelMapImageData || !labelmapInstanceUID) {
      return undefined;
    }

    if (component._labelmapRegistered === labelmapInstanceUID) {
      return component._labelmapDisplayVolume;
    }

    const displayId = component._getSegImageVolumeId();
    let volume;

    if (displayId && displayId !== labelmapInstanceUID) {
      volume = attachDerivedSegmentationDisplay(labelmapInstanceUID, displayId, {
        referencedVolumeId: component._getImageVolumeId(),
      });
      component._derivedDisplayId = volume ? displayId : undefined;
    } else {
      volume = attachSegmentationDisplay(labelmapInstanceUID);
      if (volume) {
        // Report the image volume this segmentation overlays, now that a viewport exists to know
        // it. Only for the canonical display: a derived view's own image volume dies with the
        // view, and stamping it onto the canonical representation would dangle.
        noteReferencedVolume(labelmapInstanceUID, component._getImageVolumeId());
      }
    }

    if (!volume) {
      return undefined;
    }

    component._labelmapRegistered = labelmapInstanceUID;
    component._labelmapDisplayVolume = volume;

    return volume;
  }

  async loadSegImageVolume(options) {
    // Attach this view to the segmentation's display materialisation.
    //
    // The segmentation itself was created by the importer. Attaching takes this view's hold; the
    // first hold materialises a fresh display generation, and the reference image volume is
    // reported so the record and representation know what they overlay.

    options = options || {};
    _.defaults(options, { setState: true });

    const component = this;
    const {
      paintFilterLabelMapImageData, paintFilterLabelMapDetails, onLabelmapImageLoad,
    } = component.props;

    if (paintFilterLabelMapImageData) {
      const { labelmapInstanceUID, metadata: labelmapMetadata } = paintFilterLabelMapDetails;
      const segVol = component._ensureLabelmapRegistration();

      // `attachSegmentationDisplay` (inside `_ensureLabelmapRegistration`) has already reported the
      // reference volume through `noteReferencedVolume`, which stamps the record, the display
      // volume and the representation together.
      const _imageVolume = c3dCache.getVolume(component._getImageVolumeId());

      // A labelmap overlays an image volume, so the two geometries have to agree. They can fail to:
      // the segmentation is built at import from the referenced series' metadata (full resolution),
      // while the image volume in the viewport may be the reduced-resolution navigation volume the
      // phase-0 pre-flight substitutes, or may be built from a different set of imageIds. Rendering
      // a mismatched pair produces a shifted, garbled overlay rather than an error, so say so.
      if (segVol && _imageVolume) {
        const _mismatch = _.some(segVol.dimensions, (d, i) => d !== _imageVolume.dimensions[i]);

        if (_mismatch) {
          console.error(
            '[vtk:Cornerstone3DLabelmapBaseView] Segmentation and image volume geometries disagree; '
            + 'the overlay will be misregistered.',
            {
              segmentationId: labelmapInstanceUID,
              segmentation: _.pick(segVol, 'dimensions', 'spacing', 'origin', 'direction'),
              imageVolumeId: component._getImageVolumeId(),
              imageVolume: _.pick(_imageVolume, 'dimensions', 'spacing', 'origin', 'direction'),
            });
        }
      }

      if (options.setState) {
        component.setState({ segInit: true });
      }

      if (_.isFunction(onLabelmapImageLoad)) {
        onLabelmapImageLoad({
          volumeId: labelmapInstanceUID, segmentationId: labelmapInstanceUID,
          meta: labelmapMetadata, vol: segVol,
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

        // Legacy -> Cornerstone3D metadata (FR-4). Only possible now: the active segment and the
        // hidden-segment flags are written onto the representation, which did not exist until the
        // call above.
        const { labelmapInstanceUID } = paintFilterLabelMapDetails;
        mirrorLegacyMetadataToCornerstone3d(labelmapInstanceUID);

        // The colour half of the metadata mirror has no Cornerstone3D event of its own -- a
        // segment's colour lives in the per-viewport LUT -- so it is driven from the
        // SegmentationService where a view has one.
        const { segmentationService } = component.props.servicesManager?.services || {};
        attachSegmentationService(labelmapInstanceUID, segmentationService);
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
    // Trigger a redraw of the provided segmentation.
    //
    // The empty slice list is deliberate. Cornerstone3D reads it as "no slice was named", so it
    // re-uploads every frame exactly as it did before -- but the labelmap bridge reads it as "no
    // voxel changed on the Cornerstone3D side", so it does not recompute `segmentsOnLabelmap` for
    // the whole series. This is a redraw, not an edit: it fires when the viewport hands the view a
    // new labelmap object, and the legacy module is the one that already has the voxels.

    const component = this;

    const { volumeId: labelmapInstanceUID } = component._segVol(options);
    if (labelmapInstanceUID) {
      c3dSegmentations.triggerSegmentationEvents.triggerSegmentationDataModified(
        labelmapInstanceUID, []);
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

        // Attach to the canonical segmentation.
        //
        // Gated on `!segInit`, NOT on `!segVol`. Since the ownership inversion the importer creates
        // the segmentation before any view mounts, so the volume is already cached on the first
        // update; gating on its absence meant this never ran, `segInit` never became true, and the
        // render branch below could never fire for the normal import path.
        if (isLoaded && imgRenderInit && !segInit) {
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

    // Give up this view's hold on the display materialisation. The last holder retires it
    // completely -- representations, segmentation entry, volume, texture, slice images -- after
    // syncing its voxels into the primary record. The record and the legacy view persist (FR-8);
    // only an explicit `removeCanonicalSegmentation` destroys those.
    if (component._labelmapRegistered) {
      if (component._derivedDisplayId) {
        detachDerivedSegmentationDisplay(
          component._labelmapRegistered, component._derivedDisplayId);
        component._derivedDisplayId = undefined;
      } else {
        detachSegmentationDisplay(component._labelmapRegistered);
      }
      component._labelmapRegistered = undefined;
      component._labelmapDisplayVolume = undefined;
    }

    await super.componentWillUnmount();
    component._clearColorLUT();

    console.log('[Cornerstone3DLabelmapBaseView-componentWillUnmount] cleanup complete');
  }
}


Cornerstone3DLabelmapBaseView.propTypes = {
	...Cornerstone3DBaseView.propTypes,
  // `{ buffer, stackImageIds }` -- the legacy cornerstone-tools labelmap3D buffer and the stack it
  // was drawn on. Not a vtkImageData: the hosting viewport passes the raw buffer through.
  paintFilterLabelMapImageData: PropTypes.object,
  // `{ labelmapInstanceUID, labelmapIndex, firstImageId, metadata }` -- the identity of the
  // labelmap in both state stores, which is what the bridge registers against.
  paintFilterLabelMapDetails: PropTypes.object,
  labelmapRenderingOptions: PropTypes.object,
  onLabelmapImageLoad: PropTypes.func,
  segVolumeCleanup: PropTypes.bool,
  removeAllSegRepresentations: PropTypes.bool,
}


export default Cornerstone3DLabelmapBaseView;