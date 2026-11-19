// "Filter annotations in imaging viewports" (an Annotations display setting, off by default and
// kept only while the table is mounted): while it is on and a search is active, the annotations
// the search leaves out are hidden in the views as well as the list. The search is one reason of
// the session's visibility rule (core DICOMSR/utils/annotationVisibility.js): this reports which
// rows it leaves out, and the rule decides what is drawn with the user's own choices and the
// active timepoint, so an annotation the user hid stays hidden when the search clears.

/**
 * The rows the search hides in the views.
 *
 * @param {object} params
 * @param {object[]} params.rows - every listed row ({ measurementId })
 * @param {Set<string>} params.matching - the measurement ids the search keeps
 * @param {boolean} params.active - whether the search applies to the views (setting on, search active)
 * @returns {{ hiddenBySearch: Set<string> }}
 */
function reconcileSearchVisibility({ rows, matching, active }) {
  const hiddenBySearch = new Set();
  if (active) {
    (rows || []).forEach((row) => {
      if (row && row.measurementId && !matching.has(row.measurementId)) {
        hiddenBySearch.add(row.measurementId);
      }
    });
  }
  return { hiddenBySearch };
}

export default reconcileSearchVisibility;
export { reconcileSearchVisibility };
