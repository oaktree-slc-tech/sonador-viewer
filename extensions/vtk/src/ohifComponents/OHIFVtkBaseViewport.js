import React, { Component } from 'react';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkVolume from '@kitware/vtk.js/Rendering/Core/Volume';
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';
import { getImageData, loadImageData } from '@sonador/react-vtkjs-viewport';
import cornerstone from 'cornerstone-core';
import cornerstoneTools from 'cornerstone-tools';
import PropTypes from 'prop-types';

import OHIF from '@ohif/core';

const segmentationModule = cornerstoneTools.getModule('segmentation');

const { StackManager } = OHIF.utils;

// TODO: Find a long term (service based) location for the labelmap cache
const labelmapCache = {};

function _getRangeFromWindowLevels(width, center, Modality = undefined) {
  /** Takes window levels and converts them to a range (lower/upper)
   * for use with VTK RGBTransferFunction
   *
   * @private
   * @param {number} [width] - the width of our window
   * @param {number} [center] - the center of our window
   * @param {string} [Modality] - 'PT', 'CT', etc.
   * @returns { lower, upper } - range
   */

  // For PET just set the range to 0-5 SUV
  if (Modality === 'PT') {
    return { lower: 0, upper: 5 };
  }

  const levelsAreNotNumbers = isNaN(center) || isNaN(width);

  if (levelsAreNotNumbers) {
    return { lower: 0, upper: 512 };
  }

  return {
    lower: center - width / 2.0,
    upper: center + width / 2.0,
  };
}

class OHIFVtkBaseViewport extends Component {
  // Component base class which can be used to work with VTK based volumetric data
  // in OHIF. Provides methods and state properties to download image stacks and covert
  // them to volumetric representations.

  state = {
    volumes: null,
    paintFilterLabelMapImageData: null,
    paintFilterBackgroundImageData: null,
    percentComplete: 0,
    isLoaded: false,
  };

  static propTypes = {
    viewportData: PropTypes.shape({
      studies: PropTypes.array.isRequired,
      displaySet: PropTypes.shape({
        StudyInstanceUID: PropTypes.string.isRequired,
        displaySetInstanceUID: PropTypes.string.isRequired,
        sopClassUIDs: PropTypes.arrayOf(PropTypes.string),
        SOPInstanceUID: PropTypes.string,
        frameIndex: PropTypes.number,
      }),
    }),
    viewportIndex: PropTypes.number.isRequired,
    children: PropTypes.node,
    onScroll: PropTypes.func,
    servicesManager: PropTypes.object.isRequired,
  };

  static destroy() {
    StackManager.clearStacks();
  }

  static id = 'OHIFVtkBaseViewport';

  static getCornerstoneStack(studies, StudyInstanceUID, displaySetInstanceUID, SOPInstanceUID, frameIndex) {
    // Create shortcut to displaySet
    const study = studies.find((study) => study.StudyInstanceUID === StudyInstanceUID);

    const displaySet = study.displaySets.find((set) => {
      return set.displaySetInstanceUID === displaySetInstanceUID;
    });

    // Get stack from Stack Manager
    const storedStack = StackManager.findOrCreateStack(study, displaySet);

    // Clone the stack here so we don't mutate it
    const stack = Object.assign({}, storedStack);

    if (frameIndex !== undefined) {
      stack.currentImageIdIndex = frameIndex;
    } else if (SOPInstanceUID) {
      const index = stack.imageIds.findIndex((imageId) => {
        const imageIdSOPInstanceUID = cornerstone.metaData.get('SOPInstanceUID', imageId);
        return imageIdSOPInstanceUID === SOPInstanceUID;
      });

      if (index > -1) {
        stack.currentImageIdIndex = index;
      }
    } else {
      stack.currentImageIdIndex = 0;
    }

    return stack;
  }

  getViewportData = (studies, StudyInstanceUID, displaySetInstanceUID, SOPClassUID, SOPInstanceUID, frameIndex) => {
    // Load image and segmentation data from OHIF image service

    const { UINotificationService } = this.props.servicesManager.services;

    // Retrieve cornerstone image stack
    const stack = OHIFVtkBaseViewport.getCornerstoneStack(
      studies,
      StudyInstanceUID,
      displaySetInstanceUID,
      SOPClassUID,
      SOPInstanceUID,
      frameIndex
    );

    const imageDataObject = getImageData(stack.imageIds, displaySetInstanceUID);
    let labelmapDataObject;
    let labelmapColorLUT;

    const firstImageId = stack.imageIds[0];
    const { state } = segmentationModule;
    const brushStackState = state.series[firstImageId];

    if (brushStackState) {
      const { activeLabelmapIndex } = brushStackState;
      const labelmap3D = brushStackState.labelmaps3D[activeLabelmapIndex];

      if (brushStackState.labelmaps3D.length > 1 && this.props.viewportIndex === 0) {
        UINotificationService.show({
          title: 'Overlapping Segmentation Found',
          message: 'Overlapping segmentations cannot be displayed when in MPR mode',
          type: 'info',
        });
      }

      this.segmentsDefaultProperties = labelmap3D.segmentsHidden.map((isHidden) => {
        return { visible: !isHidden };
      });

      const vtkLabelmapID = `${firstImageId}_${activeLabelmapIndex}`;

      if (labelmapCache[vtkLabelmapID]) {
        labelmapDataObject = labelmapCache[vtkLabelmapID];
      } else {
        // TODO -> We need an imageId based getter in cornerstoneTools
        const labelmapBuffer = labelmap3D.buffer;

        // Create VTK Image Data with buffer as input
        labelmapDataObject = vtkImageData.newInstance();

        const dataArray = vtkDataArray.newInstance({
          numberOfComponents: 1, // labelmap with single component
          values: new Uint16Array(labelmapBuffer),
        });

        labelmapDataObject.getPointData().setScalars(dataArray);
        labelmapDataObject.setDimensions(...imageDataObject.dimensions);
        labelmapDataObject.setSpacing(...imageDataObject.vtkImageData.getSpacing());
        labelmapDataObject.setOrigin(...imageDataObject.vtkImageData.getOrigin());
        labelmapDataObject.setDirection(...imageDataObject.vtkImageData.getDirection());

        // Cache the labelmap volume.
        labelmapCache[vtkLabelmapID] = labelmapDataObject;
      }
      labelmapColorLUT = state.colorLutTables[labelmap3D.colorLUTIndex];
    }

    return {
      imageDataObject,
      labelmapDataObject,
      labelmapColorLUT,
    };
  };

