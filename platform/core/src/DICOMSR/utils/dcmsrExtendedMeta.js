// Helper methods for encoding extended meta attributes to DICOM-SR. Provides support for
// attributes defined by the OHIF v3 MeasurementService schema that are not supported by
// DCM.js and the Cornerstone DICOM-SR adapters packaged with Cornerstone 3D.

// This module provides two methods:
// 1. encodeExtendedMeta: encodes DICOM-SR extended attributes from a measurement as content items
//    of a TID 1501 measurement group. They are `HAS PROPERTIES` TEXT children of the group's
//    Finding (the same flat form in Enhanced and Comprehensive 3D SR). A group with no Finding
//    keeps them as group-level `HAS CONCEPT MOD` items until those tools gain a Finding.
// 2. parseExtendedMeta: parses the attributes back into toolState as part of loading DICOM-SR
//    data from DCM.js. It reads children of the Finding and, for files written before the
//    attributes moved there, group-level items.

import _ from 'lodash';

import { sr as dcmjsSr } from 'dcmjs';
import { MeasurementApi } from '../../measurements/classes';
import Enums from '../../measurements/enums';
import { asArray, codedConcept, conceptNameValue, findingItemOf } from './codedConcept';

const { TextContentItem } = dcmjsSr.valueTypes;
const { SonadorCodeValues, RelationshipType } = Enums.SREnums;

const EXTENDED_META = [
  ['description', SonadorCodeValues.DCMSR_MEASUREMENT_DESCRIPTION],
  ['text', SonadorCodeValues.DCMSR_MEASUREMENT_TEXT],
  ['location', SonadorCodeValues.DCMSR_MEASUREMENT_LOCATION],
];


function encodeExtendedMeta(measurement, srItem) {
  // Add extended metadata attributes from the measurement to the associated srItem (a measurement
  // group). Supported fields: description, text, location. (Refer to SR enums module for
  // additional information on the fields and their use.)

  // Unpack measurement data and check for extended attributes
  const { measurementData, measurementMeta } = MeasurementApi._unpackMeasurementData(measurement);
  const values = {
    description: measurement.description || measurementMeta.description || measurementData.description,
    text: measurementMeta.text || measurementData.text || measurement.text,
    location: measurementMeta.location || measurementData.location || measurement.location,
  };

  const finding = findingItemOf(srItem);
  const parent = finding || srItem;
  const relationshipType = finding ? RelationshipType.HAS_PROPERTIES : RelationshipType.CONCEPT_MOD;

  const items = EXTENDED_META.filter(([key]) => values[key]).map(([key, code]) => new TextContentItem({
    name: codedConcept(code),
    value: values[key],
    relationshipType,
  }));

  parent.ContentSequence = [...asArray(parent.ContentSequence), ...items];
  return srItem;
}


function parseExtendedMeta(srItem, annotation, options) {
  // Parse extended metadata attributes from the srItem and add them to the annotation. Supported fields: description,
  // text, location. (Refer to SR enums module for additional information on the fields and their use.)
  options = options || {}
  _.defaults(options, {
    textPath: 'annotation.metadata.text',
    locationPath: 'annotation.metadata.location',
  });

  // Children of the Finding first, then group-level items (files written before they moved)
  const groupItems = asArray(_.isArray(srItem) ? srItem : srItem.ContentSequence);
  const finding = findingItemOf({ ContentSequence: groupItems });
  const candidates = [...asArray(finding && finding.ContentSequence), ...groupItems];
  const textOf = code => {
    const item = candidates.find(contentItem => conceptNameValue(contentItem) === code.value);
    return item && item.TextValue;
  };

  const description = textOf(SonadorCodeValues.DCMSR_MEASUREMENT_DESCRIPTION);
  if (description && !annotation.description) {
    annotation.description = description;
  }

  const text = textOf(SonadorCodeValues.DCMSR_MEASUREMENT_TEXT);
  if (text && !annotation.annotation?.metadata?.text) {
    _.set(annotation, options.textPath, text);
  }

  const location = textOf(SonadorCodeValues.DCMSR_MEASUREMENT_LOCATION);
  if (location && !annotation.annotation?.metadata?.location) {
    _.set(annotation, options.locationPath, location);
  }

  return annotation;
}


export { encodeExtendedMeta, parseExtendedMeta };