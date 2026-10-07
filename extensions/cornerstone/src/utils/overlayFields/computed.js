// Overlay values derived from several attributes of the current instance or its series.

import { readTagValue, trimNumber } from './resolveTag';

function numbers(instance, code, count) {
  const read = readTagValue(instance, code);
  if (!read) {
    return null;
  }

  const values = (Array.isArray(read.value) ? read.value : [read.value]).map(Number);
  if (values.length < count || values.some(value => !Number.isFinite(value))) {
    return null;
  }

  return values;
}

function scalar(instance, code) {
  const values = numbers(instance, code, 1);
  return values ? values[0] : null;
}

/**
 * Rows x PixelSpacing[0] by Columns x PixelSpacing[1], in mm.
 */
export function fieldOfView(instance) {
  const rows = scalar(instance, '00280010');
  const columns = scalar(instance, '00280011');
  const spacing = numbers(instance, '00280030', 2);
  if (rows === null || columns === null || !spacing) {
    return '';
  }

  const width = trimNumber(columns * spacing[1], 1);
  const height = trimNumber(rows * spacing[0], 1);
  return `${width} x ${height} mm`;
}

export function reconstructionMatrix(instance) {
  const rows = scalar(instance, '00280010');
  const columns = scalar(instance, '00280011');
  if (rows === null || columns === null) {
    return '';
  }

  return `${rows} x ${columns}`;
}

/**
 * Acquisition Matrix (0018,1310) holds frequency rows, frequency columns, phase rows, phase
 * columns; one of each pair is zero.
 */
export function acquisitionMatrix(instance) {
  const values = numbers(instance, '00181310', 4);
  if (!values) {
    return '';
  }

  const frequency = values[0] || values[1];
  const phase = values[2] || values[3];
  if (!frequency || !phase) {
    return '';
  }

  return `${frequency} x ${phase}`;
}

export function pixelSpacing(instance) {
  const spacing = numbers(instance, '00280030', 2);
  if (!spacing) {
    return '';
  }

  return `${trimNumber(spacing[0])} x ${trimNumber(spacing[1])} mm`;
}

function sliceNormal(orientation) {
  const [rx, ry, rz, cx, cy, cz] = orientation;
  return [ry * cz - rz * cy, rz * cx - rx * cz, rx * cy - ry * cx];
}

function slicePosition(instance, normal) {
  const position = numbers(instance, '00200032', 3);
  if (!position) {
    return null;
  }

  return position[0] * normal[0] + position[1] * normal[1] + position[2] * normal[2];
}

/**
 * Distance between this instance and its nearest neighbour along the slice normal.
 *
 * @param {object} instance naturalized dataset
 * @param {object[]} seriesInstances naturalized datasets of the same series
 * @returns {number|null}
 */
export function neighbourSliceDistance(instance, seriesInstances) {
  const orientation = numbers(instance, '00200037', 6);
  if (!orientation || !Array.isArray(seriesInstances)) {
    return null;
  }

  const normal = sliceNormal(orientation);
  const here = slicePosition(instance, normal);
  if (here === null) {
    return null;
  }

  let nearest = null;
  seriesInstances.forEach(other => {
    const there = slicePosition(other, normal);
    if (there === null) {
      return;
    }

    const distance = Math.abs(there - here);
    if (distance > 1e-6 && (nearest === null || distance < nearest)) {
      nearest = distance;
    }
  });

  return nearest;
}

/**
 * Spacing Between Slices (0018,0088) when present, else the neighbour distance.
 *
 * @returns {number|null}
 */
export function sliceSpacingValue(instance, seriesInstances) {
  const declared = scalar(instance, '00180088');
  if (declared !== null && declared > 0) {
    return declared;
  }

  return neighbourSliceDistance(instance, seriesInstances);
}

export function sliceSpacing(instance, seriesInstances) {
  const spacing = sliceSpacingValue(instance, seriesInstances);
  return spacing === null ? '' : `${trimNumber(spacing)} mm`;
}

export function sliceGap(instance, seriesInstances) {
  const spacing = sliceSpacingValue(instance, seriesInstances);
  const thickness = scalar(instance, '00180050');
  if (spacing === null || thickness === null) {
    return '';
  }

  return `${trimNumber(spacing - thickness)} mm`;
}
