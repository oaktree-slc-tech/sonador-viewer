import React, { useEffect, useState } from 'react';
import cornerstone from 'cornerstone-core';
import PropTypes from 'prop-types';

import OHIF from '@ohif/core';
import { useViewerStudyErrors } from '@ohif/core/src/store/useViewerStudyErrors';
import { useSnackbarContext } from '@ohif/ui';

import OHIFCornerstoneViewportOverlay from './components/OHIFCornerstoneViewportOverlay';
import checkForSRAnnotations from './tools/checkForSRAnnotations';
import ConnectedCornerstoneViewport from './ConnectedCornerstoneViewport';

const { DisplaySetApi } = OHIF.display;
const { StackManager } = OHIF.utils;


export default function OHIFCornerstoneViewport({
  viewportData, 
  customProps={},
  isStackPrefetchEnabled = true,
  viewportIndex,
  children,
  onNewImage,
  stackPrefetch,
}) {
  const [viewportDataState, setViewportDataState] = useState(null);  

  const snackbar = useSnackbarContext();
  const { addError } = useViewerStudyErrors();

  /**
   * Obtain the CornerstoneTools Stack for the specified display set.
   *
   * @param {Object[]} studies
   * @param {String} StudyInstanceUID
   * @param {String} displaySetInstanceUID
   * @param {String} [SOPInstanceUID]
   * @param {Number} [frameIndex=1]
   * @return {Object} CornerstoneTools Stack
   */
  const getCornerstoneStack = (studies, StudyInstanceUID, displaySetInstanceUID, SOPInstanceUID, frameIndex = 0) => {
    if (!studies || !studies.length) {
      const errorTitle = 'Studies not provided';

      addError({ studyId: StudyInstanceUID, error: `${StudyInstanceUID} error`, title: errorTitle });

      return snackbar.show({
        title: errorTitle,
        message: '',
        type: 'error',
        autoClose: false,
      });
    }

    if (!StudyInstanceUID) {
      return snackbar.show({
        title: 'StudyInstanceUID not provided',
        message: '',
        type: 'error',
        autoClose: false,
      });
    }

    if (!displaySetInstanceUID) {
      const errorTitle = 'displaySetInstanceUID not provided';

      addError({ studyId: StudyInstanceUID, error: `${StudyInstanceUID} error`, title: errorTitle });

      return snackbar.show({
        title: errorTitle,
        message: '',
        type: 'error',
        autoClose: false,
      });
    }

    // Create shortcut to displaySet
    const study = studies.find((study) => study.StudyInstanceUID === StudyInstanceUID);

    if (!study) {
      const errorTitle = 'Study not found';

      addError({ studyId: StudyInstanceUID, error: `${StudyInstanceUID} error`, title: errorTitle });

      return snackbar.show({
        title: errorTitle,
        message: '',
        type: 'error',
        autoClose: false,
      });
    }

    const displaySet = study.displaySets.find((set) => {
      return set.displaySetInstanceUID === displaySetInstanceUID;
    });

    if (!displaySet) {
      const errorTitle = 'Display Set not found';

      addError({ studyId: StudyInstanceUID, error: `${StudyInstanceUID} error`, title: errorTitle });

      return snackbar.show({
        title: errorTitle,
        message: '',
        type: 'error',
        autoClose: false,
      });
    }

    // Get stack from Stack Manager
    const storedStack = StackManager.findOrCreateStack(study, displaySet);

    // Clone the stack here so we don't mutate it
    const stack = Object.assign({}, storedStack);
    stack.currentImageIdIndex = frameIndex;

    if (SOPInstanceUID) {
      const index = stack.imageIds.findIndex((imageId) => {
        const imageIdSOPInstanceUID = cornerstone.metaData.get('SOPInstanceUID', imageId);

        return imageIdSOPInstanceUID === SOPInstanceUID;
      });

      if (index > -1) {
        stack.currentImageIdIndex = index;
      } else {
        console.warn('SOPInstanceUID provided was not found in specified DisplaySet');
      }
    }

    return stack;
  };

  const getViewportData = (studies, StudyInstanceUID, displaySetInstanceUID, SOPInstanceUID, frameIndex) => {
    const stack = getCornerstoneStack(studies, StudyInstanceUID, displaySetInstanceUID, SOPInstanceUID, frameIndex);

    return {
      StudyInstanceUID,
      displaySetInstanceUID,
      stack,
    };
  };

  const setStateFromProps = () => {
    const { studies, displaySet } = viewportData;
    const { StudyInstanceUID, displaySetInstanceUID, sopClassUIDs, SOPInstanceUID, frameIndex } = displaySet;

    if (StudyInstanceUID && displaySetInstanceUID) {
      if (sopClassUIDs?.length > 1) {
        console.warn('More than one SOPClassUID in the same series is not yet supported.');
      }

      setViewportDataState(
        getViewportData(studies, StudyInstanceUID, displaySetInstanceUID, SOPInstanceUID, frameIndex)
      );
    }
  };

  useEffect(() => {
    setStateFromProps();

    return () => {
      StackManager.clearStacks();
    };
  }, []);

  useEffect(() => {
    checkForSRAnnotations({ displaySet: viewportData.displaySet, viewportIndex });
    setStateFromProps();
  }, [
    viewportData.displaySet.displaySetInstanceUID,
    viewportData.displaySet.SOPInstanceUID,
    viewportData.displaySet.frameIndex,
  ]);

  if (!viewportDataState) {
    return null;
  }

  const { inconsistencyWarnings } = viewportData.displaySet;
  const {
    imageIds,
    currentImageIdIndex,
    // If this comes from the instance, would be a better default
    // `FrameTime` in the instance
    // frameRate = 0,
  } = viewportDataState.stack || {};

  const newImageHandler = ({ currentImageIdIndex, sopInstanceUid }) => {
    const { displaySet } = viewportData;
    const { StudyInstanceUID } = displaySet;

    if (currentImageIdIndex >= 0) {
      onNewImage({
        StudyInstanceUID,
        SOPInstanceUID: sopInstanceUid,
        frameIndex: currentImageIdIndex,
        activeViewportIndex: viewportIndex,
      });
    }
  };

  const overlay = (props) => {
    const displaySet = viewportData.displaySet;
    let filteredSRLabels;
    if (displaySet.SRLabels?.length) {
      filteredSRLabels = displaySet.SRLabels.filter(
        (SRLabel) => SRLabel.ReferencedSOPInstanceUID === displaySet.SOPInstanceUID
      );
    }

    return (
      <OHIFCornerstoneViewportOverlay
        {...props}
        inconsistencyWarnings={inconsistencyWarnings}
        SRLabels={filteredSRLabels}
      />
    );
  };

  return (
    <>
      <ConnectedCornerstoneViewport
        viewportIndex={viewportIndex}
        imageIds={imageIds}
        imageIdIndex={currentImageIdIndex}
        onNewImageDebounced={newImageHandler}
        onNewImageDebounceTime={300}
        viewportOverlayComponent={overlay}
        stackPrefetch={stackPrefetch}
        isStackPrefetchEnabled={isStackPrefetchEnabled}
        {...customProps}
      />
      {children?.map((child, index) => {
        if (child) {
          return React.cloneElement(child, {
            viewportIndex: viewportIndex,
            key: index,
          });
        }

        return null;
      })}
    </>
  );
}

OHIFCornerstoneViewport.propTypes = {
  studies: PropTypes.object,
  displaySet: PropTypes.object,
  viewportIndex: PropTypes.number,
  children: PropTypes.node,
  customProps: PropTypes.object,
  stackPrefetch: PropTypes.object,
  isStackPrefetchEnabled: PropTypes.bool,
};
