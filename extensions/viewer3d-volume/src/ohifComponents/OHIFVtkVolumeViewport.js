import _ from "lodash";

import React from "react";
import PropTypes from "prop-types";

import OHIF from '@ohif/core';
import { extractStudyIdFromURL } from "@ohif/core/src/utils/extractStudyIdFromURL";
import { eventTypes as segmentationEventTypes } from "@ohif/extension-dicom-segmentation";
import {
  LoadingIndicator,
  VolumeFitNotice,
  OHIFVtkBaseViewport,
  vtkUtils,
} from "@ohif/extension-vtk";
import { eventTypes as uiEvents } from "@ohif/ui";

import ConnectedVTKVolumeViewport from "../connectedComponents/ConnectedVTKVolumeViewport.js";
import { TOOLS as VolViewerTools } from '../enums';

const { DisplaySetApi } = OHIF.display;

class OHIFVtkVolumeViewport extends OHIFVtkBaseViewport {
  // OHIF component that is able to retrieve and render a CT volume

  static id = "OHIFVtkVolumeViewport";

  state = {
    ...OHIFVtkBaseViewport.state,
    defaultColorPreset:
      vtkUtils.volumeColorPresetsConstants.VTK_VOLUME_CPROFILE_CT_BONE,
    activeColorPreset: "",
    segmentationSurfaceEnabled: false,
    imageVolumeRenderingEnabled: true,
  };

  constructor() {
    super(...arguments);
  }

  applyVolumeTransforms(vtkImage, volumeActor, volumeMapper, options) {
    // Volume rendering presets are applied to the Cornerstone3D volume actor by the view, not by
    // this class, which does not build a vtkVolume actor of its own.
    options = options || {};

    const { activeColorPreset, defaultColorPreset } = this.state;
    options.vtkColorPreset = activeColorPreset || defaultColorPreset;

    vtkUtils.applyVtkVolumeRenderOptions(vtkImage, volumeActor, volumeMapper, options);
  }

