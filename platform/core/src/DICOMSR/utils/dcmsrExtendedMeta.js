// Helper methods for encoding extended meta attributes to DICOM-SR. Provides support for
// attributes defined by the OHIF v3 MeasurementService schema that are not supported by
// DCM.js and the Cornerstone DICOM-SR adapters packaged with Cornerstone 3D.

// This module provides two methods:
// 1. encodeExtendedMeta: encodes DICOM-SR extended attributes from a measurement
//    to SR content items written as part of a TID-300 / TID-1501 / TID-1500 
//    measurement report.
// 2. parseExtendedMeta: parses DICOM-SR content items to retrieve extended
//    attributes and add them to toolState as part of loading DICOM-SR data from DCM.js.

import _ from 'lodash';

import { sr as dcmjsSr } from 'dcmjs';
import { MeasurementApi } from '../../measurements/classes';
import Enums from '../../measurements/enums';

const { Code, CodedConcept } = dcmjsSr.coding;
const { TextContentItem } = dcmjsSr.valueTypes;
const { SonadorCodeValues, RelationshipType } = Enums.SREnums;


function encodeExtendedMeta(measurement, srItem) {
  // Add extended metadata attributes from the measurement to the associated srItem. Supported fields: description, text,
  // location. (Refer to SR enums module for additional information on the fields and their use.)

  // Retrieve reference to SR item content sequence
  const srContentSequence = srItem.ContentSequence || [];

  // Unpack measurement data and check for extended attributes
  const { measurementData, measurementMeta } = MeasurementApi._unpackMeasurementData(measurement);
  const description = measurement.description || measurementMeta.description || measurementData.description;
  const text = measurementMeta.text || measurementData.text || measurement.text;
  const location = measurementMeta.location || measurementData.location || measurement.location;

  let descriptionSrItem, textSrItem, locationSrItem;
  let extendedSrMeta = [];

  // Encode description
  if (description) {

    descriptionSrItem = new TextContentItem({
      name: new CodedConcept(SonadorCodeValues.DCMSR_MEASUREMENT_DESCRIPTION),
      value: description,
      relationshipType: RelationshipType.CONCEPT_MOD,
    });
    extendedSrMeta.push(descriptionSrItem);
  }

  // Encode text
  if (text) {
    
    textSrItem = new TextContentItem({
      name: new CodedConcept(SonadorCodeValues.DCMSR_MEASUREMENT_TEXT),
      value: text,
      relationshipType: RelationshipType.CONCEPT_MOD,
    });
    extendedSrMeta.push(textSrItem);
  }

  // Encode location
  if (location) {

    locationSrItem = new TextContentItem({
      name: new CodedConcept(SonadorCodeValues.DCMSR_MEASUREMENT_LOCATION),
      value: location,
      relationshipType: RelationshipType.CONCEPT_MOD,
    });
    extendedSrMeta.push(locationSrItem);
  }

  // Merge SR and extended meta content sequences
  srItem.ContentSequence = [...srContentSequence, ...extendedSrMeta];
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

  // SR Item content sequence
  const srSeq = _.isArray(srItem) ? srItem : srItem.ContentSequence;

  // Check for description field
  const descriptionSrItem = srSeq.find(contentItem => {
    return contentItem.ConceptNameCodeSequence 
      && contentItem.ConceptNameCodeSequence.CodeValue == SonadorCodeValues.DCMSR_MEASUREMENT_DESCRIPTION.value;
  });
  if (descriptionSrItem && descriptionSrItem.TextValue && !annotation.description) {
    annotation.description = descriptionSrItem.TextValue;
  }

  // Check for text field
  const textSrItem = srSeq.find(contentItem => {
    return contentItem.ConceptNameCodeSequence
      && contentItem.ConceptNameCodeSequence.CodeValue == SonadorCodeValues.DCMSR_MEASUREMENT_TEXT.value;
  });
  if (textSrItem && textSrItem.TextValue && !annotation.annotation?.metadata?.text) {
    _.set(annotation, options.textPath, textSrItem.TextValue);
  }

  // Check for location field
  const locationSrItem = srSeq.find(contentItem => {
    return contentItem.ConceptNameCodeSequence
      && contentItem.ConceptNameCodeSequence.CodeValue == SonadorCodeValues.DCMSR_MEASUREMENT_LOCATION.value;
  });
  if (locationSrItem && locationSrItem.TextValue && !annotation.annotation?.metadata?.location) {
    _.set(annotation, options.locationPath, locationSrItem.TextValue);    
  }

  return annotation;
}


export { encodeExtendedMeta, parseExtendedMeta };