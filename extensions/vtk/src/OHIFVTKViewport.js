import React from 'react';
// DO not Remove cornerstone, without it can be broken
import cornerstone from 'cornerstone-core';
import cornerstoneTools from 'cornerstone-tools';

import {
  Enums as C3dEnums,
} from "@cornerstonejs/core";

import { useViewerStudyErrors } from '@ohif/core/src/store/useViewerStudyErrors';
import { extractStudyIdFromURL } from '@ohif/core/src/utils/extractStudyIdFromURL';

import { eventTypes as uiEvents, Icon } from '@ohif/ui';

import { eventTypes as segmentationEventTypes } from '@ohif/extension-dicom-segmentation';

import Cornerstone3DInspectionView from './components/Cornerstone3DInspectionView.js';
import LoadingIndicator from './ohifComponents/LoadingIndicator.js';
import OHIFVtkBaseViewport from './ohifComponents/OHIFVtkBaseViewport.js';
import ConnectedVTKViewport from './ConnectedVTKViewport';

const segmentationModule = cornerstoneTools.getModule('segmentation');

const volumeCache = {};


class OHIFVTKMprViewport extends OHIFVtkBaseViewport {
  // OHIF VTK viewport used to retrieve images for the VTK MPR viewport.
  // Also manages interactions with the Cornerstone3D inspection ("details") view.

  static defaultProps = {
    onScroll: () => {},
  };

  static id = 'OHIFVTKViewport';

  state = {
    ...super.state,
    isInpsectionViewOpen: false,
  };

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

    if (options.lower && options.upper) {
      volumeActor.getProperty().getRGBTransferFunction(0).setRange(options.lower, options.upper);
    }

    // Set the sample distance to half the mean length of one side. This is where the divide by 6 comes from.
    // https://github.com/Kitware/VTK/blob/6b559c65bb90614fb02eb6d1b9e3f0fca3fe4b0b/Rendering/VolumeOpenGL2/vtkSmartVolumeMapper.cxx#L344
    const spacing = vtkImage.getSpacing();
    const sampleDistance = (spacing[0] + spacing[1] + spacing[2]) / 6;
    volumeMapper.setSampleDistance(sampleDistance);

