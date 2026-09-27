import _ from "lodash";

import React, { Component } from "react";
import PropTypes from "prop-types";
import cornerstoneTools from 'cornerstone-tools';

import {
  Enums as c3dToolsEnums,

  // Segmentations
  segmentation as c3dSegmentations,
} from '@cornerstonejs/tools';
import { SegmentationRepresentations } from '@cornerstonejs/tools/enums';

import OHIF from "@ohif/core";
import { extractStudyIdFromURL } from "@ohif/core/src/utils/extractStudyIdFromURL";
import { eventTypes as uiEvents } from "@ohif/ui";

import {
  Enums as vtkEnums,
  LoadingIndicator,
  VolumeFitNotice,
  OHIFVtkBaseViewport,
  cornerstone3dUtils,
  vtkUtils,
} from "@ohif/extension-vtk";
import { eventTypes as segmentationEventTypes } from "@ohif/extension-dicom-segmentation";

import SegmentationEditorViewport from "../components/SegmentationEditorLayout.js";
import { Enums as SegEditorEnums } from '../enums';
import { DEFAULT_SEG_EDITOR_LAYOUT } from '../layouts/segEditorLayouts';
import { claimEditorDisplaySet, releaseEditorDisplaySet } from '../utils/editorDisplaySetLifecycle';

const segmentationModule = cornerstoneTools.getModule('segmentation');
const { DisplaySetApi } = OHIF.display;


class OHIFSegmentationEditorViewport extends OHIFVtkBaseViewport {
  // OHIF viewport with support for retrieving segmentation masks using Cornerstone3D and initializing
  // a viewport capable of displaying them for editing.

  static id = "OHIFSegmentationEditorViewport";

  state = {
    ...OHIFVtkBaseViewport.state,

    // Editor 3D-viewport rendering toggles (FR-3 defaults: Surface on, 3D Volume off).
    // Tracked as editor-scoped displaySet attributes so the toolbar toggles, commands, and this
    // viewport share one source of truth — mirroring imageVolumeRenderingEnabled /
    // segmentationSurfaceEnabled in OHIFVtkVolumeViewport, but under dedicated names because the
    // volume viewer's attributes carry side-panel semantics elsewhere.
    segEditorVolumeRenderingEnabled: false,
    segEditorSurfaceRenderingEnabled: true,
    // 3D tab shows the Three.js editing canvas (set by the tool palette's 3D tab)
    segEditor3dEditingEnabled: false,
    // Layout preset (layouts/segEditorLayouts), chosen from the toolbar's Layout widget
    segEditorLayout: DEFAULT_SEG_EDITOR_LAYOUT,
    // Counter bumped by the 3D menu's Reset (resetSegEditor3DView); the layout resets the camera
    segEditor3dViewReset: 0,
  };

  constructor() {
    super(...arguments);
  }

