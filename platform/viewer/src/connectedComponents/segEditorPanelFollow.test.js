// The right side panel following the Segmentation Editor

import { panelToOpenForEditor, rightPanelWithoutTab, SEG_EDITOR_CONTEXT } from './segEditorPanelFollow';

describe('panelToOpenForEditor', () => {
  it('opens the Segmentations panel when the editor becomes active and no right panel is open', () => {
    expect(panelToOpenForEditor({
      prevActiveContexts: ['VIEWER', 'ACTIVE_VIEWPORT::CORNERSTONE'],
      activeContexts: ['VIEWER', SEG_EDITOR_CONTEXT],
      isRightSidePanelOpen: false,
    })).toBe('segmentation-panel');
  });

  it('leaves an open right panel alone, and does nothing when the editor was already active or is not', () => {
    const editorNow = { prevActiveContexts: ['VIEWER'], activeContexts: ['VIEWER', SEG_EDITOR_CONTEXT] };
    expect(panelToOpenForEditor({ ...editorNow, isRightSidePanelOpen: true })).toBeNull();
    expect(panelToOpenForEditor({
      prevActiveContexts: ['VIEWER', SEG_EDITOR_CONTEXT], activeContexts: ['VIEWER', SEG_EDITOR_CONTEXT], isRightSidePanelOpen: false,
    })).toBeNull();
    expect(panelToOpenForEditor({
      prevActiveContexts: ['VIEWER'], activeContexts: ['VIEWER', 'ACTIVE_VIEWPORT::CORNERSTONE'], isRightSidePanelOpen: false,
    })).toBeNull();
  });
});

describe('rightPanelWithoutTab', () => {
  const options = [{ value: 'measurement-panel' }];

  it('names the open right panel whose tab is no longer offered', () => {
    expect(rightPanelWithoutTab({
      isRightSidePanelOpen: true, selectedRightSidePanel: 'segmentation-panel', isIssuesContentRightSidePanel: false, rightOptions: options,
    })).toBe('segmentation-panel');
  });

  it('leaves a panel with a tab, a closed panel and the Issues content alone', () => {
    expect(rightPanelWithoutTab({
      isRightSidePanelOpen: true, selectedRightSidePanel: 'measurement-panel', isIssuesContentRightSidePanel: false, rightOptions: options,
    })).toBeNull();
    expect(rightPanelWithoutTab({
      isRightSidePanelOpen: false, selectedRightSidePanel: 'segmentation-panel', isIssuesContentRightSidePanel: false, rightOptions: options,
    })).toBeNull();
    expect(rightPanelWithoutTab({
      isRightSidePanelOpen: true, selectedRightSidePanel: 'segmentation-panel', isIssuesContentRightSidePanel: true, rightOptions: options,
    })).toBeNull();
    expect(rightPanelWithoutTab({ isRightSidePanelOpen: true, selectedRightSidePanel: '', rightOptions: [] })).toBeNull();
  });
});
