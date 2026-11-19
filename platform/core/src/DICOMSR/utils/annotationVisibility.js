// One rule decides whether an annotation is drawn: the user has not hidden it, the search does not
// leave it out, and its timepoint is the active one. The three reasons are kept apart here, for the
// session, and this module is the only writer of the visibility the stores hold: the measurement
// service's records, the representations only the Measurements API holds (listed or not), the
// Cornerstone3D read-only display annotations, and the registered stores (the landmark sets).
//
// An annotation is keyed as the Measurements panel keys its row: the classic `_id` of a measurement
// with a representation, the service uid of one without (out-of-plane), the tracking UID of a display
// annotation no representation shares, and a registered store's own key. The rule runs whether or not
// the panel is mounted; the Measurements API calls it on each change of the reasons, of the active
// timepoint, of series membership, on hydration and on a session clear.

import log from '../../log';
import { getSRDisplayAnnotations, setSRDisplayAnnotationVisible } from '../readOnly/srDisplayAnnotations';
import { visibilityStores } from './visibilityStores';

const userHidden = new Set();
let searchHidden = new Set();
// The rule's own writes announce updates; those are not reconciled again
let applying = false;

/** The identifiers of a measurement, wherever its schema keeps them (as the Measurements API unpacks them) */
function unpack(entity) {
  if (!entity) {
    return {};
  }
  const measurementMeta = entity.metadata || entity;
  const measurementData = entity.data || entity.measurementData || entity;
  const _id = measurementMeta._id || measurementData._id || entity._id;
  const uid = entity.uid || measurementMeta.uid || measurementMeta._measurementServiceId
    || measurementData.uid || measurementData._measurementServiceId;
  return { uid, _id };
}

/** The key of a service record: its representation's _id, else its uid */
const recordKeyOf = record => unpack(record)._id || record.uid;

const timepointOf = (api, entity) => (typeof api.timepointIdOf === 'function' ? api.timepointIdOf(entity) : undefined);
const activeTimepointOf = api => (typeof api.getActiveTimepointId === 'function' ? api.getActiveTimepointId() : undefined);

/** Whether the user has hidden an annotation */
const isUserVisible = key => !userHidden.has(key);

/** The user's choice for one annotation */
function setUserVisible(key, visible) {
  if (!key) {
    return;
  }
  if (visible) {
    userHidden.delete(key);
  } else {
    userHidden.add(key);
  }
}

/** The annotations the search leaves out (while it applies to the views); an empty set clears the reason */
function setSearchHidden(keys) {
  searchHidden = new Set(keys || []);
}

const getSearchHidden = () => new Set(searchHidden);

/** Forget every reason (a session clear) */
function resetAnnotationVisibility() {
  userHidden.clear();
  searchHidden = new Set();
}

const effective = (key, timepointId, activeTimepointId) =>
  isUserVisible(key) && !searchHidden.has(key) && (!activeTimepointId || timepointId === activeTimepointId);

/** The display annotation's key: the `_id` of a representation that holds its tracking UID, else the UID */
function overlayKeyOf(trackingUid, representationKeys) {
  return representationKeys.get(trackingUid) || `overlay:${trackingUid}`;
}

function representationKeysByTrackingUid(api) {
  const keys = new Map();
  Object.values(api.tools || {}).forEach((collection) => {
    (collection || []).forEach((representation) => {
      const trackingUid = representation.TrackingUniqueIdentifier
        || (representation.metadata && representation.metadata.TrackingUniqueIdentifier);
      if (trackingUid && representation._id && !keys.has(trackingUid)) {
        keys.set(trackingUid, representation._id);
      }
    });
  });
  return keys;
}

/**
 * Every annotation the rule covers, with its key and timepoint: { key, timepointId, kind, ... }.
 * `kind` is 'record', 'representation', 'overlay' or 'store'.
 */
