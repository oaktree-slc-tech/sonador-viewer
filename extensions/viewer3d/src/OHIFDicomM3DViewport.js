import React, { Component } from 'react';
import dcmjs from 'dcmjs';
import dicomParser from 'dicom-parser';
import _ from 'lodash';
import PropTypes from 'prop-types';

import OHIF from '@ohif/core';
import { str2ab } from '@ohif/core';
import { LoadingIndicator } from '@ohif/extension-vtk';
import { eventTypes as uiEvents } from '@ohif/ui';

import M3DModelView from './threejs/M3DModelView.js';
import { MIMETYPE_STL, SOP_CLASS_UIDS } from './OHIFDicom3DSopClassHandler.js';

import './styles/LoadingIndicator.css';

const { DicomLoaderService, createEncapsulatedDocumentFileUrl } = OHIF.utils;

class OHIFDicomM3DViewport extends Component {
  // OHIF viewport with support for displaying 3D models and scenes. Supports STL and GLB.
  // STL files may be part of a series with multiple models.
  // TODO: Implement support for USDZ files.

  static propTypes = {
    studies: PropTypes.object,
    displaySet: PropTypes.object,
    viewportIndex: PropTypes.number,
    viewportData: PropTypes.object,
    activeViewportIndex: PropTypes.number,
    setViewportActive: PropTypes.func,
    setViewportSpecificData: PropTypes.func,
    getStaticUrl: PropTypes.func,
  };

  state = {
    byteArray: null,
    models: [],
    modelType: '',
    modelCount: 0,
    error: null,
    isLoaded: false,
    cinePlaying: false,
    cineFrameRate: 60,
    percentComplete: 0,
  };

  static id = 'OHIFDicomM3dViewport';

  onModelLoaded(api) {
    // Set API reference for the Three.js viewport, mark the model as loaded, and remove overlay.
    this.api = api;
    this.setState({ isLoaded: true });

    if (
      this.api.sceneData &&
      this.api.sceneData.animations &&
      this.api.sceneData.animations.length &&
      _.isFunction(this.props.setViewportSpecificData)
    ) {
      this.props.setViewportSpecificData({
        m3d: { animations: true },
        cine: {
          isPlaying: this.state.cinePlaying,
          cineFrameRate: this.state.cineFrameRate,
        },
      });
    }

    // Bind DOM events
    this.bindDomEvents();
  }

  parseByteArray(byteArray) {
    // Parse byte array to dataset
    let dataset;

    try {
      dataset = dicomParser.parseDicom(byteArray);
    } catch (error) {
      console.error('Unable to parse DICOM file: ', error);
      this.setState((state) => ({ ...state, error }));
    }

    return dataset;
  }

  resizeViewport() {
    // Resize Three.js render window

    if (this.api) {
      this.api.resize();
      this.api.render();
    }
  }

  get3DModelFileUrl(dataSet, byteArray, options) {
    // Unpack the the 3D model data to a file URL
    options = options || {};

    if (dataSet) {
      // Ensure that the 3D model is supported
      const SOPClassUID = dataSet.string('x00080016');
      if (!_.includes(_.values(SOP_CLASS_UIDS), SOPClassUID)) {
        throw new Error('Invalid DICOM-encapsulated 3D model type: ' + SOPClassUID);
      }
    }

    return createEncapsulatedDocumentFileUrl(dataSet, byteArray, options);
  }

