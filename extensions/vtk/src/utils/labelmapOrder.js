import _ from 'lodash';


// Slice-order arithmetic between a legacy cornerstone-tools labelmap and a Cornerstone3D volume.
//
// The legacy `labelmap3D.buffer` is one contiguous ArrayBuffer in *stack* order: `StackManager`
// holds the display set's imageIds in the order the study describes them, and
// `setLabelmap3DByFirstImageId` lays one slice down per imageId in that order. A Cornerstone3D
// streaming volume re-sorts the same imageIds by image position, so the two orders coincide for
// most series but are not the same thing.
//
// Kept free of Cornerstone3D, vtk.js and @ohif/core imports: both the bridge and the volume
// utilities need this arithmetic, and neither should have to pull the other in to get it.


export function computeLabelmapSliceMap(referenceVolume, stackImageIds) {
  // Work out where each slice of a legacy labelmap lands in a Cornerstone3D volume.

  // @input referenceVolume (ImageVolume): the image volume the labelmap is derived from
  // @input stackImageIds (str[]): the legacy stack's imageIds, in buffer order
  // @returns { map, identity, slices }
  //   map[stackIndex] = volume slice index, or -1 when the volume has no such slice
  //   identity: true when the two orders coincide slice for slice, which is the condition for
  //     sharing the buffer by reference rather than copying it

  const slices = referenceVolume?.dimensions ? referenceVolume.dimensions[2] : 0;

  const map = _.map(stackImageIds || [], (imageId) => {
    const index = referenceVolume && _.isFunction(referenceVolume.getImageIdIndex)
      ? referenceVolume.getImageIdIndex(imageId)
      : undefined;

    return _.isNumber(index) && index >= 0 && index < slices ? index : -1;
  });

  const identity = !!slices && map.length === slices && _.every(map, (v, i) => v === i);

  return { map, identity, slices: slices || 0 };
}


export function invertLabelmapSliceMap(map) {
  // Reverse of `computeLabelmapSliceMap().map`: volume slice index -> stack index.
  //
  // A volume slice the stack does not cover has no entry, which is what the Cornerstone3D ->
  // legacy direction checks before it writes anything back.

  const inverse = new Map();

  _.each(map || [], (volumeIndex, stackIndex) => {
    if (volumeIndex >= 0 && !inverse.has(volumeIndex)) {
      inverse.set(volumeIndex, stackIndex);
    }
  });

  return inverse;
}


export function mapLabelmapBufferToVolumeOrder(referenceVolume, stackImageIds, labelmapBuffer) {
  // Re-order a legacy cornerstone-tools `labelmap3D.buffer` (stack order) into the slice order of a
  // Cornerstone3D volume.
  //
  // Mapping by imageId rather than by position in the stack is what keeps a segment on the slice it
  // was drawn on when the two orders differ.

  // @input referenceVolume (ImageVolume): the image volume the labelmap is derived from
  // @input stackImageIds (str[]): the legacy stack's imageIds, in buffer order
  // @input labelmapBuffer (ArrayBuffer|TypedArray): the legacy labelmap buffer
  // @returns Uint16Array in volume slice order

  const [columns, rows, slices] = referenceVolume.dimensions;
  const sliceLength = columns * rows;

  const source = labelmapBuffer instanceof Uint16Array
    ? labelmapBuffer
    : new Uint16Array(labelmapBuffer);
  const target = new Uint16Array(sliceLength * slices);

  _.each(stackImageIds, (imageId, stackIndex) => {
    const volumeIndex = referenceVolume.getImageIdIndex(imageId);

    // A slice the volume does not contain (a decimated navigation volume drops slices) has
    // nowhere to go; the labelmap simply has no data at that position.
    if (volumeIndex === undefined || volumeIndex < 0 || volumeIndex >= slices) {
      return;
    }

    const from = stackIndex * sliceLength;
    if (from + sliceLength > source.length) {
      return;
    }

    target.set(source.subarray(from, from + sliceLength), volumeIndex * sliceLength);
  });

  return target;
}


export function getSegmentsOnPixelData(pixelData) {
  // The segment indices present on one slice, in the shape cornerstone-tools stores on
  // `labelmaps2D[i].segmentsOnLabelmap`.
  //
  // Reimplemented rather than imported: the library's `getSegmentsOnPixeldata` is internal to its
  // bundle and is not reachable through the segmentation module's public getters/setters. It is
  // `[...new Set(pixelData)]` at v6.0.10 -- background (0) included -- and this matches it exactly,
  // because `SegmentationPanel` and `getLabelmapStats` read the array the library writes.

  return [...new Set(pixelData)];
}


export function planSegmentValueRemap(segMetadata) {
  // Decide how DICOM segment numbers map onto the canonical Uint8 voxel values.
  //
  // The canonical store is `Uint8Array` (the only format Cornerstone3D's labelmap renderer
  // displays; see `canonicalScalarTypeFor` in labelmapBridge.js), so a SEG whose segment numbers
  // exceed 255 cannot keep them as raw voxel values. Values are narrowed EXPLICITLY, never by
  // `TypedArray.set`'s silent modulo: numbers up to 255 keep their identity, and each number above
  // 255 is assigned the lowest voxel value no declared segment uses. The map is stored with the
  // segmentation's provenance so serialization can invert it (#136 FR-5).

  // @input segMetadata (object): the dcmjs segment metadata; `data` is indexed by segment number
  // @returns Object<number, number> mapping ORIGINAL segment number -> canonical voxel value,
  //   containing entries only for numbers that had to move; empty when nothing does
  // @throws when more than 255 segments are declared -- there is no valid narrowing

  const data = (segMetadata && segMetadata.data) || [];
  const declared = [];
  _.each(data, (entry, segmentNumber) => {
    if (entry && segmentNumber) {
      declared.push(segmentNumber);
    }
  });

  if (declared.length > 255) {
    throw new Error(
      `planSegmentValueRemap: ${declared.length} segments declared; a Uint8 labelmap holds at `
      + 'most 255');
  }

  const used = new Set(declared.filter((segmentNumber) => segmentNumber <= 255));
  const map = {};

  let next = 1;
  _.each(declared, (segmentNumber) => {
    if (segmentNumber <= 255) {
      return;
    }
    while (used.has(next)) {
      next += 1;
    }
    map[segmentNumber] = next;
    used.add(next);
  });

  return map;
}