    // Be generous to suppress warnings, as the logging really hurts performance.
    volumeMapper.setMaximumSamplesPerRay(4000);
  }

  setStateFromProps() {
    const { studies, displaySet } = this.props.viewportData;
    const { StudyInstanceUID, displaySetInstanceUID, sopClassUIDs, SOPInstanceUID, frameIndex } = displaySet;

    if (sopClassUIDs.length > 1) {
      console.warn('More than one SOPClassUID in the same series is not yet supported.');
    }

    const study = studies.find((study) => study.StudyInstanceUID === StudyInstanceUID);

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

      // Retrieve image and labelmap from viewport data
      const { imageDataObject, labelmapDataObject, labelmapColorLUT, labelmapDetails } = this.getViewportData(
        studies, StudyInstanceUID, displaySetInstanceUID, SOPInstanceUID, frameIndex);

      this.imageDataObject = imageDataObject;

      const volumeActor = this.getOrCreateVolume(imageDataObject, displaySetInstanceUID);

      this.setState(
        {
          percentComplete: 0,
          dataDetails,
        },
        () => {
          this.loadProgressively(imageDataObject);

          setTimeout(() => {
            this.setState({
              volumes: [volumeActor],
              paintFilterLabelMapImageData: labelmapDataObject,
              paintFilterLabelMapDetails: labelmapDetails,
              paintFilterBackgroundImageData: imageDataObject.vtkImageData,
              labelmapColorLUT,
            });
          }, 200);
        }
      );
    } catch (error) {
      // An error occurred while loading image data, log and notify user
      const errorTitle = 'Failed to load image data.';
      console.error(errorTitle, error);

      // Retrieve UI notification, logging, and UIModalService
      const { UINotificationService, LoggerService, UIModalService } = this.props.servicesManager.services;

      if (this.props.viewportIndex === 0) {
        const message = error.message.includes('buffer') ? 'Dataset is too big to display in MPR' : error.message;
        LoggerService.error({ error, message });

        const studyId = extractStudyIdFromURL();

        if (studyId) {
          // Will be called only on Viewer study page
          useViewerStudyErrors.getState().addError({ studyId, error: message, title: errorTitle });
        }

        UINotificationService.show({
          title: errorTitle,
          message,
          type: 'error',
          autoClose: false,
          action: {
            label: 'Exit 2D MPR',
            onClick: ({ close }) => {
              // context: 'ACTIVE_VIEWPORT::VTK',
              close();
              this.props.commandsManager.runCommand('setCornerstoneLayout');
            },
          },
        });
      }
      this.setState({ isLoaded: true });
    }
  }

  resizeViewport() {
    if (this.api && this.api.genericRenderWindow) {
      this.api.genericRenderWindow.resize();
    }
  }

  componentDidMount() {
    // Initialize component
    this.boundResizeViewport = this.resizeViewport.bind(this);

    // Subscribe to VTK tab events in order update component after UI changes
    document.addEventListener(segmentationEventTypes.SegmentationPanelTabUpdatedEvent, this.boundResizeViewport);
    document.addEventListener(uiEvents.sidebar.toggle, this.boundResizeViewport);

    // Load images to VTK.js viewport
    this.setStateFromProps();
  }

  componentDidUpdate(prevProps) {
    // Update component after change

    const { displaySet } = this.props.viewportData;
    const prevDisplaySet = prevProps.viewportData.displaySet;

    if (
      displaySet.displaySetInstanceUID !== prevDisplaySet.displaySetInstanceUID ||
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
  }

  render() {
    const component = this;
    const { configuration: segmentationConfiguration } = segmentationModule;
    const { UINotificationService, LoggerService, UIModalService } = this.props.servicesManager.services;
    
    let childrenWithProps = null;

    const handleToggleInspectionView = () => {
      // Display Cornerstone 3D tools inspection view for the volume
      
      const { viewportData, servicesManager } = component.props;
      const { 
        isInpsectionViewOpen, isLoaded, paintFilterBackgroundImageData, 
        paintFilterLabelMapImageData, paintFilterLabelMapDetails
      } = component.state;
      const { displaySet } = component.props.viewportData;
      const { SeriesDescription, SeriesInstanceUID, displaySetInstanceUID } = displaySet;

      const _api = component.props.commandsManager.runCommand('getVtkApiForViewportIndex', {
        index: component.props.viewportIndex,
      });

      let _o;
      if (component.props.viewportIndex == 1) {
        _o = C3dEnums.OrientationAxis.SAGITTAL;
      } else if (component.props.viewportIndex == 2) {
        _o = C3dEnums.OrientationAxis.CORONAL
      } else {
        _o = C3dEnums.OrientationAxis.AXIAL;
      }

      component.setState((prevState) => ({        
        isInpsectionViewOpen: !prevState.isEnlargedViewOpen,
      }));

      // Display detail view in modal
      const WrappedSeriesInspectionView = function() {
        return (
          <Cornerstone3DInspectionView
            viewportData={viewportData} isLoaded={isLoaded} volumes={component.state.volumes}
            onClose={() => component.setState({ isInpsectionViewOpen: false })}
            servicesManager={servicesManager} orientation={_o}
            paintFilterBackgroundImageData={paintFilterBackgroundImageData} 
            paintFilterLabelMapImageData={paintFilterLabelMapImageData}
            paintFilterLabelMapDetails={paintFilterLabelMapDetails}
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
          />
        );
      }

      UIModalService.show({
        content: WrappedSeriesInspectionView,
        title: SeriesDescription ? SeriesDescription : 'Details for Series '+(SeriesInstanceUID || displaySetInstanceUID),
        fullscreen: true,
        noScroll: true,
      });
    };

    // TODO: Does it make more sense to use Context?
    if (this.props.children && this.props.children.length) {
      childrenWithProps = this.props.children.map((child, index) => {
        return (
          child &&
          React.cloneElement(child, {
            viewportIndex: this.props.viewportIndex,
            key: index,
          })
        );
      });
    }

    const style = { width: '100%', height: '100%', position: 'relative' };

    return (
      <>
        <div style={style}>
          {!this.state.isLoaded && <LoadingIndicator percentComplete={this.state.percentComplete} />}
          {this.state.volumes && (
            <ConnectedVTKViewport
              volumes={this.state.volumes}
              paintFilterLabelMapImageData={this.state.paintFilterLabelMapImageData}
              paintFilterBackgroundImageData={this.state.paintFilterBackgroundImageData}
              viewportIndex={this.props.viewportIndex}
              dataDetails={this.state.dataDetails}
              labelmapRenderingOptions={{
                colorLUT: this.state.labelmapColorLUT,
                globalOpacity: segmentationConfiguration.fillAlpha,
                visible: segmentationConfiguration.renderFill,
                outlineThickness: segmentationConfiguration.outlineWidth,
                renderOutline: segmentationConfiguration.renderOutline,
                segmentsDefaultProperties: this.segmentsDefaultProperties,
                onNewSegmentationRequested: () => {
                  this.setStateFromProps();
                },
              }}
              onScroll={this.props.onScroll}
              afterCreation={(api) => (this.api = api)}
            />
          )}
        </div>
        {this.state.isLoaded && (
          <div className="zoomButton" onClick={handleToggleInspectionView} >
            <Icon name="search-plus" width="18px" height="18px" />
          </div>
        )}
        {childrenWithProps}
      </>
    );
  }
}


export default OHIFVTKMprViewport;
