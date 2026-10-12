// Surface edits of the Segmentation Editor's 3D tools (ohif-viewers#142, FR-23..FR-26): showing an
// edited surface, recording the edit, and the queue of labelmap writes that follow.
//
// The segment's surface in the Cornerstone3D geometry cache is what the editing canvas and the VTK
// 3D view both show, so an edit is applied there: the canvas is asked to rebuild its mesh, and the
// VTK view re-renders the geometry on its next segmentation render. Nothing here marks the vol3d
// labelmap modified, which would rebuild every surface from it.
//
// Writes run one after another, in edit order, so each sees the voxels the ones before it wrote.
// The queue outlives the canvas (a layout change remounts it) and is cancelled when the editor
// closes.

import { cache as c3dCache, utilities as c3dUtilities } from '@cornerstonejs/core';
import {
  segmentation as c3dSegmentations,
  utilities as c3dToolsUtilities,
} from '@cornerstonejs/tools';

import { editIndexBox } from './deleteSelection.js';
import { extractIndexBox } from './labelmapCarve.js';
import { withOwnSurfaceWrite } from './ownWrites.js';
import { applyLabelmapEdit, carveInWorker, deltaInWorker, getLabelmapForEdit } from './segmentEdits.js';
import { refreshSurfaceActors } from './surfaceActors.js';
import { WRITE_KINDS } from './surfaceEditMemo.js';
import { adjustPendingWrites, request3DToolAction } from './threeDToolState.js';


/** Request the canvas answers after a surface it shows changed in the cache. */
export const SURFACE_CHANGED_REQUEST = 'surfaceChanged';

/** Thrown by a write whose target became invalid before it could be made. */
export class WriteRefusedError extends Error {
  constructor(message = 'The labelmap write was refused') {
    super(message);
    this.name = 'WriteRefusedError';
  }
}

let chain = Promise.resolve();
// The queued and running jobs ({ memo, cancelled }), each counted once
const pending = new Set();

/**
 * Show a surface for a segment: write it to the geometry cache, push it into the VTK actors that
 * show it, rebuild the canvas mesh, and re-render the VTK view.
 *
 * @param {string} segmentationId - the vol3d segmentation the surface belongs to
 * @param {string} geometryId
 * @param {{ points, polys }} surface
 * @param {Object} [deps]
 * @param {boolean} [deps.keepSelection] - the surface keeps its vertices (a smooth), so the canvas
 *   keeps its selection and moves the highlight
 */
export function setCachedSurface(segmentationId, geometryId, surface, deps = {}) {
  const {
    keepSelection = false,
    getGeometry = id => c3dCache.getGeometry(id),
    refreshActors = (segId, geomId, next) => refreshSurfaceActors(segId, geomId, next),
    renderSegmentation = id => c3dToolsUtilities.segmentation.triggerSegmentationRenderBySegmentationId(id),
    notifyCanvas = () => request3DToolAction(SURFACE_CHANGED_REQUEST, { geometryId, keepSelection }),
  } = deps;
  const geometry = getGeometry(geometryId);
  if (!geometry?.data) {
    return false;
  }
  geometry.data.points = surface.points;
  geometry.data.polys = surface.polys;
  // The display replaces an actor's polydata only when the array lengths change; a surface that
  // kept its vertices is pushed into the actors here
  try {
    refreshActors(segmentationId, geometryId, surface);
  } catch (error) {
    console.error('[SegEditor] the VTK surface actors could not be refreshed', error);
  }
  notifyCanvas();
  renderSegmentation(segmentationId);
  return true;
}

/**
 * Record a surface edit in the shared undo history and apply it (the surface is shown and its
 * labelmap write queued, as a redo would).
 */
export function recordSurfaceEdit(memo, history = c3dUtilities.HistoryMemo.DefaultHistoryMemo) {
  history.push(memo);
  memo.restoreMemo(false);
}

