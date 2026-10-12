// Cornerstone3D side of the 3D Selection tool's delete (ohif-viewers#142): the worker tasks and the
// labelmap writes the pipeline is given as dependencies.

import { cache as c3dCache, getWebWorkerManager, utilities as c3dUtilities } from '@cornerstonejs/core';
import { init as initPolySeg } from '@cornerstonejs/polymorphic-segmentation';
import {
  segmentation as c3dSegmentations,
  utilities as c3dToolsUtilities,
} from '@cornerstonejs/tools';

import { HOLE_FILLING_WORKER, registerHoleFillingWorker } from './registerHoleFillingWorker';
import { LABELMAP_CARVE_WORKER, registerLabelmapCarveWorker } from './registerLabelmapCarveWorker';


const POLYSEG_WORKER = 'polySeg';
const IDENTITY_DIRECTION = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * Patch the holes in the hole-filling worker.
 *
 * @param {Float64Array[]} loops
 * @param {Object} [options] - patchHole's (closure, maxConstraints)
 * @param {Function} [onProgress]
 */
export function patchHolesInWorker(loops, options = {}, onProgress) {
  registerHoleFillingWorker();
  return getWebWorkerManager().executeTask(HOLE_FILLING_WORKER, 'patchHoles', { loops, options }, {
    callbacks: onProgress ? [onProgress] : [],
  });
}

/**
 * Open and non-manifold edges of a surface, from the carve worker.
 *
 * @param {{ points, polys }} surface
 * @param {Object} [options]
 * @param {number} [options.weldTolerance]
 */
export function diagnoseSurfaceInWorker({ points, polys }, { weldTolerance = 0 } = {}) {
  registerLabelmapCarveWorker();
  return getWebWorkerManager().executeTask(LABELMAP_CARVE_WORKER, 'diagnose', { points, polys, weldTolerance });
}

/**
 * Carve the labelmap for a surface edit in the carve worker (labelmapCarve's carveLabelmap).
 *
 * @param {Object} args - see carveLabelmap
 * @returns {Promise<Int32Array>}
 */
export function carveInWorker(args) {
  registerLabelmapCarveWorker();
  return getWebWorkerManager().executeTask(LABELMAP_CARVE_WORKER, 'carve', args);
}

/**
 * The labelmap delta of an edit that moved the surface, from the carve worker (labelmapCarve's
 * deltaLabelmap).
 *
 * @param {Object} args - see deltaLabelmap
 * @returns {Promise<{ remove: Int32Array, add: Int32Array }>}
 */
export function deltaInWorker(args) {
  registerLabelmapCarveWorker();
  return getWebWorkerManager().executeTask(LABELMAP_CARVE_WORKER, 'delta', args);
}

/** The cut's whole-mesh stages, in the carve worker (deleteSelection's prepareCut and friends). */
export function prepareCutInWorker(args) {
  registerLabelmapCarveWorker();
  return getWebWorkerManager().executeTask(LABELMAP_CARVE_WORKER, 'prepareCut', args);
}

export function prepareRepairInWorker(args) {
  registerLabelmapCarveWorker();
  return getWebWorkerManager().executeTask(LABELMAP_CARVE_WORKER, 'prepareRepair', args);
}

export function assembleCutInWorker(args) {
  registerLabelmapCarveWorker();
  return getWebWorkerManager().executeTask(LABELMAP_CARVE_WORKER, 'assembleCut', args);
}

/** The triangle topology of a surface, built in the carve worker (meshRepair's triangleTopology). */
export function triangleTopologyInWorker({ points, polys }) {
  registerLabelmapCarveWorker();
  return getWebWorkerManager().executeTask(LABELMAP_CARVE_WORKER, 'triangleTopology', { points, polys });
}

/**
 * Smooth the selected region of a surface in the carve worker (smoothSelection's smoothSurface).
 *
 * @param {{ surface, selected, options }} args
 */
export function smoothInWorker({ surface, selected, selectedTriangles, options }) {
  registerLabelmapCarveWorker();
  return getWebWorkerManager().executeTask(LABELMAP_CARVE_WORKER, 'smooth', {
    surface: { points: surface.points, polys: surface.polys },
    selected: selected ? Array.from(selected) : [],
    selectedTriangles: selectedTriangles ? Array.from(selectedTriangles) : undefined,
    options,
  });
}

