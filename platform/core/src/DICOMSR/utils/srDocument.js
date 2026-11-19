// Document-level rules for a Viewer save (the Series-Tag exchange profile with Sonador IO):
// the document class and root template, the equipment profile, the observation context, and the
// parent a save is measured against.
//
// * Every document the Viewer writes is Comprehensive 3D SR. A new document has root template
//   `Sonador-SR.1500` (mapping resource `Sonador-SR`); a re-save keeps the parent's template. An
//   Enhanced SR report is still read, and a new version of one is written as Comprehensive 3D SR.
//   The parent is the single SR hydrated for the study; several, or none, give a new document.
// * Equipment and the Device Observer are the Viewer's on every save; the Person Observer is the
//   signed-in user, omitted when the session does not name one.
// * documentKind classifies a document by its root concept name (enums SR_DOCUMENT_KIND): an
//   exchange document, `(126000, DCM)`, or an application document, a root concept in the
//   `Sonador-SR` scheme that also carries content the Viewer does not model. A save regenerates the
//   whole document from tool state, so the Viewer never writes to an application document: the
//   measurements of its supported tools are hydrated read-only and never written by a save, and it is
//   never a save parent.
// * A tracking UID held by several documents is shown once: a copy from an exchange document (which
//   can be edited) takes precedence over one from an application document, and of application
//   documents the current one's does (currentDocument; measurementCopies.js).
// * An exchange document that holds a landmark set is not a save parent either: the set is listed
//   and drawn, not held as tool state, so a save regenerated from tool state would drop it.

import _ from 'lodash';

import { data as dcmjsData } from 'dcmjs';

import {
  DCM,
  DCMR_SR_TEMPLATE,
  ObserverContextCodes,
  RELATIONSHIP_TYPE,
  SONADOR_MANUFACTURER,
  SONADOR_SR,
  SONADOR_SR_TEMPLATE,
  SONADOR_VIEWER_MODEL_NAME,
  SR_DOCUMENT_CLASS,
  SR_DOCUMENT_KIND,
} from '../enums';
import log from '../../log';
import { asArray, codeValueOf, codedConcept, conceptNameValue, firstItem } from './codedConcept';
import { holdsLandmarkSets } from '../landmarks/landmarkGroups';

const { DicomMetaDictionary } = dcmjsData;


// Equipment

const softwareVersion = () => {
  try {
    return process.env.VERSION_NUMBER || 'dev';
  } catch (e) {
    return 'dev';
  }
};

const equipment = () => ({
  Manufacturer: SONADOR_MANUFACTURER,
  ManufacturerModelName: SONADOR_VIEWER_MODEL_NAME,
  SoftwareVersions: softwareVersion(),
});


// Observation context

function personObserverName(user) {
  // DICOM PN (`Family^Given`) for a Sonador user (`first_name`, `last_name`, `username`)
  if (!user) {
    return null;
  }
  const family = _.trim(user.last_name);
  const given = _.trim(user.first_name);
  if (family || given) {
    return given ? `${family}^${given}` : family;
  }
  return _.trim(user.username) || null;
}

async function resolvePersonObserverName(server, fetchSystemInfo) {
  // The signed-in user from the imaging server's `/system` report (cached on `server.sysInfo` by
  // whichever consumer fetched it first). Null when it cannot be resolved.
  if (!server) {
    return null;
  }
  try {
    if (!server.sysInfo && fetchSystemInfo) {
      const response = await fetchSystemInfo(server);
      if (response && response.ok) {
        server.sysInfo = await response.json();
      }
    }
    return personObserverName(server.sysInfo && server.sysInfo.User);
  } catch (e) {
    console.warn('[DICOM-SR:srDocument] unable to resolve the person observer', e);
    return null;
  }
}

const observationItem = (valueType, code, value) => {
  const item = {
    RelationshipType: RELATIONSHIP_TYPE.HAS_OBS_CONTEXT,
    ValueType: valueType,
    ConceptNameCodeSequence: [codedConcept(code)],
  };
  return Object.assign(item, value);
};

