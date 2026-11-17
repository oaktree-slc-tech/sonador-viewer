// The groups of a Sonador-SR document that hold landmark sets: a measurement group of the Imaging
// Measurements container whose tracking identifier names the tool `SonadorLandmarkSet`, under either
// Cornerstone prefix, and a legacy point group (template Sonador-SR.1002 under the root container
// `Clinical-Report.Volume-Measurements`; the same template under another parent is not one).

import { asArray, conceptNameMatches, firstItem } from '../utils/codedConcept';
import {
  CodeNameCodeSequenceValues, CORNERSTONE_3D_TAG, CORNERSTONE_TOOLS_SR_TAG, DCM, DCMSR_VOLUME_MEASUREMENTS, LANDMARK_SET_TOOL,
  SONADOR_POINT_GROUP_TEMPLATE,
} from '../enums';

const dcmCode = value => ({ value, schemeDesignator: DCM });
const IMAGING_MEASUREMENTS = dcmCode(CodeNameCodeSequenceValues.ImagingMeasurements);
const MEASUREMENT_GROUP = dcmCode(CodeNameCodeSequenceValues.MeasurementGroup);
const TRACKING_IDENTIFIER = dcmCode(CodeNameCodeSequenceValues.TrackingIdentifier);
const TRACKING_UID = dcmCode(CodeNameCodeSequenceValues.TrackingUniqueIdentifier);

const LANDMARK_SET_PREFIXES = [CORNERSTONE_TOOLS_SR_TAG, CORNERSTONE_3D_TAG].map(prefix => `${prefix}:`);


/** Whether a tracking identifier names a landmark set, under either Cornerstone prefix */
function isLandmarkSetTrackingIdentifier(trackingIdentifier) {
  return typeof trackingIdentifier === 'string'
    && LANDMARK_SET_PREFIXES.some(prefix => trackingIdentifier === `${prefix}${LANDMARK_SET_TOOL}`);
}

const trackingIdentifierOf = items => {
  const item = asArray(items).find(contentItem => conceptNameMatches(contentItem, TRACKING_IDENTIFIER));
  return item ? item.TextValue : undefined;
};
const trackingUidOf = items => {
  const item = asArray(items).find(contentItem => conceptNameMatches(contentItem, TRACKING_UID));
  return item ? item.UID : undefined;
};

/** Whether the content of a measurement group (its ContentSequence) is that of a landmark set */
const isLandmarkSetGroup = items => isLandmarkSetTrackingIdentifier(trackingIdentifierOf(items));

const templateOf = item => {
  const template = firstItem(item && item.ContentTemplateSequence);
  return template && template.TemplateIdentifier;
};

/** The legacy point groups of a document, in document order */
function legacyGroupsOf(dataset) {
  return asArray(dataset && dataset.ContentSequence)
    .filter(item => item.ValueType === 'CONTAINER' && conceptNameMatches(item, DCMSR_VOLUME_MEASUREMENTS))
    .flatMap(container => asArray(container.ContentSequence))
    .filter(item => item.ValueType === 'CONTAINER' && templateOf(item) === SONADOR_POINT_GROUP_TEMPLATE);
}

/** The landmark-set groups of a document's Imaging Measurements container, in document order */
function landmarkSetGroupsOf(dataset) {
  const container = asArray(dataset && dataset.ContentSequence).find(item => conceptNameMatches(item, IMAGING_MEASUREMENTS));
  return asArray(container && container.ContentSequence)
    .filter(item => conceptNameMatches(item, MEASUREMENT_GROUP) && isLandmarkSetGroup(item.ContentSequence));
}

/** Whether a document holds a landmark-set group or a legacy point group, readable or not */
const holdsLandmarkSets = dataset => landmarkSetGroupsOf(dataset).length > 0 || legacyGroupsOf(dataset).length > 0;


export {
  holdsLandmarkSets, isLandmarkSetGroup, isLandmarkSetTrackingIdentifier, landmarkSetGroupsOf, legacyGroupsOf, trackingIdentifierOf,
  trackingUidOf,
};
