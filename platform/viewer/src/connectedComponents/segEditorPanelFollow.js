// How the right side panel follows the Segmentation Editor (the decisions ToolbarRow applies):
//
// - the editor cannot be used without the Segmentations panel, so when the editor's context
//   becomes active and no right panel is showing, that panel is opened. A panel the user already
//   has open is left alone;
// - a right panel whose tab is no longer offered (the Segmentations panel once the editor closes
//   on a study without SEG or model series) closes with its tab. The Issues content is not a
//   tab and is never closed this way.

export const SEG_EDITOR_CONTEXT = 'ACTIVE_VIEWPORT::SONADOR3DSEG';
export const SEGMENTATION_PANEL = 'segmentation-panel';

/**
 * @param {Object} params
 * @param {string[]} params.prevActiveContexts
 * @param {string[]} params.activeContexts
 * @param {boolean} params.isRightSidePanelOpen
 * @returns {string|null} the panel to open on the right, or null
 */
export function panelToOpenForEditor({ prevActiveContexts = [], activeContexts = [], isRightSidePanelOpen }) {
  const opened = activeContexts.includes(SEG_EDITOR_CONTEXT) && !prevActiveContexts.includes(SEG_EDITOR_CONTEXT);
  return opened && !isRightSidePanelOpen ? SEGMENTATION_PANEL : null;
}

/**
 * @param {Object} params
 * @param {boolean} params.isRightSidePanelOpen
 * @param {string} params.selectedRightSidePanel
 * @param {boolean} params.isIssuesContentRightSidePanel
 * @param {Array<{ value: string }>} params.rightOptions - the right tabs offered
 * @returns {string|null} the open right panel whose tab is gone, or null
 */
export function rightPanelWithoutTab({
  isRightSidePanelOpen, selectedRightSidePanel, isIssuesContentRightSidePanel, rightOptions = [],
}) {
  if (!isRightSidePanelOpen || isIssuesContentRightSidePanel || !selectedRightSidePanel) {
    return null;
  }
  return rightOptions.some(option => option.value === selectedRightSidePanel) ? null : selectedRightSidePanel;
}
