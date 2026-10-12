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

    restoreMemo(isUndo) {
      setSurface(geometryId, isUndo ? before : after, { keepSelection });
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

export default createSurfaceEditMemo;
