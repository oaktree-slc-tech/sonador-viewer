// DICOM-SR encoding of display attributes, kept apart from the extended meta attributes
// (dcmsrExtendedMeta.js): they describe how a measurement is rendered, not what it records.
//
// The colours are properties of the measurement and are written as children of its property
// parent (propertyParent.js: the NUM item for Angle and Cobb angle, the Finding otherwise), in the
// form of the document class:
// * nested (Comprehensive 3D SR, the default): the parent HAS PROPERTIES a display attributes
//   CONTAINER, which CONTAINS a `Color` CONTAINER with one TEXT item per color role;
// * flat (Enhanced SR, which permits no CONTAINER under a CODE or NUM item): the role TEXT items
//   are HAS PROPERTIES children of the parent, named by their dotted concept names.
// A group with no parent item keeps the group-level CONTAINS container. Readers accept all three
// layouts, including the group-level container of files written before the colours moved.
// Values are DICOM CIELab triples (`L\a\b`), since SR content items cannot carry
// RecommendedDisplayCIELabValue. Codes are built by codedConcept.js, which selects the value
// attribute; readers accept any of the three.

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
import { DISPLAY_LAYOUT, PROPERTY_PARENT, RelationshipType, SonadorCodeValues } from '../enums';
import { asArray, codedConcept, conceptNameValue, findingItemOf } from './codedConcept';
import { numItemsOf, propertyCarrier } from './propertyParent';

const { ContainerContentItem, TextContentItem } = dcmjsSr.valueTypes;
const { DCMSR_DISPLAY_ATTRIBUTES, DCMSR_DISPLAY_COLOR, DCMSR_DISPLAY_COLOR_ROLES } = SonadorCodeValues;

const findContentItem = (contentSequence, code) =>
  asArray(contentSequence).find(contentItem => conceptNameValue(contentItem) === code.value);


function measurementDisplayAttributes(measurement) {
  const { measurementData, measurementMeta } = MeasurementApi._unpackMeasurementData(measurement);
  return measurement.displayAttributes || measurementData.displayAttributes || measurementMeta.displayAttributes;
}


function encodeDisplayAttributes(measurement, srItem, options) {
  // @input options.layout ('nested' | 'flat', default 'nested'): form of the colours under the
  //   parent, chosen by the class of the document being written
  // @input options.propertyParent ('finding' | 'num', default 'finding'): item the colours are
  //   written under (propertyParent.js)
  const layout = (options && options.layout) || DISPLAY_LAYOUT.NESTED;
  const { item: carrier, nested } = propertyCarrier(srItem, options && options.propertyParent);
  const parentItem = nested ? carrier : undefined;
  const color = getDisplayColor({ displayAttributes: measurementDisplayAttributes(measurement) });
  const roles = DISPLAY_COLOR_ROLES.filter(role => color[role]);
  if (!roles.length) {
    return srItem;
  }

  const colorItems = relationshipType => roles.map(role => new TextContentItem({
    name: codedConcept(DCMSR_DISPLAY_COLOR_ROLES[role]),
    value: hexToDicomLab(color[role]).join('\\'),
    relationshipType,
  }));

  let items;
  if (parentItem && layout === DISPLAY_LAYOUT.FLAT) {
    items = colorItems(RelationshipType.HAS_PROPERTIES);
  } else {
    const colorContainer = new ContainerContentItem({
      name: codedConcept(DCMSR_DISPLAY_COLOR),
      relationshipType: RelationshipType.CONTAINS,
    });
    colorContainer.ContentSequence = colorItems(RelationshipType.CONTAINS);

    const displayContainer = new ContainerContentItem({
      name: codedConcept(DCMSR_DISPLAY_ATTRIBUTES),
      relationshipType: parentItem ? RelationshipType.HAS_PROPERTIES : RelationshipType.CONTAINS,
    });
    displayContainer.ContentSequence = [colorContainer];
    items = [displayContainer];
  }

  const parent = parentItem || srItem;
  parent.ContentSequence = [...asArray(parent.ContentSequence), ...items];
  return srItem;
}


function parseDisplayAttributes(srItem, annotation, options) {
  // An unreadable color is skipped; the finding and its other colors are kept. A container
  // without a Background item records no fill (see resolveFindingColor).
  options = options || {};
  _.defaults(options, { path: 'annotation.data.displayAttributes' });

  // Nested or flat under the property parent (the NUM item first, for the NUM parent), then under
  // the Finding, or the group-level container (legacy)
  const groupItems = asArray(_.isArray(srItem) ? srItem : srItem && srItem.ContentSequence);
  const group = { ContentSequence: groupItems };
  const finding = findingItemOf(group);
  const hasColours = items => !!findContentItem(items, DCMSR_DISPLAY_ATTRIBUTES)
    || DISPLAY_COLOR_ROLES.some(role => findContentItem(items, DCMSR_DISPLAY_COLOR_ROLES[role]));
  const numItems = options.propertyParent === PROPERTY_PARENT.NUM
    ? asArray((numItemsOf(group).find(num => hasColours(asArray(num.ContentSequence))) || {}).ContentSequence)
    : [];
  const parentItems = numItems.length ? numItems : asArray(finding && finding.ContentSequence);
  const displayContainer = findContentItem(parentItems, DCMSR_DISPLAY_ATTRIBUTES)
    || findContentItem(groupItems, DCMSR_DISPLAY_ATTRIBUTES);
  const colorContainer = displayContainer && findContentItem(displayContainer.ContentSequence, DCMSR_DISPLAY_COLOR);
  const roleItems = colorContainer ? colorContainer.ContentSequence : parentItems;
  if (!colorContainer && !DISPLAY_COLOR_ROLES.some(role => findContentItem(roleItems, DCMSR_DISPLAY_COLOR_ROLES[role]))) {
    return annotation;
  }

  const color = {};
  DISPLAY_COLOR_ROLES.forEach(role => {
    const colorItem = findContentItem(roleItems, DCMSR_DISPLAY_COLOR_ROLES[role]);
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


export { DISPLAY_LAYOUT, encodeDisplayAttributes, parseDisplayAttributes };
