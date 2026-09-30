// A DICOM Segmentation object as a labelled grid for import (labelmapGrid), read from the SEG
// itself rather than through the images it references: the per-frame plane positions and the
// shared orientation and spacing place every frame in patient coordinates, so a SEG can be
// imported into a segmentation of a different series, and a local SEG file into a study that
// does not hold its source images. Only when a frame carries no position of its own is the
// referenced image consulted (the study's copy, through the caller's resolver).
//
// Frames are placed by their position along the slice normal, on a grid at the smallest frame
// spacing; a SEG with gaps between frames leaves those slices empty. The frames must share one
// rectangular grid: a frame displaced along the row or column axes, or one that does not sit on
// the slice lattice, is refused rather than placed where it is not (Image Position (Patient) is
// the full position of a frame's first voxel, so orientation and spacing alone do not make a
// shared grid). Overlapping segments share one grid, so where two segments claim a voxel the
// later frame keeps it (counted for the caller). Segment numbers stay the SEG's own; the importer
// renumbers them into the segmentation.

import dcmjs from 'dcmjs';


const SOP_CLASS_SEGMENTATION = '1.2.840.10008.5.1.4.1.1.66.4';

const { DicomMessage, DicomMetaDictionary, BitArray, Colors } = dcmjs.data;

/** dcmjs naturalizes a one-item sequence to the item itself */
export function asSequence(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

const asNumbers = value => asSequence(value).map(Number);

function _cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ].map(value => value || 0);   // no negative zeros
}

const _dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function _sameVector(a, b, tolerance = 1e-3) {
  return a.length === b.length && a.every((value, i) => Math.abs(value - b[i]) <= tolerance);
}

/** The naturalized dataset of a DICOM Part 10 byte stream */
export function readDicomDataset(arrayBuffer) {
  const dicomData = DicomMessage.readFile(arrayBuffer);
  const dataset = DicomMetaDictionary.naturalizeDataset(dicomData.dict);
  dataset._meta = DicomMetaDictionary.namifyDataset(dicomData.meta);
  return dataset;
}

/** `segment-<n>` for a segment without a label */
export function defaultSegmentLabel(segmentNumber) {
  return `segment-${segmentNumber}`;
}

/** The segments a SEG declares: number, label and colour (RGB 0-255, from CIELab) */
export function segmentsFromSegmentSequence(dataset) {
  return asSequence(dataset.SegmentSequence).map(item => {
    const value = Number(item.SegmentNumber);
    const lab = asNumbers(item.RecommendedDisplayCIELabValue);
    return {
      value,
      label: item.SegmentLabel || defaultSegmentLabel(value),
      ...(lab.length === 3
        ? { color: Colors.dicomlab2RGB(lab).map(x => Math.round(x * 255)) }
        : {}),
    };
  }).sort((a, b) => a.value - b.value);
}

function _pixelBits(dataset, frameCount, frameSize) {
  // The SEG's pixels as one byte per pixel, frame after frame
  const buffers = asSequence(dataset.PixelData);
  const total = buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0);
  const packed = new Uint8Array(total);
  let offset = 0;
  buffers.forEach(buffer => {
    packed.set(new Uint8Array(buffer), offset);
    offset += buffer.byteLength;
  });

  const bitsAllocated = Number(dataset.BitsAllocated) || 1;
  const needed = frameCount * frameSize;
  let pixels;
  if (bitsAllocated === 1) {
    pixels = BitArray.unpack(packed);
  } else if (bitsAllocated === 8) {
    // FRACTIONAL segmentations: a pixel belongs to the segment at half the maximum or more
    const threshold = (Number(dataset.MaximumFractionalValue) || 255) / 2;
    pixels = new Uint8Array(packed.length);
    for (let i = 0; i < packed.length; i++) {
      pixels[i] = packed[i] >= threshold ? 1 : 0;
    }
  } else {
    throw new Error(`Segmentations with ${bitsAllocated} bits per pixel are not supported`);
  }
  if (pixels.length < needed) {
    throw new Error('The segmentation\'s pixel data is shorter than its frames');
  }
  return pixels;
}

