import _ from "lodash";

import React, { Component, createRef } from "react";
import { withTranslation } from 'react-i18next';
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
  getPolySeg,
} from '@cornerstonejs/tools';
import {
  getLabelmapActorUID,
  getSurfaceActorEntry,
} from '@cornerstonejs/tools/segmentation/helpers/getSegmentationActor';

import {
  createVOISynchronizer as c3dCreateVOISynchronizer,
} from '@cornerstonejs/tools/synchronizers';

import {
  init as c3dPolySegInit,
  computeSurfaceData as c3dComputeSurfaceData,
  updateSurfaceData as c3dUpdateSurfaceData,
} from '@cornerstonejs/polymorphic-segmentation';


import OHIF, { display } from "@ohif/core";
import {
  cornerstone3dUtils as c3dUtils,
  Cornerstone3DLabelmapBaseView,
  LoadingIndicator,
} from '@ohif/extension-vtk';

import { Enums as SonadorSegEnums } from '../enums';
import { Cornerstone3DSegmentationViewerBaseViewport } from '../components/Cornerstone3DSegmentationViewerLayout';

const { ViewportType, Events: c3dEvents } = C3dEnums;
const { DisplaySetApi } = display;


class SegmentationEditorBaseViewport extends Cornerstone3DSegmentationViewerBaseViewport {
  // React component that can be used to edit DICOM or NIFTI segmentations. (Uses VTK.js components
  // and Cornerstone3D.) The viewport tracks two versions of the segmentation, one for 3D views
  // and a second instance for 2D views. This is done to ensure efficient rendering of 2D and 3D data.

  static id = "SegmentationEditorViewport";

  static propTypes = {
    ...Cornerstone3DSegmentationViewerBaseViewport.propTypes,
    servicesManager: PropTypes.object.isRequired,
  }

  constructor(props) {
    super(props);
  }

