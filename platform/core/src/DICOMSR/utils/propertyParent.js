// The item that carries a measurement's properties (description, text, location, view, source
// series, drawing plane and the display attributes). Length, Angle and Cobb angle write them as
// `HAS PROPERTIES` children of their NUM item, and the circle's are read from its NUM; tools with a
// Finding write them under the Finding; a group with neither keeps them at group level. Readers of a
// NUM-parent tool look under its NUM, then at the group-level items of files written in the legacy
// layout; a Finding in its group keeps its own children and is never read for the measurement's
// properties. Readers of other tools look under the Finding, then at the group-level items. A group
// with several NUMs (a circle: Area, Perimeter, Radius) takes the typed properties from the first
// NUM in document order that carries any of them.

import { ANGLE_TOOLS } from './angleGeometry';
import { CIRCLE_TOOLS } from './circleGeometry';
import { PROPERTY_PARENT, RelationshipType } from '../enums';
import { asArray, conceptNameValue, findingItemOf } from './codedConcept';

const NUM_PARENT_TOOLS = [...ANGLE_TOOLS, 'Length', ...CIRCLE_TOOLS];

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
 * The items a reader searches for properties, in order of precedence. For the NUM parent of a group
 * with a NUM: the children of the first NUM carrying any of `codes` (the first NUM when none does),
 * then the group-level items; a Finding's children belong to the Finding and are not read. Otherwise
 * the Finding's children, then the group-level items.
 */
function propertyCandidates(groupItems, parent, codes) {
  const group = { ContentSequence: asArray(groupItems) };
  const nums = parent === PROPERTY_PARENT.NUM ? numItemsOf(group) : [];
  if (nums.length) {
    const carrying = nums.find(num => asArray(num.ContentSequence)
      .some(item => (codes || []).includes(conceptNameValue(item))));
    return [...asArray((carrying || nums[0]).ContentSequence), ...group.ContentSequence];
  }
  const finding = findingItemOf(group);
  return [...asArray(finding && finding.ContentSequence), ...group.ContentSequence];
}


export { NUM_PARENT_TOOLS, numItemsOf, propertyCandidates, propertyCarrier, propertyParentOf };
