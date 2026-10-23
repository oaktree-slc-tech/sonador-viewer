// The synchronization ledger of the 3D surfaces (ohif-viewers#152 §4, §6): which surface edits are
// in force on each surface, in apply order, and which of them the 2D views have not received. It
// lives with the editor session, like the write queue and the shared history, not with the
// canvas: a canvas remounted by a layout change starts from this ledger, and a memo recorded by a
// departed canvas keeps reporting here through its undo and redo.
//
// While a memo in force is surface-only (a result with defects, a repair, a write that was
// refused or failed), the labelmap does not reflect the surface: a later write computed from that
// surface would voxelize an intermediate state. The canvas keeps later edits surface-only, and the
// writer refuses a queued write whose predecessors did not reach the labelmap (surfaceEdits).

import { cache as c3dCache } from '@cornerstonejs/core';

import { get3DToolState, set3DUnsynchronizedEdits } from './threeDToolState.js';

const _defaultGetPoints = geometryId => c3dCache.getGeometry(geometryId)?.data?.points;

// geometryId -> the memos in force, in apply order
const _ledger = new Map();
let _getPoints = _defaultGetPoints;

/** Tests: read the current surface of a geometry from elsewhere than the geometry cache. */
export function configureSyncLedger({ getPoints } = {}) {
  _getPoints = getPoints || _defaultGetPoints;
}

/** Drop the ledger (the editor opened or closed; its history is dropped with it). */
export function resetSyncLedger() {
  _ledger.clear();
  set3DUnsynchronizedEdits(0);
}

/**
 * Whether a memo in force leaves the surface ahead of the labelmap: it was applied to the surface
 * alone, or its write was refused or failed. A write that found nothing to change is synchronized.
 */
export function isUnsynchronizedMemo(memo) {
  return !!memo.surfaceOnly && memo.writeReport?.status !== 'nothing';
}

function _note(memo, applied) {
  const list = _ledger.get(memo.geometryId) || [];
  const without = list.filter(entry => entry !== memo);
  _ledger.set(memo.geometryId, applied ? [...without, memo] : without);
}

/**
 * Follow a surface-edit memo through its apply, undo and redo. The ledger is brought in line
 * before the surface changes: the cache update inside the restore republishes the target, and the
 * ledger's last memo must then be the one whose result the cache holds (on undo, the previous).
 */
export function trackSurfaceEditMemo(memo) {
  if (memo._surfaceSyncTracked) {
    return memo;
  }
  memo._surfaceSyncTracked = true;
  const restore = memo.restoreMemo;
  memo.restoreMemo = isUndo => {
    _note(memo, !isUndo);
    restore(isUndo);
    publishSyncLedger();
  };
  return memo;
}

/**
 * The memos in force on a surface, in apply order. Once the surface no longer holds the last
 * memo's result (rebuilt from the labelmap by a slice edit or an import, or replaced), the
 * labelmap is the authority again and the ledger of that surface is dropped.
 */
export function memosInForce(geometryId) {
  const list = _ledger.get(geometryId);
  if (!list?.length) {
    return [];
  }
  if (list[list.length - 1].after.points !== _getPoints(geometryId)) {
    _ledger.delete(geometryId);
    return [];
  }
  return list;
}

/** How many applied edits of a surface the 2D views have not received. */
export function unsynchronizedEdits(geometryId) {
  return memosInForce(geometryId).filter(isUnsynchronizedMemo).length;
}

/**
 * The memos in force before `memo` on its surface that did not reach the labelmap: a write of
 * `memo` would then be computed from a surface the labelmap does not reflect.
 */
export function unsynchronizedPredecessors(memo) {
  const list = memosInForce(memo.geometryId);
  const at = list.indexOf(memo);
  return (at < 0 ? list : list.slice(0, at)).filter(isUnsynchronizedMemo);
}

/** Publish the count for the segment the 3D tools act on. */
export function publishSyncLedger() {
  const segmentIndex = get3DToolState().target?.segmentIndex;
  let count = 0;
  if (segmentIndex) {
    Array.from(_ledger.keys()).forEach(geometryId => {
      const list = memosInForce(geometryId);
      if (list.length && list[list.length - 1].segmentIndex === segmentIndex) {
        count += list.filter(isUnsynchronizedMemo).length;
      }
    });
  }
  set3DUnsynchronizedEdits(count);
}
