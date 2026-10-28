// Undo record of a surface edit (ohif-viewers#142, FR-26 / AR-16): the segment's surface before
// and after, and the labelmap write that follows it in the background. It is pushed to
// Cornerstone3D's history when the surface is edited, so slice edits and surface edits undo in the
// order they were made.
//
// Undo puts the surface back; a write still pending is dropped, a write already made is reverted
// through its labelmap memo. Redo re-applies the surface and queues the write again (or re-applies
// the labelmap memo once the write has been made).

import { withOwnSurfaceWrite } from './ownWrites.js';

let counter = 0;

/** The labelmap writes a surface edit can ask for (the memo's `write.kind`). */
export const WRITE_KINDS = {
  // Clear the segment's voxels the edit moved outside (and within the removal depth)
  delete: 'delete',
  // Clear the voxels the surface moved out of and set the background voxels it moved over
  smooth: 'smooth',
  // The delta from the last synchronized surface (the checkpoint) to the current one, written
  // for every surface-only edit in between at once (ohif-viewers#152 §4): the same delta write
  // as a smooth's, between surfaces further apart
  sync: 'sync',
};

/**
 * @param {Object} params
 * @param {string} params.geometryId - the segment's surface in the geometry cache
 * @param {number} params.segmentIndex
 * @param {{ points, polys }} params.before
 * @param {{ points, polys }} params.after - empty arrays when the whole surface is gone
 * @param {{ min: number[], max: number[] }} params.editBox - world box the edit can affect
 * @param {{ kind: string, selectedPoints?: ArrayLike<number>, depth?: number }} [params.write] -
 *   the labelmap write the edit asks for (WRITE_KINDS); a delete carries the removed points and
 *   the removal depth
 * @param {ArrayLike<number>} [params.selectedPoints] - a delete's removed points, when no `write`
 *   is given
 * @param {number} [params.depth] - a delete's removal depth, when no `write` is given
 * @param {boolean} [params.keepSelection] - the edit keeps the surface's vertices (a smooth), so
 *   the canvas keeps its selection across it
 * @param {Object} params.labelmapVolume - the working labelmap volume at the time of the edit
 * @param {Object} params.deps
 * @param {Function} params.deps.setSurface - (geometryId, surface, { keepSelection }) => void:
 *   show a surface
 * @param {Function} params.deps.queueWrite - (memo) => void: queue the labelmap write
 * @param {Function} [params.deps.withOwnEdit] - (fn) => fn(): marks labelmap edits made for the
 *   surface, which must not rebuild it
 */
export function createSurfaceEditMemo({
  geometryId, segmentIndex, before, after, editBox, write, selectedPoints, depth, keepSelection = false,
  labelmapVolume, deps,
}) {
  const { setSurface, queueWrite, withOwnEdit = fn => fn() } = deps;
  counter += 1;
  const writeDescriptor = write || { kind: WRITE_KINDS.delete, selectedPoints, depth };

  const memo = {
    id: `surface-edit-${counter}`,
    operationType: 'surface',
    geometryId,
    segmentIndex,
    before,
    after,
    editBox,
    write: writeDescriptor,
    keepSelection,
    labelmapVolume,
    // The write queued for this edit while it is pending ({ cancelled })
    job: null,
    // The labelmap memo of the write once made
    labelmapMemo: null,
    // Set when the write was refused or failed: the surface edit stands, the labelmap is unchanged
    surfaceOnly: false,

    // Set by a synchronization record that covers this edit (createSurfaceSyncMemo): the record
    // moves the surface between the checkpoint and the synchronized surface as a whole, so this
    // edit's own undo and redo leave the surface alone (its voxels were never written)
    absorbedBy: null,

    restoreMemo(isUndo) {
      if (!memo.absorbedBy) {
        setSurface(geometryId, isUndo ? before : after, { keepSelection });
      }
      if (memo.labelmapMemo) {
        withOwnSurfaceWrite(() => withOwnEdit(() => memo.labelmapMemo.restoreMemo(isUndo)));
        return;
      }
      if (isUndo) {
        if (memo.job) {
          memo.job.cancelled = true;
          memo.job = null;
        }
      } else if (!memo.surfaceOnly) {
        queueWrite(memo);
      }
    },
  };
  return memo;
}

