// The landmark sets of the documents loaded in this measurement session. A set is identified by the
// SOP Instance UID of its document together with its tracking UID: the same tracking UID in two
// documents gives two entries, and a document processed again adds none. Sets never enter the
// measurement service or the Measurements API, so they are never listed as measurements and never
// written by a save. The store is emptied when the measurement session is cleared.
//
// The store also holds the session's view of the sets, which the panel sets and the renderers read:
// which sets are hidden (every set is shown until hidden), and the current landmark, the one last
// chosen from the panel ({ key, index }, `index` in the set's landmark order). Both outlive the panel
// and are reset with the session.
//
// An entry: { key, set, document: { SOPInstanceUID, SeriesInstanceUID, StudyInstanceUID, kind,
// evidence } } (readLandmarkSets.js for the set, landmarkPlacement.js for the evidence).

import log from '../../log';
import { documentKind, subscribeSessionCleared } from '../utils/srDocument';
import readLandmarkSets from './readLandmarkSets';
import { attributionOf, cachedSeries, evidenceOf, imageOf } from './landmarkPlacement';

const EVENTS = Object.freeze({
  CHANGED: 'event::landmarkSets:changed',
  VISIBILITY_CHANGED: 'event::landmarkSets:visibilityChanged',
  SELECTION_CHANGED: 'event::landmarkSets:selectionChanged',
});

const entries = new Map();
const documents = new Set();
const listeners = new Set();
const hidden = new Set();
let current = null;

const keyOf = (SOPInstanceUID, trackingUid) => `${SOPInstanceUID}::${trackingUid}`;

function notify(type = EVENTS.CHANGED) {
  listeners.forEach((listener) => {
    try {
      listener({ type });
    } catch (error) {
      log.error('[DICOM-SR:landmarkSets] listener failed', error);
    }
  });
}

/** Listen for sets added and cleared, visibility and the current landmark; returns { unsubscribe } */
function subscribe(listener) {
  listeners.add(listener);
  return { unsubscribe: () => listeners.delete(listener) };
}

function logDiagnostics(SOPInstanceUID, diagnostics) {
  const describe = ({ code, trackingUid, detail }) => [code, trackingUid, detail].filter(Boolean).join(' ');
  const warnings = diagnostics.filter(diagnostic => diagnostic.level === 'warning').map(describe);
  const infos = diagnostics.filter(diagnostic => diagnostic.level !== 'warning').map(describe);
  if (warnings.length) {
    log.warn(`[DICOM-SR:landmarkSets] document ${SOPInstanceUID}: landmark content not read as written`, warnings);
  }
  if (infos.length) {
    log.info(`[DICOM-SR:landmarkSets] document ${SOPInstanceUID}`, infos);
  }
}

/** Image coordinates outside the image they are on, when its dimensions are loaded */
function outOfBoundsDiagnostics(set, store) {
  const found = set.domain === 'image' && set.image && imageOf(set.image, store);
  const { Rows, Columns } = (found && found.instance) || {};
  if (!Number(Rows) || !Number(Columns)) {
    return [];
  }
  return set.landmarks
    .filter(({ point: [column, row] }) => column < 0 || row < 0 || column > Number(Columns) || row > Number(Rows))
    .map(landmark => ({ level: 'warning', code: 'landmark-point-out-of-bounds', trackingUid: set.trackingUid, detail: `landmark ${landmark.ordinal}` }));
}

/**
 * Add the landmark sets of a document (a naturalized SR dataset). A document already processed in
 * this session adds nothing.
 *
 * @param {object} dataset
 * @param {object} store - the metadata store attribution and placement read (DicomMetadataStore)
 * @returns {number} the number of sets added
 */
