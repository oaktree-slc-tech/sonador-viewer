// The outcome of a DICOM-SR save as the user sees it: a full save, a partial one naming each
// measurement left out and what to do about it, or no save when every measurement was left out (no
// report is uploaded then). Technical details stay in the log. Once the report is stored, the
// measurements it holds, as they were written, are locked as saved measurements.

import { asArray, conceptNameValue } from './codedConcept';

const TOOL_LABELS = { Angle: 'Angle', CobbAngle: 'Cobb angle' };

const ACTIONS = {
  incomplete: 'complete it, or delete it and draw it again',
  degenerate: 'move its endpoints apart so that each line has a length',
  uncalibrated: 'its image calibration is missing or invalid, so the angle cannot be measured in degrees; draw it on a calibrated image',
};
const DEFAULT_ACTION = 'check it and save again';


/** A measurement the writer left out: the tool, its label, and the refusal code of the error */
function omittedMeasurement(toolType, tool, error) {
  return {
    toolType,
    label: (tool && (tool.label || tool.description || (tool.metadata && tool.metadata.description))) || '',
    reason: (error && error.code) || 'invalid',
  };
}


/**
 * Title, message and notification type of a save.
 *
 * @param {object|Array<object>} outcome - { omitted, saved } of the save: the omittedMeasurement()
 *   entries and the number of measurements written (an array is the omitted list of a save that
 *   wrote at least one)
 * @param {string} [destination] - name of the server the report was stored on
 */
function saveResultSummary(outcome, destination) {
  const { omitted = [], saved } = Array.isArray(outcome) ? { omitted: outcome } : (outcome || {});
  const stored = destination ? `Data persisted to ${destination}.` : 'Data persisted.';
  if (!omitted.length) {
    return { title: 'Measurements saved successfully', message: stored, type: 'success', omitted: [], saved };
  }

  const lines = omitted.map(({ toolType, label, reason }) => {
    const name = TOOL_LABELS[toolType] || toolType;
    return `${label ? `${name} "${label}"` : name}: ${ACTIONS[reason] || DEFAULT_ACTION}.`;
  });
  if (saved === 0) {
    const none = omitted.length === 1 ? 'The measurement was not saved.' : `None of the ${omitted.length} measurements was saved.`;
    return {
      title: 'Measurements not saved',
      message: `${none} Nothing was stored. ${lines.join(' ')}`,
      type: 'error',
      omitted,
      saved: 0,
    };
  }

  const count = omitted.length === 1 ? 'One measurement was' : `${omitted.length} measurements were`;
  return {
    title: 'Measurements partly saved',
    message: `${stored} ${count} not saved. ${lines.join(' ')}`,
    type: 'warning',
    omitted,
    saved,
  };
}



const TRACKING_UNIQUE_IDENTIFIER = '112040';

// What a record holds besides its persisted state: lifecycle and interaction flags, values derived
// from its geometry, and service references
const NOT_PERSISTED = new Set([
  'source', 'modifiedTimestamp', 'displayText', 'getReport', 'cachedStats',
  'isDirty', 'isLocked', 'isReadOnly', 'isSelected', 'isVisible', 'visible',
  'active', 'highlight', 'invalidated', 'activeHandleIndex', 'hasMoved',
]);

const trackingUIDOf = measurement => measurement && ((measurement.metadata && measurement.metadata.TrackingUniqueIdentifier)
  || (measurement.data && measurement.data.TrackingUniqueIdentifier) || measurement.TrackingUniqueIdentifier);

function writtenTrackingUID(srItem, depth = 0) {
  // The Tracking Unique Identifier of an encoded measurement group
  if (!srItem || depth > 3) {
    return undefined;
  }
  const items = Array.isArray(srItem) ? srItem : [srItem];
  for (const item of items) {
    if (item && item.ValueType === 'UIDREF' && conceptNameValue(item) === TRACKING_UNIQUE_IDENTIFIER) {
      return item.UID;
    }
    const nested = item && writtenTrackingUID(asArray(item.ContentSequence), depth + 1);
    if (nested) {
      return nested;
    }
  }
  return undefined;
}

function persistedState(value, seen = new Set()) {
  // A record's persisted state as canonical JSON: keys sorted, functions and the keys above left out
  if (Array.isArray(value)) {
    return `[${value.map(item => persistedState(item, seen)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    if (seen.has(value)) {
      return '"[cycle]"';
    }
    seen.add(value);
    const entries = Object.keys(value).sort()
      .filter(key => !NOT_PERSISTED.has(key) && typeof value[key] !== 'function' && value[key] !== undefined)
      .map(key => `${JSON.stringify(key)}:${persistedState(value[key], seen)}`);
    seen.delete(value);
    return `{${entries.join(',')}}`;
  }
  return typeof value === 'function' || value === undefined ? 'null' : JSON.stringify(value);
}


/**
 * A measurement as the report writes it, taken when the report is encoded: its service uid, the
 * tracking UID the report holds, the measurement session, and its persisted state (geometry, image
 * and frame references, label and properties, display colours, value). It identifies the version a
 * successful upload stores.
 *
 * @param {object} measurement - the service record
 * @param {object} [srItem] - its encoded measurement group
 * @param {*} [session] - the measurement session the report was encoded in
 */
function measurementVersion(measurement, srItem, session) {
  return {
    uid: measurement.uid,
    TrackingUniqueIdentifier: writtenTrackingUID(srItem) || trackingUIDOf(measurement),
    session,
    state: persistedState(measurement),
  };
}

/** Whether a service record is still the version a report wrote */
const sameVersion = (version, measurement) => Boolean(measurement) && measurement.uid === version.uid
  && persistedState(measurement) === version.state;


/**
 * Lock the measurements a stored report holds, as they were written: they are listed with the saved
 * measurements, are no longer pending, and are not written again, as a measurement read from a
 * report is. Each is updated through the service so its representations (the measurements list,
 * the viewports) follow. Nothing is locked when the session the report was encoded in has ended;
 * a measurement no longer in the session, or changed in any persisted attribute since the report
 * was encoded, is left as it is: a later edit stays pending and is saved next time.
 *
 * @param {object} measurementService
 * @param {object[]} versions - the measurements written (`measurementVersion`)
 * @param {object} [options]
 * @param {*} [options.session] - the current measurement session
 * @returns {number} the measurements locked
 */
function lockSavedMeasurements(measurementService, versions, options = {}) {
  if (!measurementService) {
    return 0;
  }
  let locked = 0;
  (versions || []).forEach(version => {
    if ('session' in options && version.session !== options.session) {
      return;
    }
    const measurement = version.uid && measurementService.getMeasurement(version.uid);
    if (!sameVersion(version, measurement)) {
      return;
    }
    measurementService.update(measurement.uid, {
      ...measurement,
      isLocked: true,
      isDirty: false,
      metadata: { ...(measurement.metadata || {}), isReadOnly: true, isLocked: true, isDirty: false },
    }, true);
    locked += 1;
  });
  return locked;
}


export { lockSavedMeasurements, measurementVersion, omittedMeasurement, sameVersion, saveResultSummary };
