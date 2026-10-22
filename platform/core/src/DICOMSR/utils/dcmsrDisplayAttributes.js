// DICOM-SR encoding of display attributes, kept apart from the extended meta attributes
// (dcmsrExtendedMeta.js): they describe how a measurement is rendered, not what it records.
//
// The measurement group CONTAINS a display attributes CONTAINER, which CONTAINS a `Color`
// CONTAINER with one TEXT item per color role. HAS CONCEPT MOD cannot be used: its target must be
// TEXT or CODE. Values are DICOM CIELab triples (`L\a\b`), since SR content items cannot carry
// RecommendedDisplayCIELabValue. Code values longer than 16 characters are written as
// LongCodeValue (PS3.3 8.1); readers accept either attribute.

import { sr as dcmjsSr } from 'dcmjs';
import _ from 'lodash';

import {
  dicomLabToHex,
  DISPLAY_ATTRIBUTE_COLOR,
  DISPLAY_COLOR_ROLES,
  getDisplayColor,
  hexToDicomLab,
} from '../../displayAttributes';
import { MeasurementApi } from '../../measurements/classes';
import { RelationshipType,SonadorCodeValues } from '../enums';

const { CodedConcept } = dcmjsSr.coding;
const { ContainerContentItem, TextContentItem } = dcmjsSr.valueTypes;
const { DCMSR_DISPLAY_ATTRIBUTES, DCMSR_DISPLAY_COLOR, DCMSR_DISPLAY_COLOR_ROLES } = SonadorCodeValues;

const CODE_VALUE_MAX_LENGTH = 16;

// Content items read from a naturalized dataset may hold single-item sequences as objects
const asArray = value => (_.isNil(value) ? [] : _.isArray(value) ? value : [value]);
const conceptValue = contentItem => {
  const concept = asArray(contentItem && contentItem.ConceptNameCodeSequence)[0];
  return concept && (concept.CodeValue || concept.LongCodeValue);
};
const findContentItem = (contentSequence, code) =>
  asArray(contentSequence).find(contentItem => conceptValue(contentItem) === code.value);


function conceptName(code) {
  const concept = new CodedConcept(code);
  if (concept.CodeValue.length > CODE_VALUE_MAX_LENGTH) {
    concept.LongCodeValue = concept.CodeValue;
    delete concept.CodeValue;
  }
  return concept;
}


function measurementDisplayAttributes(measurement) {
  const { measurementData, measurementMeta } = MeasurementApi._unpackMeasurementData(measurement);
  return measurement.displayAttributes || measurementData.displayAttributes || measurementMeta.displayAttributes;
}


function encodeDisplayAttributes(measurement, srItem) {
  const color = getDisplayColor({ displayAttributes: measurementDisplayAttributes(measurement) });
  const colorItems = DISPLAY_COLOR_ROLES.filter(role => color[role]).map(role => new TextContentItem({
    name: conceptName(DCMSR_DISPLAY_COLOR_ROLES[role]),
    value: hexToDicomLab(color[role]).join('\\'),
    relationshipType: RelationshipType.CONTAINS,
  }));

  if (!colorItems.length) {
    return srItem;
  }

  const colorContainer = new ContainerContentItem({
    name: conceptName(DCMSR_DISPLAY_COLOR),
    relationshipType: RelationshipType.CONTAINS,
  });
  colorContainer.ContentSequence = colorItems;

  const displayContainer = new ContainerContentItem({
    name: conceptName(DCMSR_DISPLAY_ATTRIBUTES),
    relationshipType: RelationshipType.CONTAINS,
  });
  displayContainer.ContentSequence = [colorContainer];

  srItem.ContentSequence = [...asArray(srItem.ContentSequence), displayContainer];
  return srItem;
}


function parseDisplayAttributes(srItem, annotation, options) {
  // An unreadable color is skipped; the finding and its other colors are kept. A container
  // without a Background item records no fill (see resolveFindingColor).
  options = options || {};
  _.defaults(options, { path: 'annotation.data.displayAttributes' });

  const srSeq = _.isArray(srItem) ? srItem : srItem && srItem.ContentSequence;
  const displayContainer = findContentItem(srSeq, DCMSR_DISPLAY_ATTRIBUTES);
  const colorContainer = displayContainer && findContentItem(displayContainer.ContentSequence, DCMSR_DISPLAY_COLOR);
  if (!colorContainer) {
    return annotation;
  }

  const color = {};
  DISPLAY_COLOR_ROLES.forEach(role => {
    const colorItem = findContentItem(colorContainer.ContentSequence, DCMSR_DISPLAY_COLOR_ROLES[role]);
    const hex = colorItem && dicomLabToHex(colorItem.TextValue);
    if (hex) {
      color[role] = hex;
    } else if (colorItem) {
      console.warn(`[DICOM-SR:parseDisplayAttributes] ignoring invalid ${role} color`, colorItem.TextValue);
    }
  });

  if (!_.isEmpty(color)) {
    _.set(annotation, options.path, { [DISPLAY_ATTRIBUTE_COLOR]: color });
  }
  return annotation;
}


export { encodeDisplayAttributes, parseDisplayAttributes };
