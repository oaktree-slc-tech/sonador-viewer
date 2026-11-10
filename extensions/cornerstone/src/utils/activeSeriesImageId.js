import OHIF from '@ohif/core';

/**
 * An image of the series shown in the active viewport, for a series-level annotation (a series
 * tag) made where there is no classic viewport image to take it from, as in the MPR view: the
 * first image of the active viewport's display set.
 *
 * @param {object} viewports - the viewports store ({ viewportSpecificData, activeViewportIndex })
 * @returns {string|undefined} the image id
 */
export default function activeSeriesImageId(viewports) {
  const data = viewports && viewports.viewportSpecificData && viewports.viewportSpecificData[viewports.activeViewportIndex];
  if (!data || !data.StudyInstanceUID) {
    return undefined;
  }
  const study = OHIF.utils.studyMetadataManager.get(data.StudyInstanceUID);
  const displaySet = study && typeof study.findDisplaySet === 'function'
    ? study.findDisplaySet(candidate => candidate.displaySetInstanceUID === data.displaySetInstanceUID)
    : undefined;
  const image = displaySet && Array.isArray(displaySet.images) ? displaySet.images[0] : undefined;
  return image && typeof image.getImageId === 'function' ? image.getImageId() : undefined;
}
