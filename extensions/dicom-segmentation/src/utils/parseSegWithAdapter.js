// Parses a DICOM SEG into the labelmap layers the importer (`loadSegmentation`) consumes.
//
// The parse runs through the Cornerstone3D adapter (`createFromDICOMSegBuffer`), which writes one
// derived Uint8 labelmap image per referenced image, per layer, into the Cornerstone3D cache. Those
// images are copied out into the shape the dcmjs 0.41 loader returned -- one contiguous Uint16
// buffer per layer in referenced-imageId order, the per-layer segments-on-frame lists and the
// segment metadata -- and are then removed from the cache: the bridge registers the canonical
// labelmap itself, and a second set of images for the same series would only cost memory.
//
// SEGs the adapter cannot parse faithfully go to the dcmjs 0.41 loader instead (see
// `getLegacyParserReason`).

import { adaptersSEG } from '@cornerstonejs/adapters';
import { findReferenceSourceImageId } from '@cornerstonejs/adapters/cornerstone/Segmentation_4X';
import {
  cache as c3dCache,
  Enums as c3dEnums,
  eventTarget as c3dEventTarget,
  metaData as c3dMetaData,
} from '@cornerstonejs/core';
import cornerstone from 'cornerstone-core';
import dcmjs from 'dcmjs';

const { DicomMessage, DicomMetaDictionary } = dcmjs.data;
const { Normalizer } = dcmjs.normalizers;

const LOG_PREFIX = '[dicom-segmentation:parseSeg]';

const RLE_LOSSLESS = '1.2.840.10008.1.2.5';
const EXPLICIT_VR_LITTLE_ENDIAN = '1.2.840.10008.1.2.1';

// The adapter writes voxels into Uint8 derived images (`createAndCacheDerivedLabelmapImage` fixes
// the buffer type and `createFromDICOMSegBuffer` forwards no array type), so a segment number above
// this would wrap.
const ADAPTER_MAX_SEGMENT_NUMBER = 255;

// The id prefix `createAndCacheDerivedImage` gives an image when the caller names none, which the
// adapter never does.
const ADAPTER_IMAGE_ID_PREFIX = 'derived:';


export default async function parseSeg(arrayBuffer, imageIds, tolerance = 1e-2, options = {}) {
  // @input arrayBuffer (ArrayBuffer): the SEG instance
  // @input imageIds (str[]): the referenced series' imageIds; the layer buffers follow this order
  // @input tolerance (num): orientation/position tolerance, as the dcmjs loader took it
  // @input options.dataset (object): the SEG, already naturalized; parsed here when absent
  // @input options.metadataProvider (object): Cornerstone3D metadata; `metaData` from core by default
  // @returns { labelmapBufferArray, segMetadata, segmentsOnFrame, segmentsOnFrameArray, parser },
  //   or undefined for a SEG neither loader implements (RLE-compressed BINARY)

  const metadataProvider = options.metadataProvider || c3dMetaData;
  const dataset = options.dataset || _naturalize(arrayBuffer);

  const legacyReason = getLegacyParserReason(dataset, imageIds, metadataProvider, tolerance);
  if (legacyReason) {
    console.warn(`${LOG_PREFIX} parsing with the dcmjs loader: ${legacyReason}`);
    return parseSegWithLegacyLoader(arrayBuffer, imageIds, tolerance, options.legacyMetadataProvider);
  }

  const adapterBuffer = _transcodeForAdapter(arrayBuffer, dataset);
  const adapterImages = new Set();
  const referencedImageIds = new Set(imageIds);

  // The images this parse owns: the set the adapter creates before it first yields (one image per
  // referenced image, which the overlapping path abandons), announced by `putImageSync`, and the
  // layers it returns. Images other code adds while the parse waits are not this parse's.
  const onImageAdded = evt => {
    const cached = evt && evt.detail && evt.detail.image;
    const image = cached && cached.image;
    if (image && referencedImageIds.has(image.referencedImageId)
        && String(cached.imageId).startsWith(ADAPTER_IMAGE_ID_PREFIX)) {
      adapterImages.add(cached.imageId);
    }
  };

  let pending;
  c3dEventTarget.addEventListener(c3dEnums.Events.IMAGE_CACHE_IMAGE_ADDED, onImageAdded);
  try {
    pending = adaptersSEG.Cornerstone3D.Segmentation.createFromDICOMSegBuffer(
      imageIds, adapterBuffer, { metadataProvider, tolerance });
  } finally {
    c3dEventTarget.removeEventListener(c3dEnums.Events.IMAGE_CACHE_IMAGE_ADDED, onImageAdded);
  }
  try {
    const parsed = await pending;

    if (!parsed) {
      console.warn(`${LOG_PREFIX} the SEG pixel data is not supported (RLE with bit packing)`);
      return undefined;
    }

    (parsed.labelMapImages || []).forEach(layer => layer.forEach(image => {
      if (image && image.imageId) {
        adapterImages.add(image.imageId);
      }
    }));

    const result = toLegacyShape(parsed, imageIds);
    _warnOnMissingSegments(dataset, result);
    return result;
  } finally {
    releaseAdapterImages(adapterImages);
  }
}


