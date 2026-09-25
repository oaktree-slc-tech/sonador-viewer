// Segmentations created in the viewer rather than loaded from a DICOM SEG (ohif-viewers#143, AR-1):
// a blank segmentation, or 3D models voxelized onto a series. They take the importer's path --
// the labelmap bridge's canonical segmentation, a free labelmap slot and a colour LUT -- so the
// Segmentation Editor finds and forks them exactly as it does a loaded SEG. They live in memory
// only (marked with `markInMemorySegmentation`) until segmentations can be saved.

import { cornerstone3dUtils } from '@ohif/extension-vtk';

import { getNextLabelmapIndex, makeColorLUTAndGetIndex } from './loadSegmentation';


/** Image ids of an image display set, in its stack order (as the importer resolves them). */
export function getDisplaySetImageIds(displaySet) {
  return (displaySet?.images || []).map(image => image.getImageId());
}

/** '#rrggbb' -> [r, g, b] (0-255), or undefined */
export function hexToRgb(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!match) {
    return undefined;
  }
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/**
 * Register a new in-memory segmentation on an image display set.
 *
 * @param {Object} params
 * @param {Object} params.displaySet - the image display set (CT/MR series)
 * @param {string} params.label - segmentation label
 * @param {Array<{ label: string, color?: number[] }>} params.segments - segments 1..n; `color`
 *   is RGB 0-255 (the default colour LUT is used when no segment has one)
 * @param {string} params.origin - 'blank' | 'models'
 * @param {Uint16Array} [params.labelmapBuffer] - voxels (segment numbers), one slice per entry of
 *   `bufferImageIds`
 * @param {string[]} [params.bufferImageIds] - slice order of `labelmapBuffer` (default: the
 *   display set's stack order)
 * @param {Object} [params.deps] - injectable bridge functions (tests)
 * @returns {{ segmentationId: string, firstImageId: string, labelmapIndex: number }}
 */
export function createInMemorySegmentation({
  displaySet, label, segments, origin, labelmapBuffer, bufferImageIds, deps = {},
}) {
  const {
    createCanonicalSegmentation = cornerstone3dUtils.createCanonicalSegmentation,
    markInMemorySegmentation = cornerstone3dUtils.markInMemorySegmentation,
    nextLabelmapIndex = getNextLabelmapIndex,
    makeColorLUT = makeColorLUTAndGetIndex,
  } = deps;

  const imageIds = getDisplaySetImageIds(displaySet);
  if (!imageIds.length) {
    throw new Error('The series has no images to segment');
  }
  const firstImageId = imageIds[0];
  const labelmapIndex = nextLabelmapIndex(firstImageId);
  const segmentationId = `${firstImageId}_${labelmapIndex}`;

  // The segment metadata the importer would have from a SEG: labels, and colours as ROIDisplayColor
  const segMetadata = {
    seriesInstanceUid: displaySet.SeriesInstanceUID,
    label,
    data: [undefined, ...segments.map((segment, i) => ({
      SegmentNumber: i + 1,
      SegmentLabel: segment.label,
      SegmentAlgorithmType: 'MANUAL',
      ...(segment.color ? { ROIDisplayColor: segment.color } : {}),
    }))],
  };
  const colorLUTIndex = makeColorLUT(segMetadata);

  createCanonicalSegmentation({
    segmentationId,
    imageIds: labelmapBuffer ? (bufferImageIds || imageIds) : imageIds,
    labelmapBuffer,
    segMetadata,
    layerSegments: segments.map((_segment, i) => i + 1),
    firstImageId,
    labelmapIndex,
    colorLUTIndex,
    label,
  });
  markInMemorySegmentation(segmentationId, { origin });

  return { segmentationId, firstImageId, labelmapIndex };
}

export default createInMemorySegmentation;