  subscribeEventListeners() {
    // Create event listeners for the viewport
    const component = this;

    const { displaySetService, segmentationService } = component.props.servicesManager.services;
    const { eventTimeout, views2d, views3d } = component.props;

    // Segmentation editor state is coordinated by the displaySet and segmentation services.
    // The viewport is responsible for ensuring that the 2D and 3D segmentations remains
    // in sync, while controls are responsible for toggling the config state maintained by
    // the Cornerstone3D and OHIF state management tools. The OHIF segmentation service
    // is a wrapper around the Cornerstone3D state management which allows for the recording
    // and replay of operations for undo/redo.
    const { displaySet } = component.props.viewportData;
    const { displaySetInstanceUID } = displaySet;

    // displaySet API: UI and data API updates
    component.displaysets_apisync = DisplaySetApi.Instance.displaySetService.subscribe(
      DisplaySetApi.Instance.displaySetService.EVENTS.DISPLAY_SET_DATASYNC, ({ apiEvent, ...apiData }) => {
        const { segmentationId } = apiData;

        // Segmentations managed by the editor
        const { volumeId: labelmapInstanceUID } = component._segVol();
        const { volumeId: labelmapInstance3dUID } = component._segVol3d();
        const _editor_segs = [labelmapInstanceUID, labelmapInstance3dUID];

        console.log('[SegmentationEditorBaseViewport:evt:displayset-datasync]: ', apiEvent, apiData);

        if (apiEvent == SonadorSegEnums.EVENTS.SEGMENT_REMOVE_PREP && _.includes(_editor_segs, segmentationId)
            && component.props.segEditorSurfaceRenderingEnabled) {

          // Segmentation Remove Prep: indicate that the surface is rendering. (Skipped while the
          // surface toggle is off — no surface recompute will follow, so no overlay.)
          // setState triggers a re-render; componentDidUpdate calls _surfaceRenderStatus()
          // because surfaceRendering changed — no forceUpdate() or manual _surfaceRenderStatus() needed.
          component.setState({ surfaceRendering: true });

        } else if (apiEvent == SonadorSegEnums.EVENTS.SEGMENT_REMOVE_SUCCESS && _.includes(_editor_segs, segmentationId)) {

          // Segmentation Remove Success/Error: clear surface rendering indicator.
          component.setState({ surfaceRendering: false });
        }
      });

    // Remove segment from volumeSeg on removal from 2D seg
    component.segservice_segment_removed = segmentationService.subscribe(
      segmentationService.EVENTS.SEGMENT_REMOVED, async ({ segmentationId, segmentIndex}) => {
        // Propagate changes to the 2D segments to the 3D labelmap/surface

        // Retrieve labelmapInstanceUID and displaySet to check segmentationIds
        const { volumeId: labelmapInstanceUID, segVol } = component._segVol();
        const { volumeId: labelmapInstance3dUID, segVol: segVol3d  } = component._segVol3d();
        const _seg = c3dSegmentations.state.getSegmentation(segmentationId);

        // Check 2D segmentation labelmap to ensure that the labelmap was cleared correctly.
        if (segVol && segmentationId == labelmapInstanceUID) {
          await c3dUtils.forceClearSegment(segmentationId, segmentIndex, { checkOnly: true });

          // Propagate change to the 3D view and labelmap
          segmentationService.removeSegment(labelmapInstance3dUID, segmentIndex);
        }

        // Trigger a render of the surface data so that the volumeLabelMap instance matches
        if (segVol3d && segmentationId == labelmapInstance3dUID) {

          // Check that segment was removed (if not remove it by force) and render new surfaces (if there are segments)
          await c3dUtils.forceClearSegment(segmentationId, segmentIndex, { checkOnly: true });
          if (_seg && _.values(_seg.segments).length > 0) {

            // Skip the surface recompute while the surface toggle is off (AR-5): the labelmap
            // stays in sync above, and re-enabling the toggle recomputes the full surface.
            if (component.props.segEditorSurfaceRenderingEnabled) {
              try {
                await c3dUpdateSurfaceData(labelmapInstance3dUID);
              } catch (err) {
                console.error('[SegmentationEditorBaseViewport:evt:segment-removed] Unable to update surface data due to an error. '
                  + 'segmentationId='+labelmapInstance3dUID+' segmentIndex='+segmentIndex, err);
              }
            }
          } else {
            for (const _v3d_id of c3dSegmentations.state.getViewportIdsWithSegmentation(labelmapInstance3dUID)) {
              c3dSegmentations.removeSurfaceRepresentation(_v3d_id, segmentationId);
            }
          }

          // Trigger "success" signal: the signal is delayed 3 times the normal eventTimeout to ensure that it arrives
          // after any progress updates.
          setTimeout(() => {
            DisplaySetApi.Instance.displaySetService.triggerApiEvent(
              SonadorSegEnums.EVENTS.SEGMENT_REMOVE_SUCCESS, { segmentationId, segmentIndex });
          }, eventTimeout*3)
        }
      });

    // Update segment color on change
    component.segservice_segment_color_change = segmentationService.subscribe(
      segmentationService.EVENTS.SEGMENT_COLOR_MODIFIED, async ({ segmentationId, segmentIndex, color }) => {

        // Retrieve labelmapInstanceUID and labelmapInstance3dUID
        const { volumeId: labelmapInstanceUID, segVol } = component._segVol();
        const { volumeId: labelmapInstance3dUID, segVol: segVol3d  } = component._segVol3d();

        // Propagate segment color change to 3D volume
        if (segVol3d && segmentationId == labelmapInstanceUID) {
          _.each(c3dSegmentations.state.getViewportIdsWithSegmentation(labelmapInstance3dUID), async (_v3d_id) => {

            // Modify surface color and update surface representations
            segmentationService.setSegmentColor(_v3d_id, labelmapInstance3dUID, segmentIndex, color);

            // CS3D's addOrUpdateSurfaceToElement only sets actor color on initial creation;
            // subsequent color LUT changes are not propagated to existing surface actors.
            // Directly update the VTK actor property so the 3D surface reflects the change.
            const surfaceActorEntry = getSurfaceActorEntry(_v3d_id, labelmapInstance3dUID, segmentIndex);
            if (surfaceActorEntry?.actor) {
              const [r, g, b] = color;
              surfaceActorEntry.actor.getProperty().setColor(r / 255, g / 255, b / 255);
              component.renderEngine?.getViewport(_v3d_id)?.render();
            }
          });

          // Re-render all 2D viewports to reflect the color change.
          // segmentationService.setSegmentColor() updates the LUT for only one viewport
          // (viewportId0, passed by editSegmentColor). Each 2D viewport tracks its own
          // per-viewport LUT entry, so the remaining viewports must also be updated.
          // We use c3dSegmentations.config.color directly rather than going through the
          // service to avoid re-entering this SEGMENT_COLOR_MODIFIED handler recursively.
          _.each(c3dSegmentations.state.getViewportIdsWithSegmentation(labelmapInstanceUID), (_v2d_id) => {
            c3dSegmentations.config.color.setSegmentIndexColor(_v2d_id, labelmapInstanceUID, segmentIndex, color);
            component.renderEngine?.getViewport(_v2d_id)?.render();
          });
        }
      });

    // Propagate active segment to 3D volume
    component.segservice_segment_active = segmentationService.subscribe(
      segmentationService.EVENTS.SEGMENT_ACTIVE, async ({ segmentationId, segmentIndex }) => {

        // Retrieve labelmapInstanceUID and labelmapInstance3dUID
        const { volumeId: labelmapInstanceUID, segVol } = component._segVol();
        const { volumeId: labelmapInstance3dUID, segVol: segVol3d  } = component._segVol3d();

        // Propagate active segment to 3D volume
        if (segVol3d && segmentationId == labelmapInstanceUID) {
          segmentationService.setActiveSegment(labelmapInstance3dUID, segmentIndex);
        }

        if (segVol3d && segmentationId == labelmapInstance3dUID) {

          // Check component "rendering" state and update if currently indicated as "rendering".
          // Changes to the active surface state can prompt a "rendering" message on the viewport
          // when there is not a background operation happening.
          setTimeout(() => {
            const { surfaceRendering } = component.state;
            if (surfaceRendering) {
              component.setState({ surfaceRendering: false });
            }
          }, eventTimeout*3);
        }
      });

    // Propagate locked segment status to 3D volume
    component.segservice_segment_locked = segmentationService.subscribe(
      segmentationService.EVENTS.SEGMENT_LOCK, async ({ segmentationId, segmentIndex, isLocked }) => {

        // Retrieve labelmapInstanceUID and labelmapInstance3dUID
        const { volumeId: labelmapInstanceUID, segVol } = component._segVol();
        const { volumeId: labelmapInstance3dUID, segVol: segVol3d  } = component._segVol3d();

        // Propagate lock status to 3D volume
        if (segVol3d && segmentationId == labelmapInstanceUID) {
          segmentationService.setSegmentLocked(labelmapInstance3dUID, segmentIndex, isLocked);
        }
      });

    // Update 3D volume active segment when new segment added to 2D labelmap
    component.segservice_segment_added = segmentationService.subscribe(
      segmentationService.EVENTS.SEGMENT_ADDED, async ({ segmentationId, segmentIndex, config }) => {

        // Retrieve labelmapInstanceUID and labelmapInstance3dUID
        const { volumeId: labelmapInstanceUID, segVol } = component._segVol();
        const { volumeId: labelmapInstance3dUID, segVol: segVol3d  } = component._segVol3d();

        console.log(`[SegmentationEditorBaseViewport:evt:segment-added] segmentationId=${segmentationId} segmentIndex=${segmentIndex}`,
          config);

        // Propagate segment to 3D volume
        if (segVol3d && segmentationId == labelmapInstanceUID) {

          // Create copy of the segment config
          const _config = _.pick(config, 'label', 'isLocked', 'active', 'color', 'visibility');
          segmentationService.addSegment(labelmapInstance3dUID, _config);
        } else if (segVol3d && segmentationId == labelmapInstance3dUID) {

          // Set active segment of the 3D volume to match that of the 2D volume
          segmentationService.setActiveSegment(
            segmentationId, c3dSegmentations.segmentIndex.getActiveSegmentIndex(labelmapInstanceUID));
        }
      });

    super.subscribeEventListeners();
  }

