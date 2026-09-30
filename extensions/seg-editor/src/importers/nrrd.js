// An NRRD label volume as a labelled grid for import (labelmapGrid). Read with three.js's NRRD
// loader (header, encodings including gzip, typed voxels), placed from the header's space
// directions and origin, and turned into patient LPS coordinates from the header's space.
//
// 3D Slicer's segmentation NRRDs (.seg.nrrd) are read as Slicer writes them: a fourth, leading
// axis holds one binary layer per group of non-overlapping segments, and `Segment<n>_...` header
// fields name each segment and give its layer, label value and colour. A plain 3D label volume
// gets one segment per distinct value, named from those fields when present and `segment-<value>`
// otherwise.

import { NRRDLoader } from 'three/examples/jsm/loaders/NRRDLoader.js';

import { defaultSegmentLabel } from './dicomSeg.js';
import { uniqueGridValues } from './labelmapGrid.js';


// Sign flips that take a header space's axes to LPS
const SPACE_TO_LPS = {
  'left-posterior-superior': [1, 1, 1],
  lps: [1, 1, 1],
  'right-anterior-superior': [-1, -1, 1],
  ras: [-1, -1, 1],
  'left-anterior-superior': [1, -1, 1],
  las: [1, -1, 1],
};

function _spaceFlip(space) {
  const key = String(space || '').trim().toLowerCase();
  return SPACE_TO_LPS[key] || [1, 1, 1];
}

const _norm = v => Math.hypot(v[0], v[1], v[2]);

/** Slicer's `Segment<n>_<field>` header fields, by segment number */
export function slicerSegmentFields(header) {
  const segments = new Map();
  Object.keys(header || {}).forEach(key => {
    const match = /^Segment(\d+)_(\w+)$/.exec(key);
    if (!match) {
      return;
    }
    const n = Number(match[1]);
    if (!segments.has(n)) {
      segments.set(n, {});
    }
    // The loader keeps `key:=value` fields as '=value'
    segments.get(n)[match[2]] = String(header[key]).replace(/^=/, '').trim();
  });
  return segments;
}

function _slicerColor(text) {
  const parts = String(text || '').trim().split(/\s+/).map(Number);
  return parts.length === 3 && parts.every(Number.isFinite)
    ? parts.map(x => Math.round(x * 255))
    : undefined;
}

/**
 * Read an NRRD into a labelled grid.
 *
 * @param {ArrayBuffer} arrayBuffer
 * @param {Object} [deps]
 * @returns {{ grid: Object, segments: Array<{ value, label, color? }>, overlapVoxels: number }}
 */
export function parseNrrd(arrayBuffer, deps = {}) {
  const { parse = buffer => new NRRDLoader().parse(buffer) } = deps;

  const volume = parse(arrayBuffer);
  const header = volume.header || {};
  const sizes = (header.sizes || []).map(Number);
  const dimension = Number(header.dimension) || sizes.length;
  if (dimension !== 3 && dimension !== 4) {
    throw new Error(`${dimension}-dimensional NRRD volumes are not supported`);
  }
  // A 4D volume's leading axis is the layer axis (Slicer's segmentation layout)
  const layerCount = dimension === 4 ? sizes[0] : 1;
  const dimensions = dimension === 4 ? sizes.slice(1) : sizes.slice(0, 3);
  const voxelCount = dimensions[0] * dimensions[1] * dimensions[2];
  if (!voxelCount || volume.data.length < voxelCount * layerCount) {
    throw new Error('The NRRD volume has no voxels');
  }

  // Space directions carry the spacing; the last three are the spatial axes (a 4D file's first
  // direction is 'none', which the loader leaves out)
  const vectors = (header.vectors || []).slice(-3);
  if (vectors.length !== 3) {
    throw new Error('The NRRD header has no space directions');
  }
  const flip = _spaceFlip(header.space);
  const spacing = vectors.map(_norm);
  if (spacing.some(s => !(s > 0))) {
    throw new Error('The NRRD header has a zero-length space direction');
  }
  // (`|| 0` keeps negative zeros out of the flipped axes)
  const direction = vectors.flatMap((v, a) => v.map((value, d) => ((value / spacing[a]) * flip[d]) || 0));
  const origin = (header.space_origin || [0, 0, 0]).map((value, d) => (Number(value) * flip[d]) || 0);

  const slicer = slicerSegmentFields(header);
  let data;
  let segments;
  let overlapVoxels = 0;

  if (layerCount > 1 || slicer.size) {
    // Slicer segments: each named segment is a label value on one layer; flattened to one value
    // per segment (its number + 1) on a single grid
    data = new Uint16Array(voxelCount);
    segments = Array.from(slicer.keys()).sort((a, b) => a - b).map((n, position) => {
      const fields = slicer.get(n);
      const layer = Number(fields.Layer) || 0;
      const labelValue = Number(fields.LabelValue);
      const value = position + 1;
      if (Number.isFinite(labelValue) && layer < layerCount) {
        for (let i = 0; i < voxelCount; i++) {
          if (volume.data[layer + layerCount * i] === labelValue) {
            if (data[i] && data[i] !== value) {
              overlapVoxels++;
            }
            data[i] = value;
          }
        }
      }
      const color = _slicerColor(fields.Color);
      return { value, label: fields.Name || fields.ID || defaultSegmentLabel(n + 1), ...(color ? { color } : {}) };
    });
    if (!segments.length) {
      throw new Error('The NRRD segmentation names no segments');
    }
  } else {
    data = volume.data;
    segments = uniqueGridValues(data).map(value => ({ value, label: defaultSegmentLabel(value) }));
  }

  return {
    grid: { data, dimensions, origin, spacing, direction },
    segments,
    overlapVoxels,
  };
}