  setStateFromProps() {
    // Retrieve DICOM data, segmentations, and other metadata needed for the segmentation editor.
    const _component = this;

    // Retrieve study metadata
    const { eventTimeout } = _component.props;
    const { studies, displaySet } = _component.props.viewportData;
    const {
      StudyInstanceUID,
      displaySetInstanceUID,
      sopClassUIDs,
      SOPInstanceUID,
      frameIndex,
    } = displaySet;

    if (sopClassUIDs.length > 1) {
      console.warn("More than one SOPClassUID in the same series is not yet supported");
    }

    const study = studies.find(
      (study) => study.StudyInstanceUID == StudyInstanceUID);

    const dataDetails = {
      studyDate: study.studyDate,
      studyTime: study.studyTime,
      studyDescription: study.studyDescription,
      patientName: study.patientName,
      patientId: study.patientId,
      seriesNumber: String(displaySet.seriesNumber),
      seriesDescription: displaySet.seriesDescription,
    };

    try {

      // Retrieve the display set's imageIds, labelmap and colour settings. The Cornerstone3D view
      // builds and streams the volume from the imageIds.
      const { imageIds, labelmapDataObject, labelmapColorLUT, labelmapDetails: sourceLabelmapDetails } = this.getViewportData(
          studies, StudyInstanceUID, displaySetInstanceUID, SOPInstanceUID, frameIndex);

      // The editor's editing model is copy-based (#136 fifth amendment, note 37810): entering
      // Seg-Editor forks the canonical segmentation into a distinct Cornerstone3D-owned WORKING
      // segmentation, initialised one way from a snapshot. Every editor view, panel operation and
      // command below receives the WORKING id, so nothing the editor does can reach the
      // PACS-loaded canonical segmentation or, through the bridge, the legacy view and other
      // displays. Released on unmount; save/export (#95) will persist it as a NEW DICOM instance.
      let labelmapDetails = sourceLabelmapDetails;
      if (sourceLabelmapDetails && sourceLabelmapDetails.labelmapInstanceUID) {
        const fork = cornerstone3dUtils.forkSegmentationForEditor(
          sourceLabelmapDetails.labelmapInstanceUID);
        if (fork) {
          labelmapDetails = {
            ...sourceLabelmapDetails,
            labelmapInstanceUID: fork.workingSegmentationId,
            sourceSegmentationId: fork.sourceSegmentationId,
          };
        }

        // A segmentation created in the viewer (ohif-viewers#143) exists only for this session of
        // the editor and is removed on close. Which one that is, is settled now, from the source
        // itself: the close runs after the layout has torn down, and must not depend on reading
        // it back through the working copy.
        _component._inMemorySegmentationId = cornerstone3dUtils.getInMemorySegmentationInfo(
          sourceLabelmapDetails.labelmapInstanceUID)?.segmentationId;
      }

      _component.hasError = false;

      this.setState({
        percentComplete: 0, loadProgress: null, loadError: null, fit: null, dataDetails,
      }, () => {

        setTimeout(() => {

          // Set displaySet API properties and trigger displaySet service
          const { displaySet } = _component.props.viewportData;
          const { labelmapInstanceUID, labelmapMetadata } = labelmapDetails;
          if (displaySet && labelmapInstanceUID && !displaySet.labelmapInstanceUID) {

            // Publish the working segmentation as the displaySet's segmentationId and mark the
            // viewport stable. The editor attributes seed the toolbar indicators and satisfy the
            // non-nil guard of the toggle commands. The ids are kept on the instance: the close
            // runs later, and must release what this editor took, not what the displaySet holds
            // by then.
            const { displacedSegmentationId } = claimEditorDisplaySet(displaySet, labelmapInstanceUID, {
              segEditorVolumeRenderingEnabled: _component.state.segEditorVolumeRenderingEnabled,
              segEditorSurfaceRenderingEnabled: _component.state.segEditorSurfaceRenderingEnabled,
              segEditor3dEditingEnabled: _component.state.segEditor3dEditingEnabled,
              segEditorLayout: _component.state.segEditorLayout,
              segEditor3dViewReset: _component.state.segEditor3dViewReset,
            });
            _component._workingSegmentationId = labelmapInstanceUID;
            _component._displacedSegmentationId = displacedSegmentationId;

            DisplaySetApi.Instance.displaySetService.addDisplaySets([displaySet]);
          }

          this.setState({
            imageIds,
            paintFilterLabelMapImageData: labelmapDataObject,
            paintFilterLabelMapDetails: labelmapDetails,
            labelmapColorLUT,
            isLoaded: true,
          });
        }, eventTimeout);
      });
    } catch (err) {

      // Resolving the stack failed, so there is nothing to render at all. Reported through the
      // same one-per-volume path as a load failure.
      console.error('Failed to load image data.', err);
      _component.onLoadError(err);
      this.setState({ isLoaded: true });
    }
  }

  onInteractionStart() {
    // Begin tracking model interaction events

    const { viewportIndex, activeViewportindex, setViewportActive } =
      this.props;

    // Set viewport active (if it is not already)
    if (
      viewportIndex != activeViewportindex &&
      _.isFunction(setViewportActive)
    ) {
      setViewportActive();
    }
  }

  onVolumeLabelmapImageLoad(volImg) {
    // Callback function invoked when the segmentation editor "volume" labelmap image becomes available.
    // The volume labelmap image is associated with the Volume3D rendering viewport and includes
    // the segmentationId of the volume to be used by 3D tools. This method adds it to the displaySet
    // associated with the primary volume.
    const component = this;

    const { displaySet } = component.props.viewportData;
    const { displaySetInstanceUID } =  displaySet;
    if (displaySetInstanceUID && volImg?.segmentationId) {
      const _ds = DisplaySetApi.Instance.displaySetService.getDisplaySetByUID(displaySetInstanceUID);
      if (_ds) {

        // Add volumeSegmentationId to the displaySet and update displaySetService
        _ds.volumeSegmentationId = volImg.segmentationId;
        DisplaySetApi.Instance.displaySetService.addDisplaySets([_ds]);
      }
    }
  }

  notifyLoadError(error) {
    // The toast carries the way out of this layout: the message names the viewer to switch to,
    // not just the fact that the load failed.

    const _component = this;

    vtkUtils.logVtkError(this.props.servicesManager, 'Failed to load image data.', {
      message: error.message,
      studyId: extractStudyIdFromURL(),
      studyError: !!extractStudyIdFromURL(),
      userNotification: true,
      userNotificationOptions: {
        type: 'error',
        autoClose: false,
        action: {
          label: 'Exit Segmentation Editor',
          onClick: ({ close }) => {
            close();
            _component.props.commandsManager.runCommand('setCornerstoneLayout');
          },
        },
      },
    });
  }

