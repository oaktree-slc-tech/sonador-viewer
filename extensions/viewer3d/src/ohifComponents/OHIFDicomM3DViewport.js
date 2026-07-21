import React, { Component } from 'react';
import dcmjs from 'dcmjs';
import _ from 'lodash';
import PropTypes from 'prop-types';

import OHIF from '@ohif/core';
import { str2ab } from '@ohif/core';
import { LoadingIndicator } from '@ohif/extension-vtk';
import { eventTypes as uiEvents } from '@ohif/ui';

import {
  // Segmentations
  segmentation as c3dSegmentations,
} from '@cornerstonejs/tools';

import M3DModelView from '../threejs/M3DModelView.js';
import { MIMETYPE_STL } from '../sopClassHandlers/OHIFDicom3DSopClassHandler.js';
import {
  getM3DGeometryId,
  acquireGeometry,
  releaseGeometry,
  hydrateM3DInstance,
  disposeM3DInstance,
  registerM3DSegmentation,
  releaseM3DSegmentation,
} from '../m3dCache';

import '../styles/LoadingIndicator.css';

const { DicomLoaderService } = OHIF.utils;

// -90deg X transform so the STL major axis points up and the model faces the viewer; without it
// the orbit controls have an extremely limited range.
const STL_COORDINATE_TRANSFORM = { rotation: [-Math.PI / 2, 0, 0] };

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
    servicesManager: PropTypes.object,
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

  constructor(props) {
    super(props);
    this.onModelLoaded       = this.onModelLoaded.bind(this);
    this.onInteractionStart  = this.onInteractionStart.bind(this);
    this.onInteractionChange = this.onInteractionChange.bind(this);
    this.onInteractionEnd    = this.onInteractionEnd.bind(this);

    // Stable identity for this viewport's references into the M3D geometry cache. Used to
    // reference-count cache entries so a model stays resident while this (or any other) viewport
    // holds it, and is freed only when the last viewport releases it. This is a cache-refcount
    // identity ONLY — it is never registered as a Cornerstone3D viewport ID.
    this._viewportId = OHIF.utils.guid();
    this._acquiredModels = [];

    // Presentation-state segmentation for STL series (m3dSegmentationState.js)
    this._segmentationId = null;
    this._segmentationSeriesUID = null;
    this._segmentationSubscriptions = [];
  }

  onModelLoaded(api) {
    // Set API reference for the Three.js viewport, mark the model as loaded, and remove overlay.
    this.api = api;
    this.setState({ isLoaded: true });

    // Reconcile the freshly-created scene against any existing presentation state (a second
    // viewport on the same series consumes state initialized — and possibly modified — elsewhere).
    this.syncModelPresentation();

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

  resizeViewport() {
    // Resize Three.js render window

    if (this.api) {
      this.api.resize();
      this.api.render();
    }
  }

  getInstanceColor(series, sopInstanceUID) {
    // Resolve the per-instance display colour from series metadata (available without fetching the
    // encapsulated document, so it is usable on a cache hit).
    if (!series || !sopInstanceUID) {
      return undefined;
    }
    const instance = series.getInstanceByUID(sopInstanceUID);
    const idata = instance && instance.getData ? instance.getData().metadata : undefined;
    if (idata && idata.RecommendedDisplayCIELabValue) {
      return OHIF.utils.color.rgb2hex(
        ...dcmjs.data.Colors.dicomlab2RGB(idata.RecommendedDisplayCIELabValue).map((x) => Math.round(x * 255))
      );
    }
    return undefined;
  }

  acquireModel({ sopInstanceUID, series, fetchRawData }) {
    // Acquire a model from the M3D geometry cache (cache-first; `fetchRawData` runs only on a miss)
    // and hydrate a private per-viewport Three.js instance from the shared cached payload.
    const geometryId = getM3DGeometryId(sopInstanceUID);
    const color = this.getInstanceColor(series, sopInstanceUID);

    return acquireGeometry(geometryId, this._viewportId, {
      fetchRawData,
      color,
      getStaticUrl: this.props.getStaticUrl,
      // Hints for raw-document payloads (InlineBinary shortcut) that carry no DICOM headers.
      sopInstanceUID,
      mimeType: this.props.viewportData?.displaySet?.m3dModelType,
    }).then((payload) => {
      const instance = hydrateM3DInstance(payload);
      const model = {
        geometryId,
        m3dType: payload.type,
        modelType: payload.mimeType,
        modelColor: color,
        instance,
      };
      this._acquiredModels.push(model);
      return model;
    });
  }

  releaseAcquiredModels() {
    // Dispose each per-viewport instance and drop its cache reference. The shared cached payload is
    // freed (and its parsed geometry/source disposed) only once the last viewport releases it.
    (this._acquiredModels || []).forEach((model) => {
      disposeM3DInstance(model.instance, model.m3dType);
      releaseGeometry(model.geometryId, this._viewportId);
    });
    this._acquiredModels = [];
  }

  getSegmentationService() {
    const { servicesManager } = this.props;
    return servicesManager && servicesManager.services
      ? servicesManager.services.segmentationService : undefined;
  }

  initM3DSegmentationState() {
    // Register the presentation-state segmentation once all STL models are acquired (the first
    // viewport for a series initializes; later viewports consume the existing state) and
    // subscribe for presentation updates. GLB scenes are out of scope.
    const component = this;
    const { displaySet } = this.props.viewportData;

    if (this.state.modelType !== MIMETYPE_STL || this._segmentationId) {
      return;
    }

    registerM3DSegmentation({ displaySet, models: this.state.models }).then(({ segmentationId }) => {
      component._segmentationId = segmentationId;
      component._segmentationSeriesUID = displaySet.SeriesInstanceUID;
      component.subscribeSegmentationEvents();
      component.syncModelPresentation();
    }, (err) => {
      console.error('[OHIFDicomM3DViewport] Unable to register M3D segmentation state', err);
    });
  }

  subscribeSegmentationEvents() {
    // Subscribe to SegmentationService presentation events. Events signal THAT something changed;
    // the Cornerstone3D segmentation metadata is the source of truth for WHAT the state is, so
    // every event triggers a pull-based reconcile (same discipline as SegmentationEditorLayout).
    const component = this;
    const segmentationService = this.getSegmentationService();

    if (!segmentationService) {
      console.warn('[OHIFDicomM3DViewport] segmentationService unavailable, model presentation state disabled');
      return;
    }

    this.unsubscribeSegmentationEvents();

    const _onSegmentationChange = ({ segmentationId }) => {
      if (segmentationId && segmentationId == component._segmentationId) {
        component.syncModelPresentation();
      }
    };

    this._segmentationSubscriptions = [
      segmentationService.subscribe(segmentationService.EVENTS.SEGMENTATION_MODIFIED, _onSegmentationChange),
      segmentationService.subscribe(segmentationService.EVENTS.SEGMENT_LOCK, _onSegmentationChange),
      segmentationService.subscribe(segmentationService.EVENTS.SEGMENT_ACTIVE, _onSegmentationChange),
    ];
  }

  unsubscribeSegmentationEvents() {
    // Clear OHIF service subscriptions (all handles expose .unsubscribe())
    (this._segmentationSubscriptions || []).forEach((subscription) => subscription?.unsubscribe());
    this._segmentationSubscriptions = [];
  }

  syncModelPresentation() {
    // Reconcile every model against the segmentation metadata: mesh visibility from
    // segments[].visible, wireframe from the segment lock state (locked renders wireframe),
    // material colour from segments[].color. Safe to call repeatedly; no-ops until both the
    // Three.js api and the segmentation are available.
    if (!this.api || !this._segmentationId) {
      return;
    }

    const _seg = c3dSegmentations.state.getSegmentation(this._segmentationId);
    if (!_seg || !_seg.segments) {
      return;
    }

    _.each(_seg.segments, (segment, idx) => {
      if (!segment || !segment.geometryId) {
        return;
      }

      this.api.setModelVisibility(segment.geometryId, segment.visible !== false);
      this.api.setModelWireframe(segment.geometryId,
        c3dSegmentations.segmentLocking.isSegmentIndexLocked(this._segmentationId, Number(idx)));
      if (segment.color) {
        this.api.setModelColor(segment.geometryId, segment.color);
      }
    });
  }

  releaseM3DSegmentationState() {
    // Unsubscribe presentation events and remove the series segmentation when this was the last
    // M3D viewport holding its models. Must run AFTER releaseAcquiredModels() so the geometry
    // reference counts the release check consults are already decremented.
    this.unsubscribeSegmentationEvents();

    if (this._segmentationSeriesUID) {
      releaseM3DSegmentation(this._segmentationSeriesUID);
    }
    this._segmentationId = null;
    this._segmentationSeriesUID = null;
  }

  fetchModel() {
    // Retrieve DICOM model instances and stage them through the M3D geometry cache.

    const { displaySet, studies } = this.props.viewportData;
    const { numImageFrames, series } = displaySet;
    const _component = this;

    const applyModel = (model, extra) => {
      _component.setState({
        models: [model],
        modelType: model.modelType,
        percentComplete: 100,
        coordinateTransform:
          model.modelType === MIMETYPE_STL ? STL_COORDINATE_TRANSFORM : undefined,
        ...extra,
      }, () => _component.initM3DSegmentationState());
    };

    const onError = (error) => {
      _component.setState({ error });
      throw new Error(error);
    };

    // Inline binary is only valid for single-instance series. Multi-instance series must always
    // fetch each model separately via their individual WADO URIs — the metadata on the display
    // set is that of the first instance only and must not short-circuit the full fetch loop.
    if ((!numImageFrames || numImageFrames <= 1) && displaySet.metadata && displaySet.metadata.EncapsulatedDocument) {
      const { InlineBinary } = displaySet.metadata.EncapsulatedDocument;

      if (InlineBinary) {
        this.setState({ modelCount: 1 });
        this.acquireModel({
          sopInstanceUID: displaySet.SOPInstanceUID,
          series,
          fetchRawData: () => Promise.resolve(str2ab(atob(InlineBinary))),
        }).then((model) => applyModel(model), onError);
        return;
      }
    }

    if (!numImageFrames && _.isUndefined(numImageFrames)) {
      this.setState({ modelCount: 1 });

      // Retrieve single model file from remote server (only on a cache miss)
      this.acquireModel({
        sopInstanceUID: displaySet.SOPInstanceUID,
        series,
        fetchRawData: () => DicomLoaderService.findDicomDataPromise(displaySet, studies),
      }).then((model) => applyModel(model), onError);
    } else if (numImageFrames && numImageFrames > 1) {
      this.setState({ modelCount: numImageFrames });

      _.times(numImageFrames, function (i) {
        // Retrieve DICOM instance
        const instance = series.getInstanceByIndex(i);
        const sopInstanceUID = instance.getSOPInstanceUID();

        // Create a copy of the display set and add instance specific data.
        // images must be cleared: DicomLoaderService.getDataByImageType() reads dataset.images[0]
        // and would always fetch the first instance regardless of the wadoUri override below.
        // Clearing it forces the service to fall through to getDataByDatasetType(), which uses
        // the per-instance wadoUri and SOPInstanceUID set here.
        const displayInstance = _.extend(_.clone(displaySet), {
          wadoUri: instance.getData().wadouri,
          SOPInstanceUID: sopInstanceUID,
          images: undefined,
        });

        _component.acquireModel({
          sopInstanceUID,
          series,
          fetchRawData: () => DicomLoaderService.findDicomDataPromise(displayInstance, studies),
        }).then((model) => {
          // Use functional setState to avoid stale state reads when multiple
          // acquire promises resolve within the same React 18 batch.
          _component.setState(prevState => {
            const updatedModels = [...prevState.models, model];
            const newState = {
              models: updatedModels,
              percentComplete: updatedModels.length === numImageFrames
                ? 100
                : Math.round((updatedModels.length / numImageFrames) * 100),
            };

            if (!prevState.modelType) {
              newState.modelType = model.modelType;
            }

            if (model.modelType === MIMETYPE_STL) {
              newState.coordinateTransform = STL_COORDINATE_TRANSFORM;
            }

            return newState;
          }, () => {
            // Register the presentation-state segmentation once the full series is acquired
            if (_component.state.percentComplete === 100) {
              _component.initM3DSegmentationState();
            }
          });
        }, onError);
      });
    }
  }

  onInteractionStart() {
    const { viewportIndex, activeViewportIndex, setViewportActive } = this.props;
    if (viewportIndex != activeViewportIndex && _.isFunction(setViewportActive)) {
      setViewportActive();
    }
  }

  onInteractionChange() {
    // Placeholder — fired every frame during orbit/pan/zoom and inertial damping.
    // Use this to sync camera state to Redux or drive multi-viewport linking.
  }

  onInteractionEnd() {
    // Placeholder — fired when the user releases the mouse/touch and damping settles.
    // Use this to persist camera position to viewportSpecificData.
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

      // Release the previous display set's cache references and dispose its per-viewport instances
      // before loading the new model, then drop the presentation-state segmentation if this was
      // the last viewport for the previous series.
      this.releaseAcquiredModels();
      this.releaseM3DSegmentationState();

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

    // Release cache references and dispose per-viewport instances, then drop the
    // presentation-state segmentation if this was the last viewport for the series
    this.releaseAcquiredModels();
    this.releaseM3DSegmentationState();

    // Remove event hnadlers
    this.removeDomEvents();
    this.api = null;
  }

  render() {
    const { byteArray, error, models, percentComplete, modelCount } = this.state;
    const style = { width: '100%', height: '100%', position: 'relative' };

    return (
      <>
        <div className="ohif-m3d-model-container" style={style} onClick={this.onInteractionStart}>
          {!this.state.isLoaded && (
            <LoadingIndicator percentComplete={modelCount && modelCount > 1 ? percentComplete : undefined} />
          )}
          {this.state.modelType && this.state.percentComplete == 100 && (
            <M3DModelView
              modelType={this.state.modelType}
              models={this.state.models}
              coordinateTransform={this.state.coordinateTransform}
              onCreated={this.onModelLoaded}
              onInteractionStart={this.onInteractionStart}
              onInteractionChange={this.onInteractionChange}
              onInteractionEnd={this.onInteractionEnd}
              getStaticUrl={this.props.getStaticUrl}
            />
          )}
        </div>
      </>
    );
  }
}

export default OHIFDicomM3DViewport;
