import OHIF from '@ohif/core';
import { ReconstructionIssues } from '@ohif/core/src/enums';

const { studyMetadataManager } = OHIF.utils;

export const storeTimepoints = () => {
  OHIF.log.info('storeTimepoints');
  return Promise.resolve();
};

export const updateTimepoint = () => {
  OHIF.log.info('updateTimepoint');
  return Promise.resolve();
};

export const removeTimepoint = () => {
  OHIF.log.info('removeTimepoint');
  return Promise.resolve();
};

export const disassociateStudy = () => {
  OHIF.log.info('disassociateStudy');
  return Promise.resolve();
};

/**
 * Async function to check if the displaySet has any derived one
 *
 * @param {*object} displaySet
 * @param {*object} study
 * @returns {bool}
 */
const checkForDerivedDisplaySets = async (displaySet, study) => {
  let derivedDisplaySetsNumber = 0;
  if (displaySet.Modality && !['SEG', 'SR', 'RTSTRUCT'].includes(displaySet.Modality)) {
    const studyMetadata = studyMetadataManager.get(study.StudyInstanceUID);

    const derivedDisplaySets = studyMetadata.getDerivedDatasets({
      referencedSeriesInstanceUID: displaySet.SeriesInstanceUID,
    });

    derivedDisplaySetsNumber = derivedDisplaySets.length;
  }

  return derivedDisplaySetsNumber > 0;
};

/**
 * Async function to check if there are any inconsistences in the series.
 *
 * For segmentation returns any error during loading.
 *
 * For reconstructable 3D volume:
 * 1) Is series multiframe?
 * 2) Do the frames have different dimensions/number of components/orientations?
 * 3) Has the series any missing frames or irregular spacing?
 * 4) Is the series 4D?
 *
 * If not reconstructable, MPR is disabled.
 * The actual computations are done in isDisplaySetReconstructable.
 *
 * @param {*object} displaySet
 * @returns {[string]} an array of strings containing the warnings
 */
const checkForSeriesInconsistencesWarnings = async (displaySet) => {
  const inconsistencyWarnings = [];

  if (displaySet.Modality !== 'SEG') {
    // warnings already checked and cached in displaySet
    if (displaySet.inconsistencyWarnings) {
      return displaySet.inconsistencyWarnings;
    }

    if (displaySet.reconstructionIssues && displaySet.reconstructionIssues.length !== 0) {
      displaySet.reconstructionIssues.forEach((warning) => {
        switch (warning) {
          case ReconstructionIssues.DATASET_4D:
            inconsistencyWarnings.push('The dataset is 4D.');
            break;
          case ReconstructionIssues.VARYING_IMAGESDIMENSIONS:
            inconsistencyWarnings.push('The dataset frames have different dimensions (rows, columns).');
            break;
          case ReconstructionIssues.VARYING_IMAGESCOMPONENTS:
            inconsistencyWarnings.push('The dataset frames have different components (Sample per pixel).');
            break;
          case ReconstructionIssues.VARYING_IMAGESORIENTATION:
            inconsistencyWarnings.push('The dataset frames have different orientation.');
            break;
          case ReconstructionIssues.IRREGULAR_SPACING:
            inconsistencyWarnings.push('The dataset frames have different pixel spacing.');
            break;
          case ReconstructionIssues.MULTIFFRAMES:
            inconsistencyWarnings.push('The dataset is a multiframes.');
            break;
          default:
            break;
        }
      });
      inconsistencyWarnings.push('The datasets is not a reconstructable 3D volume. MPR mode is not available.');
    }

    if (
      displaySet.missingFrames &&
      !displaySet.reconstructionIssues?.find((warn) => warn === ReconstructionIssues.DATASET_4D)
    ) {
      inconsistencyWarnings.push('The datasets is missing frames: ' + displaySet.missingFrames + '.');
    }

    if (displaySet.isSOPClassUIDSupported === false) {
      inconsistencyWarnings.push('The datasets is not supported.');
    }
    displaySet.inconsistencyWarnings = inconsistencyWarnings;
  } else {
    if (displaySet.loadError) {
      inconsistencyWarnings.push(displaySet.segLoadErrorMessagge);
      displaySet.inconsistencyWarnings = inconsistencyWarnings;
    }
  }

  return inconsistencyWarnings;
};

