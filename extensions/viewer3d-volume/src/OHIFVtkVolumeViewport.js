import React from "react";
import cornerstoneTools from "cornerstone-tools";

import { useViewerStudyErrors } from "@ohif/core/src/store/useViewerStudyErrors";
import { extractStudyIdFromURL } from "@ohif/core/src/utils/extractStudyIdFromURL";
import { eventTypes as segmentationEventTypes } from "@ohif/extension-dicom-segmentation";
import {
  LoadingIndicator,
  OHIFVtkBaseViewport,
  vtkUtils,
} from "@ohif/extension-vtk";
import { eventTypes as uiEvents } from "@ohif/ui";

import ConnectedVTKVolumeViewport from "./ConnectedVTKVolumeViewport.js";

const segmentationModule = cornerstoneTools.getModule("segmentation");

const volumeCache = {};


class OHIFVtkVolumeViewport extends OHIFVtkBaseViewport {
  // OHIF component that is able to retrieve and render a CT volume

  static id = "OHIFVtkVolumeViewport";

  state = {
    ...OHIFVtkBaseViewport.state,
    defaultColorPreset:
      vtkUtils.volumeColorPresetsConstants.VTK_VOLUME_CPROFILE_CT_BONE,
    activeColorPreset: "",
  };

  constructor() {
    super(...arguments);
  }

  getVolume(displaySetInstanceUID) {
    // Retrieve volume for the provided display set instance UID
    return volumeCache[displaySetInstanceUID];
  }

  cacheVolume(displaySetInstanceUID, volumeActor) {
    volumeCache[displaySetInstanceUID] = volumeActor;
  }

  applyVolumeTransforms(vtkImage, volumeActor, volumeMapper, options) {
    // Apply transforms and VTK properties to volume actor and mapper
    options = options || {};

    // Set color preset options
    const { activeColorPreset, defaultColorPreset } = this.state;
    options.vtkColorPreset = activeColorPreset || defaultColorPreset;

    vtkUtils.applyVtkVolumeRenderOptions(
      vtkImage,
      volumeActor,
      volumeMapper,
      options,
    );
  }

  setStateFromProps() {
    // Initialize VTK widgets, retrieve volume data, configure component, and initialize VTK volume rendering
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
      const { imageDataObject, labelmapDataObject, labelmapColorLUT } = this.getViewportData(studies,
          StudyInstanceUID, displaySetInstanceUID, SOPInstanceUID, frameIndex);

      this.imageDataObject = imageDataObject;

      const volumeActor = this.getOrCreateVolume(
        imageDataObject,
        displaySetInstanceUID,
      );

      // Begin progressively loading data
      this.setState({ percentComplete: 0, dataDetails }, () => {
        this.loadProgressively(imageDataObject);

        // Update load progress every 200 milliseconds.
        setTimeout(() => {
          this.setState({
            volumes: [volumeActor],
            paintFilterLabelMapImageData: labelmapDataObject,
            paintFilterBackgroundImageData: imageDataObject.vtkImageData,
            labelmapColorLUT,
          });
        }, 200);
      });
    } catch (err) {
      
      // An error occurred while loading image data, notify user
      const errorTitle = "Failed to load image data.";
      const errorOptions = {};

      // Log properties to study error list and display user notification
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
            label: 'Exit Volume Viewer',
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

  resizeViewport() {
    // Resize VTK.js render window
    if (this.api && this.api.genericRenderWindow) {
      this.api.genericRenderWindow.resize();
    }
  }

  componentDidMount() {
    // Retrieve image volume and initialize component
    const _component = this;
    this.boundResizeViewport = this.resizeViewport.bind(this);

    let loadAsync;
    const { displaySet } = this.props.viewportData;
    const { defaultColorPreset } = this.state;

    // Ensure that the default color profile is the correct one for the modality.
    if (
      displaySet &&
      displaySet.Modality &&
      defaultColorPreset !=
        vtkUtils.volumeColorPresetUtils.getDefaultVolumePresetForModality(
          displaySet.Modality,
        )
    ) {
      loadAsync = true;
      this.setState({
        defaultColorPreset:
          vtkUtils.volumeColorPresetUtils.getDefaultVolumePresetForModality(
            displaySet.Modality,
          ),
      });
    }

    // Subscribe to OHIF tab events in order to update component after UI changes
    document.addEventListener(segmentationEventTypes.SegmentationPanelTabUpdatedEvent, this.boundResizeViewport);
    document.addEventListener(uiEvents.sidebar.toggle, this.boundResizeViewport);

    // Load volumetric data: if state properties were changed, loadVolumeData needs
    // to be called asynchronously.
    const loadVolumeData = () => _component.setStateFromProps();
    if (loadAsync) {
      window.setTimeout(loadVolumeData, 10);
    } else {
      loadVolumeData();
    }
  }

  componentDidUpdate(prevProps, prevState) {
    // Process component update
    const { displaySet } = this.props.viewportData;
    const prevDisplaySet = prevProps.viewportData.displaySet;

    // Display set changed, re-render component
    if (
      displaySet.displaySetInstanceUID !==
        prevDisplaySet.displaySetInstanceUID ||
      displaySet.SOPInstanceUID !== prevDisplaySet.SOPInstanceUID ||
      displaySet.frameIndex !== prevDisplaySet.frameIndex
    ) {
      this.setStateFromProps();
    }
  }

  componentWillUnmount() {
    // Remove event handlers and reactive logic for viewport

    // Unsubscribe from VTK tab events
    document.removeEventListener(segmentationEventTypes.SegmentationPanelTabUpdatedEvent, this.boundResizeViewport);
    document.removeEventListener(uiEvents.sidebar.toggle, this.boundResizeViewport);

    // Set internal API reference to null
    this.api = null;
  }

  render() {
    const style = { width: "100%", height: "100%", position: "relative" };

    return (
      <>
        <div className="ohif-vtk-volume" style={style}>
          {!this.state.isLoaded && (
            <LoadingIndicator percentComplete={this.state.percentComplete} />
          )}
          {this.state.volumes && (
            <ConnectedVTKVolumeViewport
              volumes={this.state.volumes}
              viewportIndex={this.props.viewportIndex}
              dataDetails={this.state.dataDetails}
              afterCreation={(api) => (this.api = api)}
            />
          )}
        </div>
      </>
    );
  }
}


// Add volume rendering options to the interface
OHIFVtkVolumeViewport.propTypes = {
  ...OHIFVtkBaseViewport.propTypes,
};
OHIFVtkVolumeViewport.defaultProps = {
  ...(OHIFVtkBaseViewport.defaultProps || {}),
};


export default OHIFVtkVolumeViewport;
