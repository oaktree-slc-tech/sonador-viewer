import React, { Component } from 'react';
import PropTypes from 'prop-types';

import cornerstone from 'cornerstone-core';
import cornerstoneTools from 'cornerstone-tools';

import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkVolume from '@kitware/vtk.js/Rendering/Core/Volume';
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';

import OHIF from '@ohif/core';
import { eventTypes as uiEvents } from '@ohif/ui';
import { eventTypes as segmentationEventTypes } from '@ohif/extension-dicom-segmentation';

import { getImageData, loadImageData } from '@sonador/react-vtkjs-viewport';

import OHIFVtkBaseViewport from './ohifComponents/OHIFVtkBaseViewport.js';
import LoadingIndicator from './ohifComponents/LoadingIndicator.js';

import ConnectedVTKViewport from './ConnectedVTKViewport';

const segmentationModule = cornerstoneTools.getModule('segmentation');

const { StackManager } = OHIF.utils;

const volumeCache = {};

// TODO: Figure out where we plan to put this long term

/**
 * Create a labelmap image with the same dimensions as our background volume.
 *
 * @param backgroundImageData vtkImageData
 */
/* TODO: Not currently used until we have drawing tools in vtkjs.
function createLabelMapImageData(backgroundImageData) {
  // TODO => Need to do something like this if we start drawing a new segmentation
  // On a vtkjs viewport.

  const labelMapData = vtkImageData.newInstance(
    backgroundImageData.get('spacing', 'origin', 'direction')
  );
  labelMapData.setDimensions(backgroundImageData.getDimensions());
  labelMapData.computeTransforms();

  const values = new Uint8Array(backgroundImageData.getNumberOfPoints());
  const dataArray = vtkDataArray.newInstance({
    numberOfComponents: 1, // labelmap with single component
    values,
  });
  labelMapData.getPointData().setScalars(dataArray);

  return labelMapData;
} */

class OHIFVTKViewport extends OHIFVtkBaseViewport {
  // OHIF VTK viewport which can be used to retrieve image volumes for use by the OHIF MPR tool

  static defaultProps = {
    onScroll: () => {},
  };

  static id = 'OHIFVTKViewport';

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
      volumeActor
        .getProperty()
        .getRGBTransferFunction(0)
        .setRange(options.lower, options.upper);
    }

    // Set the sample distance to half the mean length of one side. This is where the divide by 6 comes from.
    // https://github.com/Kitware/VTK/blob/6b559c65bb90614fb02eb6d1b9e3f0fca3fe4b0b/Rendering/VolumeOpenGL2/vtkSmartVolumeMapper.cxx#L344
    const spacing = vtkImage.getSpacing();
    const sampleDistance = (spacing[0] + spacing[1] + spacing[2]) / 6;
    volumeMapper.setSampleDistance(sampleDistance);

    // Be generous to suppress warnings, as the logging really hurts performance.
    // TODO: maybe we should auto adjust samples to 1000.
    volumeMapper.setMaximumSamplesPerRay(4000);
  }

  setStateFromProps() {
    const { studies, displaySet } = this.props.viewportData;
    const {
      StudyInstanceUID,
      displaySetInstanceUID,
      sopClassUIDs,
      SOPInstanceUID,
      frameIndex,
    } = displaySet;

    if (sopClassUIDs.length > 1) {
      console.warn(
        'More than one SOPClassUID in the same series is not yet supported.'
      );
    }

    const study = studies.find(
      (study) => study.StudyInstanceUID === StudyInstanceUID
    );

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
      const { imageDataObject, labelmapDataObject, labelmapColorLUT } =
        this.getViewportData(
          studies,
          StudyInstanceUID,
          displaySetInstanceUID,
          SOPInstanceUID,
          frameIndex
        );

      this.imageDataObject = imageDataObject;

      /* TODO: Not currently used until we have drawing tools in vtkjs.
      if (!labelmap) {
        labelmap = createLabelMapImageData(data);
      } */

      const volumeActor = this.getOrCreateVolume(
        imageDataObject,
        displaySetInstanceUID
      );

      this.setState(
        {
          percentComplete: 0,
          dataDetails,
        },
        () => {
          this.loadProgressively(imageDataObject);

          // TODO: There must be a better way to do this.
          // We do this so that if all the data is available the react-vtkjs-viewport
          // Will render _something_ before the volumes are set and the volume
          // Construction that happens in react-vtkjs-viewport locks up the CPU.
          setTimeout(() => {
            this.setState({
              volumes: [volumeActor],
              paintFilterLabelMapImageData: labelmapDataObject,
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

      // Retrieve UI notification and logging service
      const { UINotificationService, LoggerService } =
        this.props.servicesManager.services;
      if (this.props.viewportIndex === 0) {
        const message = error.message.includes('buffer')
          ? 'Dataset is too big to display in MPR'
          : error.message;
        LoggerService.error({ error, message });
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
    document.addEventListener(
      segmentationEventTypes.SegmentationPanelTabUpdatedEvent,
      this.boundResizeViewport
    );
    document.addEventListener(
      uiEvents.sidebar.toggle,
      this.boundResizeViewport
    );

    // Load images to VTK.js viewport
    this.setStateFromProps();
  }

  componentDidUpdate(prevProps, prevState) {
    // Update component after change

    const { displaySet } = this.props.viewportData;
    const prevDisplaySet = prevProps.viewportData.displaySet;

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
    document.removeEventListener(
      segmentationEventTypes.SegmentationPanelTabUpdatedEvent,
      this.boundResizeViewport
    );
    document.removeEventListener(
      uiEvents.sidebar.toggle,
      this.boundResizeViewport
    );
  }

  render() {
    let childrenWithProps = null;
    const { configuration } = segmentationModule;

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
          {!this.state.isLoaded && (
            <LoadingIndicator percentComplete={this.state.percentComplete} />
          )}
          {this.state.volumes && (
            <ConnectedVTKViewport
              volumes={this.state.volumes}
              paintFilterLabelMapImageData={
                this.state.paintFilterLabelMapImageData
              }
              paintFilterBackgroundImageData={
                this.state.paintFilterBackgroundImageData
              }
              viewportIndex={this.props.viewportIndex}
              dataDetails={this.state.dataDetails}
              labelmapRenderingOptions={{
                colorLUT: this.state.labelmapColorLUT,
                globalOpacity: configuration.fillAlpha,
                visible: configuration.renderFill,
                outlineThickness: configuration.outlineWidth,
                renderOutline: configuration.renderOutline,
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
        )}
        {childrenWithProps}
      </>
    );
  }
}

export default OHIFVTKViewport;