/**
 * Checks if display set is active, i.e. if the series is currently shown
 * in the active viewport.
 *
 * For data display set, this functions checks if the active
 * display set instance uid in the current active viewport is the same of the
 * thumbnail one.
 *
 * For derived modalities (e.g., SEG and RTSTRUCT), the function gets the
 * reference display set and then checks the reference uid with the active
 * display set instance uid.
 *
 * @param {displaySet} displaySet
 * @param {Study[]} studies
 * @param {string} activeDisplaySetInstanceUID
 * @returns {boolean} is active.
 */
const isDisplaySetActive = (displaySet, studies, activeDisplaySetInstanceUID) => {
  let active = false;

  const { displaySetInstanceUID } = displaySet;

  // TO DO: in the future, we could possibly support new modalities
  // we should have a list of all modalities here, instead of having hard coded checks
  if (displaySet.Modality !== 'SEG' && displaySet.Modality !== 'RTSTRUCT' && displaySet.Modality !== 'SR') {
    active = activeDisplaySetInstanceUID === displaySetInstanceUID;
  } else if (displaySet.Modality === 'SR') {
    active = activeDisplaySetInstanceUID === displaySetInstanceUID;

    if (!active && displaySet.getSourceDisplaySet) {
      const referencedDisplaySet = displaySet.getSourceDisplaySet(studies, false);
      if (referencedDisplaySet && referencedDisplaySet.length !== 0) {
        for (let i = 0; i < referencedDisplaySet.length; i++) {
          if (referencedDisplaySet[i].displaySetInstanceUID === activeDisplaySetInstanceUID) {
            active = true;
            break;
          }
        }
      }
    }
  } else if (displaySet.getSourceDisplaySet) {
    if (displaySet.Modality === 'SEG') {
      const { referencedDisplaySet } = displaySet.getSourceDisplaySet(studies, false);
      active = referencedDisplaySet
        ? activeDisplaySetInstanceUID === referencedDisplaySet.displaySetInstanceUID
        : false;
    } else {
      const referencedDisplaySet = displaySet.getSourceDisplaySet(studies, false);
      active = referencedDisplaySet
        ? activeDisplaySetInstanceUID === referencedDisplaySet.displaySetInstanceUID
        : false;
    }
  }

  return active;
};

/**
 * What types are these? Why do we have "mapping" dropped in here instead of in
 * a mapping layer?
 *
 * TODO[react]:
 * - Add showStackLoadingProgressBar option
 *
 * @param {Study[]} studies
 * @param {string} activeDisplaySetInstanceUID
 */
export const mapStudiesToThumbnails = (studies, activeDisplaySetInstanceUID) => {
  return studies.map((study) => {
    const { StudyInstanceUID } = study;
    const thumbnails = study.displaySets.map((displaySet) => {
      const { displaySetInstanceUID, SeriesDescription, numImageFrames, SeriesNumber } = displaySet;

      let imageId;
      let altImageText;

      if (displaySet.Modality && displaySet.Modality === 'SEG') {
        altImageText = 'SEG';
      } else if (displaySet.Modality && displaySet.Modality === 'SR') {
        altImageText = 'SR';
      } else if (displaySet.images && displaySet.images.length) {
        const imageIndex = Math.floor(displaySet.images.length / 2);
        imageId = displaySet.images[imageIndex].getImageId();
      } else if (displaySet.isSOPClassUIDSupported === false) {
        altImageText = displaySet.SOPClassUIDNaturalized;
      } else {
        altImageText = displaySet.Modality ? displaySet.Modality : 'UN';
      }

      const hasWarnings = checkForSeriesInconsistencesWarnings(displaySet);

      const hasDerivedDisplaySets = checkForDerivedDisplaySets(displaySet, study);

      return {
        active: isDisplaySetActive(displaySet, studies, activeDisplaySetInstanceUID),
        imageId,
        altImageText,
        displaySetInstanceUID,
        SeriesDescription,
        numImageFrames,
        SeriesNumber,
        hasWarnings,
        hasDerivedDisplaySets,
      };
    });

    return {
      StudyInstanceUID,
      thumbnails,
    };
  });
};