/**
 * Undo record of a synchronization (ohif-viewers#152 §4, §6, §7): the labelmap brought from the
 * last synchronized surface (the checkpoint) to the current surface in one bounded delta write,
 * covering the surface-only edits in between. The record is one transaction over both
 * representations: undo puts the surface back to the checkpoint and reverts the voxels written
 * (or drops the pending write), so surface and labelmap agree again and no unsynchronized surface
 * is left behind wherever Undo is pressed (another target, the Labelmap palette); redo shows the
 * synchronized surface again and re-applies the voxels (or queues the write again). The edits it
 * covers are absorbed (`absorbedBy`), a failed earlier record among them: below it in the history,
 * their own undo and redo no longer move the surface, so stepping past the record does not walk
 * the surface forward again, and redoing a failed record cannot revive its surface without its
 * voxels.
 *
 * It is recorded like a surface edit (recordSurfaceEdit): pushed to the history, then applied,
 * which queues its write. While the write is pending the covered edits count as synchronized;
 * a refused or failed write leaves them, and this record, unsynchronized (syncLedger); undoing
 * such a record likewise returns to the checkpoint, which the labelmap still reflects.
 *
 * @param {Object} params
 * @param {string} params.geometryId
 * @param {number} params.segmentIndex
 * @param {{ points, polys }} params.before - the checkpoint surface, which the labelmap reflects
 * @param {{ points, polys }} params.after - the current surface
 * @param {{ min: number[], max: number[] }} params.editBox - the accumulated affected region
 * @param {Object[]} params.covers - the surface-only memos this write brings to the labelmap
 * @param {Object|null} params.acknowledged - the findings the user acknowledged for a best-effort
 *   conversion (defect counts, proposed voxel counts, the reason), or null for the write that
 *   follows a repair whose result is closed
 * @param {Object} params.labelmapVolume
 * @param {Object} params.deps
 * @param {Function} params.deps.setSurface - (geometryId, surface, options) => void
 * @param {Function} params.deps.queueWrite - (memo) => Promise<boolean>
 * @param {Function} [params.deps.withOwnEdit]
 */
export function createSurfaceSyncMemo({
  geometryId, segmentIndex, before, after, editBox, covers = [], acknowledged = null, labelmapVolume, deps,
}) {
  const { setSurface, queueWrite, withOwnEdit = fn => fn() } = deps;
  counter += 1;

  const memo = {
    id: `surface-sync-${counter}`,
    operationType: 'surface',
    sync: true,
    geometryId,
    segmentIndex,
    before,
    after,
    editBox,
    covers,
    acknowledged,
    write: { kind: WRITE_KINDS.sync },
    keepSelection: true,
    labelmapVolume,
    job: null,
    labelmapMemo: null,
    surfaceOnly: false,
    // Set while the record is applied (not undone): a redo re-applies, a first apply queues
    inForce: false,
    // Set by a later synchronization record that covers this one (its write failed and a retry
    // took the surface over): see restoreMemo
    absorbedBy: null,

    restoreMemo(isUndo) {
      // Covered by a later synchronization record (a failed record that a retry absorbed): that
      // record moves the surface and the voxels; this one, below it in the history, moves nothing
      if (memo.absorbedBy) {
        memo.inForce = !isUndo;
        if (isUndo && memo.job) {
          memo.job.cancelled = true;
          memo.job = null;
        }
        return;
      }
      if (isUndo) {
        memo.inForce = false;
        setSurface?.(geometryId, before, { keepSelection: false });
        if (memo.labelmapMemo) {
          withOwnSurfaceWrite(() => withOwnEdit(() => memo.labelmapMemo.restoreMemo(true)));
        } else if (memo.job) {
          memo.job.cancelled = true;
          memo.job = null;
        }
        return;
      }
      if (memo.inForce) {
        return;
      }
      memo.inForce = true;
      setSurface?.(geometryId, after, { keepSelection: true });
      if (memo.labelmapMemo) {
        withOwnSurfaceWrite(() => withOwnEdit(() => memo.labelmapMemo.restoreMemo(false)));
      } else if (!memo.surfaceOnly) {
        queueWrite(memo);
      }
    },
  };
  covers.forEach(covered => {
    covered.absorbedBy = memo;
  });
  return memo;
}

/**
 * Whether replaying a history entry would put a 3D surface ahead of the labelmap (ohif-viewers
 * #152 §7, the no-hidden-draft rule): a surface-kind memo whose redo restores a surface without
 * a recorded voxel change. That is a surface-only edit, a refused or failed write, or a record
 * whose write was dropped by its undo and would be queued anew. A memo with its labelmap memo,
 * one whose write found nothing to change, and one absorbed by a synchronization record replay
 * coherently. A grouped entry (an array) needs the context when any of its items does.
 *
 * Such a replay is only coherent while the user is editing that surface in 3D, where the
 * ledger, the footer and the handoff account for it; the Redo command refuses it elsewhere.
 */
export function replayNeeds3DContext(entry) {
  if (Array.isArray(entry)) {
    return entry.some(replayNeeds3DContext);
  }
  return !!entry && entry.operationType === 'surface' && !entry.absorbedBy && !entry.labelmapMemo
    && entry.writeReport?.status !== 'nothing';
}

export default createSurfaceEditMemo;