/**
 * The voxels a write may still touch, checked against the labelmap as it is now: a removal must
 * still belong to the edit's segment, an addition must still be background. The worker classified
 * a snapshot of the box; a slice edit, an import or another segment's write may have changed
 * those voxels since, and neither may be undone or overrun by this write.
 *
 * @param {{ remove: Int32Array, add: Int32Array }} delta - linear labelmap indices
 * @param {ArrayLike<number>} scalarData - the labelmap now
 * @param {number} segmentIndex
 * @returns {{ remove: Int32Array, add: Int32Array, dropped: number }}
 */
export function ownedDelta({ remove, add }, scalarData, segmentIndex) {
  const keptRemove = [];
  const keptAdd = [];
  remove.forEach(index => {
    if (scalarData[index] === segmentIndex) {
      keptRemove.push(index);
    }
  });
  add.forEach(index => {
    if (scalarData[index] === 0) {
      keptAdd.push(index);
    }
  });
  return {
    remove: Int32Array.from(keptRemove),
    add: Int32Array.from(keptAdd),
    dropped: remove.length - keptRemove.length + add.length - keptAdd.length,
  };
}

/**
 * The labelmap write of a surface edit: the edit's index box is examined in the worker and the
 * voxels are written through a labelmap memo, which the surface edit's record keeps for undo. A
 * delete (`write.kind` delete) carves: it only clears the segment's voxels. A smooth (`write.kind`
 * smooth) takes the delta of the two surfaces: it clears the segment's voxels the surface moved
 * out of and sets the background voxels it moved over; other segments are never written.
 *
 * The target is checked before the worker runs and again, against the labelmap as it is then,
 * before anything is written: the segment must exist and be unlocked, the working labelmap must
 * be the volume the edit was made on, and every voxel written must still be the segment's (a
 * removal) or background (an addition). A write is refused when the target is gone; voxels that
 * changed hands meanwhile are left alone. A refused or failed write leaves the labelmap unchanged
 * and the surface edit standing (undo puts the surface back).
 *
 * @param {Object} memo - createSurfaceEditMemo
 * @param {Object} deps
 * @param {string} deps.editSegmentationId - the working segmentation
 * @param {Function} [deps.withOwnEdit] - (fn) => fn(): marks the write as made for the surface
 * @param {Function} [deps.getLabelmap] - (segmentationId) => getLabelmapForEdit result, read again
 *   after the worker so the write sees the labelmap as it is then
 * @param {Function} [deps.carve] - async (args) => Int32Array (a delete)
 * @param {Function} [deps.delta] - async (args) => { remove, add } (a smooth)
 * @param {Function} [deps.isSegmentLocked] - (segmentationId, segmentIndex) => boolean
 * @param {Function} [deps.segmentExists] - (segmentationId, segmentIndex) => boolean
 */
