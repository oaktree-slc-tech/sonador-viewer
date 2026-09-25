// Undo / redo for the Segmentation Editor (ohif-viewers#142 FR-10, FR-22): Cornerstone3D's shared
// history (DefaultHistoryMemo), which the labelmap tools (brush, eraser, threshold, shapes) and the
// 3D Selection tool's delete record their edits in -- the same history OHIF v3's undo/redo
// commands drive.
//
// The history holds references to the labelmaps it restores, so it must not outlive an editor
// session: it is cleared when the editor opens and when it closes, and a closed session's edits
// cannot be replayed into the next one.

import { utilities as c3dUtilities } from '@cornerstonejs/core';

function _history() {
  return c3dUtilities.HistoryMemo.DefaultHistoryMemo;
}

export function undoSegEditorEdit(history = _history()) {
  if (history.canUndo) {
    history.undo();
    return true;
  }
  return false;
}

export function redoSegEditorEdit(history = _history()) {
  if (history.canRedo) {
    history.redo();
    return true;
  }
  return false;
}

/** Drop every recorded edit (HistoryMemo has no clear(); resizing resets its ring). */
export function clearSegEditorHistory(history = _history()) {
  const { size } = history;
  history.size = size;
}
