// The landmark sets of the documents loaded in this measurement session. A set is identified by the
// SOP Instance UID of its document together with its tracking UID: the same tracking UID in two
// documents gives two entries, and a document processed again adds none. Sets never enter the
// measurement service or the Measurements API, so they are never listed as measurements and never
// written by a save. The store is emptied when the measurement session is cleared.
//
// An entry: { key, set, document: { SOPInstanceUID, SeriesInstanceUID, StudyInstanceUID, kind,
// evidence } } (readLandmarkSets.js for the set, landmarkPlacement.js for the evidence).

import log from '../../log';
import { documentKind, subscribeSessionCleared } from '../utils/srDocument';
import readLandmarkSets from './readLandmarkSets';
import { attributionOf, cachedSeries, evidenceOf, imageOf } from './landmarkPlacement';

const EVENTS = Object.freeze({ CHANGED: 'event::landmarkSets:changed' });

const entries = new Map();
const documents = new Set();
const listeners = new Set();

const keyOf = (SOPInstanceUID, trackingUid) => `${SOPInstanceUID}::${trackingUid}`;

function notify() {
  listeners.forEach((listener) => {
    try {
      listener({ type: EVENTS.CHANGED });
    } catch (error) {
      log.error('[DICOM-SR:landmarkSets] listener failed', error);
    }
  });
}

/** Listen for sets added and cleared; returns { unsubscribe } */
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
  const changed = entries.size > 0;
  entries.clear();
  documents.clear();
  if (changed) {
    notify();
  }
}

subscribeSessionCleared(clearLandmarkSets);


export { addLandmarkSetsOf, clearLandmarkSets, EVENTS, getLandmarkSet, getLandmarkSets, keyOf, subscribe };
