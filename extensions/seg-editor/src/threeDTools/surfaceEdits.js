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
import { extractIndexBox, indexBoxSize } from './labelmapCarve.js';
import { withOwnSurfaceWrite } from './ownWrites.js';
import { applyLabelmapEdit, carveInWorker, deltaInWorker, getLabelmapForEdit } from './segmentEdits.js';
import { refreshSurfaceActors } from './surfaceActors.js';
import { WRITE_KINDS } from './surfaceEditMemo.js';
import { unsynchronizedPredecessors } from './syncLedger.js';
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
 * The number of linear labelmap indices outside an inclusive index box (ohif-viewers#149, FR-6):
 * a proposed delta is valid only when this is zero.
 *
 * @param {ArrayLike<number>} indices
 * @param {{ min: number[], max: number[] }} indexBox
 * @param {number[]} dimensions
 */
export function countOutsideIndexBox(indices, indexBox, dimensions) {
  const [nx, ny, nz] = dimensions;
  const { min, max } = indexBox;
  const total = nx * ny * nz;
  let outside = 0;
  for (let n = 0; n < indices.length; n++) {
    const index = indices[n];
    if (!Number.isInteger(index) || index < 0 || index >= total) {
      outside++;
      continue;
    }
    const i = index % nx;
    const j = Math.floor(index / nx) % ny;
    const k = Math.floor(index / (nx * ny));
    if (i < min[0] || i > max[0] || j < min[1] || j > max[1] || k < min[2] || k > max[2]) {
      outside++;
    }
  }
  return outside;
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
 * changed hands meanwhile are left alone. The proposed indices are validated against the edit's
 * index domain (editIndexBox) before anything is written, and a delta reaching outside it is
 * refused rather than clipped (ohif-viewers#149, FR-6). A refused or failed write leaves the
 * labelmap unchanged and the surface edit standing (undo puts the surface back). The outcome is
 * recorded on the memo as `writeReport`.
 *
 * The edit's predecessors on its surface are checked when the write runs and again before the
 * labelmap is touched (syncLedger): an earlier edit in force that did not reach the labelmap
 * (surface-only, refused or failed) means this edit's surfaces describe a state the labelmap
 * never had, and its write is refused rather than computed from an intermediate mesh
 * (ohif-viewers#152 §4). The canvas already keeps such edits surface-only when it knows; the check
 * here covers a predecessor that failed after this edit was prepared.
 *
 * @param {Object} memo - createSurfaceEditMemo
 * @param {Object} deps
 * @param {string} deps.editSegmentationId - the working segmentation
 * @param {Function} [deps.blockingPredecessors] - (memo) => memo[]: the predecessors in force
 *   that did not reach the labelmap (default: syncLedger.unsynchronizedPredecessors)
 * @param {Function} [deps.withOwnEdit] - (fn) => fn(): marks the write as made for the surface
 * @param {Function} [deps.getLabelmap] - (segmentationId) => getLabelmapForEdit result, read again
 *   after the worker so the write sees the labelmap as it is then
 * @param {Function} [deps.carve] - async (args) => Int32Array (a delete)
 * @param {Function} [deps.delta] - async (args) => { remove, add } (a smooth)
 * @param {Function} [deps.isSegmentLocked] - (segmentationId, segmentIndex) => boolean
 * @param {Function} [deps.segmentExists] - (segmentationId, segmentIndex) => boolean
 * @param {boolean} [deps.keepIndices] - keep the proposed and applied indices on the report (the
 *   developer edit-case export)
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
    keepIndices = false,
    blockingPredecessors = unsynchronizedPredecessors,
  } = deps;
  const job = memo.job;
  if (!job || job.cancelled) {
    return false;
  }

  const targetValid = labelmap => !job.cancelled
    && !!labelmap && labelmap.volume === memo.labelmapVolume
    && segmentExists(editSegmentationId, memo.segmentIndex)
    && !isSegmentLocked(editSegmentationId, memo.segmentIndex);
  const refusePredecessors = (report, blocked) => {
    Object.assign(report, { status: 'refused', reason: 'predecessor', predecessors: blocked.length });
    memo.writeReport = report;
    throw new WriteRefusedError(`${blocked.length} earlier edit(s) of this surface did not reach the labelmap`);
  };

  const labelmap = getLabelmap(editSegmentationId);
  if (!targetValid(labelmap)) {
    memo.writeReport = { status: 'refused', reason: 'target' };
    throw new WriteRefusedError();
  }
  const blockedBefore = blockingPredecessors(memo);
  if (blockedBefore.length) {
    refusePredecessors({}, blockedBefore);
  }

  const write = memo.write || { kind: WRITE_KINDS.delete };
  const isDelete = write.kind !== WRITE_KINDS.smooth;
  const depth = isDelete ? write.depth || 0 : 0;
  const { axes, indexBox } = editIndexBox({ editBox: memo.editBox, depth, labelmap });
  const report = {
    status: 'pending',
    kind: write.kind,
    domain: indexBox,
    domainVoxels: indexBox ? indexBoxSize(indexBox).reduce((a, b) => a * b, 1) : 0,
    proposedRemove: 0,
    proposedAdd: 0,
    removed: 0,
    added: 0,
    dropped: 0,
    farField: 0,
  };
  memo.writeReport = report;
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
    report.status = 'cancelled';
    return false;
  }
  report.proposedRemove = classified.remove.length;
  report.proposedAdd = classified.add.length;
  if (keepIndices) {
    report.proposed = { remove: Array.from(classified.remove), add: Array.from(classified.add) };
    report.labelmap = { dimensions: labelmap.dimensions, axes };
    report.boxBefore = indexBox ? extractIndexBox(labelmap.scalarData, labelmap.dimensions, indexBox) : null;
  }

  // No voxel outside the edit's index domain may change: a delta reaching outside it is a faulty
  // write and is refused whole, not clipped
  const farField = indexBox
    ? countOutsideIndexBox(classified.remove, indexBox, labelmap.dimensions)
      + countOutsideIndexBox(classified.add, indexBox, labelmap.dimensions)
    : classified.remove.length + classified.add.length;
  report.farField = farField;
  if (farField > 0) {
    report.status = 'refused';
    report.reason = 'domain';
    throw new WriteRefusedError(`${farField} proposed voxel(s) lie outside the edit's index domain`);
  }

  // The labelmap as it is now: the working volume may have been replaced, and the voxels the
  // worker classified may have changed hands
  const current = getLabelmap(editSegmentationId);
  if (!targetValid(current)) {
    report.status = 'refused';
    report.reason = 'target';
    throw new WriteRefusedError();
  }
  const { remove, add, dropped } = ownedDelta(classified, current.scalarData, memo.segmentIndex);
  memo.droppedVoxels = dropped;
  report.dropped = dropped;
  // The predecessors once more, right before the labelmap is touched
  const blockedNow = blockingPredecessors(memo);
  if (blockedNow.length) {
    refusePredecessors(report, blockedNow);
  }

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
  report.status = changed ? 'written' : 'nothing';
  report.removed = changed ? remove.length : 0;
  report.added = changed ? add.length : 0;
  if (keepIndices) {
    report.applied = { remove: Array.from(remove), add: Array.from(add) };
  }
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
        memo.writeReport = { ...(memo.writeReport || {}), status: 'refused', message: error.message };
        onRefused(memo);
      } else {
        memo.writeReport = { ...(memo.writeReport || {}), status: 'failed', message: String(error?.message || error) };
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