function observerContextItems({ personName, deviceObserverUID }) {
  // TID 1002: the Person Observer (TID 1003) when named, then the Device Observer (TID 1004)
  const items = [];
  if (personName) {
    items.push(observationItem('PNAME', ObserverContextCodes.PersonObserverName, { PersonName: personName }));
  }
  items.push(
    observationItem('CODE', ObserverContextCodes.ObserverType, {
      ConceptCodeSequence: [codedConcept(ObserverContextCodes.Device)],
    }),
    observationItem('UIDREF', ObserverContextCodes.DeviceObserverUID, {
      UID: deviceObserverUID || DicomMetaDictionary.uid(),
    }),
    observationItem('TEXT', ObserverContextCodes.DeviceObserverName, { TextValue: SONADOR_VIEWER_MODEL_NAME }),
    observationItem('TEXT', ObserverContextCodes.DeviceObserverManufacturer, { TextValue: SONADOR_MANUFACTURER }),
    observationItem('TEXT', ObserverContextCodes.DeviceObserverModelName, { TextValue: SONADOR_VIEWER_MODEL_NAME }),
  );
  return items;
}

function applyRootContent(content, { template, personName, deviceObserverUID } = {}) {
  // Set the root template and replace dcmjs's placeholder Person Observer with the observation
  // context. Returns the content.
  const { TemplateIdentifier, MappingResource } = template || SONADOR_SR_TEMPLATE;
  content.ContentTemplateSequence = [{ MappingResource, TemplateIdentifier }];

  const items = asArray(content.ContentSequence).filter(item =>
    conceptNameValue(item) !== ObserverContextCodes.PersonObserverName.value);
  const languageIndex = items.findIndex(item => conceptNameValue(item) === '121049');
  items.splice(languageIndex + 1, 0, ...observerContextItems({ personName, deviceObserverUID }));
  content.ContentSequence = items;
  return content;
}


// Document kind

const IMAGING_MEASUREMENT_REPORT = '126000';

/** The kind of an SR document (SR_DOCUMENT_KIND), by its root concept name */
function documentKind(dataset) {
  const rootConcept = firstItem(dataset && dataset.ConceptNameCodeSequence);
  if (!rootConcept) {
    return SR_DOCUMENT_KIND.OTHER;
  }
  if (codeValueOf(rootConcept) === IMAGING_MEASUREMENT_REPORT && rootConcept.CodingSchemeDesignator === DCM) {
    return SR_DOCUMENT_KIND.EXCHANGE;
  }
  return rootConcept.CodingSchemeDesignator === SONADOR_SR ? SR_DOCUMENT_KIND.APPLICATION : SR_DOCUMENT_KIND.OTHER;
}

/** Whether a document is an application document: displayed by the Viewer, never written to */
const isApplicationDocument = dataset => documentKind(dataset) === SR_DOCUMENT_KIND.APPLICATION;


// Document class

function documentSettings(parent) {
  // { documentClass, template } of a save made against `parent` (a registered report, or null):
  // Comprehensive 3D SR, whatever the parent's class
  if (!parent) {
    return { documentClass: SR_DOCUMENT_CLASS.COMPREHENSIVE_3D, template: SONADOR_SR_TEMPLATE };
  }
  const template = parent.TemplateIdentifier
    ? { TemplateIdentifier: parent.TemplateIdentifier, MappingResource: parent.MappingResource
        || (parent.TemplateIdentifier === DCMR_SR_TEMPLATE.TemplateIdentifier ? 'DCMR' : SONADOR_SR_TEMPLATE.MappingResource) }
    : SONADOR_SR_TEMPLATE;
  return { documentClass: SR_DOCUMENT_CLASS.COMPREHENSIVE_3D, template };
}


// Parent registry: the SR documents hydrated in this measurement session, by study. Each clear
// starts a new session; a load that began in an earlier session does not register.