  resizeViewport() {
    // Resize VTK.js render windows
    if (this.api && this.api.genericRenderWindow) {
      this.api.genericRenderWindow.resize();
    }
  }

  _evtDisplaySetUpdate({ displaySetInstanceUID, displaySet }) {
    // Apply displaySet updates to viewport state (mirrors OHIFVtkVolumeViewport._evtDisplaySetUpdate):
    // the 3D rendering toggle commands flip the attributes and republish, and this maps them into
    // component state so the layout receives them as props.

    const _component = this;
    const { displaySetInstanceUID: viewportDisplaySetInstanceUID } = _component.props.viewportData.displaySet;

    if (displaySetInstanceUID == viewportDisplaySetInstanceUID) {
      _component.setState(_.pick(displaySet,
        'segEditorVolumeRenderingEnabled', 'segEditorSurfaceRenderingEnabled', 'segEditor3dEditingEnabled',
        'segEditorLayout', 'segEditor3dViewReset'));
    }
  }

  componentDidMount() {
    // Retrieve segmentation data and initialize component
    const _component = this;
    _component.boundResizeViewport = _component.resizeViewport.bind(_component);

    // Subscribe to displaySetService update events (3D rendering toggle attributes)
    _component.displayset_dataupdate = DisplaySetApi.Instance.displaySetService.subscribe(
      DisplaySetApi.Instance.displaySetService.EVENTS.DISPLAY_SET_CHANGED,
      _component._evtDisplaySetUpdate.bind(_component));

    let loadAsync;
    const { displaySet } = _component.props.viewportData;

    // Cache a copy of the style defaults (restored when the component is unmounted)
    _component.labelmapStyleDefaults = c3dSegmentations.config.style.getStyle({ type: SegmentationRepresentations.Labelmap });

    // Subscribe to OHIF tab events in order to update component after UI changes
    document.addEventListener(segmentationEventTypes.SegmentationPanelTabUpdatedEvent, _component.boundResizeViewport);
    document.addEventListener(uiEvents.sidebar.toggle, _component.boundResizeViewport);

    // Load volumetric data: if state properties were changed, loadVolumeData needs to be called asynchrnously
    const loadVolumeData = () => _component.setStateFromProps();
    if (loadAsync) {
      window.setTimeout(loadVolumeData, 10);
    } else {
      loadVolumeData();
    }
  }

  componentWillUnmount() {
    // Remove event handlers and reactive logic for viewport
    const _component = this;
    const { eventTimeout } = _component.props;

    // Unsubscribe from VTK tab events
    document.removeEventListener(segmentationEventTypes.SegmentationPanelTabUpdatedEvent, _component.boundResizeViewport);
    document.removeEventListener(uiEvents.sidebar.toggle, _component.boundResizeViewport);

    // displaySet update events
    _component.displayset_dataupdate?.unsubscribe();

    setTimeout(() => {
      // Mark the displaySet.stableViewport property as false so that reloads will work as expected

      const { displaySet } = _component.props.viewportData;
      const { displaySetInstanceUID } =  displaySet;

      if (displaySetInstanceUID) {
        console.log('[OHIFSegmentationEditorViewport:component-unmounting]', displaySetInstanceUID, displaySet);

        // Pull displaySet data from service to ensure that it is up to date. The displaySet data
        // on the props hash may have been mutated and will not have an accurate state of the segmentation data.
        // This is due to a bug in the way displaySet state propagates which the underlying architecture is being migrated
        // for compatibility with upstream OHIF V3+. When the veiwport closes, the displaySet sholud be marked
        // as stableViewport = false, which will notify OHIF that updates to displaySet state should trigger reloads.
        // TODO: Begin migrating general viewer state to utilize service based representations rather than flux.
        const _ds = DisplaySetApi.Instance.displaySetService.getDisplaySetByUID(displaySetInstanceUID);
        const workingSegmentationId = _component._workingSegmentationId;
        if (_ds && workingSegmentationId) {

          // Each step stands on its own. This runs in a deferred callback after the layout's
          // own teardown, so a failure in one step would otherwise go unreported and skip the
          // rest: the created segmentation would stay installed, and active, on its series.
          const step = (name, run) => {
            try {
              return run();
            } catch (error) {
              console.error(`[OHIFSegmentationEditorViewport:component-unmounting] ${name} failed`, error);
              return undefined;
            }
          };

          // A segmentation created in the viewer (ohif-viewers#143) exists only for this session
          // of the editor: once closed, it is removed rather than left behind on the series. The
          // id was settled at load; reading the marker through the working copy is only a
          // fallback, since the copy may already be gone by now.
          const inMemorySegmentationId = _component._inMemorySegmentationId
            || step('reading the in-memory marker',
              () => cornerstone3dUtils.getInMemorySegmentationInfo(workingSegmentationId))?.segmentationId;

          // Release the editor's working segmentation: its displays, state entry and stack go;
          // the source canonical segmentation and its legacy view are untouched.
          step('releasing the working copy',
            () => cornerstone3dUtils.releaseEditorWorkingCopy(workingSegmentationId));
          if (inMemorySegmentationId) {
            step('removing the created segmentation',
              () => cornerstone3dUtils.removeCanonicalSegmentation(inMemorySegmentationId));
          }

          // Give the displaySet back: the segmentation it carried before the editor (an M3D
          // series' own) is restored, and the editor attributes are cleared
          step('releasing the display set', () => releaseEditorDisplaySet(_ds, {
            workingSegmentationId,
            displacedSegmentationId: _component._displacedSegmentationId,
          }));
          _component._workingSegmentationId = undefined;
          _component._displacedSegmentationId = undefined;
          _component._inMemorySegmentationId = undefined;

          step('publishing the display set',
            () => DisplaySetApi.Instance.displaySetService.addDisplaySets([_ds]));

          // Style defaults, last: the working copy these addressed is gone, so this only clears
          // what the session set under its id.
          step('restoring style defaults', () => [
            ['setFillAlpha', 'fillAlpha'],
            ['setOutlineWidth', 'outlineWidth'],
            ['setRenderFill', 'renderFill'],
            ['setRenderFillInactive', 'renderFillInactive'],
            ['setRenderOutline', 'renderOutline'],
            ['setRenderOutlineInactive', 'renderOutlineInactive'],
          ].forEach(([command, style]) => {
            _component.props.commandsManager.runCommand(command, {
              value: _component.labelmapStyleDefaults[style], segmentationId: workingSegmentationId,
            }, vtkEnums.VIEWPORT);
          }));
        }
      }
    }, eventTimeout);
  }