export async function runSurfaceEditWrite(memo, deps) {
  const {
    editSegmentationId,
    withOwnEdit = fn => fn(),
    getLabelmap = getLabelmapForEdit,
    carve = carveInWorker,
    delta = deltaInWorker,
    isSegmentLocked = (id, index) => c3dSegmentations.segmentLocking.isSegmentIndexLocked(id, index),
    segmentExists = (id, index) => !!c3dSegmentations.state.getSegmentation(id)?.segments?.[index],
  } = deps;
  const job = memo.job;
  if (!job || job.cancelled) {
    return false;
  }

  const targetValid = labelmap => !job.cancelled
    && !!labelmap && labelmap.volume === memo.labelmapVolume
    && segmentExists(editSegmentationId, memo.segmentIndex)
    && !isSegmentLocked(editSegmentationId, memo.segmentIndex);

  const labelmap = getLabelmap(editSegmentationId);
  if (!targetValid(labelmap)) {
    throw new WriteRefusedError();
  }

  const write = memo.write || { kind: WRITE_KINDS.delete };
  const isDelete = write.kind !== WRITE_KINDS.smooth;
  const depth = isDelete ? write.depth || 0 : 0;
  const { axes, indexBox } = editIndexBox({ editBox: memo.editBox, depth, labelmap });
  let classified = { remove: new Int32Array(0), add: new Int32Array(0) };
  if (indexBox) {
    const args = {
      original: memo.before,
      edited: memo.after.points?.length ? memo.after : null,
      boxData: extractIndexBox(labelmap.scalarData, labelmap.dimensions, indexBox),
      dimensions: labelmap.dimensions,
      segmentIndex: memo.segmentIndex,
      axes,
      indexBox,
    };
    if (isDelete) {
      classified = { remove: await carve({ ...args, selectedPoints: write.selectedPoints, depth }), add: new Int32Array(0) };
    } else {
      classified = await delta(args);
    }
  }
  if (job.cancelled) {
    return false;
  }

  // The labelmap as it is now: the working volume may have been replaced, and the voxels the
  // worker classified may have changed hands
  const current = getLabelmap(editSegmentationId);
  if (!targetValid(current)) {
    throw new WriteRefusedError();
  }
  const { remove, add, dropped } = ownedDelta(classified, current.scalarData, memo.segmentIndex);
  memo.droppedVoxels = dropped;

  let changed = false;
  let labelmapMemo = null;
  if (remove.length || add.length) {
    const { segmentIndex } = memo;
    ({ changed, memo: labelmapMemo } = withOwnSurfaceWrite(() => withOwnEdit(() => applyLabelmapEdit({
      segmentationId: editSegmentationId,
      volume: current.volume,
      edit: setAtIndex => {
        remove.forEach(index => setAtIndex(index, 0));
        add.forEach(index => setAtIndex(index, segmentIndex));
      },
    }))));
  }
  memo.labelmapMemo = changed ? labelmapMemo : null;
  memo.surfaceOnly = !changed;
  if (memo.job === job) {
    memo.job = null;
  }
  return changed;
}

/**
 * Queue the labelmap write of a surface edit behind the writes already queued. Each queued write
 * is its own job: an edit re-queued by a redo while its first write still runs is a second job,
 * and only the job that completes retires itself.
 *
 * @param {Object} memo - createSurfaceEditMemo
 * @param {Object} deps - runSurfaceEditWrite's, plus:
 * @param {Function} [deps.onRefused] - (memo) => void: the write was refused
 * @param {Function} [deps.onError] - (error, memo) => void: the write failed
 * @param {Function} [deps.run] - the write itself (tests)
 * @returns {Promise<boolean>} whether the labelmap changed
 */
export function queueSurfaceEditWrite(memo, deps) {
  const { onRefused = () => {}, onError = () => {}, run = runSurfaceEditWrite } = deps;
  const job = { memo, cancelled: false };
  memo.job = job;
  memo.surfaceOnly = false;
  pending.add(job);
  adjustPendingWrites(1);

  const write = chain
    .catch(() => {})
    .then(() => (job.cancelled ? false : run(memo, deps)))
    .catch(error => {
      if (job.cancelled) {
        return false;
      }
      memo.surfaceOnly = true;
      if (memo.job === job) {
        memo.job = null;
      }
      if (error instanceof WriteRefusedError) {
        onRefused(memo);
      } else {
        onError(error, memo);
      }
      return false;
    })
    .finally(() => {
      if (pending.delete(job)) {
        adjustPendingWrites(-1);
      }
    });
  chain = write;
  return write;
}

/** Drop every queued write (editor closing): their surface edits stay as shown. */
export function cancelSurfaceEditWrites() {
  pending.forEach(job => {
    job.cancelled = true;
    if (job.memo.job === job) {
      job.memo.job = null;
    }
  });
  pending.clear();
  adjustPendingWrites(-Infinity);
  chain = Promise.resolve();
}

/** Writes queued or running (tests). */
export function pendingSurfaceEditWrites() {
  return pending.size;
}
