// Read and format a single DICOM attribute from a naturalized (dcmjs) instance dataset.
//
// Standard attributes are keyed by dictionary keyword; private and unknown attributes keep their
// eight-character hex key. The VR comes from the dictionary, then from the dataset's `_vrMap`.

import dcmjs from 'dcmjs';

import { normalizeTagCode, punctuateTagCode } from '@ohif/core/src/utils/overlayFields';

import { formatDICOMDate, formatDICOMTime, formatPN } from '../formatStudy';

const { DicomMetaDictionary } = dcmjs.data;

const NUMERIC_VRS = new Set(['DS', 'FD', 'FL', 'IS', 'US', 'SS', 'UL', 'SL', 'UV', 'SV', 'OD', 'OF']);
const BINARY_VRS = new Set(['OB', 'OW', 'OL', 'OV', 'UN', 'SQ']);

/**
 * @param {string} code any form accepted by normalizeTagCode
 * @returns {{ keyword: string|null, vr: string|null }}
 */
export function tagDefinition(code) {
  const punctuated = punctuateTagCode(code);
  const entry = punctuated ? DicomMetaDictionary.dictionary[punctuated] : null;

  return { keyword: entry ? entry.name : null, vr: entry ? entry.vr : null };
}

/**
 * @param {object} instance naturalized dataset
 * @param {string} code any form accepted by normalizeTagCode
 * @returns {{ value: *, vr: string|null }|null} null when the attribute is absent or empty
 */
export function readTagValue(instance, code) {
  const hex = normalizeTagCode(code);
  if (!instance || !hex) {
    return null;
  }

  const { keyword, vr } = tagDefinition(hex);
  const key = keyword && instance[keyword] !== undefined ? keyword : hex;
  const value = instance[key];

  if (value === undefined || value === null || value === '') {
    return null;
  }

  const vrMap = instance._vrMap || {};
  return { value, vr: vr || vrMap[key] || null };
}

function trimNumber(number, precision = 2) {
  const parsed = typeof number === 'number' ? number : parseFloat(number);
  if (!Number.isFinite(parsed)) {
    return '';
  }

  return parsed.toFixed(precision).replace(/\.?0+$/, '');
}

function formatDate(value) {
  const text = String(value);
  const formatted = formatDICOMDate(text.slice(0, 8));
  return formatted === 'Invalid date' ? text : formatted;
}

function formatTime(value) {
  const text = String(value);
  const formatted = formatDICOMTime(text);
  return formatted === 'Invalid date' ? text : formatted;
}

function formatDateTime(value) {
  const text = String(value);
  const date = formatDate(text.slice(0, 8));
  const time = text.length > 8 ? formatTime(text.slice(8, 14)) : '';
  return time ? `${date} ${time}` : date;
}

function formatScalar(value, vr) {
  if (value === undefined || value === null || value === '') {
    return '';
  }

  if (typeof value === 'object') {
    if (value.Alphabetic !== undefined) {
      return formatPN(value.Alphabetic) || '';
    }

    return '';
  }

  if (vr === 'DA') {
    return formatDate(value);
  }

  if (vr === 'TM') {
    return formatTime(value);
  }

  if (vr === 'DT') {
    return formatDateTime(value);
  }

  if (vr === 'PN') {
    return formatPN(String(value)) || '';
  }

  if (NUMERIC_VRS.has(vr) || typeof value === 'number') {
    return trimNumber(value);
  }

  return String(value).trim();
}

/**
 * @param {*} value naturalized attribute value
 * @param {string|null} vr
 * @returns {string} display text; empty when the value cannot be shown as text
 */
export function formatTagValue(value, vr) {
  if (vr && BINARY_VRS.has(vr)) {
    return '';
  }

  if (Array.isArray(value)) {
    if (value.some(entry => entry && typeof entry === 'object' && entry.Alphabetic === undefined)) {
      return '';
    }

    return value
      .map(entry => formatScalar(entry, vr))
      .filter(text => text !== '')
      .join('\\');
  }

  return formatScalar(value, vr);
}

/**
 * Resolve the first present attribute of a fallback chain to display text.
 *
 * @param {object} instance naturalized dataset
 * @param {string[]} codes ordered chain
 * @returns {string} empty when no attribute in the chain renders
 */
export function resolveTagText(instance, codes) {
  for (const code of codes || []) {
    const read = readTagValue(instance, code);
    if (!read) {
      continue;
    }

    const text = formatTagValue(read.value, read.vr);
    if (text !== '') {
      return text;
    }
  }

  return '';
}

export { trimNumber };