  getOrCreate3DModel(byteArray) {
    // Parse the provided byte array to a dataset and file URL
    const { displaySet } = this.props.viewportData;
    const { series } = displaySet;

    const modelDataset = this.parseByteArray(byteArray);
    const modelType = modelDataset ? modelDataset.string('x00420012') : undefined;

    // Parse instance properties to retrieve display properties
    const SOPInstanceUID = modelDataset ? modelDataset.string('x00080018') : undefined;
    let modelColor;
    if (SOPInstanceUID) {
      const instance = series.getInstanceByUID(SOPInstanceUID);
      const idata = instance.getData().metadata;
      modelColor = idata.RecommendedDisplayCIELabValue
        ? OHIF.utils.color.rgb2hex(
            ...dcmjs.data.Colors.dicomlab2RGB(idata.RecommendedDisplayCIELabValue).map((x) => Math.round(x * 255))
          )
        : undefined;
    }

    // const colorRgb = modelDataset ? modelDataset.number('x0062000d') : undefined;
    // Create blob URL
    const modelFileUrl = this.get3DModelFileUrl(modelDataset, byteArray, {
      mimetype: modelType,
    });

    return { byteArray, modelDataset, modelType, modelFileUrl, modelColor };
  }

  fetchModel() {
    // Retrieve DICOM model instances.

    const { displaySet, studies, metadata } = this.props.viewportData;
    const { numImageFrames, series } = displaySet;

    // File available from cache, retrieve and set inline byte array
    if (displaySet.metadata && displaySet.metadata.EncapsulatedDocument) {
      const { InlineBinary, BulkDataURI } = displaySet.metadata.EncapsulatedDocument;

      if (InlineBinary) {
        // Create dataset from DICOM inline binary data
        const inlineBinaryData = atob(InlineBinary);
        const mdata = this.getOrCreate3DModel(str2ab(inlineBinaryData));
        this.setState({
          modelCount: 1,
          models: [mdata],
          modelType: mdata.modelType,
          percentComplete: 100,
        });
        return;
      }
    }

    if (!numImageFrames && _.isUndefined(numImageFrames)) {
      this.setState({ modelCount: 1 });

      // Retrieve single model file from remote server
      DicomLoaderService.findDicomDataPromise(displaySet, studies).then(
        (data) => {
          const mdata = this.getOrCreate3DModel(new Uint8Array(data));
          this.setState({
            models: [mdata],
            percentComplete: 100,
            modelType: mdata.modelType,
          });
        },
        (error) => {
          this.setState({ error });
          throw new Error(error);
        }
      );
    } else if (numImageFrames && numImageFrames > 1) {
      this.setState({ modelCount: numImageFrames });

      // Retrieve multiple models from remote server
      const _component = this;

      _.times(numImageFrames, function (i) {
        // Retrieve DICOM instance
        const instance = series.getInstanceByIndex(i);

        // Create a copy of the display set and add instance specific data.
        const displayInstance = _.extend(_.clone(displaySet), {
          wadoUri: instance.getData().wadouri,
          SOPInstanceUID: instance.getSOPInstanceUID(),
        });

        // Retrieve DICOM instances for all models
        DicomLoaderService.findDicomDataPromise(displayInstance, studies).then(
          (data) => {
            const { percentComplete, modelCount, modelType, models } = _component.state;

            // Retrieve model instance from DICOM data
            const mdata = _component.getOrCreate3DModel(new Uint8Array(data));

            // Create update to component state
            let newState = {
              models: [...models, mdata],
              percentComplete:
                models.length + 1 == numImageFrames ? 100 : Math.round(percentComplete + 100 * (1 / modelCount)),
            };
            if (!modelType) {
              newState.modelType = mdata.modelType;
            }

            // Add -90 degree x transform for STL models so that
            // the major axis (x) will point upwards and the model will appear to be
            // facing the viewer. If the transform is not applied, the orbit controls
            // have an extremely limited range.
            if (modelType == MIMETYPE_STL) {
              newState.coordinateTransform = {
                rotation: [-Math.PI / 2, 0, 0],
              };
            }

            // Update component state
            _component.setState(newState);
          },
          (error) => {
            _component.setState({ error });
            throw new Error(error);
          }
        );
      });
    }
  }

  onInteractionStart() {
    // Model interaction events
    const { viewportIndex, activeViewportIndex, setViewportActive } = this.props;

    // Set viewport active (if it is not already)
    if (viewportIndex != activeViewportIndex && _.isFunction(setViewportActive)) {
      setViewportActive();
    }
  }

