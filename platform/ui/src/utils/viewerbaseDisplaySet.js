import { utils } from '@ohif/core';

const { studyMetadataManager } = utils;

const viewerbaseGetDisplaySet = (
  viewportSpecificData = {},
  activeViewportIndex
) => {
  // Retrieve the desired displayset from the psecified viewport specific data and active index

  const { displaySetInstanceUID, StudyInstanceUID } =
    viewportSpecificData[activeViewportIndex];

  const studies = studyMetadataManager.all();

  const study = studies.find(
    (study) => study.studyInstanceUID === StudyInstanceUID
  );

  const displaySet = study._displaySets.find(
    (set) => set.displaySetInstanceUID === displaySetInstanceUID
  );

  return { study: study, displaySet: displaySet };
};

const viewerbaseDisplaySetReconstructable = (
  viewportSpecificData = {},
  activeViewportIndex
) => {
  // Determine if the specified viewport data supports 3D reconstruction

  if (!viewportSpecificData[activeViewportIndex]) {
    return false;
  }

  // Retrieve study and displayset
  const { study, displaySet } = viewerbaseGetDisplaySet(
    viewportSpecificData,
    activeViewportIndex
  );

  if (!study || !displaySet) {
    return false;
  }

  // Determine if the displayset supports 3D reconstruction
  return displaySet.isReconstructable;
};

export { viewerbaseGetDisplaySet };
export { viewerbaseDisplaySetReconstructable };
