// The item that carries a measurement's properties (description, text, location, view and the
// display attributes). Angle and Cobb angle write them as `HAS PROPERTIES` children of their NUM
// item; tools with a Finding write them under the Finding; a group with neither keeps them at group
// level. Readers look under the tool's parent first, then fall back to the Finding and to the
// group-level items of files written in the legacy layout.

import { ANGLE_TOOLS } from './angleGeometry';
import { PROPERTY_PARENT, RelationshipType } from '../enums';
import { asArray, conceptNameValue, findingItemOf } from './codedConcept';

const NUM_PARENT_TOOLS = ANGLE_TOOLS;

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
 * The items a reader searches for properties, in order of precedence. For the NUM parent: the
 * children of the first NUM carrying any of `codes` (the first NUM when none does), then the
 * Finding's children, then the group-level items.
 */
function propertyCandidates(groupItems, parent, codes) {
  const group = { ContentSequence: asArray(groupItems) };
  const finding = findingItemOf(group);
  let numItems = [];
  if (parent === PROPERTY_PARENT.NUM) {
    const nums = numItemsOf(group);
    const carrying = nums.find(num => asArray(num.ContentSequence)
      .some(item => (codes || []).includes(conceptNameValue(item))));
    numItems = asArray((carrying || nums[0] || {}).ContentSequence);
  }
  return [...numItems, ...asArray(finding && finding.ContentSequence), ...group.ContentSequence];
}


export { numItemsOf, propertyCandidates, propertyCarrier, propertyParentOf };