  async _activateSegmentationRepresentation() {
    // Activate the labelmap representation for the segmentation viewer. As part of activation
    // set the "active" segment to be the lowest segmentIndex. The active segment
    // is set prior to adding the representation in order to streamline loading / rendering
    // and prevent un-necessary updates.

    const component = this;

    const { volumeId: labelmapInstanceUID } = component._segVol();
    if (labelmapInstanceUID) {

      // Determine the first segmentIndex of the segmentation and activate it
      const _seg = c3dSegmentations.state.getSegmentation(labelmapInstanceUID);
      const segIdxMin = _.min(_.keys(_seg.segments));
      c3dSegmentations.segmentIndex.setActiveSegmentIndex(labelmapInstanceUID, segIdxMin);
    }

    await super._activateSegmentationRepresentation();
  }

  async _activateSurfaceRepresentation() {
    // Activate the surface representationf for the segmentation viewer. As part of the activation
    // set the "active" segment so that it matches the 2D viewport.
    // Changes to the active segment will be propagated by the segmentationService.

    const component = this;
    const { volumeId: labelmapInstanceUID } = component._segVol();
    const { volumeId: labelmapInstance3dUID } = component._segVol3d();

    if (labelmapInstanceUID && labelmapInstance3dUID) {

      // Set segmentIndex to match the 2D viewport
      c3dSegmentations.segmentIndex.setActiveSegmentIndex(
        labelmapInstance3dUID, c3dSegmentations.segmentIndex.getActiveSegmentIndex(labelmapInstanceUID));
    }

    await super._activateSurfaceRepresentation();
  }

  unsubscribeEvents() {
    // Unsubscribe event handlers
    const component = this;

    // displaySetApi service events
    component.displaysets_apisync?.unsubscribe();

    // Segmentation service events
    component.segservice_segment_removed?.unsubscribe();
    component.segservice_segment_color_change?.unsubscribe();
    component.segservice_segment_active?.unsubscribe();
    component.segservice_segment_locked?.unsubscribe();
    component.segservice_segment_added?.unsubscribe();

    super.unsubscribeEvents();
  }
}


// Export both the base editor (plain JS class which can be extended) and a wrapped viewport providing
// translation utilitites. Views which utilize the viewer directly should use the wrapped version.
export default withTranslation('Common')(SegmentationEditorBaseViewport);
export { SegmentationEditorBaseViewport };