const hydratedReports = new Map();
let session = 0;

const currentSession = () => session;

function registerHydratedReport(dataset, loadSession = session) {
  // An application document is never a save parent: a save would regenerate it from tool state and
  // drop the content the Viewer does not model
  if (!dataset || !dataset.SOPInstanceUID || !dataset.StudyInstanceUID || loadSession !== session) {
    return;
  }
  if (isApplicationDocument(dataset)) {
    log.info('[DICOM-SR:srDocument] application document, not a save parent', dataset.SOPInstanceUID);
    return;
  }
  if (holdsLandmarkSets(dataset)) {
    log.info('[DICOM-SR:srDocument] document holds a landmark set, not a save parent', dataset.SOPInstanceUID);
    return;
  }
  const template = firstItem(dataset.ContentTemplateSequence) || {};
  hydratedReports.set(dataset.SOPInstanceUID, {
    StudyInstanceUID: dataset.StudyInstanceUID,
    SeriesInstanceUID: dataset.SeriesInstanceUID,
    SOPInstanceUID: dataset.SOPInstanceUID,
    SOPClassUID: dataset.SOPClassUID,
    TemplateIdentifier: template.TemplateIdentifier,
    MappingResource: template.MappingResource,
  });
}

// Reports that are never save parents whatever their own content, decided by the Measurements API:
// those of an SR series that belongs to a defined timepoint, every revision of it included
let saveParentExclusion = () => false;

function setSaveParentExclusion(predicate) {
  saveParentExclusion = typeof predicate === 'function' ? predicate : () => false;
}

function saveParent(StudyInstanceUID) {
  // The single SR hydrated for the study, or null when there are none or several
  const reports = [...hydratedReports.values()]
    .filter(report => report.StudyInstanceUID === StudyInstanceUID && !saveParentExclusion(report));
  return reports.length === 1 ? reports[0] : null;
}

// Other session state (the landmark sets) is emptied with the registry
const sessionClearedListeners = new Set();

function subscribeSessionCleared(listener) {
  sessionClearedListeners.add(listener);
  return () => sessionClearedListeners.delete(listener);
}

function clearHydratedReports() {
  hydratedReports.clear();
  applicationMeasurements.clear();
  session += 1;
  sessionClearedListeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      log.error('[DICOM-SR:srDocument] session cleared listener failed', error);
    }
  });
}


// Measurements read from an application document (hydrated, or drawn by the read-only display), by
// tracking UID, with the document they were read from: shown read-only and never written by a save,
// which would copy them into another document. Which copy is shown is decided by measurementCopies.js.

const applicationMeasurements = new Map();

const markApplicationMeasurement = (TrackingUniqueIdentifier, source = {}) =>
  TrackingUniqueIdentifier && applicationMeasurements.set(TrackingUniqueIdentifier, source);
const unmarkApplicationMeasurement = TrackingUniqueIdentifier => applicationMeasurements.delete(TrackingUniqueIdentifier);
const isApplicationMeasurement = TrackingUniqueIdentifier =>
  !!TrackingUniqueIdentifier && applicationMeasurements.has(TrackingUniqueIdentifier);
const applicationMeasurementSource = TrackingUniqueIdentifier => applicationMeasurements.get(TrackingUniqueIdentifier);


// The current document, in the order the Sonador IO client applies (its `current_instance`): every
// document another candidate names in Predecessor Documents Sequence is set aside; of the others, the
// latest Content Date and Time, then Instance Creation Date and Time, then the greatest SOP Instance UID.

// A DICOM date and time as text that sorts in time order: HHMMSS and six fractional digits, a shorter
// time or fraction read at its own scale
const dateTimeOf = (date, time) => {
  const [whole, fraction] = String(time || '').split('.');
  return `${date || ''}${(whole || '').padEnd(6, '0')}${(fraction || '').padEnd(6, '0')}`;
};

