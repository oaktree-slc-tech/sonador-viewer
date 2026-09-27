// The image reference of an SR content item or of a whole measurement group. dcmjs naturalizes a
// one-item sequence as an object and a longer one as an array, and a group merged across several
// measurement groups (same tracking UID) may carry its reference on any of its items.

const toArray = sequence => (!sequence ? [] : Array.isArray(sequence) ? sequence : [sequence]);

/** The first ReferencedSOPSequence item under a content item (its own, or one of its children's) */
export function findReferencedSOPSequence(contentItem) {
  if (!contentItem) {
    return undefined;
  }
  const own = toArray(contentItem.ReferencedSOPSequence)[0];
  if (own) {
    return own;
  }
  for (const child of toArray(contentItem.ContentSequence)) {
    const reference = toArray(child.ReferencedSOPSequence)[0];
    if (reference) {
      return reference;
    }
  }
  return undefined;
}

/**
 * The first image reference found across `contentItems`, preferring the items that pass
 * `preferred` (e.g. the finding items). Returns { ReferencedSOPSequence, ReferencedSOPInstanceUID,
 * ReferencedFrameNumber } or undefined.
 */
export function findReferencedSOP(contentItems, preferred = () => false) {
  const items = toArray(contentItems);
  const ordered = [...items.filter(preferred), ...items.filter(item => !preferred(item))];

  for (const item of ordered) {
    const ReferencedSOPSequence = findReferencedSOPSequence(item);
    if (ReferencedSOPSequence?.ReferencedSOPInstanceUID) {
      const { ReferencedSOPInstanceUID, ReferencedFrameNumber } = ReferencedSOPSequence;
      return { ReferencedSOPSequence, ReferencedSOPInstanceUID, ReferencedFrameNumber };
    }
  }
  return undefined;
}

export default findReferencedSOP;
