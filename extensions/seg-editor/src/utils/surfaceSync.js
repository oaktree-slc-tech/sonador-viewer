// Keeps the editor's 3D surface in step with edits to the working segmentation (ohif-viewers#142,
// FR-9 / AR-7, FR-25 / AR-17).
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
// That library update runs through the polySeg addon wrapper (@ohif/core polySegSingleFlight),
// which publishes when an update starts and ends and runs them in order. The sync follows those
// for the vol3d segmentation: `onUpdateStart` / `onUpdateEnd` bracket the whole run of
// outstanding updates (queued ones included), so the view says the surface is being updated until
// none is left, and `syncNow()` resolves once the update its own marking queued has ended (or
// timed out): the next update queued after it asks, behind any that were already outstanding.
//
// - The copy always runs, so a surface enabled later is computed from current voxels.
// - Edits made before the surface exists (or while it is off) mark it stale; `refreshIfStale()`
//   marks the labelmap modified again once the surface is available.
// - Edits made for the surface itself (`withOwnEdit`: the labelmap writes that follow a surface
//   edit, and their undo) only need the copy: the surface already shows them.
// - Any other edit rebuilds the surface, but not while a surface edit's write is still queued
//   (`isUpdateBlocked`): a rebuild then would show the labelmap without that edit. The rebuild
//   waits, re-checking at the edit delay, until the writes have landed.

import { eventTarget as c3dEventTarget } from '@cornerstonejs/core';
import {
  Enums as c3dToolsEnums,
  segmentation as c3dSegmentations,
} from '@cornerstonejs/tools';

import log from '@ohif/core/src/log.js';
import {
  isSurfaceUpdating as c3dIsSurfaceUpdating,
  subscribeSurfaceUpdates as c3dSubscribeSurfaceUpdates,
  waitForSurfaceUpdate as c3dWaitForSurfaceUpdate,
} from '@ohif/core/src/utils/polySegSingleFlight';


export const SURFACE_SYNC_DELAY_MS = 1500;
// An update that has not ended by then is treated as over, so a view never waits forever
export const SURFACE_UPDATE_TIMEOUT_MS = 120000;

const LOG_PREFIX = '[SegEditor-surfaceSync]';


/**
 * @param {Object} params
 * @param {string} params.sourceSegmentationId - the working segmentation painted in 2D
 * @param {string} params.targetSegmentationId - the vol3d segmentation the surface is built from
 * @param {Function} params.getSourceVolume - () => the working copy's labelmap volume
 * @param {Function} params.getTargetVolume - () => the vol3d labelmap volume
 * @param {Function} params.isSurfaceShown - () => true while a surface is displayed and can be
 *   updated (surface enabled and its first computation finished)
 * @param {Function} [params.onUpdateStart] - () => void, when a surface update of the vol3d
 *   segmentation begins
 * @param {Function} [params.onUpdateEnd] - ({ error?, cancelled? }) => void, when it ends
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
  onUpdateStart = () => {},
  onUpdateEnd = () => {},
  onError = err => log.error(LOG_PREFIX, err),
  delayMs = SURFACE_SYNC_DELAY_MS,
  deps = {},
}) {
  const {
    eventTarget = c3dEventTarget,
    markModified = id => c3dSegmentations.triggerSegmentationEvents.triggerSegmentationDataModified(id),
    dataModifiedEvent = c3dToolsEnums.Events.SEGMENTATION_DATA_MODIFIED,
    subscribeSurfaceUpdates = c3dSubscribeSurfaceUpdates,
    waitForSurfaceUpdate = c3dWaitForSurfaceUpdate,
    isSurfaceUpdating = c3dIsSurfaceUpdating,
    updateTimeoutMs = SURFACE_UPDATE_TIMEOUT_MS,
    isUpdateBlocked = () => false,
  } = deps;

  let timer = null;
  let surfaceStale = false;
  let stopped = false;
  let updating = false;
  // An edit being made for the surface (withOwnEdit)
  let ownEdit = false;
  // Edits since the last copy: any at all, and any not made for the surface
  let voxelsPending = false;
  let foreignPending = false;

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
    voxelsPending = false;

    if (force || isSurfaceShown()) {
      updateSurface(reason);
    } else {
      surfaceStale = true;
      log.debug(LOG_PREFIX, 'voxels copied; surface not shown, marked stale');
    }
    return true;
  }

  // Apply the edits since the last copy: a copy, and a surface update if any edit was not made
  // for the surface
  function flush(reason) {
    if (stopped || !voxelsPending) {
      return false;
    }
    if (foreignPending) {
      if (isUpdateBlocked()) {
        log.debug(LOG_PREFIX, 'surface update waits for the queued surface edits');
        schedule();
        return false;
      }
      const done = copyAndUpdate(reason);
      if (done) {
        foreignPending = false;
      }
      return done;
    }
    try {
      if (copyVoxels()) {
        voxelsPending = false;
        return true;
      }
    } catch (err) {
      onError(err);
    }
    return false;
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      flush('2D edit');
    }, delayMs);
  }

  function onDataModified(evt) {
    if (stopped || evt?.detail?.segmentationId !== sourceSegmentationId) {
      return;
    }
    voxelsPending = true;
    if (!ownEdit) {
      foreignPending = true;
    }
    schedule();
  }

  // The surface updates of the vol3d segmentation, as the polySeg wrapper reports them
  const unsubscribeUpdates = subscribeSurfaceUpdates(event => {
    if (stopped || event.segmentationId !== targetSegmentationId) {
      return;
    }
    if (event.phase === 'start' && !updating) {
      updating = true;
      onUpdateStart();
    } else if (event.phase === 'end' && updating && !isSurfaceUpdating(targetSegmentationId)) {
      // The last outstanding update of the segmentation has ended
      updating = false;
      onUpdateEnd({ error: event.error, cancelled: event.cancelled });
    }
  });

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
     *
     * @returns {Promise<Object|false>} false when nothing was updated; else the outcome of the
     *   update the library ran for it (`{ ended }`, `{ timedOut }` or `{ cancelled }`)
     */
    syncNow() {
      clearTimeout(timer);
      timer = null;
      // Ask before marking modified: the waiter is bound to the next update queued after it asks,
      // which is the one the marking causes, and never to one already running
      const outcome = waitForSurfaceUpdate(targetSegmentationId, { timeoutMs: updateTimeoutMs });
      if (!copyAndUpdate('re-enable', { force: true })) {
        return Promise.resolve(false);
      }
      foreignPending = false;
      return outcome;
    },

    /**
     * Run an edit of the working labelmap that the surface already shows (the write following a
     * surface edit, or its undo): it is copied like any edit but never rebuilds the surface.
     */
    withOwnEdit(fn) {
      const previous = ownEdit;
      ownEdit = true;
      try {
        return fn();
      } finally {
        ownEdit = previous;
      }
    },

    /** Detach. */
    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = null;
      eventTarget.removeEventListener(dataModifiedEvent, onDataModified);
      unsubscribeUpdates();
    },

    // for tests
    get state() {
      return { surfaceStale, scheduled: !!timer, stopped, updating, voxelsPending, foreignPending };
    },
  };
}

export default createSurfaceSync;