export function parseSegWithLegacyLoader(arrayBuffer, imageIds, tolerance = 1e-2, metadataProvider) {
  // The dcmjs 0.41 loader: Uint16 layers (segment numbers above 255 survive), no LABELMAP support.
  const result = dcmjs.adapters.Cornerstone.Segmentation.generateToolState(
    imageIds,
    arrayBuffer,
    metadataProvider || cornerstone.metaData,
    false,
    tolerance,
    4
  );
  return result && { ...result, parser: 'legacy' };
}


export function getLegacyParserReason(dataset, imageIds, metadataProvider, tolerance = 1e-2) {
  // Why the adapter cannot parse this SEG faithfully, or null when it can.

  const isLabelmap = dataset.SegmentationType === 'LABELMAP';
  const maxSegmentNumber = _maxSegmentNumber(dataset);

  if (maxSegmentNumber > ADAPTER_MAX_SEGMENT_NUMBER) {
    if (isLabelmap) {
      throw new Error(
        `LABELMAP segmentations with segment numbers above ${ADAPTER_MAX_SEGMENT_NUMBER} are not supported.`);
    }
    return `segment number ${maxSegmentNumber} does not fit the adapter's 8-bit labelmap`;
  }

  if (isLabelmap) {
    // The dcmjs loader cannot read LABELMAP at all; the adapter is the only option.
    return null;
  }

  if (!dataset.FrameOfReferenceUID) {
    // The adapter requires plane orientation; the dcmjs loader treats such a SEG as planar.
    return 'the SEG has no FrameOfReferenceUID';
  }

  const firstImageId = imageIds[0];
  if (!metadataProvider.get('instance', firstImageId)
      || !metadataProvider.get('generalImageModule', firstImageId)
      || !metadataProvider.get('imagePlaneModule', firstImageId)) {
    return 'the referenced images have no Cornerstone3D instance metadata';
  }

  // The adapter's BINARY path stops without settling its promise when a frame references an image
  // outside `imageIds`; the dcmjs loader skips the frame. Resolve every frame up front, exactly as
  // the adapter will.
  const unresolved = _unresolvedFrames(dataset, imageIds, metadataProvider, tolerance);
  if (unresolved.length) {
    return `${unresolved.length} SEG frame(s) reference images outside the series (first: frame ${unresolved[0]})`;
  }

  return null;
}


export function toLegacyShape(parsed, imageIds) {
  // The adapter's layers as the dcmjs 0.41 loader returned them: ArrayBuffers of Uint16 voxels,
  // slice i at offset i * sliceLength in `imageIds` order; `segmentsOnFrameArray[layer][slice]` and
  // `segmentsOnFrame[slice]` list the segment numbers present.

  const { labelMapImages = [], segMetadata } = parsed;
  const sliceIndex = new Map(imageIds.map((imageId, index) => [imageId, index]));

  let sliceLength;
  const labelmapBufferArray = [];
  const segmentsOnFrameArray = [];
  const segmentsOnFrame = [];

  labelMapImages.forEach((layerImages, layerIndex) => {
    const slices = layerImages.map(image => ({
      index: sliceIndex.get(image.referencedImageId),
      voxels: _scalarData(image),
    })).filter(({ index, voxels }) => index !== undefined && voxels);

    if (sliceLength === undefined && slices.length) {
      sliceLength = slices[0].voxels.length;
    }

    const buffer = new Uint16Array((sliceLength || 0) * imageIds.length);
    const layerSegments = [];

    slices.forEach(({ index, voxels }) => {
      if (voxels.length !== sliceLength) {
        throw new Error(
          `Labelmap slice ${index} has ${voxels.length} voxels where ${sliceLength} were expected.`);
      }
      buffer.set(voxels, index * sliceLength);

      const present = _presentValues(voxels);
      if (present.length) {
        layerSegments[index] = present;
        segmentsOnFrame[index] = _union(segmentsOnFrame[index], present);
      }
    });

    labelmapBufferArray[layerIndex] = buffer.buffer;
    segmentsOnFrameArray[layerIndex] = layerSegments;
  });

  return {
    labelmapBufferArray,
    segMetadata,
    segmentsOnFrame,
    segmentsOnFrameArray,
    parser: 'adapter',
  };
}


export function releaseAdapterImages(imageIds) {
  // Remove the adapter's derived images from the Cornerstone3D cache. The image objects stay valid
  // for callers that still hold them; only the cache entries (and their byte accounting) go.
  imageIds.forEach(imageId => {
    if (!c3dCache.getImageLoadObject(imageId)) {
      return;
    }
    try {
      c3dCache.removeImageLoadObject(imageId, { force: true });
    } catch (error) {
      console.warn(`${LOG_PREFIX} could not remove ${imageId} from the image cache`, error);
    }
  });
}


