import OHIF, { utils, log } from '@ohif/core';
import cornerstoneTools from 'cornerstone-tools';
import refreshViewports from './refreshViewports';

const { studyMetadataManager } = utils;
const { DisplaySetApi } = OHIF.display;

/**
 *
 *
 * @param {*} viewportSpecificData
 * @param {*} studies
 * @param {*} displaySet
 * @param {*} firstImageId
 * @param {*} activeLabelmapIndex
 * @returns
 */
export default async function setActiveLabelmap(
  referencedDisplaySet,
  studies,
  displaySet,
  callback = () => {},
  onDisplaySetLoadFailure = err => {
    console.error(err.message);
  }
) {
  const studyMetadata = studyMetadataManager.get(
    referencedDisplaySet.StudyInstanceUID
  );
  const firstImageId = studyMetadata.getFirstImageId(
    referencedDisplaySet.displaySetInstanceUID
  );

  let { state } = cornerstoneTools.getModule('segmentation');

  let brushStackState = state.series[firstImageId];
  const activeLabelmapIndex = brushStackState
    ? brushStackState.activeLabelmapIndex
    : undefined;

  let labelmapIndex =
    displaySet.hasOverlapping === true
      ? displaySet.originLabelMapIndex
      : displaySet.labelmapIndex;

  if (labelmapIndex === activeLabelmapIndex) {
    log.warn(`${activeLabelmapIndex} is already the active labelmap`);
    return labelmapIndex;
  }

  if (!displaySet.isLoaded && !displaySet.loadError) {
    // Evict stale labelmaps3D slots from any previous load of this same SEG series
    // before calling load(). Without this, _getNextLabelmapIndex appends a new slot
    // rather than reusing the old one, so both the old and new data are composited
    // on every render (ghost segmentation after study reload).
    if (brushStackState?.labelmaps3D?.length > 0) {
      brushStackState.labelmaps3D.forEach((lm3D, idx) => {
        if (lm3D?.metadata?.segmentationSeriesInstanceUID === displaySet.SeriesInstanceUID) {
          brushStackState.labelmaps3D[idx] = null;
        }
      });
    }

    try {
      await displaySet.load(referencedDisplaySet, studies);
    } catch (error) {

      // Update displaySet data and trigger service
      displaySet.isLoaded = false;
      displaySet.loadError = true;
      displaySet.segLoadErrorMessage = error.message;
      onDisplaySetLoadFailure(error);

      DisplaySetApi.Instance.displaySetService.addDisplaySets([displaySet]);

      /*
       * TODO: Improve the way we notify parts of the app
       * that depends on derived display sets to be loaded.
       * (Implement pubsub for better tracking of derived display sets)
       */
      const event = new CustomEvent('segmentationLoadingError');
      document.dispatchEvent(event);

      return -1;
    }
  }

  labelmapIndex =
    displaySet.hasOverlapping === true
      ? displaySet.originLabelMapIndex
      : displaySet.labelmapIndex;

  // This might have just been created, so need to use the non-cached value.
  state = cornerstoneTools.getModule('segmentation').state;

  brushStackState = state.series[firstImageId];
  if (brushStackState) {
    brushStackState.activeLabelmapIndex = labelmapIndex;
  }

  refreshViewports();
  callback();

  return labelmapIndex;
}
