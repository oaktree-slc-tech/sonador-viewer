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
//   whole document from tool state, so the Viewer never writes to an application document: its
//   measurement groups are displayed, not hydrated (its Series Tags excepted, hydrated read-only),
//   and it is never a save parent.

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

function saveParent(StudyInstanceUID) {
  // The single SR hydrated for the study, or null when there are none or several
  const reports = [...hydratedReports.values()].filter(report => report.StudyInstanceUID === StudyInstanceUID);
  return reports.length === 1 ? reports[0] : null;
}

function clearHydratedReports() {
  hydratedReports.clear();
  applicationMeasurements.clear();
  session += 1;
}


// Measurements hydrated from an application document (its Series Tags), by tracking UID: shown
// read-only and never written by a save, which would copy them into another document

const applicationMeasurements = new Set();

const markApplicationMeasurement = TrackingUniqueIdentifier =>
  TrackingUniqueIdentifier && applicationMeasurements.add(TrackingUniqueIdentifier);
const isApplicationMeasurement = TrackingUniqueIdentifier =>
  !!TrackingUniqueIdentifier && applicationMeasurements.has(TrackingUniqueIdentifier);


// Reports written by this Viewer and shown before the upload confirms they are stored. Their
// measurements hydrate unlocked: until the report is stored they are not saved, and a failed
// upload must leave them editable for a retry.

const unconfirmedReports = new Set();

const markReportUnconfirmed = SOPInstanceUID => SOPInstanceUID && unconfirmedReports.add(SOPInstanceUID);
const confirmReport = SOPInstanceUID => unconfirmedReports.delete(SOPInstanceUID);
const isUnconfirmedReport = SOPInstanceUID => unconfirmedReports.has(SOPInstanceUID);


export {
  applyRootContent,
  clearHydratedReports,
  confirmReport,
  currentSession,
  documentSettings,
  equipment,
  documentKind,
  isApplicationDocument,
  isApplicationMeasurement,
  markApplicationMeasurement,
  isUnconfirmedReport,
  markReportUnconfirmed,
  observerContextItems,
  personObserverName,
  registerHydratedReport,
  resolvePersonObserverName,
  saveParent,
  softwareVersion,
};
