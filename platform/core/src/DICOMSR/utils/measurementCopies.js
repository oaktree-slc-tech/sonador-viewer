// One copy of a measurement per tracking UID, whichever documents hold it and in whatever order they
// load. A copy is held as a classic representation (a hydrated measurement on an image, or the
// read-only display's on an image), a measurement-service record (a hydrated measurement, held
// off-plane or not), and a Cornerstone3D read-only display annotation (the read-only display's).
//
// An exchange document's copy takes precedence over an application document's; of two exchange
// copies the first stays; of application copies, the one of the current document of every
// application document the tracking UID has been read from (srDocument.js currentDocument). Each
// application copy keeps the means to import it, so that the current one is shown however late the
// document that decides it arrives. A copy is replaced only once its successor has been imported:
// a failed import leaves the copy shown, with its protection from saves, and an application copy that
// fails gives way to the next of its tracking UID. A copy without a tracking UID is imported only from
// an exchange document.

import log from '../../log';
import { hasSRDisplayAnnotation, removeSRDisplayAnnotation } from '../readOnly/srDisplayAnnotations';
import {
  applicationMeasurementSource, currentDocument, isApplicationMeasurement, markApplicationMeasurement, subscribeSessionCleared,
  unmarkApplicationMeasurement,
} from './srDocument';

// Tracking UID -> SOP Instance UID -> { order, importer, overlay } of each application copy read
const applicationCopies = new Map();
subscribeSessionCleared(() => applicationCopies.clear());

const trackingUidOf = entry => entry && (entry.TrackingUniqueIdentifier
  || (entry.metadata && entry.metadata.TrackingUniqueIdentifier)
  || (entry.data && entry.data.TrackingUniqueIdentifier));

/**
 * Where a tracking UID's copy is held: { representations: [{ toolType, _id }], records: [uid], overlay }
 *
 * @param {object} context - { measurementApi, measurementService }
 */
function copiesOf(trackingUid, { measurementApi, measurementService }) {
  const representations = [];
  Object.entries((measurementApi && measurementApi.tools) || {}).forEach(([toolType, collection]) => {
    (collection || []).forEach((entry) => {
      if (trackingUidOf(entry) === trackingUid) {
        representations.push({ toolType, _id: entry._id });
      }
    });
  });
  const serviceRecords = measurementService && typeof measurementService.getMeasurements === 'function'
    ? measurementService.getMeasurements() : [];
  const records = serviceRecords.filter(record => trackingUidOf(record) === trackingUid).map(record => record.uid);
  // Whatever else the Measurements API finds by the tracking UID
  const found = measurementApi && typeof measurementApi.getMeasurementByTrackingUid === 'function'
    && measurementApi.getMeasurementByTrackingUid(trackingUid);
  if (found && !representations.some(entry => entry._id && entry._id === found._id) && !(found.uid && records.includes(found.uid))) {
    if (found.uid) {
      records.push(found.uid);
    } else {
      representations.push({ toolType: found.toolType, _id: found._id });
    }
  }
  let overlay = false;
  try {
    overlay = hasSRDisplayAnnotation(trackingUid);
  } catch (error) {
    overlay = false;
  }
  return { representations, records, overlay };
}

const isHeld = copies => copies.representations.length > 0 || copies.records.length > 0 || copies.overlay;

/**
 * Remove the copies of a snapshot: classic representations with their tool state and service record,
 * the remaining service records, and (unless the incoming copy replaced it in place) the read-only
 * display annotation.
 */
function retireCopies(trackingUid, copies, { measurementApi, measurementService }, { keepOverlay = false } = {}) {
  // Each part is retired whatever another's removal does: a part already gone counts as removed
  const attempt = (part, remove) => {
    try {
      remove();
    } catch (error) {
      log.warn('[DICOM-SR:measurementCopies] '+part+' of a replaced copy not removed', trackingUid, error);
    }
  };
  copies.representations.forEach(({ toolType, _id }) => attempt('classic representation', () => {
    if (measurementApi && typeof measurementApi.deleteMeasurements === 'function') {
      const measurementTypeId = measurementApi.toolsGroupsMap && measurementApi.toolsGroupsMap[toolType];
      measurementApi.deleteMeasurements(toolType, measurementTypeId, { toolId: toolType }, { _ids: [_id] });
    }
  }));
  copies.records.forEach(uid => attempt('measurement record', () => {
    if (measurementService && typeof measurementService.getMeasurement === 'function' && measurementService.getMeasurement(uid)) {
      measurementService.remove(uid);
    }
  }));
  if (copies.overlay && !keepOverlay) {
    attempt('read-only display annotation', () => removeSRDisplayAnnotation(trackingUid));
  }
  if (measurementApi && typeof measurementApi.syncMeasurementsAndToolData === 'function') {
    attempt('tool data', () => measurementApi.syncMeasurementsAndToolData());
  }
}

