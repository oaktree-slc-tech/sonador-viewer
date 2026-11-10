// Helper methods for encoding extended meta attributes to DICOM-SR. Provides support for
// attributes defined by the OHIF v3 MeasurementService schema that are not supported by
// DCM.js and the Cornerstone DICOM-SR adapters packaged with Cornerstone 3D.

// This module provides two methods:
// 1. encodeExtendedMeta: encodes DICOM-SR extended attributes from a measurement as content items
//    of a TID 1501 measurement group. They are `HAS PROPERTIES` TEXT children of the item the
//    tool's property parent names (propertyParent.js): the NUM item for Angle and Cobb angle, the
//    group's Finding otherwise (the same flat form in Enhanced and Comprehensive 3D SR). A group
//    with neither keeps them as group-level `HAS CONCEPT MOD` items.
// 2. parseExtendedMeta: parses the attributes back into toolState as part of loading DICOM-SR
//    data from DCM.js. It reads children of the property parent first and, for files written
//    before the attributes moved there, the Finding and group-level items.

import _ from 'lodash';

import { sr as dcmjsSr } from 'dcmjs';
import { MeasurementApi } from '../../measurements/classes';
import Enums from '../../measurements/enums';
import { asArray, codedConcept, conceptNameValue } from './codedConcept';
import { propertyCandidates, propertyCarrier } from './propertyParent';

const { TextContentItem } = dcmjsSr.valueTypes;
const { SonadorCodeValues, RelationshipType } = Enums.SREnums;

const EXTENDED_META = [
  ['description', SonadorCodeValues.DCMSR_MEASUREMENT_DESCRIPTION],
  ['text', SonadorCodeValues.DCMSR_MEASUREMENT_TEXT],
  ['location', SonadorCodeValues.DCMSR_MEASUREMENT_LOCATION],
];
const EXTENDED_META_CODES = [
  ...EXTENDED_META.map(([, code]) => code.value), SonadorCodeValues.DCMSR_MEASUREMENT_VIEW.value,
];


function encodeExtendedMeta(measurement, srItem, options) {
  // Add extended metadata attributes from the measurement to the associated srItem (a measurement
  // group). Supported fields: description, text, location, view. (Refer to SR enums module for
  // additional information on the fields and their use.)
  //
  // @input options.propertyParent ('finding' | 'num', default 'finding'): item the properties
  //   are written under (propertyParent.js)
  options = options || {};

  // Unpack measurement data and check for extended attributes
  const { measurementData, measurementMeta } = MeasurementApi._unpackMeasurementData(measurement);
  const values = {
    description: measurement.description || measurementMeta.description || measurementData.description,
    text: measurementMeta.text || measurementData.text || measurement.text,
    location: measurementMeta.location || measurementData.location || measurement.location,
  };
  const views = asArray(measurementMeta.views || measurementData.views || measurement.views)
    .filter(view => _.isString(view) && view !== '');

  const { item: parent, relationshipType } = propertyCarrier(srItem, options.propertyParent);
  const textItem = (code, value) => new TextContentItem({ name: codedConcept(code), value, relationshipType });

  const items = [
    ...EXTENDED_META.filter(([key]) => values[key]).map(([key, code]) => textItem(code, values[key])),
    ...views.map(view => textItem(SonadorCodeValues.DCMSR_MEASUREMENT_VIEW, view)),
  ];

  parent.ContentSequence = [...asArray(parent.ContentSequence), ...items];
  return srItem;
}


function parseExtendedMeta(srItem, annotation, options) {
  // Parse extended metadata attributes from the srItem and add them to the annotation. Supported fields: description,
  // text, location, views. (Refer to SR enums module for additional information on the fields and their use.)
  //
  // @input options.propertyParent ('finding' | 'num', default 'finding'): item searched first
  options = options || {}
  _.defaults(options, {
    textPath: 'annotation.metadata.text',
    locationPath: 'annotation.metadata.location',
    viewsPath: 'annotation.metadata.views',
  });

  // Children of the property parent first, then the Finding and group-level items (files written
  // before the properties moved)
  const groupItems = asArray(_.isArray(srItem) ? srItem : srItem.ContentSequence);
  const candidates = propertyCandidates(groupItems, options.propertyParent, EXTENDED_META_CODES);
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

  // View items, trimmed and otherwise kept as found (unknown values included)
  const views = candidates
    .filter(item => conceptNameValue(item) === SonadorCodeValues.DCMSR_MEASUREMENT_VIEW.value)
    .map(item => _.trim(item.TextValue))
    .filter(Boolean);
  if (views.length && !annotation.annotation?.metadata?.views) {
    _.set(annotation, options.viewsPath, views);
  }

  return annotation;
}


export { encodeExtendedMeta, parseExtendedMeta };