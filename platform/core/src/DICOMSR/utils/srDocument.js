// Document-level rules for a Viewer save (the Series-Tag exchange profile with Sonador IO):
// the document class and root template, the equipment profile, the observation context, and the
// parent a save is measured against.
//
// * A new document is Comprehensive 3D SR with root template `Sonador-SR.1500` (mapping resource
//   `Sonador-SR`). A re-save keeps the parent's class and template: an Enhanced SR parent stays
//   Enhanced SR, any other parent is written as Comprehensive 3D SR. The parent is the single SR
//   hydrated for the study; several, or none, give a new document.
// * An Enhanced SR save whose content Enhanced SR cannot hold (an SCOORD3D item, a CONTAINER under
//   a CODE or NUM item) is written as Comprehensive 3D SR instead, with a warning.
// * Equipment and the Device Observer are the Viewer's on every save; the Person Observer is the
//   signed-in user, omitted when the session does not name one.
// * isDisplayOnlyDocument classifies a document whose root concept is in the `Sonador-SR` scheme
//   (an application document). The Cornerstone3D report reader does not hydrate its Angle and
//   Cobb angle groups; other groups are not affected by the classification.

import _ from 'lodash';

import { data as dcmjsData } from 'dcmjs';

import {
  DCMR_SR_TEMPLATE,
  ObserverContextCodes,
  RELATIONSHIP_TYPE,
  SONADOR_MANUFACTURER,
  SONADOR_SR,
  SONADOR_SR_TEMPLATE,
  SONADOR_VIEWER_MODEL_NAME,
  SR_DOCUMENT_CLASS,
} from '../enums';
import { asArray, codedConcept, conceptNameValue, firstItem } from './codedConcept';

const { DicomMetaDictionary } = dcmjsData;

const ENHANCED_SR_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.88.22';


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

function isDisplayOnlyDocument(dataset) {
  // True for a document whose root concept name is coded in the Sonador-SR scheme
  const rootConcept = firstItem(dataset && dataset.ConceptNameCodeSequence);
  return !!rootConcept && rootConcept.CodingSchemeDesignator === SONADOR_SR;
}


// Document class

function requiresComprehensive(contentItem, parent) {
  // True when the content holds an SCOORD3D item or a CONTAINER under a CODE or NUM item, which an
  // Enhanced SR document cannot hold (PS3.3 Table A.35.2-2)
  if (!contentItem) {
    return false;
  }
  if (contentItem.ValueType === 'SCOORD3D') {
    return true;
  }
  if (contentItem.ValueType === 'CONTAINER' && parent && ['CODE', 'NUM'].includes(parent.ValueType)) {
    return true;
  }
  return asArray(contentItem.ContentSequence).some(child => requiresComprehensive(child, contentItem));
}

function documentSettings(parent) {
  // { documentClass, template } of a save made against `parent` (a registered report, or null)
  if (!parent) {
    return { documentClass: SR_DOCUMENT_CLASS.COMPREHENSIVE_3D, template: SONADOR_SR_TEMPLATE };
  }
  const template = parent.TemplateIdentifier
    ? { TemplateIdentifier: parent.TemplateIdentifier, MappingResource: parent.MappingResource
        || (parent.TemplateIdentifier === DCMR_SR_TEMPLATE.TemplateIdentifier ? 'DCMR' : SONADOR_SR_TEMPLATE.MappingResource) }
    : SONADOR_SR_TEMPLATE;
  const documentClass = parent.SOPClassUID === ENHANCED_SR_SOP_CLASS_UID
    ? SR_DOCUMENT_CLASS.ENHANCED
    : SR_DOCUMENT_CLASS.COMPREHENSIVE_3D;
  return { documentClass, template };
}


// Parent registry: the SR documents hydrated in this measurement session, by study. Each clear
// starts a new session; a load that began in an earlier session does not register.

const hydratedReports = new Map();
let session = 0;

const currentSession = () => session;

function registerHydratedReport(dataset, loadSession = session) {
  if (!dataset || !dataset.SOPInstanceUID || !dataset.StudyInstanceUID || loadSession !== session) {
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
  session += 1;
}


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
  isDisplayOnlyDocument,
  isUnconfirmedReport,
  markReportUnconfirmed,
  observerContextItems,
  personObserverName,
  registerHydratedReport,
  requiresComprehensive,
  resolvePersonObserverName,
  saveParent,
  softwareVersion,
};
