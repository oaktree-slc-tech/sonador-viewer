// Whether the Segmentations side panel's tab is offered for the open studies (the panel module's
// `isDisabled`). The panel hosts the DICOM-SEG segmentations, the M3D models sidebar and the
// Segmentation Editor's controls, so it is offered when any of those has something to show:
//
// - the Segmentation Editor is the active viewport (whatever the study holds: a segmentation
//   created in the viewer has no SEG series behind it, and the editor cannot be used without its
//   panel);
// - a study has a DICOM-SEG series (the tab's badge counts the SEGs referencing the active series);
// - a study has an STL model series (GLB scenes have no sidebar content).

import OHIF from '@ohif/core';
import { Enums as SegEditorEnums } from '@ohif/extension-seg3d-editor';
import { isSTLDisplaySet as isSTL } from '@ohif/extension-viewerm3d';

const { studyMetadataManager } = OHIF.utils;

export const SEGMENTATION_PANEL_TARGET = 'segmentation-panel';

/** Whether a viewport's data is the Segmentation Editor's */
export function isSegEditorViewport(activeViewport) {
  return activeViewport?.plugin === SegEditorEnums.VIEWPORT_PLUGIN;
}

/**
 * @param {Object[]} studies - the viewer's studies
 * @param {Object} activeViewport - the active viewport's data
 * @param {Object} [deps]
 * @param {Function} [deps.getStudyMetadata] - (StudyInstanceUID) => StudyMetadata
 * @param {Function} [deps.isSTLDisplaySet]
 * @param {Function} [deps.onSegBadge] - ({ badgeNumber, target }) => void, told how many SEGs
 *   reference the active series
 * @returns {boolean} true when the tab is to be hidden
 */
export function isSegmentationPanelDisabled(studies, activeViewport, deps = {}) {
  const {
    getStudyMetadata = uid => studyMetadataManager.get(uid),
    isSTLDisplaySet = isSTL,
    onSegBadge = () => {},
  } = deps;

  if (isSegEditorViewport(activeViewport)) {
    return false;
  }
  if (!studies) {
    return true;
  }

  const hasSeries = (study, Modality) => !!study?.series?.some(series => series.Modality === Modality);

  if (studies.some(study => hasSeries(study, 'SEG'))) {
    if (activeViewport) {
      const studyMetadata = getStudyMetadata(activeViewport.StudyInstanceUID);
      if (!studyMetadata) {
        return undefined;
      }
      const referencedDS = studyMetadata.getDerivedDatasets({
        referencedSeriesInstanceUID: activeViewport.SeriesInstanceUID,
        Modality: 'SEG',
      });
      onSegBadge({ badgeNumber: referencedDS.length, target: SEGMENTATION_PANEL_TARGET });
    }
    return false;
  }

  // M3D/STL series host the M3D sidebar in this panel, so they enable it without a DICOM-SEG
  // being present. The STL/GLB distinction lives with the viewerm3d SOP class handler, which
  // resolves it from the display set metadata.
  return !studies.some(study => {
    if (!hasSeries(study, 'M3D')) {
      return false;
    }
    const studyMetadata = getStudyMetadata(study.StudyInstanceUID);
    const displaySets = studyMetadata ? studyMetadata.getDisplaySets() : [];
    return displaySets.some(isSTLDisplaySet);
  });
}
