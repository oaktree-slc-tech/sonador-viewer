// The synchronization ledger of the 3D surfaces (ohif-viewers#152 §4, §6): which surface edits are
// in force on each surface, in apply order, which of them the 2D views have not received, and
// the checkpoint a synchronization starts from. It lives with the editor session, like the write
// queue and the shared history, not with the canvas: a canvas remounted by a layout change starts
// from this ledger, and a memo recorded by a departed canvas keeps reporting here through its undo
// and redo.
//
// While a memo in force is surface-only (a result with defects, a repair, a write that was
// refused or failed), the labelmap does not reflect the surface: a later write computed from that
// surface would voxelize an intermediate state. The canvas keeps later edits surface-only, and the
// writer refuses a queued write whose predecessors did not reach the labelmap (surfaceEdits).
//
// A synchronization record (surfaceEditMemo.createSurfaceSyncMemo) in force covers the memos
// before it: its write takes the labelmap from the checkpoint surface to the surface it was made
// on, so the edits in between no longer count, whether its write is pending or made. A
// synchronization whose write was refused or failed covers nothing.

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

/** Whether a memo's write was refused or failed (as opposed to never asked for). */
export function isFailedWriteMemo(memo) {
  const status = memo.writeReport?.status;
  return isUnsynchronizedMemo(memo) && (status === 'refused' || status === 'failed');
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

// The index after the last synchronization in force whose write was not refused or failed: the
// memos before it are covered by it
function _coverIndex(list) {
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].sync && !isUnsynchronizedMemo(list[i])) {
      return i + 1;
    }
  }
  return 0;
}

// The memos in force a synchronization has not covered
function _uncovered(list) {
  return list.slice(_coverIndex(list));
}

/** How many applied edits of a surface the 2D views have not received. */
export function unsynchronizedEdits(geometryId) {
  return _uncovered(memosInForce(geometryId)).filter(isUnsynchronizedMemo).length;
}

/**
 * The memos in force before `memo` on its surface that did not reach the labelmap: a write of
 * `memo` would then be computed from a surface the labelmap does not reflect. A synchronization
 * is computed from its checkpoint to cover exactly the memos it was made for (`covers`); any
 * other unsynchronized predecessor (a write that failed after it was prepared) blocks it too.
 */
export function unsynchronizedPredecessors(memo) {
  const list = memosInForce(memo.geometryId);
  const at = list.indexOf(memo);
  const before = at < 0 ? list : list.slice(0, at);
  const covered = memo.sync ? new Set(memo.covers || []) : null;
  return _uncovered(before).filter(entry => isUnsynchronizedMemo(entry) && !covered?.has(entry));
}

/** The smallest box holding every given box ({ min, max }); null without any. */
export function unionBoxes(boxes) {
  const valid = boxes.filter(box => box?.min && box?.max);
  if (!valid.length) {
    return null;
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  valid.forEach(box => {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], box.min[axis]);
      max[axis] = Math.max(max[axis], box.max[axis]);
    }
  });
  return { min, max };
}

/**
 * The checkpoint of a surface whose edits the 2D views have not received (ohif-viewers#152 §4):
 * the last surface the labelmap reflects (the surface before the first unsynchronized edit in
 * force), the edits since, and the region they affected together. Null while the surface is
 * synchronized. A write still pending counts as synchronized here; the handoff lets the queue
 * drain before it reads the checkpoint.
 *
 * @returns {{ surface: { points, polys }, memos: Object[], editBox: { min, max }|null,
 *   failed: number }|null}
 */
export function surfaceCheckpoint(geometryId) {
  const open = _uncovered(memosInForce(geometryId));
  const first = open.findIndex(isUnsynchronizedMemo);
  if (first < 0) {
    return null;
  }
  const memos = open.slice(first);
  return {
    surface: memos[0].before,
    memos,
    editBox: unionBoxes(memos.map(memo => memo.editBox)),
    failed: memos.filter(isFailedWriteMemo).length,
  };
}

/**
 * Every surface of the session whose 2D views are behind (ohif-viewers#152 handoff): the handoff
 * resolves all of them, not only the target's, so a surface left behind by a target change, an
 * undo or a whole-surface removal (which has no mesh any more) is never carried over silently.
 *
 * @returns {{ geometryId: string, segmentIndex: number, checkpoint: Object }[]} in ledger order
 */
export function unsynchronizedSurfaces() {
  const found = [];
  Array.from(_ledger.keys()).forEach(geometryId => {
    const list = memosInForce(geometryId);
    const checkpoint = list.length ? surfaceCheckpoint(geometryId) : null;
    if (checkpoint) {
      found.push({ geometryId, segmentIndex: list[list.length - 1].segmentIndex, checkpoint });
    }
  });
  return found;
}

/** Publish the counts for the segment the 3D tools act on. */
export function publishSyncLedger() {
  const segmentIndex = get3DToolState().target?.segmentIndex;
  let count = 0;
  let failed = 0;
  if (segmentIndex) {
    Array.from(_ledger.keys()).forEach(geometryId => {
      const list = memosInForce(geometryId);
      if (list.length && list[list.length - 1].segmentIndex === segmentIndex) {
        const open = _uncovered(list);
        count += open.filter(isUnsynchronizedMemo).length;
        failed += open.filter(isFailedWriteMemo).length;
      }
    });
  }
  set3DUnsynchronizedEdits(count, failed);
}