function addLandmarkSetsOf(dataset, store) {
  const { SOPInstanceUID, SeriesInstanceUID, StudyInstanceUID } = dataset || {};
  if (!SOPInstanceUID || documents.has(SOPInstanceUID)) {
    return 0;
  }
  documents.add(SOPInstanceUID);

  // The cached metadata of an instance, which tells the reader whether an image is tiled
  const instanceOf = uid => cachedSeries(store)
    .reduce((found, series) => found || (series.instances || []).find(instance => instance && instance.SOPInstanceUID === uid), undefined);
  const { sets, diagnostics } = readLandmarkSets(dataset, { instanceOf });
  const document = { SOPInstanceUID, SeriesInstanceUID, StudyInstanceUID, kind: documentKind(dataset), evidence: evidenceOf(dataset) };
  let added = 0;
  sets.forEach((set) => {
    const key = keyOf(SOPInstanceUID, set.trackingUid);
    if (entries.has(key)) {
      diagnostics.push({ level: 'warning', code: 'landmark-set-duplicate-tracking-uid', trackingUid: set.trackingUid });
      return;
    }
    const { warning } = attributionOf(set, document, store);
    if (warning) {
      diagnostics.push({ level: 'warning', code: warning, trackingUid: set.trackingUid });
    }
    diagnostics.push(...outOfBoundsDiagnostics(set, store));
    entries.set(key, { key, set, document });
    added += 1;
  });

  logDiagnostics(SOPInstanceUID, diagnostics);
  if (added) {
    log.info(`[DICOM-SR:landmarkSets] document ${SOPInstanceUID}: ${added} landmark set(s) listed`);
    notify();
  }
  return added;
}

/** The entries, in the order their documents were processed and their sets were read */
const getLandmarkSets = () => [...entries.values()];

const getLandmarkSet = key => entries.get(key);

function clearLandmarkSets() {
  const changed = entries.size > 0 || hidden.size > 0 || current !== null;
  entries.clear();
  documents.clear();
  hidden.clear();
  current = null;
  if (changed) {
    notify();
  }
}


// Visibility

/** Whether a set is shown: every set is until it is hidden */
const isLandmarkSetVisible = key => !hidden.has(key);

/** Show or hide one set */
function setLandmarkSetVisible(key, visible) {
  if (!entries.has(key) || isLandmarkSetVisible(key) === Boolean(visible)) {
    return;
  }
  if (visible) {
    hidden.delete(key);
  } else {
    hidden.add(key);
  }
  notify(EVENTS.VISIBILITY_CHANGED);
}

/** Show or hide every listed set */
function setLandmarkSetsVisible(visible) {
  const changed = [...entries.keys()].filter(key => isLandmarkSetVisible(key) !== Boolean(visible));
  if (!changed.length) {
    return;
  }
  changed.forEach(key => (visible ? hidden.delete(key) : hidden.add(key)));
  notify(EVENTS.VISIBILITY_CHANGED);
}

/** Whether every listed set is shown */
const areLandmarkSetsVisible = () => [...entries.keys()].every(isLandmarkSetVisible);


// The current landmark

/**
 * The landmark last chosen from the panel: { key, index, entry, landmark }, or null. A set that is no
 * longer listed has none.
 */
function getCurrentLandmark() {
  const entry = current && entries.get(current.key);
  const landmark = entry && entry.set.landmarks[current.index];
  return landmark ? { key: current.key, index: current.index, entry, landmark } : null;
}

/**
 * Make a set's landmark the current one; returns it as getCurrentLandmark does, or null. Every
 * choice is reported, a repeat of the current one included, so a renderer can act on each request.
 */
function selectLandmark(key, index) {
  const entry = entries.get(key);
  if (!entry || !Number.isInteger(index) || index < 0 || index >= entry.set.landmarks.length) {
    return null;
  }
  current = { key, index };
  notify(EVENTS.SELECTION_CHANGED);
  return getCurrentLandmark();
}

/** Clear the current landmark: no set holds it until one is chosen or stepped again */
function clearCurrentLandmark() {
  if (current) {
    current = null;
    notify(EVENTS.SELECTION_CHANGED);
  }
}

/**
 * Step through a set: its first landmark when another set's (or none) is current, else the next one,
 * the first again after the last. Returns the new current landmark, or null for a set not listed.
 */
function stepLandmarkSet(key) {
  const entry = entries.get(key);
  if (!entry || !entry.set.landmarks.length) {
    return null;
  }
  const index = current && current.key === key ? (current.index + 1) % entry.set.landmarks.length : 0;
  current = { key, index };
  notify(EVENTS.SELECTION_CHANGED);
  return getCurrentLandmark();
}

subscribeSessionCleared(clearLandmarkSets);


export {
  addLandmarkSetsOf, areLandmarkSetsVisible, clearCurrentLandmark, clearLandmarkSets, EVENTS, getCurrentLandmark, getLandmarkSet, getLandmarkSets,
  isLandmarkSetVisible, keyOf, selectLandmark, setLandmarkSetsVisible, setLandmarkSetVisible, stepLandmarkSet, subscribe,
};
