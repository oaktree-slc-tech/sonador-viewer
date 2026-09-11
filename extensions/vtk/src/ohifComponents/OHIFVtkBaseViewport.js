import _ from 'lodash';

import { Component } from 'react';

import cornerstone from 'cornerstone-core';
import cornerstoneTools from 'cornerstone-tools';
import PropTypes from 'prop-types';

import OHIF, { uiNotificationService } from '@ohif/core';

import { getCanonicalSegmentationsForSeries } from '../utils/labelmapBridge.js';
import { extractStudyIdFromURL } from '@ohif/core/src/utils/extractStudyIdFromURL';

const { DicomMetadataStore: DcmMetaStore } = OHIF;
const segmentationModule = cornerstoneTools.getModule('segmentation');

const { DisplaySetApi } = OHIF.display;
const { StackManager } = OHIF.utils;


class OHIFVtkBaseViewport extends Component {
  // Component base class for the volumetric surfaces (MPR, the 3D viewer, the segmentation editor).
  //
  // This class resolves the display set's imageIds and its legacy labelmap and hands both to the
  // Cornerstone3D view classes, which own volume creation and loading. It builds no vtkImageData
  // volume and does not drive the legacy image-load pool: Cornerstone3D loads and renders.

  constructor(props) {
    super(props);

    // Bound once here rather than declared as class fields: they are handed to the Cornerstone3D
    // view as props AND overridden by the subclasses, and a class field would shadow the
    // prototype -- the subclass override would never run.
    this.onLoadProgress = this.onLoadProgress.bind(this);
    this.onLoadError = this.onLoadError.bind(this);
    this.onVolumeFit = this.onVolumeFit.bind(this);
  }

