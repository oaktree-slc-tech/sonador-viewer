// Build the Viewer Metadata picker's option list from the Standard Fields and the display
// attributes shared with the user by their groups.

import { normalizeTagCode, STANDARD_FIELDS, standardFieldCodes, tagFieldValue } from './index';

/**
 * Catalogue label for a tag code, from the normalised `/cache/dcm-tags` payload
 * (`{ Level: { code: { label, tag, ... } } }`).
 */
export function catalogueLabel(catalogue, code) {
  const hex = normalizeTagCode(code);
  if (!hex || !catalogue) {
    return null;
  }

  for (const level of Object.values(catalogue)) {
    for (const [key, entry] of Object.entries(level || {})) {
      if (normalizeTagCode(entry && entry.code) === hex || normalizeTagCode(key) === hex) {
        return (entry && (entry.label || entry.tag)) || null;
      }
    }
  }

  return null;
}

/**
 * Picker options for the shared display attributes of the aggregate response.
 *
 * An attribute whose code a Standard Field already renders, as its primary attribute or a
 * fallback, is omitted. Duplicate codes across groups are collapsed, first one wins.
 *
 * @param {object[]} attributes aggregate `tags` records: `{ Code, Tag, Label, Group }`
 * @param {object} [catalogue] normalised tag catalogue, for labels
 * @returns {{ title: string, value: string }[]}
 */
export function sharedAttributeOptions(attributes, catalogue) {
  const standardCodes = standardFieldCodes();
  const seen = new Set();
  const options = [];

  (attributes || []).forEach(tag => {
    const hex = normalizeTagCode(tag && tag.Code);
    if (!hex || standardCodes.has(hex) || seen.has(hex)) {
      return;
    }

    seen.add(hex);
    options.push({
      title: tag.Label || catalogueLabel(catalogue, hex) || tag.Tag || hex,
      value: tagFieldValue(hex),
    });
  });

  return options;
}

/**
 * The complete picker list: Standard Fields under a "Standard" heading, then the shared
 * attributes under a "Shared" heading when there are any. Headings are `{ heading }` entries.
 */
export function mergeOverlayFieldOptions(attributes, catalogue) {
  const standard = STANDARD_FIELDS.map(({ title, value }) => ({ title, value }));
  const shared = sharedAttributeOptions(attributes, catalogue);

  if (!shared.length) {
    return standard;
  }

  return [{ heading: 'Standard' }, ...standard, { heading: 'Shared' }, ...shared];
}
