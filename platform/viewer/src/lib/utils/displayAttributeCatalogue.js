// Searchable rows for the Display Attributes editor, built from the normalised `/cache/dcm-tags` payload.

import { normalizeTagCode } from '@ohif/core/src/utils/overlayFields';

export const SEARCH_LIMIT = 40;

/**
 * One row per tag code across every resource level, sorted by label.
 *
 * @param {object} catalogue `{ Level: { code: { code, tag, label, private } } }`
 * @param {Set<string>} [exclude] normalised codes to leave out, e.g. the ones Standard Fields render
 * @returns {{ code: string, display: string, keyword: string, label: string, private: boolean }[]}
 */
export function catalogueRows(catalogue, exclude) {
  const rows = new Map();

  Object.values(catalogue || {}).forEach(level => {
    Object.entries(level || {}).forEach(([key, entry]) => {
      const code = normalizeTagCode((entry && entry.code) || key);
      if (!code || rows.has(code) || (exclude && exclude.has(code))) {
        return;
      }

      rows.set(code, {
        code,
        display: `${code.slice(0, 4)},${code.slice(4)}`,
        keyword: (entry && entry.tag) || '',
        label: (entry && (entry.label || entry.tag)) || code,
        private: !!(entry && entry.private),
      });
    });
  });

  return Array.from(rows.values()).sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Rows whose label, keyword or code contains the term; the first `limit` rows when it is empty.
 */
export function searchCatalogue(rows, term, limit = SEARCH_LIMIT) {
  const needle = (term || '').trim().toLowerCase().replace(/[\s(),]/g, '');
  if (!needle) {
    return rows.slice(0, limit);
  }

  return rows
    .filter(
      row =>
        row.label.toLowerCase().replace(/\s/g, '').includes(needle) ||
        row.keyword.toLowerCase().includes(needle) ||
        row.code.toLowerCase().includes(needle)
    )
    .slice(0, limit);
}
