// Cornerstone3D side of the 3D Selection tool's delete (ohif-viewers#142): the worker tasks and the
// labelmap write that deleteSelection is given as dependencies.

import { cache as c3dCache, getWebWorkerManager, utilities as c3dUtilities } from '@cornerstonejs/core';
import {
  segmentation as c3dSegmentations,
  utilities as c3dToolsUtilities,
} from '@cornerstonejs/tools';
import { init as initPolySeg } from '@cornerstonejs/polymorphic-segmentation';

import { HOLE_FILLING_WORKER, registerHoleFillingWorker } from './registerHoleFillingWorker';


const POLYSEG_WORKER = 'polySeg';
const IDENTITY_DIRECTION = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * Patch the holes in the hole-filling worker.
 *
 * @param {Float64Array[]} loops
 * @param {Function} [onProgress]
 */
export function patchHolesInWorker(loops, onProgress) {
  registerHoleFillingWorker();
  return getWebWorkerManager().executeTask(HOLE_FILLING_WORKER, 'patchHoles', { loops }, {
    callbacks: onProgress ? [onProgress] : [],
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
 * The working labelmap of a segmentation, as deleteSelection reads it.
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
 * Clear voxels of a segmentation's labelmap, recorded for undo (as the labelmap tools and
 * Cornerstone3D's clearSegmentValue record their edits), and mark it modified so the 2D views
 * and the surface sync update.
 *
 * @param {Object} params
 * @param {string} params.segmentationId
 * @param {Object} params.volume - the labelmap volume
 * @param {Int32Array} params.indices - linear voxel indices
 */
export function removeLabelmapVoxels({ segmentationId, volume, indices }) {
  const { LabelmapMemo } = c3dToolsUtilities.segmentation;
  const memo = LabelmapMemo.createLabelmapMemo(segmentationId, volume.voxelManager);
  const voxelManager = memo.voxelManager;
  indices.forEach(index => voxelManager.setAtIndex(index, 0));

  if (memo.commitMemo()) {
    c3dUtilities.HistoryMemo.DefaultHistoryMemo.push(memo);
  }
  c3dSegmentations.triggerSegmentationEvents.triggerSegmentationDataModified(segmentationId);
}
