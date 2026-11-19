// Timepoints: the series-level bucket a Sonador-SR document belongs to, read from the item of
// Referenced Performed Procedure Step Sequence whose Referenced SOP Class UID is the timepoint class
// UID (constants/timepoint.js). The encoding and the rules for reading, comparing and ordering
// timepoints are the Sonador timepoint contract, shared with the Sonador IO client; the Viewer
// consumes timepoints and never writes one.
//
// The encoding departs from the standard in five documented ways:
//
// 1. The standard defines the sequence as a reference to the Performed Procedure Step during which
//    the series was created. A timepoint item references no stored object.
// 2. The item's Referenced SOP Class UID is a Sonador constant, not the Modality Performed Procedure
//    Step SOP Class.
// 3. The item carries four attributes the SOP Instance Reference macro does not define: Performed
//    Procedure Step ID, Start Date, Start Time and Description.
// 4. On a series that already holds an item, the timepoint item is a second item where the standard
//    permits one.
// 5. On an SR document the four series-level attributes are additional Type 3 attributes, and their
//    meaning is the timepoint's, not a procedure step's.
//
// The item is the record: the series-level copies of the four attributes are never read as a
// timepoint. A reader never fails on a malformed item; every condition is a logged warning.

import log from '../../log';
import { TIMEPOINT_CLASS_UID } from '../constants/timepoint';

const asArray = value => (value === undefined || value === null ? [] : (Array.isArray(value) ? value : [value]));

const DATE_PATTERN = /^\d{8}$/;
// DICOM TM: HH, HHMM, HHMMSS, or HHMMSS followed by a fraction of up to six digits, each component in
// its range (the second may be 60)
const TIME_PATTERN = /^(\d{2})(?:(\d{2})(?:(\d{2})(\.\d{1,6})?)?)?$/;
const TIME_KEY_LENGTH = 12;

const DIAGNOSTICS = Object.freeze({
  MULTIPLE_ITEMS: 'timepoint-multiple-items',
  MISSING_UID: 'timepoint-missing-uid',
  INVALID_DATE: 'timepoint-invalid-date',
  SERIES_CONFLICT: 'timepoint-series-conflict',
  ATTRIBUTE_MISMATCH: 'timepoint-attribute-mismatch',
});

/** A naturalized value as trimmed text; undefined when absent or empty (the UID) */
function textOf(value) {
  const single = Array.isArray(value) ? value[0] : value;
  if (single === undefined || single === null) {
    return undefined;
  }
  const text = String(single).trim();
  return text.length ? text : undefined;
}

/**
 * An optional attribute as the document holds it: null when the item does not hold the attribute,
 * the empty string when it holds it without a value, else its text as naturalized (not trimmed).
 * Presence is part of the value.
 */
function optionalTextOf(item, keyword) {
  if (!item || !Object.prototype.hasOwnProperty.call(item, keyword)) {
    return null;
  }
  const value = item[keyword];
  const single = Array.isArray(value) ? value[0] : value;
  return single === undefined || single === null ? '' : String(single);
}

const isValidDate = text => typeof text === 'string' && DATE_PATTERN.test(text);

const isValidTime = (text) => {
  const match = typeof text === 'string' ? TIME_PATTERN.exec(text) : null;
  if (!match) {
    return false;
  }
  const [, hours, minutes, seconds] = match;
  return Number(hours) <= 23 && Number(minutes || 0) <= 59 && Number(seconds || 0) <= 60;
};

// An attribute held without a value is neither valid nor invalid: it counts as absent
const optionalValid = (text, isValid) => text === null || text === '' || isValid(text);

/**
 * The timepoint of a naturalized dataset, or null.
 *
 * @param {object} dataset
 * @returns {{ uid: string, id: string|null, date: string|null, time: string|null, description: string|null,
 *   dateValid: boolean, timeValid: boolean }|null}
 */
