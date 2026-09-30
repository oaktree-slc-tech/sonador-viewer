// A NIfTI label volume as a labelled grid for import (labelmapGrid). Read with nifti-reader-js
// (NIfTI-1 and -2, gzipped or not), placed from the header's affine (the sform, else the qform,
// else the pixel dimensions) and turned from NIfTI's RAS into patient LPS coordinates. The reader
// hands the image back as bytes: they are decoded in the file's byte order, and the affine is
// brought to millimetres from the header's spatial unit (metres, millimetres or microns). NIfTI
// carries no segment names, so each distinct value becomes a segment named `segment-<value>`.

import * as nifti from 'nifti-reader-js';

import { defaultSegmentLabel } from './dicomSeg.js';
import { uniqueGridValues } from './labelmapGrid.js';


// NIfTI datatype codes -> typed arrays
const DATA_TYPES = {
  2: Uint8Array,
  4: Int16Array,
  8: Int32Array,
  16: Float32Array,
  64: Float64Array,
  256: Int8Array,
  512: Uint16Array,
  768: Uint32Array,
};

const _norm = v => Math.hypot(v[0], v[1], v[2]);

// xyzt_units: the low three bits are the spatial unit
const SPATIAL_UNITS_MASK = 0x07;
const UNITS_TO_MM = { 0: 1, 1: 1000, 2: 1, 3: 0.001 };   // unknown, metre, millimetre, micron

/**
 * The image bytes as voxels of the header's datatype, in the file's byte order (a big-endian
 * file's multibyte values are swapped into the platform's order).
 */
export function decodeVoxels(image, ArrayType, { littleEndian = true, count }) {
  const bytes = ArrayType.BYTES_PER_ELEMENT;
  const voxels = new ArrayType(count);
  const platformLittleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  if (bytes === 1 || littleEndian === platformLittleEndian) {
    voxels.set(new ArrayType(image, 0, count));
    return voxels;
  }
  const view = new DataView(image);
  const getter = {
    Int16Array: 'getInt16', Uint16Array: 'getUint16', Int32Array: 'getInt32', Uint32Array: 'getUint32',
    Float32Array: 'getFloat32', Float64Array: 'getFloat64',
  }[ArrayType.name];
  for (let i = 0; i < count; i++) {
    voxels[i] = view[getter](i * bytes, littleEndian);
  }
  return voxels;
}

/** Millimetres per unit of the header's spatial unit */
export function spatialUnitToMm(header) {
  const unit = (Number(header?.xyzt_units) || 0) & SPATIAL_UNITS_MASK;
  const scale = UNITS_TO_MM[unit];
  if (scale === undefined) {
    throw new Error(`NIfTI spatial unit ${unit} is not supported`);
  }
  return scale;
}

/**
 * Read a NIfTI into a labelled grid.
 *
 * @param {ArrayBuffer} arrayBuffer
 * @param {Object} [deps]
 * @returns {{ grid: Object, segments: Array<{ value, label }> }}
 */
export function parseNifti(arrayBuffer, deps = {}) {
  const { reader = nifti } = deps;

  let data = arrayBuffer;
  if (reader.isCompressed(data)) {
    data = reader.decompress(data);
  }
  if (!reader.isNIFTI(data)) {
    throw new Error('Not a NIfTI file');
  }
  const header = reader.readHeader(data);
  const dims = header.dims.map(Number);
  const dimensions = dims.slice(1, 4);
  const voxelCount = dimensions[0] * dimensions[1] * dimensions[2];
  if (dims[0] < 3 || !voxelCount) {
    throw new Error('The NIfTI volume has no voxels');
  }

  const ArrayType = DATA_TYPES[header.datatypeCode];
  if (!ArrayType) {
    throw new Error(`NIfTI datatype ${header.datatypeCode} is not supported`);
  }
  const image = reader.readImage(header, data);
  if (image.byteLength < voxelCount * ArrayType.BYTES_PER_ELEMENT) {
    throw new Error('The NIfTI image is shorter than its dimensions');
  }
  // The first volume of a 4D file
  const voxels = decodeVoxels(image, ArrayType, { littleEndian: header.littleEndian !== false, count: voxelCount });

  // The affine maps voxel (i, j, k, 1) to RAS in the header's unit; LPS negates x and y
  const affine = header.affine;
  const toMm = spatialUnitToMm(header);
  const lps = row => (row < 2 ? -1 : 1);
  const column = c => [0, 1, 2].map(r => (affine[r][c] * lps(r) * toMm) || 0);   // no negative zeros
  const axes = [column(0), column(1), column(2)];
  const spacing = axes.map(_norm);
  if (spacing.some(s => !(s > 0))) {
    throw new Error('The NIfTI header has a degenerate affine');
  }

  return {
    grid: {
      data: voxels,
      dimensions,
      origin: column(3),
      spacing,
      direction: axes.flatMap((axis, a) => axis.map(value => (value / spacing[a]) || 0)),
    },
    segments: uniqueGridValues(voxels).map(value => ({ value, label: defaultSegmentLabel(value) })),
  };
}
