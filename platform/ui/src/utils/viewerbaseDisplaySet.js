import { utils } from '@ohif/core';

const { studyMetadataManager } = utils;

const viewerbaseGetDisplaySet = (viewportSpecificData = {}, activeViewportIndex) => {
  // Retrieve the displayset for the currently active viewport

  const { displaySetInstanceUID, StudyInstanceUID } = viewportSpecificData[activeViewportIndex];

  const studies = studyMetadataManager.all();

  const study = studies.find((study) => study.studyInstanceUID === StudyInstanceUID);

  const displaySet = study?._displaySets.find((set) => set.displaySetInstanceUID === displaySetInstanceUID);

  return { study, displaySet };
};

const viewerbaseDisplaySetReconstructable = (viewportSpecificData = {}, activeViewportIndex) => {
  // Determine if the specified viewport data supports 3D reconstruction

  try {
    if (!viewportSpecificData[activeViewportIndex]) {
      return false;
    }

    // Retrieve study and displayset
    const { study, displaySet } = viewerbaseGetDisplaySet(viewportSpecificData, activeViewportIndex);

    if (!study || !displaySet) {
      return false;
    }

    // Determine if the displayset supports 3D reconstruction
    return displaySet.isReconstructable;
  } catch (err) {
    console.error('Unable to determine if the display set was reconstructable due to an error. ', err);
  }

  return false;
};

// Modalities the volume viewers and the Segmentation Editor treat as 3D volumes
const VOLUME_MODALITIES = ['CT', 'MR'];

const viewerbaseDisplaySetIsCTOrMRVolume = (viewportSpecificData = {}, activeViewportIndex) => {
  // Determine if the active viewport shows a CT or MR series that supports 3D reconstruction

  try {
    if (viewerbaseDisplaySetReconstructable(viewportSpecificData, activeViewportIndex)) {
      const { displaySet } = viewerbaseGetDisplaySet(viewportSpecificData, activeViewportIndex);
      return !!displaySet && VOLUME_MODALITIES.includes(displaySet.Modality);
    }
  } catch (err) {
    console.error('Unable to retrieve study or displayset due to an error.', err);
  }

  return false;
};

export { viewerbaseGetDisplaySet, viewerbaseDisplaySetReconstructable, viewerbaseDisplaySetIsCTOrMRVolume };