  state = {
    imageIds: null,
    paintFilterLabelMapImageData: null,
    percentComplete: 0,
    isLoaded: false,

    // Streaming-volume state reported up by the view
    loadProgress: null,
    loadError: null,
    fit: null,
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

  getBrushStackState  = (stack) => {
    // Retrieve the image stack for the viewport
    const { state } = segmentationModule;
    
    // Retrieve stack, firstImageId
    const firstImageId = stack?.imageIds?.length ? stack.imageIds[0] : undefined;
    const brushStackState = state.series[firstImageId];

    return { brushStackState, firstImageId }
  }

  getViewportData = (studies, StudyInstanceUID, displaySetInstanceUID, SOPClassUID, SOPInstanceUID, frameIndex) => {
    // Load image and segmentation data from OHIF image service
    
    const component = this;

    const { displaySetService } = DisplaySetApi.Instance;
    const { UINotificationService,  } = this.props.servicesManager.services;
    const { state } = segmentationModule;

    // Retrieve cornerstone image stack
    const stack = OHIFVtkBaseViewport.getCornerstoneStack(
      studies, StudyInstanceUID, displaySetInstanceUID, SOPClassUID, SOPInstanceUID, frameIndex);
    const { firstImageId, brushStackState } = component.getBrushStackState(stack);

    let labelmapDataObject;
    let labelmapColorLUT;
    let labelmapInstanceUID;
    let labelmapMetadata;
    let labelmapIndex;

    // Identity comes from the BRIDGE RECORDS, not from the legacy segmentation module: the
    // volumetric path must work whether or not a legacy `labelmap3D` is installed (the
    // `lazyLegacyLabelmap` deployments past #92 have none until a classic consumer asks). The
    // legacy module is consulted only for the state that genuinely lives there -- the panel's
    // active-labelmap selection and per-segment visibility -- when it is present.
    const seriesRecords = getCanonicalSegmentationsForSeries(firstImageId);

    if (seriesRecords.length) {
      const activeIndex = brushStackState
        ? brushStackState.activeLabelmapIndex
        : undefined;
      const record = _.find(seriesRecords,
        (r) => activeIndex === undefined || r.labelmapIndex === activeIndex)
        || seriesRecords[0];

      labelmapInstanceUID = record.segmentationId;
      labelmapIndex = record.labelmapIndex;

      // Unpack labelmap metadata from the record's SEG metadata (the same object the legacy view
      // carries when installed).
      const activeLabelmapMetata = record.segMetadata;
      if (activeLabelmapMetata) {

        // Retrieve series and segmentation series identifiers
        labelmapMetadata = _.pick(activeLabelmapMetata, 'seriesInstanceUid', 'segmentationSeriesInstanceUID');
        labelmapMetadata.data = _.filter(activeLabelmapMetata.data, (s) => s && s.SegmentLabel);

        // Add additional properties from the series metadata
        const _labelmapDcmMeta = DcmMetaStore.getSeries(StudyInstanceUID, labelmapMetadata.segmentationSeriesInstanceUID);
        if (_labelmapDcmMeta?.instances?.length) {
          const _dcm0 = _labelmapDcmMeta.instances[0];
          _.extend(labelmapMetadata, _.pick(_dcm0, 'SeriesDescription', 'SeriesDate', 'SeriesTime', 'SeriesNumber', 'Modality', ));
        }
      }

      if (seriesRecords.length > 1 && this.props.viewportIndex === 0) {

        UINotificationService.show({
          title: 'Overlapping Segmentation Found',
          message: 'Overlapping segmentations cannot be displayed when in MPR mode',
          type: 'info',
        });
      }

      // Per-segment visibility is panel UI state and lives on the legacy view when one is
      // installed; without one, everything is visible.
      const legacyLabelmap3D = brushStackState
        ? brushStackState.labelmaps3D[labelmapIndex]
        : undefined;
      this.segmentsDefaultProperties = legacyLabelmap3D
        ? legacyLabelmap3D.segmentsHidden.map((isHidden) => ({ visible: !isHidden }))
        : _.map(_.filter((activeLabelmapMetata && activeLabelmapMetata.data) || [], Boolean),
            () => ({ visible: true }));

      // What a view needs to attach to the canonical Cornerstone3D segmentation: the classic stack
      // (the bridge checks the legacy compatibility view against it) and the colour LUT index from
      // the record. The labelmap's voxels are NOT carried -- Cornerstone3D owns them, and a view
      // reads them through `getCanonicalSegmentation`.
      const colorLUTIndex = legacyLabelmap3D
        ? legacyLabelmap3D.colorLUTIndex
        : record.colorLUTIndex;

      labelmapDataObject = {
        stackImageIds: stack.imageIds,
        colorLUTIndex,
      };

      labelmapColorLUT = state.colorLutTables[colorLUTIndex];
    }

    return {
      imageIds: stack.imageIds,
      displaySet: component.props.viewportData?.displaySet,
      labelmapDataObject,
      labelmapColorLUT,
      // `labelmapIndex` and `firstImageId` are the address of the labelmap3D inside the legacy
      // segmentation module (`state.series[firstImageId].labelmaps3D[labelmapIndex]`). The bridge
      // needs them to write an edit made in Cornerstone3D back into the legacy state, and cannot
      // recover them from `labelmapInstanceUID` -- a firstImageId can itself contain underscores.
      labelmapDetails: {
        labelmapInstanceUID,
        labelmapIndex,
        firstImageId,
        metadata: labelmapMetadata,
      },
    };
  };

  onLoadProgress(loadProgress) {
    // Streaming-volume progress from the Cornerstone3D view.

    const { framesProcessed = 0, numberOfFrames = 0, complete } = loadProgress || {};
    const percentComplete = numberOfFrames
      ? Math.floor((framesProcessed * 100) / numberOfFrames)
      : 0;

    if (percentComplete !== this.state.percentComplete || complete) {
      this.setState({ loadProgress, percentComplete });
    }
  }

  onLoadError(error) {
    // First load failure for the volume. Recorded once per volume,
    // and from the first viewport only, so a three-pane MPR layout does not raise three identical
    // messages for one failing series.

    const { LoggerService } = this.props.servicesManager.services;

    if (this.hasError) {
      return;
    }
    this.hasError = true;
    this.setState({ loadError: error });

    if (this.props.viewportIndex !== 0) {
      return;
    }

    // Logged without a toast, then notified separately: the unified logger cannot carry the
    // "way out of this layout" action each surface needs, and going through both with notify:true
    // would raise the condition to the user twice.
    LoggerService.error({
      error,
      title: 'Image Load Error',
      message: error.message,
      notify: false,
      studyInstanceUID: extractStudyIdFromURL(),
    });

    this.notifyLoadError(error);
  }

  notifyLoadError(error) {
    // Raise the sticky toast for a load failure. Subclasses override this to attach the action
    // that leaves their layout (Exit 2D MPR, Exit Volume Viewer, Exit Segmentation Editor).

    uiNotificationService.show({
      title: 'Failed to load image data.',
      message: error.message,
      type: 'error',
      autoClose: false,
      studyInstanceUID: extractStudyIdFromURL(),
      error,
    });
  }

  onVolumeFit(fit) {
    // The pre-flight decision for this display set, recorded so the viewport can show the
    // reduced-resolution notice.
    this.setState({ fit });
  }
}


export default OHIFVtkBaseViewport;
