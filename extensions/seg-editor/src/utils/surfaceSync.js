// Keeps the editor's 3D surface in step with edits to the working segmentation (ohif-viewers#142,
// FR-9 / AR-7).
//
// The 2D views paint the working copy (`<source>::edit`); the surface is built from a separate
// editor-local labelmap (`vol3d:<source>::edit`) whose voxels were copied once, at load. After
// edits pause, the working-copy voxels are copied into the vol3d labelmap and the vol3d labelmap
// is marked modified.
//
// Marking it modified (triggerSegmentationDataModified) is what updates the surface. It is
// Cornerstone3D's own path: it invalidates the cached segment indices of the vol3d labelmap (so
// segments added since the last computation get a surface), and it runs the library's surface
// listener, registered while a Surface representation is attached, which rebuilds the meshes
// (polySeg updateSurfaceData) and re-renders. Calling updateSurfaceData directly skipped the
// index invalidation, so new segments never appeared.
//
// - The copy always runs, so a surface enabled later is computed from current voxels.
// - Edits made before the surface exists (or while it is off) mark it stale; `refreshIfStale()`
//   marks the labelmap modified again once the surface is available.

import { eventTarget as c3dEventTarget } from '@cornerstonejs/core';
import {
  Enums as c3dToolsEnums,
  segmentation as c3dSegmentations,
} from '@cornerstonejs/tools';

import log from '@ohif/core/src/log.js';


export const SURFACE_SYNC_DELAY_MS = 1500;

const LOG_PREFIX = '[SegEditor-surfaceSync]';


/**
 * @param {Object} params
 * @param {string} params.sourceSegmentationId - the working segmentation painted in 2D
 * @param {string} params.targetSegmentationId - the vol3d segmentation the surface is built from
 * @param {Function} params.getSourceVolume - () => the working copy's labelmap volume
 * @param {Function} params.getTargetVolume - () => the vol3d labelmap volume
 * @param {Function} params.isSurfaceShown - () => true while a surface is displayed and can be
 *   updated (surface enabled and its first computation finished)
 * @param {Function} [params.onError] - (err) => void
 * @param {number} [params.delayMs]
 * @param {Object} [params.deps] - injectable Cornerstone3D functions (tests)
 */
export function createSurfaceSync({
  sourceSegmentationId,
  targetSegmentationId,
  getSourceVolume,
  getTargetVolume,
  isSurfaceShown,
  onError = err => log.error(LOG_PREFIX, err),
  delayMs = SURFACE_SYNC_DELAY_MS,
  deps = {},
}) {
  const {
    eventTarget = c3dEventTarget,
    markModified = id => c3dSegmentations.triggerSegmentationEvents.triggerSegmentationDataModified(id),
    dataModifiedEvent = c3dToolsEnums.Events.SEGMENTATION_DATA_MODIFIED,
  } = deps;

  let timer = null;
  let surfaceStale = false;
  let stopped = false;

  function copyVoxels() {
    const source = getSourceVolume();
    const target = getTargetVolume();
    if (!source?.voxelManager || !target?.voxelManager) {
      log.debug(LOG_PREFIX, 'labelmap volume unavailable, skipping copy', {
        source: !!source?.voxelManager,
        target: !!target?.voxelManager,
      });
      return false;
    }

    const voxels = target.voxelManager.getCompleteScalarDataArray();
    voxels.set(source.voxelManager.getCompleteScalarDataArray());
    target.voxelManager.setCompleteScalarDataArray(voxels);
    return true;
  }

  function updateSurface(reason) {
    surfaceStale = false;
    log.debug(LOG_PREFIX, `marking ${targetSegmentationId} modified (${reason})`);
    markModified(targetSegmentationId);
  }

  function copyAndUpdate(reason, { force = false } = {}) {
    if (stopped) {
      return false;
    }

    try {
      if (!copyVoxels()) {
        return false;
      }
    } catch (err) {
      onError(err);
      return false;
    }

    if (force || isSurfaceShown()) {
      updateSurface(reason);
    } else {
      surfaceStale = true;
      log.debug(LOG_PREFIX, 'voxels copied; surface not shown, marked stale');
    }
    return true;
  }

  function onDataModified(evt) {
    if (stopped || evt?.detail?.segmentationId !== sourceSegmentationId) {
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      copyAndUpdate('2D edit');
    }, delayMs);
  }

  eventTarget.addEventListener(dataModifiedEvent, onDataModified);

  return {
    /** Update the surface if edits were made before it could be. */
    refreshIfStale() {
      if (!stopped && surfaceStale && isSurfaceShown()) {
        updateSurface('catch-up');
      }
    },

    /**
     * Copy the current voxels and update the surface now, whatever its state: used when the
     * surface is re-enabled and must reflect edits made while it was off.
     */
    syncNow() {
      clearTimeout(timer);
      timer = null;
      return copyAndUpdate('re-enable', { force: true });
    },

    /** Detach. */
    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = null;
      eventTarget.removeEventListener(dataModifiedEvent, onDataModified);
    },

    // for tests
    get state() {
      return { surfaceStale, scheduled: !!timer, stopped };
    },
  };
}

export default createSurfaceSync;
