// Image ids for every image of the study's image display sets, keyed by SOP instance (and frame):
// the ids the viewports use, derived exactly as StackManager derives them and registered with the
// same metadata providers, so an annotation hydrated from a report keys the same tool state the
// viewport reads.
//
// The image plane of a single-frame image is also answered from its display set's instance
// metadata, when no other Cornerstone3D metadata provider has it: the report reader and the
// coordinate conversion read the plane through Cornerstone3D, whose providers only know the
// instances held by the DicomMetadataStore. Without it, a measurement on such an image is not
// hydrated, and the read-only display shows it instead. Only complete geometry is answered: a
// position, an orientation and the image's own pixel spacing; nothing is substituted.

import { metaData as c3dMetaData } from '@cornerstonejs/core';

import metadataProvider from '../../../classes/MetadataProvider';
import c3dMetadataProvider from '../../../classes/Cornerstone3dMetadataProvider';
import getImageId from '../../../utils/getImageId';
import { planeFromInstance } from '../../readOnly/planeGeometry';

// Below the viewer's providers: answered only when none of them has the image
const FALLBACK_PRIORITY = -100;

// imagePlaneModule by image id, for the fallback provider
const fallbackPlanes = new Map();
let fallbackRegistered = false;

function fallbackPlaneProvider(type, imageId) {
  return type === 'imagePlaneModule' && typeof imageId === 'string' ? fallbackPlanes.get(imageId) : undefined;
}

function numbers(value, count) {
  // `count` finite numbers of a DICOM multi-valued attribute (an array or a backslash list), or null
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split('\\') : [];
  if (values.length !== count || values.some(item => item === '' || item === null || !Number.isFinite(Number(item)))) {
    return null;
  }
  return values.map(Number);
}

function registerFallbackPlane(imageId, naturalized) {
  // Only complete geometry: a position, an orientation and a positive pixel spacing in both
  // directions; no spacing or plane vector is assumed
  const position = naturalized && numbers(naturalized.ImagePositionPatient, 3);
  const orientation = naturalized && numbers(naturalized.ImageOrientationPatient, 6);
  const spacing = naturalized && numbers(naturalized.PixelSpacing, 2);
  const directions = orientation && [orientation.slice(0, 3), orientation.slice(3)]
    .every(direction => Math.hypot(...direction) > 0);
  const plane = position && directions && spacing && spacing.every(value => value > 0)
    ? planeFromInstance({ ...naturalized, ImagePositionPatient: position, ImageOrientationPatient: orientation, PixelSpacing: spacing })
    : null;
  if (!plane) {
    return;
  }
  fallbackPlanes.set(imageId, {
    ...plane,
    rows: Number(naturalized.Rows) || undefined,
    columns: Number(naturalized.Columns) || undefined,
  });
  if (!fallbackRegistered) {
    c3dMetaData.addProvider(fallbackPlaneProvider, FALLBACK_PRIORITY);
    fallbackRegistered = true;
  }
}


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
            registerFallbackPlane(imageId, naturalized);
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

export { fallbackPlaneProvider };
export default buildSopInstanceImageIds;