/** The fields the current-document choice reads, of a naturalized document */
function documentOrderOf(dataset) {
  const predecessors = asArray(dataset && dataset.PredecessorDocumentsSequence)
    .flatMap(study => asArray(study.ReferencedSeriesSequence))
    .flatMap(series => asArray(series.ReferencedSOPSequence))
    .map(sop => sop.ReferencedSOPInstanceUID)
    .filter(Boolean);
  return {
    SOPInstanceUID: dataset && dataset.SOPInstanceUID,
    predecessors,
    content: dataset && dataset.ContentDate ? dateTimeOf(dataset.ContentDate, dataset.ContentTime) : '',
    creation: dataset && dataset.InstanceCreationDate ? dateTimeOf(dataset.InstanceCreationDate, dataset.InstanceCreationTime) : '',
  };
}

const compareText = (a, b) => (a === b ? 0 : (a > b ? 1 : -1));
const compareTimestamps = (a, b) => compareText(a.content, b.content) || compareText(a.creation, b.creation)
  || compareText(String(a.SOPInstanceUID || ''), String(b.SOPInstanceUID || ''));

/** The current one of several document orders (documentOrderOf) */
function currentDocument(orders) {
  const candidates = asArray(orders);
  const superseded = new Set(candidates.flatMap(order => order.predecessors));
  const remaining = candidates.filter(order => !superseded.has(order.SOPInstanceUID));
  return (remaining.length ? remaining : candidates).reduce((best, order) => (!best || compareTimestamps(order, best) > 0 ? order : best), null);
}

// Reports written by this Viewer and shown before the upload confirms they are stored. Their
// measurements hydrate unlocked: until the report is stored they are not saved, and a failed
// upload must leave them editable for a retry.

const unconfirmedReports = new Set();

const markReportUnconfirmed = SOPInstanceUID => SOPInstanceUID && unconfirmedReports.add(SOPInstanceUID);
const confirmReport = SOPInstanceUID => unconfirmedReports.delete(SOPInstanceUID);
const isUnconfirmedReport = SOPInstanceUID => unconfirmedReports.has(SOPInstanceUID);


// The character set of a document with text outside ASCII (dcmjs writes every text value as UTF-8)
const UTF8_CHARACTER_SET = 'ISO_IR 192';

function hasNonAsciiText(value) {
  if (_.isString(value)) {
    return Array.from(value).some(character => character.charCodeAt(0) > 0x7f);
  }
  if (_.isArray(value)) {
    return value.some(hasNonAsciiText);
  }
  if (_.isPlainObject(value) || (_.isObject(value) && !ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer))) {
    return Object.keys(value).some(key => !key.startsWith('_') && hasNonAsciiText(value[key]));
  }
  return false;
}

/**
 * Set Specific Character Set to ISO_IR 192 when any text value of a naturalized document is outside
 * ASCII, whatever tool or header it belongs to. A document of ASCII text only is left as it is.
 *
 * @returns {object} the dataset
 */
function applyCharacterSet(dataset) {
  if (dataset && hasNonAsciiText(_.omit(dataset, 'SpecificCharacterSet'))) {
    dataset.SpecificCharacterSet = UTF8_CHARACTER_SET;
  }
  return dataset;
}


export {
  UTF8_CHARACTER_SET,
  applyCharacterSet,
  applyRootContent,
  clearHydratedReports,
  confirmReport,
  currentSession,
  documentSettings,
  equipment,
  documentKind,
  isApplicationDocument,
  applicationMeasurementSource,
  currentDocument,
  documentOrderOf,
  isApplicationMeasurement,
  markApplicationMeasurement,
  unmarkApplicationMeasurement,
  isUnconfirmedReport,
  markReportUnconfirmed,
  observerContextItems,
  personObserverName,
  registerHydratedReport,
  resolvePersonObserverName,
  saveParent,
  setSaveParentExclusion,
  softwareVersion,
  subscribeSessionCleared,
};