  getVolume(displaySetInstanceUID) {
    // Retrieve volume for the provided display set instance UID
    // @returns vtkVolumeActor or undefined (if a volume does not exist)

    throw new Error('getVolume must be implemented in child classes');
  }

  cacheVolume(displaySetInstanceUID, volumeActor) {
    // Cache volume

    throw new Error('cacheVolume must be implemented in child classes');
  }

  getOrCreateVolume(imageDataObject, displaySetInstanceUID) {
    /**	Create volume from the provided image data object

		* @param {object} imageDataObject
		* @param {object} imageDataObject.vtkImageData
		* @param {object} imageDataObject.imageMetaData0
		* @param {number} [imageDataObject.imageMetaData0.WindowWidth] - The volume's initial WindowWidth
		* @param {number} [imageDataObject.imageMetaData0.WindowCenter] - The volume's initial WindowCenter
		* @param {string} imageDataObject.imageMetaData0.Modality - CT, MR, PT, etc
		* @param {string} displaySetInstanceUID
		*
		* @returns vtkVolumeActor
		* @memberof OHIFVtkBaseViewport
		*/

    // Retrieve volume instance from cache (if present)
    let volumeActor = this.getVolume(displaySetInstanceUID);
    if (volumeActor) {
      return volumeActor;
    }

    const { vtkImageData, imageMetaData0 } = imageDataObject;
    // TODO -> Should update react-vtkjs-viewport and react-cornerstone-viewports
    // internals to use naturalized DICOM JSON names.
    const { windowWidth: WindowWidth, windowCenter: WindowCenter, modality: Modality } = imageMetaData0;

    const { lower, upper } = _getRangeFromWindowLevels(WindowWidth, WindowCenter, Modality);
    volumeActor = vtkVolume.newInstance();
    const volumeMapper = vtkVolumeMapper.newInstance();

    volumeActor.setMapper(volumeMapper);
    volumeMapper.setInputData(vtkImageData);

    // Apply VTK transforms for the volume
    this.applyVolumeTransforms(vtkImageData, volumeActor, volumeMapper, {
      lower,
      upper,
      windowWidth: WindowWidth,
      windowCenter: WindowCenter,
      modality: Modality,
    });

    // Cache the volume
    this.cacheVolume(displaySetInstanceUID, volumeActor);
    return volumeActor;
  }

  applyVolumeTransforms(vtkImage, volumeActor, volumeMapper, options) {
    // Abstract Method: Apply transforms and VTK properties to VTK volume actor and mapper

    throw new Error('applyVolumeTransforms must be implemented in child classes');
  }

  loadProgressively(imageDataObject) {
    // Load and render the image stack progressively as it is retrieved by the image service.

    loadImageData(imageDataObject);

    const { isLoading, imageIds } = imageDataObject;

    if (!isLoading) {
      this.setState({ isLoaded: true });
      return;
    }

    const NumberOfFrames = imageIds.length;

    const onPixelDataInsertedCallback = (numberProcessed) => {
      const percentComplete = Math.floor((numberProcessed * 100) / NumberOfFrames);

      if (percentComplete !== this.state.percentComplete) {
        this.setState({
          percentComplete,
        });
      }
    };

    const onPixelDataInsertedErrorCallback = (error) => {
      const { UINotificationService, LoggerService } = this.props.servicesManager.services;

      if (!this.hasError) {
        if (this.props.viewportIndex === 0) {
          // Only show the notification from one viewport 1 in multi-viewport layouts
          LoggerService.error({ error, message: error.message });
          UINotificationService.show({
            title: 'Image Load Error',
            message: error.message,
            type: 'error',
            autoClose: false,
          });
        }

        this.hasError = true;
      }
    };

    const onAllPixelDataInsertedCallback = () => {
      this.setState({
        isLoaded: true,
      });
    };

    imageDataObject.onPixelDataInserted(onPixelDataInsertedCallback);
    imageDataObject.onAllPixelDataInserted(onAllPixelDataInsertedCallback);
    imageDataObject.onPixelDataInsertedError(onPixelDataInsertedErrorCallback);
  }
}

export default OHIFVtkBaseViewport;
