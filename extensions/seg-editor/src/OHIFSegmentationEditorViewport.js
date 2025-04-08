import _ from "lodash";

import React, { Component } from "react";
import PropTypes from "prop-types";
import cornerstoneTools from 'cornerstone-tools';

import OHIF from "@ohif/core";
import { useViewerStudyErrors } from "@ohif/core/src/store/useViewerStudyErrors";
import { extractStudyIdFromURL } from "@ohif/core/src/utils/extractStudyIdFromURL";
import { eventTypes as uiEvents } from "@ohif/ui";

import {
  LoadingIndicator,
  OHIFVtkBaseViewport,
  vtkUtils,
} from "@ohif/extension-vtk";
import { eventTypes as segmentationEventTypes } from "@ohif/extension-dicom-segmentation";

import SegmentationEditorViewport from "./SegmentationEditorViewport.js";

const segmentationModule = cornerstoneTools.getModule('segmentation');


const segmentationVolumeCache = {};


class OHIFSegmentationEditorViewport extends OHIFVtkBaseViewport {
  // OHIF viewport with support for retrieving segmentation masks using Cornerstone3D and initializing
  // a viewport capable of displaying them for editing.

  static id = "OHIFSegmentationEditorViewport";

  state = {
    ...OHIFVtkBaseViewport.state,
  };

  constructor() {
    super(...arguments);
  }

  getVolume(displayInstanceUID) {
    // Retrieve volume for the provided display set instance UID
    return segmentationVolumeCache[displayInstanceUID];
  }

  cacheVolume(displayInstanceUID, volumeActor) {
    segmentationVolumeCache[displayInstanceUID] = volumeActor;
  }

  applyVolumeTransforms(vtkImage, volumeActor, volumeMapper, options) {
    console.log("TODO: Apply volume transforms");
  }

  setStateFromProps() {
    // Retrieve DICOM data, segmentations, and other metadata needed for the segmentation editor.
    const _component = this;

    // Retrieve study metadata
    const { studies, displaySet } = this.props.viewportData;
    const {
      StudyInstanceUID,
      displaySetInstanceUID,
      sopClassUIDs,
      SOPInstanceUID,
      frameIndex,
    } = displaySet;

    console.log("Set state from properties", StudyInstanceUID, displaySetInstanceUID || '(undefined)', frameIndex);

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
          this.setState({
            volumes: [volumeActor],
            paintFilterLabelMapImageData: labelmapDataObject,
            paintFilterLabelMapDetails: labelmapDetails,
            paintFilterBackgroundImageData: imageDataObject.vtkImageData,
            labelmapColorLUT,
          });
        }, 200);
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

  resizeViewport() {
    // Resize VTK.js render windows
    if (this.api && this.api.genericRenderWindow) {
      this.api.genericRenderWindow.resize();
    }
  }

  componentDidMount() {
    // Retrieve segmentation data and initialize component
    const _component = this;
    _component.boundResizeViewport = _component.resizeViewport.bind(_component);

    let loadAsync;
    const { displaySet } = _component.props.viewportData;

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

    // Unsubscribe from VTK tab events
    document.removeEventListener(segmentationEventTypes.SegmentationPanelTabUpdatedEvent, _component.boundResizeViewport);
    document.removeEventListener(uiEvents.sidebar.toggle, _component.boundResizeViewport);
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
          />
        )}
      </div>
      </>
    );
  }
}


OHIFSegmentationEditorViewport.propTypes = {
  ...OHIFVtkBaseViewport.propTypes,
};
OHIFSegmentationEditorViewport.defaultProps = {
  ...(OHIFVtkBaseViewport.defaultProps || {}),
};


export default OHIFSegmentationEditorViewport;