function annotationsOf(api) {
  const service = api.measurementService;
  const entries = [];
  const records = service && typeof service.getMeasurements === 'function' ? service.getMeasurements() : [];
  records.forEach((record) => {
    entries.push({ kind: 'record', key: recordKeyOf(record), timepointId: timepointOf(api, record), record });
  });
  Object.entries(api.tools || {}).forEach(([toolType, collection]) => {
    (collection || []).forEach((representation) => {
      const { uid, _id } = unpack(representation);
      if ((uid && service && typeof service.getMeasurement === 'function' && service.getMeasurement(uid)) || !_id) {
        return;
      }
      entries.push({ kind: 'representation', key: _id, timepointId: timepointOf(api, representation), representation, toolType });
    });
  });
  const representationKeys = representationKeysByTrackingUid(api);
  const overlays = typeof getSRDisplayAnnotations === 'function' ? getSRDisplayAnnotations() : [];
  (overlays || []).forEach((annotation) => {
    const trackingUid = annotation && annotation.data && annotation.data.TrackingUniqueIdentifier;
    if (!trackingUid) {
      return;
    }
    const srDocument = annotation.data.srDocument;
    entries.push({
      kind: 'overlay',
      key: overlayKeyOf(trackingUid, representationKeys),
      timepointId: timepointOf(api, { metadata: { srDocument } }),
      annotation,
      trackingUid,
    });
  });
  visibilityStores().forEach((store) => {
    (store.entries() || []).forEach((entry) => {
      entries.push({ kind: 'store', key: store.keyOf(entry), timepointId: timepointOf(api, entry), store, entry });
    });
  });
  return entries;
}

/**
 * Compute the visibility of every annotation and write it to its store. Returns the number of
 * annotations whose visibility changed.
 *
 * @param {object} api - the MeasurementApi instance
 */
function applyAnnotationVisibility(api) {
  if (!api || !api.measurementService || applying) {
    return 0;
  }
  applying = true;
  try {
    return writeAnnotationVisibility(api);
  } finally {
    applying = false;
  }
}

function writeAnnotationVisibility(api) {
  const activeTimepointId = activeTimepointOf(api);
  let changed = 0;
  const storeChanges = new Map();
  annotationsOf(api).forEach((entry) => {
    const visible = effective(entry.key, entry.timepointId, activeTimepointId);
    try {
      if (entry.kind === 'record') {
        if ((entry.record.isVisible !== false) !== visible) {
          api.measurementService.toggleVisibilityMeasurement(entry.record.uid, visible);
          changed += 1;
        }
      } else if (entry.kind === 'representation') {
        if ((entry.representation.visible !== false) !== visible) {
          entry.representation.visible = visible;
          const updated = typeof api.updateMeasurement === 'function' ? api.updateMeasurement(entry.toolType, entry.representation) : undefined;
          if (typeof api.syncMeasurementsAndToolData === 'function') {
            api.syncMeasurementsAndToolData(updated);
          }
          changed += 1;
        }
      } else if (entry.kind === 'overlay') {
        if ((entry.annotation.isVisible !== false) !== visible) {
          setSRDisplayAnnotationVisible(entry.trackingUid, visible);
          changed += 1;
        }
      } else if (entry.store.isVisible(entry.entry) !== visible) {
        if (!storeChanges.has(entry.store)) {
          storeChanges.set(entry.store, []);
        }
        storeChanges.get(entry.store).push({ entry: entry.entry, visible });
        changed += 1;
      }
    } catch (error) {
      log.warn('[DICOM-SR:annotationVisibility] visibility not written', entry.kind, entry.key, error);
    }
  });
  // A store's entries are written together, so that it announces the change once
  storeChanges.forEach((changes, store) => {
    try {
      if (typeof store.setVisibleMany === 'function') {
        store.setVisibleMany(changes);
      } else {
        changes.forEach(({ entry, visible }) => store.setVisible(entry, visible));
      }
    } catch (error) {
      log.warn('[DICOM-SR:annotationVisibility] visibility not written', store.id, error);
    }
  });
  return changed;
}

/**
 * Write the visibility of one service record as the rule decides it, when the record arrives or is
 * updated by any source (one with no classic representation included). True when it changed.
 */
function reconcileRecordVisibility(api, record) {
  if (!api || !api.measurementService || !record || !record.uid || applying) {
    return false;
  }
  const visible = effective(recordKeyOf(record), timepointOf(api, record), activeTimepointOf(api));
  if ((record.isVisible !== false) === visible) {
    return false;
  }
  applying = true;
  try {
    api.measurementService.toggleVisibilityMeasurement(record.uid, visible);
  } finally {
    applying = false;
  }
  return true;
}

/** The keys of the annotations of the active timepoint (those Show all and Hide all act on) */
function activeTimepointKeys(api) {
  const activeTimepointId = activeTimepointOf(api);
  return annotationsOf(api)
    .filter(entry => !activeTimepointId || entry.timepointId === activeTimepointId)
    .map(entry => entry.key);
}

export {
  activeTimepointKeys, annotationsOf, applyAnnotationVisibility, getSearchHidden, isUserVisible, reconcileRecordVisibility,
  resetAnnotationVisibility, setSearchHidden, setUserVisible,
};
