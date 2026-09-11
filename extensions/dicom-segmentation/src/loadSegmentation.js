import cornerstoneTools from 'cornerstone-tools';
import dcmjs from 'dcmjs';

import { cornerstone3dUtils } from '@ohif/extension-vtk';

export default async function loadSegmentation(
  imageIds,
  segDisplaySet,
  labelmapBuffer,
  segMetadata,
  segmentsOnFrame,
  labelmapSegments
) {
  // TODO: Could define a color LUT based on colors in the SEG.
  const labelmapIndex = _getNextLabelmapIndex(imageIds[0]);

  // Segment numbers above 255 cannot be raw values in the canonical Uint8 labelmap; the planner
  // assigns each one a free sub-256 voxel value, reversibly (the map is stored with the
  // segmentation's provenance). The colour LUT is keyed by voxel value, so it uses the same map.
  const segmentValueMap = cornerstone3dUtils.planSegmentValueRemap(segMetadata);
  const colorLUTIndex = _makeColorLUTAndGetIndex(segMetadata, segmentValueMap);

  // Cornerstone3D owns the segmentation (#136 FR-1, as reversed by !87 note 37485). `dcmjs` has
  // parsed the SEG; it is not the store. The canonical voxels, geometry, slice order and segment
  // metadata go to Cornerstone3D first, and only then does the bridge build the legacy `labelmap3D`
  // that the classic viewport, `SegmentationPanel` and the cornerstone-tools brush read.
  //
  // `setters.labelmap3DByFirstImageId` is deliberately NOT called: it would allocate a second,
  // competing buffer and make the legacy module the origin of the labelmap again (AR-6).
  const segmentationId = `${imageIds[0]}_${labelmapIndex}`;

  // The segment numbers present on THIS labelmap layer, translated to CANONICAL voxel values. An
  // overlapping SEG imports as several layers, one canonical segmentation each; without this list
  // every layer's segmentation would carry the SEG's full declared segment set and the per-layer
  // membership would be lost. Canonical values because they are the single operational identity
  // after import -- the panel compares them against the clicked segment and against
  // `segmentsOnLabelmap`, both of which hold canonical values.
  const layerSegments = labelmapSegments.length
    ? Array.from(new Set(
        labelmapSegments
          .filter((a) => !!a)
          .reduce((a, b) => a.concat(b))
          .map((segmentNumber) => segmentValueMap[segmentNumber] || segmentNumber)
      ))
    : [];

  // One call, and deliberately no display hold: `createCanonicalSegmentation` registers the
  // durable Cornerstone3D segmentation (stack-backed labelmap + provenance) and installs the
  // legacy compatibility view, while display materialisation belongs to views alone. (An
  // importer-held view refcount is what previously pinned the display state forever, so no
  // teardown ever ran and the second open of a series inherited a texture from a destroyed WebGL
  // context.)
  cornerstone3dUtils.createCanonicalSegmentation({
    segmentationId,
    imageIds,
    labelmapBuffer,
    segMetadata,
    segmentValueMap,
    layerSegments,
    firstImageId: imageIds[0],
    labelmapIndex,
    colorLUTIndex,
  });

  // Every layer's id, keyed by its labelmap index; `segmentationId` stays the latest layer's id
  // as a compatibility alias for consumers that track a single active labelmap
  // (`OHIFSegmentationEditorViewport`, the 3D volume viewer's segmentation table).
  segDisplaySet.segmentationId = segmentationId;
  segDisplaySet.segmentationIds = {
    ...(segDisplaySet.segmentationIds || {}),
    [labelmapIndex]: segmentationId,
  };

  if (!segDisplaySet.labelmapSegments) {
    segDisplaySet.labelmapSegments = {};
  }

  /**
   * Cache each labelmap segments.
   * This data is used to determine the active label map when a given segment is activated/clicked.
   */
  segDisplaySet.labelmapSegments[labelmapIndex] = layerSegments;
  segDisplaySet.labelmapIndex = labelmapIndex;

  /*
   * TODO: Improve the way we notify parts of the app that depends on segs to be loaded.
   *
   * Currently we are using a non-ideal implementation through a custom event to notify the segmentation panel
   * or other components that could rely on loaded segmentations that
   * the segments were loaded so that e.g. when the user opens the panel
   * before the segments are fully loaded, the panel can subscribe to this custom event
   * and update itself with the new segments.
   *
   * This limitation is due to the fact that the cs segmentation module is an object (which will be
   * updated after the segments are loaded) that React its not aware of its changes
   * because the module object its not passed in to the panel component as prop but accessed externally.
   *
   * Improving this event approach to something reactive that can be tracked inside the react lifecycle,
   * allows us to easily watch the module or the segmentations loading process in any other component
   * without subscribing to external events.
   */
  const event = new CustomEvent('extensiondicomsegmentationsegloaded', {
    detail: {
      imageIds,
      segDisplaySet,
      labelmapBuffer,
      segMetadata,
      segmentsOnFrame,
      labelmapSegments,
    },
  });
  document.dispatchEvent(event);

  return labelmapIndex;
}