  componentDidMount() {
    // Retrieve 3D model and initialize component
    const component = this;
    this.fetchModel();
  }

  bindDomEvents() {
    // Bind to DOM events to respond to changes in UI
    const component = this;

    // Subscribe to OHIF tab event in order to update component after UI changes
    this.boundResizeViewport = this.resizeViewport.bind(this);
    document.addEventListener(uiEvents.sidebar.toggle, this.boundResizeViewport);
    document.addEventListener(uiEvents.viewport.update, this.boundResizeViewport);
    window.addEventListener('resize', this.boundResizeViewport);
  }

  removeDomEvents() {
    // Unbind DOM events

    document.removeEventListener(uiEvents.sidebar.toggle, this.boundResizeViewport);
    document.removeEventListener(uiEvents.viewport.update, this.boundResizeViewport);
    window.removeEventListener('resize', this.boundResizeViewport);
  }

  componentDidUpdate(prevProps, prevState) {
    // Update m3D view
    const { viewportData } = this.props;
    const { displaySet } = viewportData;
    const prevDisplaySet = (prevProps.viewportData || {}).displaySet;

    // Determine if the active display set changed, if so load the new dataset
    if (
      displaySet.displaySetInstanceUID !== prevDisplaySet.displaySetInstanceUID ||
      displaySet.SOPInstanceUID !== prevDisplaySet.SOPInstanceUID ||
      displaySet.frameIndex !== prevDisplaySet.frameIndex
    ) {
      // Remove DOM events and reference to previous API object
      this.removeDomEvents();
      this.api = null;

      // Clear actively loaded model and reset CINE controls
      this.setState({
        isLoaded: false,
        byteArray: null,
        models: [],
        error: null,
        cinePlaying: false,
        cineFrameRate: 60,
        percentComplete: 0,
      });
      if (this.props.setViewportSpecificData && _.isFunction(this.props.setViewportSpecificData)) {
        this.props.setViewportSpecificData({
          m3d: {},
          cine: {
            isPlaying: this.state.cinePlaying,
            cineFrameRate: this.state.cineFrameRate,
          },
        });
      }

      // Load new model instance
      this.fetchModel();
    }

    // Update current display set
    else {
      const { m3d, cine } = viewportData.displaySet || {};

      const { isPlaying, cineFrameRate } = cine || {};

      if (m3d || {}.animations) {
        // Start animation playback
        if (isPlaying && this.api) {
          this.api.startAnimationPlayback();
        }

        // Stop animation playback
        if (!isPlaying && this.api) {
          this.api.stopAnimationPlayback();
        }

        // Set animation frame rate
        if (cineFrameRate && this.api) {
          this.api.setAnimationFrameRate(cine.cineFrameRate);
        }
      }
    }
  }

  componentWillUnmount() {
    // Remove event handlers and reactive logic for viewport

    // Clear viewport specific state
    if (this.props.setViewportSpecificData && _.isFunction(this.props.setViewportSpecificData)) {
      this.props.setViewportSpecificData({ m3d: {}, cine: {} });
    }

    // Remove event hnadlers
    this.removeDomEvents();
    this.api = null;
  }

  render() {
    const { byteArray, error, models, percentComplete, modelCount } = this.state;
    const style = { width: '100%', height: '100%', position: 'relative' };

    return (
      <>
        <div className="ohif-m3d-model-container" style={style}>
          {!this.state.isLoaded && (
            <LoadingIndicator percentComplete={modelCount && modelCount > 1 ? percentComplete : undefined} />
          )}
          {this.state.modelType && this.state.percentComplete == 100 && (
            <M3DModelView
              modelType={this.state.modelType}
              models={this.state.models}
              coordinateTransform={this.state.coordinateTransform}
              onCreated={this.onModelLoaded.bind(this)}
              onInteractionStart={this.onInteractionStart.bind(this)}
              getStaticUrl={this.props.getStaticUrl}
            />
          )}
        </div>
      </>
    );
  }
}

export default OHIFDicomM3DViewport;