function _naturalize(arrayBuffer) {
  const dicomData = DicomMessage.readFile(arrayBuffer);
  const dataset = DicomMetaDictionary.naturalizeDataset(dicomData.dict);
  dataset._meta = DicomMetaDictionary.namifyDataset(dicomData.meta);
  return dataset;
}


function _transferSyntax(dataset) {
  const meta = dataset._meta || {};
  return meta.TransferSyntaxUID && meta.TransferSyntaxUID.Value && meta.TransferSyntaxUID.Value[0];
}


function _transcodeForAdapter(arrayBuffer, dataset) {
  // The adapter decodes RLE into a chunk list, which its LABELMAP path then indexes as one typed
  // array. An RLE LABELMAP is therefore handed over decoded, as Explicit VR Little Endian.
  if (dataset.SegmentationType !== 'LABELMAP' || _transferSyntax(dataset) !== RLE_LOSSLESS) {
    return arrayBuffer;
  }
  if (dataset.BitsAllocated !== 8) {
    throw new Error('RLE-compressed LABELMAP segmentations are supported with 8 bits per voxel only.');
  }

  const copy = _naturalize(arrayBuffer);
  const frames = Array.isArray(copy.PixelData) ? copy.PixelData : [copy.PixelData];
  const decoded = dcmjs.utilities.compression.decode(frames, copy.Rows, copy.Columns);
  copy.PixelData = [decoded.buffer];
  copy._meta = { TransferSyntaxUID: { Value: [EXPLICIT_VR_LITTLE_ENDIAN] } };

  return dcmjs.data.datasetToDict(copy).write();
}


function _maxSegmentNumber(dataset) {
  const segments = _asArray(dataset.SegmentSequence);
  let max = segments.length;

  segments.forEach(segment => {
    max = Math.max(max, Number(segment && segment.SegmentNumber) || 0);
  });
  _asArray(dataset.PerFrameFunctionalGroupsSequence).forEach(group => {
    const identification = _first(group && group.SegmentIdentificationSequence);
    max = Math.max(max, Number(identification && identification.ReferencedSegmentNumber) || 0);
  });

  return max;
}


function _unresolvedFrames(dataset, imageIds, metadataProvider, tolerance) {
  const multiframe = Normalizer.normalizeToDataset([dataset]);
  const sopUIDImageIdIndexMap = imageIds.reduce((acc, imageId) => {
    const generalImageModule = metadataProvider.get('generalImageModule', imageId);
    if (generalImageModule && generalImageModule.sopInstanceUID) {
      acc[generalImageModule.sopInstanceUID] = imageId;
    }
    return acc;
  }, {});
  const known = new Set(imageIds);

  const unresolved = [];
  _asArray(multiframe.PerFrameFunctionalGroupsSequence).forEach((group, frameIndex) => {
    const imageId = findReferenceSourceImageId(
      multiframe, frameIndex, imageIds, metadataProvider, tolerance, sopUIDImageIdIndexMap);
    if (!imageId || !known.has(imageId)) {
      unresolved.push(frameIndex);
    }
  });
  return unresolved;
}


function _warnOnMissingSegments(dataset, result) {
  // The adapter's overlap split visits segments 1..SegmentSequence.length, so a SEG with gaps in
  // its numbering can lose a segment. Name any that has frames but no voxels after the parse.
  if (dataset.SegmentationType === 'LABELMAP') {
    return;
  }

  const imported = new Set();
  result.segmentsOnFrame.forEach(segments => (segments || []).forEach(n => imported.add(n)));

  const framed = new Set();
  _asArray(dataset.PerFrameFunctionalGroupsSequence).forEach(group => {
    const identification = _first(group && group.SegmentIdentificationSequence);
    const number = Number(identification && identification.ReferencedSegmentNumber);
    if (number) {
      framed.add(number);
    }
  });

  const missing = [...framed].filter(number => !imported.has(number));
  if (missing.length) {
    console.warn(`${LOG_PREFIX} segments with frames but no imported voxels: ${missing.join(', ')}`);
  }
}


function _scalarData(image) {
  if (image.voxelManager && typeof image.voxelManager.getScalarData === 'function') {
    return image.voxelManager.getScalarData();
  }
  return typeof image.getPixelData === 'function' ? image.getPixelData() : undefined;
}


function _presentValues(voxels) {
  const present = new Set();
  for (let i = 0; i < voxels.length; i++) {
    if (voxels[i]) {
      present.add(voxels[i]);
    }
  }
  return [...present].sort((a, b) => a - b);
}


function _union(existing, values) {
  if (!existing) {
    return values.slice();
  }
  return [...new Set([...existing, ...values])].sort((a, b) => a - b);
}


function _asArray(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}


function _first(value) {
  return Array.isArray(value) ? value[0] : value;
}