function _getNextLabelmapIndex(firstImageId) {
  // The next free labelmap slot on the series, considering BOTH sides of the bridge. The legacy
  // module alone is not enough: under `cornerstone3d.lazyLegacyLabelmap` no legacy state is
  // installed at import, so successive layers would all pick index 0 and collide on one
  // segmentationId -- the canonical Cornerstone3D segmentations are the authoritative roster.

  const { state } = cornerstoneTools.getModule('segmentation');
  const brushStackState = state.series[firstImageId];

  const used = new Set();

  if (brushStackState) {
    brushStackState.labelmaps3D.forEach((labelmap3D, index) => {
      if (labelmap3D) {
        used.add(index);
      }
    });
  }

  (cornerstone3dUtils.getCanonicalSegmentationsForSeries(firstImageId) || []).forEach(
    (canonical) => {
      if (canonical && Number.isInteger(canonical.labelmapIndex)) {
        used.add(canonical.labelmapIndex);
      }
    });

  let labelmapIndex = 0;
  while (used.has(labelmapIndex)) {
    labelmapIndex += 1;
  }

  return labelmapIndex;
}

function _makeColorLUTAndGetIndex(segMetadata, segmentValueMap) {
  const { setters, state } = cornerstoneTools.getModule('segmentation');
  const { colorLutTables } = state;
  const colorLUTIndex = _getNextColorLUTIndex();

  const { data } = segMetadata;
  const valueMap = segmentValueMap || {};

  if (!data.some((segment) => segment && (segment.ROIDisplayColor || segment.RecommendedDisplayCIELabValue))) {
    // Use default cornerstoneTools colorLUT.
    return 0;
  }

  const colorLUT = [];

  for (let i = 0; i < data.length; i++) {
    const segment = data[i];
    if (!segment) {
      continue;
    }

    // The LUT is looked up by VOXEL value, so a remapped segment's colour sits at its canonical
    // value, not at its original DICOM segment number.
    const lutIndex = valueMap[i] || i;
    const { ROIDisplayColor, RecommendedDisplayCIELabValue } = segment;

    if (RecommendedDisplayCIELabValue) {
      const rgb = dcmjs.data.Colors.dicomlab2RGB(RecommendedDisplayCIELabValue).map((x) => Math.round(x * 255));

      colorLUT[lutIndex] = [...rgb, 255];
    } else if (ROIDisplayColor) {
      colorLUT[lutIndex] = [...ROIDisplayColor, 255];
    } else {
      colorLUT[lutIndex] = [...colorLutTables[0][lutIndex]];
    }
  }

  colorLUT.shift();
  setters.colorLUT(colorLUTIndex, colorLUT);

  return colorLUTIndex;
}

function _getNextColorLUTIndex() {
  const { state } = cornerstoneTools.getModule('segmentation');
  const { colorLutTables } = state;

  let colorLUTIndex = colorLutTables.length;

  for (let i = 0; i < colorLutTables.length; i++) {
    if (!colorLutTables[i]) {
      colorLUTIndex = i;
      break;
    }
  }

  return colorLUTIndex;
}
