// Image ids for every image of the study's image display sets, keyed by SOP instance (and frame):
// the ids the viewports use, derived exactly as StackManager derives them and registered with the
// same metadata providers, so an annotation hydrated from a report keys the same tool state the
// viewport reads.

import metadataProvider from '../../../classes/MetadataProvider';
import c3dMetadataProvider from '../../../classes/Cornerstone3dMetadataProvider';
import getImageId from '../../../utils/getImageId';


function registerImageId(imageId, uids, frameIndex) {
  metadataProvider.addImageIdToUIDs(imageId, uids);
  c3dMetadataProvider.addImageIdToUIDs(imageId, frameIndex === undefined ? uids : { ...uids, frameIndex });
}

/**
 * @param {Array} imageDisplaySets - display sets carrying `images` (InstanceMetadata wrappers or
 *   their data objects)
 * @param {object} [options]
 * @param {Function} [options.getImageId] - id builder, StackManager's by default
 * @param {boolean} [options.register] - register the ids with the metadata providers (default true)
 * @returns {{ sopInstanceUIDToImageId: object, imageIdsForToolState: object }}
 *   `sopInstanceUIDToImageId[SOP]` is the instance's id (its first frame's for a multiframe);
 *   `imageIdsForToolState[SOP][frameNumber]` the id per DICOM (1-based) frame number
 */
export function buildSopInstanceImageIds(imageDisplaySets, options = {}) {
  const { getImageId: buildImageId = getImageId, register = true } = options;
  const sopInstanceUIDToImageId = {};
  const imageIdsForToolState = {};

  (imageDisplaySets || []).forEach(displaySet => {
    const images = displaySet?.images || displaySet?.instances || [];

    images.forEach(instance => {
      const image = typeof instance?.getData === 'function' ? instance.getData() : instance;
      const naturalized = image?.metadata || image;
      const { StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID, NumberOfFrames } = naturalized || {};
      if (!SOPInstanceUID || sopInstanceUIDToImageId[SOPInstanceUID]) {
        return;
      }
      const uids = { StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID };

      try {
        if (NumberOfFrames > 1) {
          imageIdsForToolState[SOPInstanceUID] = [];
          for (let i = 0; i < NumberOfFrames; i++) {
            const imageId = buildImageId(image, i);
            if (!imageId) {
              continue;
            }
            imageIdsForToolState[SOPInstanceUID][i + 1] = imageId;
            if (register) {
              registerImageId(imageId, uids, i);
            }
          }
          sopInstanceUIDToImageId[SOPInstanceUID] = imageIdsForToolState[SOPInstanceUID][1];
        } else {
          const imageId = buildImageId(image);
          if (!imageId) {
            return;
          }
          sopInstanceUIDToImageId[SOPInstanceUID] = imageId;
          imageIdsForToolState[SOPInstanceUID] = [];
          imageIdsForToolState[SOPInstanceUID][1] = imageId;
          if (register) {
            registerImageId(imageId, uids);
          }
        }
      } catch (error) {
        console.warn('[DICOM-SR:sopInstanceImageIds] unable to build an image id for SOPInstanceUID='
          + SOPInstanceUID, error);
      }
    });
  });

  return { sopInstanceUIDToImageId, imageIdsForToolState };
}

export default buildSopInstanceImageIds;
