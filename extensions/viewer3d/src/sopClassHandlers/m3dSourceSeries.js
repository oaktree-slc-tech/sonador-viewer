// The imaging series a 3D model series was made from (ohif-viewers#143, FR-5). Encapsulated STL
// instances name it in ReferencedSeriesSequence, and share its frame of reference: the models'
// vertices are in that series' patient coordinates, so they can be placed on its image grid.

// Modalities the Segmentation Editor segments
const VOLUME_MODALITIES = ['CT', 'MR'];

function _firstInstanceMetadata(displaySet) {
  const image = displaySet?.images?.[0];
  return (image?.getData ? image.getData()?.metadata : undefined) || displaySet?.metadata;
}

/** SeriesInstanceUID of the series a model display set references, or undefined */
export function getM3DSourceSeriesUID(m3dDisplaySet) {
  const metadata = m3dDisplaySet?.metadata || _firstInstanceMetadata(m3dDisplaySet);
  const referenced = metadata?.ReferencedSeriesSequence;
  const first = Array.isArray(referenced) ? referenced[0] : referenced;
  return first?.SeriesInstanceUID || undefined;
}

/**
 * The display set of the imaging series a model display set was made from: the referenced series,
 * a CT or MR volume in the same study, in the same frame of reference when both declare one.
 *
 * @param {Object} m3dDisplaySet
 * @param {Object[]} displaySets - the study's display sets
 * @returns {Object|undefined}
 */
export function findM3DSourceDisplaySet(m3dDisplaySet, displaySets = []) {
  const seriesInstanceUID = getM3DSourceSeriesUID(m3dDisplaySet);
  if (!seriesInstanceUID) {
    return undefined;
  }
  const frameOfReferenceUID = (m3dDisplaySet?.metadata || _firstInstanceMetadata(m3dDisplaySet))
    ?.FrameOfReferenceUID;

  return displaySets.find(displaySet => {
    if (displaySet.SeriesInstanceUID !== seriesInstanceUID || !displaySet.isReconstructable
        || !VOLUME_MODALITIES.includes(displaySet.Modality)) {
      return false;
    }
    const sourceFrameOfReference = _firstInstanceMetadata(displaySet)?.FrameOfReferenceUID;
    return !frameOfReferenceUID || !sourceFrameOfReference
      || sourceFrameOfReference === frameOfReferenceUID;
  });
}