  setStateFromProps() {
    // Initialize VTK widgets, retrieve volume data, configure component, and initialize VTK volume rendering
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
      const { imageIds, labelmapDataObject, labelmapColorLUT, labelmapDetails } = this.getViewportData(studies,
          StudyInstanceUID, displaySetInstanceUID, SOPInstanceUID, frameIndex);

      _component.hasError = false;

      this.setState({
        percentComplete: 0, loadProgress: null, loadError: null, fit: null, dataDetails,
      }, () => {

        setTimeout(() => {

          // Set displaySet API properties and trigger displaySet service
          const { imageVolumeRenderingEnabled, segmentationSurfaceEnabled } = _component.state;
          const { displaySet } = _component.props.viewportData;
          const { labelmapInstanceUID, labelmapMetadata } = labelmapDetails;
          if (displaySet) {

            if (labelmapInstanceUID && !displaySet.labelmapInstanceUID) {

              // Add the labelmapInstanceUID to the displaySet. Also indicate the viewport as stable
              // to avoid unintentional mutation while the volume viewer is loaded.
              displaySet.segmentationId = labelmapInstanceUID;
              displaySet.segmentationSurfaceEnabled = segmentationSurfaceEnabled;
            }

            displaySet.imageVolumeRenderingEnabled = imageVolumeRenderingEnabled;
            displaySet.volumeCroppingEnabled = false;
            displaySet.volumeCropSelectActive = false;
            displaySet.volumeViewerToolMode = VolViewerTools.VOLVIEWER_TOOL_DEFAULT;
            displaySet.stableViewport = true;

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
          label: 'Exit Volume Viewer',
          onClick: ({ close }) => {
            close();
            _component.props.commandsManager.runCommand('setCornerstoneLayout');
          },
        },
      },
    });
  }

  resizeViewport() {
    // Resize VTK.js render window
    if (this.api && this.api.genericRenderWindow) {
      this.api.genericRenderWindow.resize();
    }
  }

  _evtDisplaySetApi({ apiEvent, ...apiData }) {
    // Manage displaySetApi events
    const _component = this;

    console.log('[OHIFVtkVolumeViewport:evt-diplsayset-api] apiEvent='+apiEvent+' apiData', apiData);
  }

  _evtDisplaySetUpdate({ displaySetInstanceUID, displaySet }) {
    // Apply displaySet updates to viewport state

    const _component = this;
    const { displaySetInstanceUID: viewportDisplaySetInstanceUID } = _component.props.viewportData.displaySet;

    if (displaySetInstanceUID == viewportDisplaySetInstanceUID) {

      console.log('[OHIFVtkVolumeViewport:evt-diplsayset-api] displaySetInstanceUID='+displaySetInstanceUID+' displaySet', displaySet);
      _component.setState(_.pick(displaySet, 'imageVolumeRenderingEnabled', 'segmentationSurfaceEnabled'));
    }
  }

  componentDidMount() {
    // Retrieve image volume and initialize component
    const _component = this;
    _component.boundResizeViewport = this.resizeViewport.bind(this);

    // Subscribe to displaySetService API events
    _component.displayset_apisync = DisplaySetApi.Instance.displaySetService.subscribe(
      DisplaySetApi.Instance.displaySetService.EVENTS.DISPLAY_SET_DATASYNC,
      _component._evtDisplaySetApi.bind(_component));

    // Subscribe to displaySetService update events
    _component.displayset_dataupdate = DisplaySetApi.Instance.displaySetService.subscribe(
      DisplaySetApi.Instance.displaySetService.EVENTS.DISPLAY_SET_CHANGED,
      _component._evtDisplaySetUpdate.bind(_component));

    let loadAsync;
    const { displaySet } = _component.props.viewportData;
    const { defaultColorPreset } = _component.state;

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
    const _component = this;
    const { eventTimeout } = _component.props;

    // Unsubscribe from VTK tab events
    document.removeEventListener(segmentationEventTypes.SegmentationPanelTabUpdatedEvent, this.boundResizeViewport);
    document.removeEventListener(uiEvents.sidebar.toggle, this.boundResizeViewport);

    // displaySet API events
    _component.displayset_apisync?.unsubscribe();
    _component.displayset_dataupdate?.unsubscribe();

    setTimeout(() => {
      const { displaySet } = _component.props.viewportData;
      const { displaySetInstanceUID } = displaySet;

      if (displaySetInstanceUID) {
        console.log('[OHIFVtkVolumeViewport:component-unmounting]', displaySetInstanceUID, displaySet);

        // Pull displaySet data from service to ensure that it is up to date. The displaySet data
        // on the props hash may have been mutated and will not have an accurate state of the volume viewer.
        const _ds = DisplaySetApi.Instance.displaySetService.getDisplaySetByUID(displaySetInstanceUID);
        if (_ds && _ds.stableViewport) {

          // Clear segmentationId from displaySet
          _ds.imageVolumeRenderingEnabled = undefined;
          _ds.segmentationSurfaceEnabled = undefined;
          _ds.volumeCroppingEnabled = undefined;
          _ds.volumeCropSelectActive = undefined;
          _ds.volumeViewerToolMode = undefined;
          _ds.segmentationId = undefined;
          _ds.stableViewport = false;

          DisplaySetApi.Instance.displaySetService.addDisplaySets([_ds]);
        }
      }
    }, eventTimeout);
  }

  render() {
    const component = this;

    const style = { width: "100%", height: "100%", position: "relative" };

    return (
      <>
        <div className="ohif-vtk-volume" style={style}>
          {!component.state.loadProgress?.complete && (
            <LoadingIndicator
              percentComplete={component.state.percentComplete}
              loadProgress={component.state.loadProgress}
            />
          )}
          <VolumeFitNotice fit={component.state.fit} />
          {component.state.imageIds && (
            <ConnectedVTKVolumeViewport
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
                segmentsDefaultProperties: component.segmentsDefaultProperties,
                onNewSegmentationRequested: () => {
                  component.setStateFromProps();
                },
              }}
              viewportIndex={component.props.viewportIndex}
              dataDetails={component.state.dataDetails}
              afterCreation={(api) => (component.api = api)}
              imageVolumeRenderingEnabled={component.state.imageVolumeRenderingEnabled}
              segmentationSurfaceEnabled={component.state.segmentationSurfaceEnabled}
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
  eventTimeout: PropTypes.number,
};
OHIFVtkVolumeViewport.defaultProps = {
  ...(OHIFVtkBaseViewport.defaultProps || {}),
  eventTimeout: 50,
};


export default OHIFVtkVolumeViewport;
