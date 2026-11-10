// "Filter annotations in imaging viewports" (an Annotations display setting, off by default and
// kept only while the table is mounted): while it is on and a search is active, the annotations
// the search leaves out are hidden in the views as well as the list. Only annotations that were
// shown are hidden, and each is shown again when it matches again, when the search is cleared or
// when the setting is turned off; an annotation the user hid stays hidden.

/**
 * The visibility changes that bring the views in line with the search.
 *
 * @param {object} params
 * @param {object[]} params.rows - every listed row ({ measurementId, isVisible })
 * @param {Set<string>} params.matching - the measurement ids the search keeps
 * @param {boolean} params.active - whether the search applies to the views (setting on, search active)
 * @param {Set<string>} params.hiddenBySearch - the ids hidden for the search so far
 * @returns {{ hide: string[], show: string[], hiddenBySearch: Set<string> }}
 */
function reconcileSearchVisibility({ rows, matching, active, hiddenBySearch }) {
  const byId = new Map((rows || []).map(row => [row.measurementId, row]));
  const hide = [];
  const show = [];
  const next = new Set();

  hiddenBySearch.forEach((id) => {
    if (!byId.has(id)) {
      return;
    }
    if (active && !matching.has(id)) {
      next.add(id);
    } else {
      show.push(id);
    }
  });

  if (active) {
    byId.forEach((row, id) => {
      if (!matching.has(id) && !next.has(id) && row.isVisible !== false) {
        hide.push(id);
        next.add(id);
      }
    });
  }

  return { hide, show, hiddenBySearch: next };
}

export default reconcileSearchVisibility;
export { reconcileSearchVisibility };