function rememberApplicationCopy(trackingUid, order, importer, overlay) {
  // Read again, a copy that failed to import is a candidate again
  const copies = applicationCopies.get(trackingUid) || new Map();
  copies.set(order.SOPInstanceUID, { order, importer, overlay, failed: false });
  applicationCopies.set(trackingUid, copies);
}

/**
 * Import a copy, then retire what was held before it; record its provenance. False, with nothing
 * changed, when the import fails; an error thrown by the import reaches the caller, nothing changed.
 */
function commit(trackingUid, importer, source, context, { overlay = false } = {}) {
  const before = copiesOf(trackingUid, context);
  // A failed import (false, or an error, which the caller handles) leaves the held copies as they are
  if (!importer()) {
    return false;
  }
  if (isHeld(before)) {
    log.info('[DICOM-SR:measurementCopies] copy replaced by one of higher precedence', trackingUid);
    retireCopies(trackingUid, before, context, { keepOverlay: overlay });
  }
  if (source) {
    markApplicationMeasurement(trackingUid, source);
  } else {
    unmarkApplicationMeasurement(trackingUid);
  }
  return true;
}

/**
 * Show a measurement's copy read from a document, subject to precedence.
 *
 * @param {string} trackingUid
 * @param {object} incoming
 * @param {object} [incoming.application] - { order } of its application document; none for an
 *   exchange document
 * @param {Function} incoming.importer - imports the copy; true when it is shown. Kept for an
 *   application copy, and called again should its document become the current one later.
 * @param {boolean} [incoming.overlay] - the copy is the read-only display's, which replaces an earlier
 *   display annotation of its tracking UID itself
 * @param {object} context - { measurementApi, measurementService }
 * @returns {boolean} whether the incoming copy is the one shown
 */
function showCopy(trackingUid, { application, importer, overlay = false }, context) {
  if (!trackingUid) {
    // No tracking UID to hold it by: an exchange copy is imported as it always was; an application
    // copy is not shown, since its copies in other documents could not be matched to it
    return application ? false : !!importer();
  }
  const held = isHeld(copiesOf(trackingUid, context));
  // A copy of an exchange document is held: it stays
  const exchangeHeld = held && !isApplicationMeasurement(trackingUid);
  if (!application) {
    return exchangeHeld ? false : commit(trackingUid, importer, null, context, { overlay });
  }

  const { order } = application;
  rememberApplicationCopy(trackingUid, order, importer, overlay);
  if (exchangeHeld) {
    return false;
  }

  // The current document's copy, which a document read later may have decided. A candidate that
  // fails to import is set aside (until its document is read again) and the next is tried; the held
  // copy stays until one is imported.
  const remembered = applicationCopies.get(trackingUid);
  const heldSource = held ? applicationMeasurementSource(trackingUid) : undefined;
  let incomingError;
  for (;;) {
    const candidates = [...remembered.values()].filter(copy => !copy.failed);
    if (!candidates.length) {
      break;
    }
    const current = currentDocument(candidates.map(copy => copy.order));
    if (heldSource && heldSource.order && heldSource.order.SOPInstanceUID === current.SOPInstanceUID) {
      break;
    }
    const chosen = remembered.get(current.SOPInstanceUID);
    let shown = false;
    try {
      shown = commit(trackingUid, chosen.importer, { order: current }, context, { overlay: chosen.overlay });
    } catch (error) {
      if (current.SOPInstanceUID === order.SOPInstanceUID) {
        incomingError = error;
      } else {
        log.warn('[DICOM-SR:measurementCopies] copy of an application document not imported', trackingUid, error);
      }
    }
    if (shown) {
      if (incomingError) {
        throw incomingError;
      }
      return current.SOPInstanceUID === order.SOPInstanceUID;
    }
    chosen.failed = true;
  }
  // An error of the incoming copy's own import reaches the caller, which reports it
  if (incomingError) {
    throw incomingError;
  }
  return false;
}

export { copiesOf, isApplicationMeasurement, retireCopies, showCopy };
