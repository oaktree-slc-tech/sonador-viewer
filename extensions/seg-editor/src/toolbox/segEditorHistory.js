// Undo / redo for the Segmentation Editor (ohif-viewers#142 FR-10, FR-22): Cornerstone3D's shared
// history (DefaultHistoryMemo), which the labelmap tools (brush, eraser, threshold, shapes) and the
// 3D Selection tool's delete record their edits in -- the same history OHIF v3's undo/redo
// commands drive.
//
// The history holds references to the labelmaps it restores, so it must not outlive an editor
// session: it is cleared when the editor opens and when it closes, and a closed session's edits
// cannot be replayed into the next one.
//
// The history is a ring (50 entries by default): an edit recorded while it is full drops the
// oldest, which can then never be undone. While a session is tracked, that is noted, so that "is
// there anything to lose?" (commandsModule's workingCopyHasChanges) does not take an empty undo
// stack to mean an unchanged segmentation.

import { utilities as c3dUtilities } from '@cornerstonejs/core';

function _history() {
  return c3dUtilities.HistoryMemo.DefaultHistoryMemo;
}

// Per history: { dropped, restore } while tracked
const _tracking = new WeakMap();

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

/**
 * The newest entries of the history that Undo would reach, newest first, without undoing them
 * (HistoryMemo keeps a ring indexed by `position`; a grouped entry is returned as its array). The
 * 3D tools' Discard (ohif-viewers#152) checks that the entries it is about to undo are exactly
 * the surface's unsynchronized edits before it touches the history.
 *
 * @param {number} count
 * @returns {Array} at most `count` entries, fewer when less can be undone
 */
export function peekSegEditorHistory(count, history = _history()) {
  const items = [];
  const available = Math.min(count, history?.undoAvailable || 0);
  const ring = history?.ring || [];
  const size = history?.size || ring.length || 1;
  for (let i = 0; i < available; i++) {
    items.push(ring[(history.position - i + size * (i + 1)) % size]);
  }
  return items;
}

/**
 * The entry Redo would replay next, without replaying it (null when there is none, or when the
 * history does not expose its ring). A grouped entry is returned as its array.
 */
export function peekSegEditorRedo(history = _history()) {
  if (!history || !(history.redoAvailable > 0) || !history.ring) {
    return null;
  }
  const size = history.size || history.ring.length || 1;
  return history.ring[(history.position + 1) % size] ?? null;
}

/** Drop every recorded edit (HistoryMemo has no clear(); resizing resets its ring). */
export function clearSegEditorHistory(history = _history()) {
  const { size } = history;
  history.size = size;
  const tracking = _tracking.get(history);
  if (tracking) {
    tracking.dropped = false;
  }
}

/**
 * Note, for an editor session, when the history drops an edit off its ring. HistoryMemo has no
 * event for it, so its two recording methods are wrapped on the instance (the class's own methods
 * are untouched, and the wrappers are removed by the returned function).
 *
 * @returns {Function} stop tracking
 */
export function trackSegEditorHistory(history = _history()) {
  if (!history || _tracking.has(history)) {
    return () => {};
  }
  const tracking = { dropped: false };
  const own = name => Object.prototype.hasOwnProperty.call(history, name) && history[name];
  const originals = { push: own('push'), initializeGroupItem: own('initializeGroupItem') };
  const { push, initializeGroupItem } = history;
  // A full ring overwrites its oldest entry when an entry is added (a grouped memo joins the
  // current entry instead)
  const full = () => history.undoAvailable >= history.size;

  history.push = function trackedPush(item) {
    const dropping = !this.isRecordingGrouped && full();
    const memo = push.call(this, item);
    if (dropping && memo) {
      tracking.dropped = true;
    }
    return memo;
  };
  history.initializeGroupItem = function trackedInitializeGroupItem(...args) {
    if (full()) {
      tracking.dropped = true;
    }
    return initializeGroupItem.apply(this, args);
  };

  tracking.restore = () => {
    Object.entries(originals).forEach(([name, original]) => {
      if (original) {
        history[name] = original;
      } else {
        delete history[name];
      }
    });
    _tracking.delete(history);
  };
  _tracking.set(history, tracking);
  return tracking.restore;
}

/** Whether a tracked session's history has dropped an edit, which can no longer be undone. */
export function segEditorHistoryDroppedEdits(history = _history()) {
  return !!_tracking.get(history)?.dropped;
}