function timepointOf(dataset) {
  try {
    const items = asArray(dataset && dataset.ReferencedPerformedProcedureStepSequence)
      .filter(item => item && textOf(item.ReferencedSOPClassUID) === TIMEPOINT_CLASS_UID);
    if (!items.length) {
      return null;
    }
    const SOPInstanceUID = dataset && dataset.SOPInstanceUID;
    if (items.length > 1) {
      log.warn(`[DICOM-SR:timepoint] ${DIAGNOSTICS.MULTIPLE_ITEMS}: ${items.length} timepoint items, the first is used`, SOPInstanceUID);
    }
    const [item] = items;
    const uid = textOf(item.ReferencedSOPInstanceUID);
    if (!uid) {
      log.warn(`[DICOM-SR:timepoint] ${DIAGNOSTICS.MISSING_UID}: the timepoint item has no Referenced SOP Instance UID`, SOPInstanceUID);
      return null;
    }
    const date = optionalTextOf(item, 'PerformedProcedureStepStartDate');
    const time = optionalTextOf(item, 'PerformedProcedureStepStartTime');
    const dateValid = optionalValid(date, isValidDate);
    const timeValid = optionalValid(time, isValidTime);
    if (!dateValid || !timeValid) {
      log.warn(`[DICOM-SR:timepoint] ${DIAGNOSTICS.INVALID_DATE}: date=${date} time=${time}`, SOPInstanceUID);
    }
    return {
      uid,
      id: optionalTextOf(item, 'PerformedProcedureStepID'),
      date,
      time,
      description: optionalTextOf(item, 'PerformedProcedureStepDescription'),
      dateValid,
      timeValid,
    };
  } catch (error) {
    log.warn('[DICOM-SR:timepoint] timepoint not read', error);
    return null;
  }
}

/** The date of a timepoint when it is valid, else null (an undated timepoint) */
function datedValue(timepoint) {
  const { date } = timepoint || {};
  return date && timepoint.dateValid !== false && isValidDate(date) ? date : null;
}

/** The time of a timepoint as twelve digits (HHMMSSFFFFFF); all zeros when absent or invalid */
function timeKeyOf(timepoint) {
  const { time } = timepoint || {};
  if (!time || timepoint.timeValid === false || !isValidTime(time)) {
    return '0'.repeat(TIME_KEY_LENGTH);
  }
  return time.replace('.', '').padEnd(TIME_KEY_LENGTH, '0');
}

const compareText = (a, b) => (a === b ? 0 : (a > b ? 1 : -1));

/**
 * The order of two timepoints: dated before undated; date; time; description (code units); UID.
 * Date and time are local to the timepoint.
 */
function compareTimepoints(a, b) {
  const dateA = datedValue(a);
  const dateB = datedValue(b);
  if (Boolean(dateA) !== Boolean(dateB)) {
    return dateA ? -1 : 1;
  }
  return compareText(dateA || '', dateB || '')
    || compareText(timeKeyOf(a), timeKeyOf(b))
    || compareText((a && a.description) || '', (b && b.description) || '')
    || compareText(String((a && a.uid) || ''), String((b && b.uid) || ''));
}

/**
 * Whether two timepoints hold the same identifier, date, time and description, presence included: an
 * attribute absent (null) differs from one held without a value ('')
 */
function timepointValuesEqual(a, b) {
  const valueOf = (timepoint, field) => (timepoint && timepoint[field] !== undefined ? timepoint[field] : null);
  return ['id', 'date', 'time', 'description'].every(field => valueOf(a, field) === valueOf(b, field));
}

/** The Viewer's id of a defined timepoint: its study and its UID together */
const timepointIdFor = (StudyInstanceUID, uid) => `timepoint:${StudyInstanceUID || ''}:${uid}`;

/** Whether a timepoint descriptor is a defined (encoded) timepoint, not the session default */
const isDefinedTimepoint = timepoint => Boolean(timepoint && timepoint.timepointType === 'defined');

export {
  DIAGNOSTICS, compareTimepoints, datedValue, isDefinedTimepoint, isValidDate, isValidTime, optionalTextOf, timeKeyOf, timepointIdFor,
  timepointOf, timepointValuesEqual,
};