/**
 * Voxelize a closed surface in the polymorphic segmentation worker. The voxelizer chooses its own
 * axis-aligned grid from the surface's bounds; the grid arguments are required by the call but
 * not used.
 *
 * @param {{ points: Float32Array, polys: Int32Array }} surface
 */
export function voxelizeSurfaceInWorker({ points, polys }) {
  // Registers the worker if polymorphic segmentation has not yet (idempotent)
  initPolySeg();
  return getWebWorkerManager().executeTask(POLYSEG_WORKER, 'convertSurfaceToVolumeLabelmap', {
    points,
    polys,
    dimensions: [1, 1, 1],
    spacing: [1, 1, 1],
    direction: IDENTITY_DIRECTION,
    origin: [0, 0, 0],
  });
}

/**
 * The working labelmap of a segmentation, as the delete pipeline reads it.
 *
 * @param {string} segmentationId
 * @returns {{ volume, scalarData, dimensions, indexToWorld }|null}
 */
export function getLabelmapForEdit(segmentationId) {
  const volumeId = c3dSegmentations.state.getSegmentation(segmentationId)
    ?.representationData?.Labelmap?.volumeId;
  const volume = volumeId && c3dCache.getVolume(volumeId);
  if (!volume?.voxelManager || !volume.imageData) {
    return null;
  }
  return {
    volume,
    scalarData: volume.voxelManager.getCompleteScalarDataArray(),
    dimensions: volume.dimensions,
    indexToWorld: ijk => volume.imageData.indexToWorld(ijk),
  };
}

/**
 * Edit voxels of a segmentation's labelmap through a labelmap memo (undo-able, as the labelmap
 * tools and Cornerstone3D's clearSegmentValue record their edits), and mark the slices written
 * modified so the 2D views update. The memo is returned for the caller to record.
 *
 * An error thrown by `edit` propagates before anything is marked modified. Once the edit is
 * committed it stands: a listener failing while the views are told is logged, not thrown, so the
 * labelmap and the caller's record never disagree about what was written.
 *
 * @param {Object} params
 * @param {string} params.segmentationId
 * @param {Object} params.volume - the labelmap volume
 * @param {(setAtIndex: (index: number, value: number) => void) => void} params.edit - writes the
 *   voxels through the memo's voxel manager
 * @returns {{ changed: boolean, memo: Object }}
 */
export function applyLabelmapEdit({ segmentationId, volume, edit }) {
  const { LabelmapMemo } = c3dToolsUtilities.segmentation;
  const memo = LabelmapMemo.createLabelmapMemo(segmentationId, volume.voxelManager);
  const voxelManager = memo.voxelManager;
  edit((index, value) => voxelManager.setAtIndex(index, value));

  const slices = voxelManager.getArrayOfModifiedSlices?.() || [];
  const changed = !!memo.commitMemo();
  try {
    c3dSegmentations.triggerSegmentationEvents.triggerSegmentationDataModified(segmentationId, slices);
  } catch (error) {
    console.error('[SegEditor] a listener failed after the labelmap edit was committed', error);
  }
  return { changed, memo };
}

/**
 * applyLabelmapEdit, recorded for undo in Cornerstone3D's history when it changed anything.
 *
 * @returns {boolean} whether anything changed
 */
export function editLabelmapVoxels(params) {
  const { changed, memo } = applyLabelmapEdit(params);
  if (changed) {
    c3dUtilities.HistoryMemo.DefaultHistoryMemo.push(memo);
  }
  return changed;
}

/**
 * Clear voxels of a segmentation's labelmap (editLabelmapVoxels with value 0).
 *
 * @param {Object} params
 * @param {string} params.segmentationId
 * @param {Object} params.volume - the labelmap volume
 * @param {Int32Array} params.indices - linear voxel indices
 */
export function removeLabelmapVoxels({ segmentationId, volume, indices }) {
  return editLabelmapVoxels({
    segmentationId,
    volume,
    edit: setAtIndex => indices.forEach(index => setAtIndex(index, 0)),
  });
}