  render() {
    const component = this;

    const { configuration: segmentationConfiguration } = segmentationModule;
    const { percentComplete, isLoaded } = component.state;
    const style = { width: '100%', height: '100%', position: 'relative' }

    return (
      <>
      <div className='ohif-segmentation-editor' style={style}>
        {!component.state.loadProgress?.complete && (
          <LoadingIndicator percentComplete={percentComplete} loadProgress={component.state.loadProgress} />
        )}
        <VolumeFitNotice fit={component.state.fit} />
        {isLoaded && component.state.imageIds && (

          <SegmentationEditorViewport
            servicesManager={component.props.servicesManager}
            commandsManager={component.props.commandsManager}
            imageIds={component.state.imageIds}
            paintFilterLabelMapImageData={component.state.paintFilterLabelMapImageData}
            paintFilterLabelMapDetails={component.state.paintFilterLabelMapDetails}
            onLoadProgress={component.onLoadProgress}
            onLoadError={component.onLoadError}
            onVolumeFit={component.onVolumeFit}
            isLoaded={component.state.isLoaded}
            viewportData={component.props.viewportData}
            labelmapRenderingOptions={{
              colorLUT: component.state.labelmapColorLUT,
              globalOpacity: segmentationConfiguration.fillAlpha,
              visible: segmentationConfiguration.renderFill,
              outlineThickness: segmentationConfiguration.outlineWidth,
              renderOutline: segmentationConfiguration.renderOutline,
              segmentsDefaultProperties: component.segmentsDefaultProperties,
              onNewSegmentationRequested: () => {
                component.setStateFromProps();
              },
            }}
            afterCreation={(api) => (component.api = api)}
            onVolumeLabelmapImageLoad={component.onVolumeLabelmapImageLoad.bind(component)}
            segEditorVolumeRenderingEnabled={component.state.segEditorVolumeRenderingEnabled}
            segEditorSurfaceRenderingEnabled={component.state.segEditorSurfaceRenderingEnabled}
            segEditor3dEditingEnabled={!!component.state.segEditor3dEditingEnabled}
            segEditorLayout={component.state.segEditorLayout}
            segEditor3dViewReset={component.state.segEditor3dViewReset}
          />
        )}
      </div>
      </>
    );
  }
}


OHIFSegmentationEditorViewport.propTypes = {
  ...OHIFVtkBaseViewport.propTypes,
  eventTimeout: PropTypes.number,
};
OHIFSegmentationEditorViewport.defaultProps = {
  ...(OHIFVtkBaseViewport.defaultProps || {}),
  eventTimeout: 50,
};


export default OHIFSegmentationEditorViewport;
