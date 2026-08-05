import _ from "lodash";

import React, { Component } from "react";
import PropTypes from "prop-types";
import cornerstoneTools from 'cornerstone-tools';

import { cache as c3dCache } from "@cornerstonejs/core";

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
  OHIFVtkBaseViewport,
  vtkUtils,
  cornerstone3dUtils,
} from "@ohif/extension-vtk";
import { eventTypes as segmentationEventTypes } from "@ohif/extension-dicom-segmentation";

const { cacheVtkImage } = cornerstone3dUtils;

import SegmentationEditorViewport from "../components/SegmentationEditorLayout.js";
import { Enums as SegEditorEnums } from '../enums';

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
  };

  constructor() {
    super(...arguments);
  }

  getVolume(displayInstanceUID) {
    // Retrieve volume for the provided display set instance UID from C3D cache
    const vol = c3dCache.getVolume(displayInstanceUID);
    return vol?._vtkActor || null;
  }

  cacheVolume(displayInstanceUID, volumeActor) {
    // Store volume actor in C3D cache for lifecycle management
    let vol = c3dCache.getVolume(displayInstanceUID);
    if (!vol) {
      try {
        vol = cacheVtkImage(displayInstanceUID, {}, volumeActor.getMapper().getInputData());
      } catch (e) {
        console.warn('[OHIFSegmentationEditorViewport:cacheVolume] Failed to register volume in C3D cache:', e);
      }
    }
    if (vol) {
      vol._vtkActor = volumeActor;
    }
  }

  applyVolumeTransforms(vtkImage, volumeActor, volumeMapper, options) {
    console.log("TODO: Apply volume transforms");
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

      // Retrieve image data, labelmaps, and color settings
      const { imageDataObject, labelmapDataObject, labelmapColorLUT, labelmapDetails } = this.getViewportData(
          studies, StudyInstanceUID, displaySetInstanceUID, SOPInstanceUID, frameIndex);

      this.imageDataObject = imageDataObject;

      const volumeActor = this.getOrCreateVolume(imageDataObject, displaySetInstanceUID);

      // Begin progressively loading data
      this.setState({ percentComplete: 0, dataDetails }, () => {
        this.loadProgressively(imageDataObject);

        // Update load progress every 200 milliseconds.
        setTimeout(() => {

          // Set displaySet API properties and trigger displaySet service
          const { displaySet } = _component.props.viewportData;
          const { labelmapInstanceUID, labelmapMetadata } = labelmapDetails;
          if (displaySet && labelmapInstanceUID && !displaySet.labelmapInstanceUID) {

            // Add the labelmapInstanceUID to the displaySet. Also indicate the viewport as stable
            // to avoid unintentional mutation while the segmentation editor is loaded.
            displaySet.segmentationId = labelmapInstanceUID;
            displaySet.stableViewport = true;

            // Initialize the editor 3D rendering toggles to their defaults. Publishing satisfies
            // the non-nil guard in the toggle commands and seeds the toolbar state indicators.
            displaySet.segEditorVolumeRenderingEnabled = _component.state.segEditorVolumeRenderingEnabled;
            displaySet.segEditorSurfaceRenderingEnabled = _component.state.segEditorSurfaceRenderingEnabled;

            DisplaySetApi.Instance.displaySetService.addDisplaySets([displaySet]);
          }

          this.setState({
            volumes: [volumeActor],
            paintFilterLabelMapImageData: labelmapDataObject,
            paintFilterLabelMapDetails: labelmapDetails,
            paintFilterBackgroundImageData: imageDataObject.vtkImageData,
            labelmapColorLUT,
          });
        }, eventTimeout);
      });
    } catch (err) {

      // An error occurred while loading
      const errorTitle = "Failed to load image data.";
      const errorOptions = {};

      if (this.props.viewportIndex === 0) {

        // Log to logger service
        errorOptions.loggerService = true;

        // Set user display message
        errorOptions.message = err.message.includes("buffer")
          ? "Dataset is too large to display in volume rendering view"
          : err.message;

        // Attempt to retrieve study ID from URL
        errorOptions.studyId = extractStudyIdFromURL();
        errorOptions.studyError = errorOptions.studyId ? true : false;

        // User notification
        errorOptions.userNotification = true;
        errorOptions.userNotificationOptions = {
          type: 'error',
          autoClose: false,
          action: {
            label: 'Exit Segmentation Editor',
            onClick: ({ close }) => {
              close();
              _component.props.commandsManager.runCommand('setCornerstoneLayout');
            }
          }
        }
      }

      // Log Errors
      vtkUtils.logVtkError(this.props.servicesManager, errorTitle, errorOptions);

      // Set state to loaded to clear in-progress screens
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
      _component.setState(_.pick(displaySet, 'segEditorVolumeRenderingEnabled', 'segEditorSurfaceRenderingEnabled'));
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
        if (_ds && _ds.stableViewport) {

          // Restore style defaults on exit
          if (_ds.segmentationId) {

            _component.props.commandsManager.runCommand('setFillAlpha', {
              value: _component.labelmapStyleDefaults.fillAlpha, segmentationId: _ds.segmentationId
            }, vtkEnums.VIEWPORT);
            _component.props.commandsManager.runCommand('setOutlineWidth', {
              value: _component.labelmapStyleDefaults.outlineWidth, segmentationId: _ds.segmentationId
            }, vtkEnums.VIEWPORT);
            _component.props.commandsManager.runCommand('setRenderFill', {
              value: _component.labelmapStyleDefaults.renderFill, segmentationId: _ds.segmentationId
            }, vtkEnums.VIEWPORT);
            _component.props.commandsManager.runCommand('setRenderFillInactive', {
              value: _component.labelmapStyleDefaults.renderFillInactive, segmentationId: _ds.segmentationId
            }, vtkEnums.VIEWPORT);
            _component.props.commandsManager.runCommand('setRenderOutline', {
              value: _component.labelmapStyleDefaults.renderOutline, segmentationId: _ds.segmentationId
            }, vtkEnums.VIEWPORT);
            _component.props.commandsManager.runCommand('setRenderOutlineInactive', {
              value: _component.labelmapStyleDefaults.renderOutlineInactive, segmentationId: _ds.segmentationId
            }, vtkEnums.VIEWPORT);
          }

          // Clear segmentationId and the editor 3D rendering toggles from the displaySet
          // (mirrors the attribute lifecycle in OHIFVtkVolumeViewport.componentWillUnmount)
          _ds.segmentationId = undefined;
          _ds.volumeSegmentationId = undefined;
          _ds.segEditorVolumeRenderingEnabled = undefined;
          _ds.segEditorSurfaceRenderingEnabled = undefined;
          _ds.stableViewport = false;

          DisplaySetApi.Instance.displaySetService.addDisplaySets([_ds]);
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
        {!component.state.isLoaded && (
          <LoadingIndicator percentComplete={percentComplete} />
        )}
        {isLoaded && component.state.volumes && (

          <SegmentationEditorViewport
            servicesManager={component.props.servicesManager}
            volumes={component.state.volumes}
            paintFilterLabelMapImageData={component.state.paintFilterLabelMapImageData}
            paintFilterLabelMapDetails={component.state.paintFilterLabelMapDetails}
            paintFilterBackgroundImageData={component.state.paintFilterBackgroundImageData}
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
