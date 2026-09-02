import _ from 'lodash';

import { Component } from 'react';

import cornerstone from 'cornerstone-core';
import cornerstoneTools from 'cornerstone-tools';
import PropTypes from 'prop-types';

import OHIF, { uiNotificationService } from '@ohif/core';
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
    
    // Retrieve segmentations
    if (brushStackState) {
      const { activeLabelmapIndex } = brushStackState;
      const labelmap3D = brushStackState.labelmaps3D[activeLabelmapIndex] || {};

      // Unpack labelmap metata
      const { metadata: activeLabelmapMetata } = labelmap3D;
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

      labelmapInstanceUID = `${firstImageId}_${activeLabelmapIndex}`;

      // The labelmap travels as its raw legacy buffer plus the stack it was drawn on. It is not
      // turned into a vtkImageData here: the geometry belongs to the Cornerstone3D volume, and the
      // buffer has to be re-ordered from stack order into the volume's slice order, which needs a
      // volume that does not exist at this point. The derived labelmap volume in the Cornerstone3D
      // cache is the only cache for it; this class keeps none of its own.
      labelmapDataObject = {
        buffer: labelmap3D.buffer,
        stackImageIds: stack.imageIds,
      };

      labelmapColorLUT = state.colorLutTables[labelmap3D.colorLUTIndex];
    }

    return {
      imageIds: stack.imageIds,
      displaySet: component.props.viewportData?.displaySet,
      labelmapDataObject,
      labelmapColorLUT,
      labelmapDetails: { labelmapInstanceUID, metadata: labelmapMetadata },
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