function _framePlane(frame, shared, resolveReferencedFrame) {
  // Position, orientation and spacing of a frame: its own, the shared ones, or the referenced
  // image's (a SEG written without per-frame positions)
  const position = asNumbers(frame.PlanePositionSequence?.ImagePositionPatient);
  const orientation = asNumbers((frame.PlaneOrientationSequence || shared.PlaneOrientationSequence)?.ImageOrientationPatient);
  const measures = frame.PixelMeasuresSequence || shared.PixelMeasuresSequence || {};
  const pixelSpacing = asNumbers(measures.PixelSpacing);

  if (position.length === 3 && orientation.length === 6 && pixelSpacing.length === 2) {
    return { position, orientation, pixelSpacing, measures };
  }

  const source = asSequence(asSequence(frame.DerivationImageSequence)[0]?.SourceImageSequence)[0];
  const referenced = source?.ReferencedSOPInstanceUID && resolveReferencedFrame
    ? resolveReferencedFrame({
      sopInstanceUID: source.ReferencedSOPInstanceUID,
      frameNumber: source.ReferencedFrameNumber ? Number(asSequence(source.ReferencedFrameNumber)[0]) : undefined,
    })
    : undefined;
  const resolved = {
    position: position.length === 3 ? position : asNumbers(referenced?.ImagePositionPatient),
    orientation: orientation.length === 6 ? orientation : asNumbers(referenced?.ImageOrientationPatient),
    pixelSpacing: pixelSpacing.length === 2 ? pixelSpacing : asNumbers(referenced?.PixelSpacing),
    measures,
  };
  if (resolved.position.length !== 3 || resolved.orientation.length !== 6 || resolved.pixelSpacing.length !== 2) {
    throw new Error(source?.ReferencedSOPInstanceUID
      ? 'The segmentation has frames without a position, and the images it references are not available'
      : 'The segmentation has frames without a position');
  }
  return resolved;
}

/**
 * Read a DICOM SEG into a labelled grid.
 *
 * @param {ArrayBuffer|Object} segData - the SEG's bytes, or its naturalized dataset
 * @param {Object} [options]
 * @param {Function} [options.resolveReferencedFrame] - ({ sopInstanceUID, frameNumber }) =>
 *   { ImagePositionPatient, ImageOrientationPatient, PixelSpacing } | undefined, for frames that
 *   carry no position of their own
 * @returns {{ grid: Object, segments: Array<{ value, label, color? }>, overlapVoxels: number,
 *   frameCount: number }} `segments` are the declared segments that have frames, by number
 */
