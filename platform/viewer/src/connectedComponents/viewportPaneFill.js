// Which viewport panes to (re)assign when the viewer's display sets change, and with what.
//
// An empty pane takes the next display set not shown yet. A pane that shows a display set in the
// classic (Cornerstone) viewport is assigned it again, so it picks up the display set's current
// state. A pane that shows one in another kind of viewport (an MPR pane, the 3D volume viewer,
// the segmentation editor) is left as it is: the study's display set carries the classic plugin,
// so assigning it again would turn that pane into a classic one inside the other view's layout
// (the MPR view's three panes, for example, became three classic viewports when a saved report
// was added to the study).

const CLASSIC = 'cornerstone';

/** The plugin a pane is shown with: its layout entry's, else its data's */
function panePlugin(layoutViewport, paneData) {
  const layoutPlugin = layoutViewport && (layoutViewport.plugin
    || Object.keys(layoutViewport).find(key => layoutViewport[key] && typeof layoutViewport[key] === 'object'));
  return layoutPlugin || (paneData && paneData.plugin) || CLASSIC;
}

/**
 * @param {object} params
 * @param {object[]} params.layoutViewports - the layout's viewport entries
 * @param {object} params.viewportSpecificData - the panes' data, by viewport index
 * @param {object[]} params.displaySets - the viewer's display sets
 * @returns {object[]} { viewportIndex, StudyInstanceUID, displaySetInstanceUID } for each pane to assign
 */
export default function panesToFill({ layoutViewports, viewportSpecificData, displaySets }) {
  if (!displaySets || !displaySets.length) {
    return [];
  }

  const shown = [];
  const assignments = [];
  (layoutViewports || []).forEach((layoutViewport, viewportIndex) => {
    const pane = viewportSpecificData[viewportIndex];
    if (pane && pane.StudyInstanceUID && pane.displaySetInstanceUID) {
      shown.push(pane.displaySetInstanceUID);
      if (panePlugin(layoutViewport, pane) === CLASSIC) {
        assignments.push({ viewportIndex, StudyInstanceUID: pane.StudyInstanceUID, displaySetInstanceUID: pane.displaySetInstanceUID });
      }
      return;
    }

    const next = displaySets.find(ds => !shown.includes(ds.displaySetInstanceUID)) || displaySets[displaySets.length - 1];
    if (next && next.StudyInstanceUID) {
      shown.push(next.displaySetInstanceUID);
      assignments.push({ viewportIndex, StudyInstanceUID: next.StudyInstanceUID, displaySetInstanceUID: next.displaySetInstanceUID });
    }
  });
  return assignments;
}

export { panesToFill, panePlugin };
