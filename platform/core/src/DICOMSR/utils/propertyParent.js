// The item that carries a measurement's properties (description, text, location, view, source
// series, drawing plane and the display attributes). Length, Angle and Cobb angle write them as
// `HAS PROPERTIES` children of their NUM item, and the circle's are read from its NUM; tools with a
// Finding write them under the Finding; a group with neither keeps them at group level. Readers of a
// NUM-parent tool look under its NUM, then at the group-level items of files written in the legacy
// layout; a Finding in its group keeps its own children and is never read for the measurement's
// properties. Readers of other tools look under the Finding, then at the group-level items. A group
// with several NUMs (a circle: Area, Perimeter, Radius) takes the typed properties from the first
// NUM in document order that carries any of them; so does a Bidirectional (Long Axis, Short Axis). One
// NUM is chosen for all of them, the colours included.

import { ANGLE_TOOLS } from './angleGeometry';
import { CIRCLE_TOOLS } from './circleGeometry';
import { BIDIRECTIONAL_TOOL } from './bidirectionalGeometry';
import {
  DCMSR_MEASUREMENT_DESCRIPTION, DCMSR_MEASUREMENT_DRAWING_PLANE, DCMSR_MEASUREMENT_LOCATION, DCMSR_MEASUREMENT_SOURCE_SERIES,
  DCMSR_MEASUREMENT_TEXT, DCMSR_MEASUREMENT_VIEW, DCMSR_DISPLAY_ATTRIBUTES, DCMSR_DISPLAY_COLOR, DCMSR_DISPLAY_COLOR_ROLES,
  PROPERTY_PARENT, RelationshipType,
} from '../enums';
import { asArray, conceptNameValue, findingItemOf } from './codedConcept';

const NUM_PARENT_TOOLS = [...ANGLE_TOOLS, 'Length', ...CIRCLE_TOOLS, BIDIRECTIONAL_TOOL];

// The codes of the typed properties, the display colours included (nested container or flat role items)
const TYPED_PROPERTY_CODES = [
  DCMSR_MEASUREMENT_DESCRIPTION, DCMSR_MEASUREMENT_TEXT, DCMSR_MEASUREMENT_LOCATION, DCMSR_MEASUREMENT_VIEW,
  DCMSR_MEASUREMENT_SOURCE_SERIES, DCMSR_MEASUREMENT_DRAWING_PLANE, DCMSR_DISPLAY_ATTRIBUTES, DCMSR_DISPLAY_COLOR,
  ...Object.values(DCMSR_DISPLAY_COLOR_ROLES),
].map(code => code.value);

const propertyParentOf = toolType =>
  (NUM_PARENT_TOOLS.includes(toolType) ? PROPERTY_PARENT.NUM : PROPERTY_PARENT.FINDING);

const numItemsOf = group => asArray(group && group.ContentSequence).filter(item => item.ValueType === 'NUM');


/**
 * The item a writer appends properties to, with the relationship they take: the NUM item for the
 * NUM parent, otherwise the Finding, otherwise the group itself (`HAS CONCEPT MOD`).
 */
function propertyCarrier(group, parent) {
  const num = parent === PROPERTY_PARENT.NUM ? numItemsOf(group)[0] : undefined;
  const carrier = num || findingItemOf(group);
  return carrier
    ? { item: carrier, nested: true, relationshipType: RelationshipType.HAS_PROPERTIES }
    : { item: group, nested: false, relationshipType: RelationshipType.CONCEPT_MOD };
}


/**
 * The NUM a reader takes every typed property from: the first NUM in document order that carries any
 * of them (TYPED_PROPERTY_CODES), else the first NUM; undefined without a NUM. Readers of all the
 * typed properties (text, view, plane, colours) use the same one.
 */
function propertyNumOf(groupItems) {
  const nums = numItemsOf({ ContentSequence: asArray(groupItems) });
  return nums.find(num => asArray(num.ContentSequence).some(item => TYPED_PROPERTY_CODES.includes(conceptNameValue(item))))
    || nums[0];
}

/**
 * The items a reader searches for properties, in order of precedence. For the NUM parent of a group
 * with a NUM: the children of its property NUM (`propertyNumOf`), then the group-level items; a
 * Finding's children belong to the Finding and are not read. Otherwise the Finding's children, then
 * the group-level items.
 */
function propertyCandidates(groupItems, parent) {
  const group = { ContentSequence: asArray(groupItems) };
  const num = parent === PROPERTY_PARENT.NUM ? propertyNumOf(groupItems) : undefined;
  if (num) {
    return [...asArray(num.ContentSequence), ...group.ContentSequence];
  }
  const finding = findingItemOf(group);
  return [...asArray(finding && finding.ContentSequence), ...group.ContentSequence];
}


export { NUM_PARENT_TOOLS, numItemsOf, propertyCandidates, propertyCarrier, propertyNumOf, propertyParentOf };