export function parseDicomSeg(segData, { resolveReferencedFrame } = {}) {
  const dataset = segData instanceof ArrayBuffer ? readDicomDataset(segData) : segData;
  if (dataset.SOPClassUID !== SOP_CLASS_SEGMENTATION) {
    throw new Error('Not a DICOM Segmentation object');
  }

  const rows = Number(dataset.Rows);
  const columns = Number(dataset.Columns);
  const frames = asSequence(dataset.PerFrameFunctionalGroupsSequence);
  const frameCount = Number(dataset.NumberOfFrames) || frames.length;
  if (!rows || !columns || !frameCount || frames.length < frameCount) {
    throw new Error('The segmentation has no frames');
  }
  const shared = asSequence(dataset.SharedFunctionalGroupsSequence)[0] || {};

  // Every frame's plane; one orientation for all of them
  const planes = frames.slice(0, frameCount).map(frame => _framePlane(frame, shared, resolveReferencedFrame));
  const { orientation, pixelSpacing } = planes[0];
  if (planes.some(plane => !_sameVector(plane.orientation, orientation) || !_sameVector(plane.pixelSpacing, pixelSpacing))) {
    throw new Error('Segmentations whose frames have different orientations or spacings are not supported');
  }
  const rowCosines = orientation.slice(0, 3);
  const columnCosines = orientation.slice(3, 6);
  const normal = _cross(rowCosines, columnCosines);

  // Slices along the normal, at the smallest distance between distinct frame positions. The
  // origin is the lowest frame; every other frame must sit straight above it (no displacement
  // along the row or column axes beyond a small fraction of a pixel) and on the slice lattice.
  const offsets = planes.map(plane => _dot(plane.position, normal));
  const origin = planes[offsets.indexOf(Math.min(...offsets))].position;
  const inPlaneTolerance = 0.01 * Math.min(pixelSpacing[0], pixelSpacing[1]);
  planes.forEach(plane => {
    const d = plane.position.map((value, i) => value - origin[i]);
    if (Math.abs(_dot(d, rowCosines)) > inPlaneTolerance || Math.abs(_dot(d, columnCosines)) > inPlaneTolerance) {
      throw new Error('The segmentation\'s frames are shifted against each other in the image plane, so they do not share one grid');
    }
  });

  const distinct = Array.from(new Set(offsets.map(offset => +offset.toFixed(3)))).sort((a, b) => a - b);
  let sliceSpacing = Infinity;
  for (let i = 1; i < distinct.length; i++) {
    sliceSpacing = Math.min(sliceSpacing, distinct[i] - distinct[i - 1]);
  }
  if (!Number.isFinite(sliceSpacing) || sliceSpacing <= 0) {
    const measures = planes[0].measures;
    sliceSpacing = Number(measures.SpacingBetweenSlices) || Number(measures.SliceThickness) || 1;
  }
  const first = distinct[0];
  const sliceOf = offset => Math.round((offset - first) / sliceSpacing);
  distinct.forEach(offset => {
    const slices = (offset - first) / sliceSpacing;
    if (Math.abs(slices - Math.round(slices)) > 0.01) {
      throw new Error('The segmentation\'s frames are not evenly spaced, so they do not share one grid');
    }
  });
  const sliceCount = sliceOf(distinct[distinct.length - 1]) + 1;

  const dimensions = [columns, rows, sliceCount];
  const data = new Uint16Array(columns * rows * sliceCount);
  const frameSize = rows * columns;
  const pixels = _pixelBits(dataset, frameCount, frameSize);
  const present = new Set();
  let overlapVoxels = 0;

  frames.slice(0, frameCount).forEach((frame, f) => {
    const segmentNumber = Number(asSequence(frame.SegmentIdentificationSequence)[0]?.ReferencedSegmentNumber);
    if (!segmentNumber) {
      return;
    }
    const k = sliceOf(offsets[f]);
    const frameOffset = f * frameSize;
    const sliceOffset = frameSize * k;
    for (let p = 0; p < frameSize; p++) {
      if (!pixels[frameOffset + p]) {
        continue;
      }
      // Pixel p is row j = p / columns, column i = p % columns: the same layout as the grid slice
      const index = sliceOffset + p;
      if (data[index] && data[index] !== segmentNumber) {
        overlapVoxels++;
      }
      data[index] = segmentNumber;
      present.add(segmentNumber);
    }
  });

  const declared = segmentsFromSegmentSequence(dataset);
  const segments = Array.from(present).sort((a, b) => a - b).map(value =>
    declared.find(segment => segment.value === value) || { value, label: defaultSegmentLabel(value) });

  return {
    grid: {
      data,
      dimensions,
      origin,
      // PixelSpacing is [row spacing (between rows, along the columns), column spacing]
      spacing: [pixelSpacing[1], pixelSpacing[0], sliceSpacing],
      direction: [...rowCosines, ...columnCosines, ...normal],
    },
    segments,
    overlapVoxels,
    frameCount,
  };
}

/**
 * A resolver of referenced frames from the study's loaded images, for parseDicomSeg.
 *
 * @param {Object[]} studies - the viewer's studies (display sets with `images`)
 * @returns {Function} ({ sopInstanceUID }) => the instance's plane metadata, or undefined
 */
export function createStudyFrameResolver(studies = []) {
  let byInstance;
  const index = () => {
    if (!byInstance) {
      byInstance = new Map();
      studies.forEach(study => {
        const displaySets = study.getDisplaySets?.() || study.displaySets || [];
        displaySets.forEach(displaySet => {
          (displaySet.images || []).forEach(image => {
            const metadata = image.getData?.()?.metadata;
            if (metadata?.SOPInstanceUID) {
              byInstance.set(metadata.SOPInstanceUID, metadata);
            }
          });
        });
      });
    }
    return byInstance;
  };

  return ({ sopInstanceUID }) => {
    const metadata = index().get(sopInstanceUID);
    if (!metadata) {
      return undefined;
    }
    const { ImagePositionPatient, ImageOrientationPatient, PixelSpacing } = metadata;
    return { ImagePositionPatient, ImageOrientationPatient, PixelSpacing };
  };
}
