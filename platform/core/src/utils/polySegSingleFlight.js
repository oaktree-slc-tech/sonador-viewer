// Polymorphic-segmentation addon wrapper, installed at cornerstoneTools.init as
// `addons.polySeg`, so it is what every library caller of `getPolySeg()` reaches.
//
// Cornerstone3D schedules segmentation renders on requestAnimationFrame without awaiting them,
// and every render of a Surface representation whose data is not yet stored starts a full
// surface computation. `computeSurfaceData` is therefore single-flighted per segmentation and
// segment set: concurrent callers share one marching-cubes job.
//
// `updateSurfaceData`, the library's response to a labelmap edit, is serialized per segmentation
// (two updates running at once write the same geometry in whichever order they finish) and its
// start and end are published, so a view can show that the surface is being updated and wait
// for the update that follows an edit. Terminating the polySeg worker (a view's toggle-off or
// unmount) kills the running job, whose promise then never settles: `resetPolySegInFlight`
// drops everything in flight so the next call starts a fresh job instead of joining a dead one.

const surfaceComputeFailures = new Map();

// In-flight state, module-level: one addon instance serves the application. Updates of a
// segmentation are numbered as they are queued; since they run in order, the highest ended
// number says which are done.
const inFlightComputes = new Map();   // key -> promise
const updateChains = new Map();       // segmentationId -> promise of the last queued update
const queuedUpdate = new Map();       // segmentationId -> number of the last update queued
const endedUpdate = new Map();        // segmentationId -> number of the last update ended
const updateListeners = new Set();
const resetListeners = new Set();
let generation = 0;

export function getSurfaceComputeFailure(segmentationId) {
  return surfaceComputeFailures.get(segmentationId);
}

export function clearSurfaceComputeFailure(segmentationId) {
  surfaceComputeFailures.delete(segmentationId);
}

function _notify(event) {
  updateListeners.forEach(listener => {
    try {
      listener(event);
    } catch (error) {
      console.error('[polySegSingleFlight] surface update listener failed', error);
    }
  });
}

/**
 * Follow surface updates: `listener({ segmentationId, phase: 'start' | 'end', update, error?,
 * cancelled? })`, where `update` numbers the segmentation's updates in queue order. Returns an
 * unsubscribe function.
 */
export function subscribeSurfaceUpdates(listener) {
  updateListeners.add(listener);
  return () => updateListeners.delete(listener);
}

/** Whether a surface update of the segmentation is queued or running */
export function isSurfaceUpdating(segmentationId) {
  return (queuedUpdate.get(segmentationId) || 0) > (endedUpdate.get(segmentationId) || 0);
}

/**
 * Resolves when the next surface update of the segmentation to be queued after this call has
 * ended. Updates run in order, so by then every update outstanding at the call has ended too; an
 * update already running when the caller asks is never taken for the caller's own. Resolves with
 * `{ ended: true }` (with that update's `error`, if it failed), with `{ timedOut: true }` after
 * `timeoutMs`, or with `{ cancelled: true }` when in-flight work is dropped (resetPolySegInFlight).
 */
export function waitForSurfaceUpdate(segmentationId, { timeoutMs = 120000 } = {}) {
  return new Promise(resolve => {
    const target = (queuedUpdate.get(segmentationId) || 0) + 1;

    let timer = null;
    const finish = result => {
      clearTimeout(timer);
      unsubscribe();
      resolve(result);
    };
    const unsubscribe = subscribeSurfaceUpdates(event => {
      if (event.segmentationId !== segmentationId || event.phase !== 'end') {
        return;
      }
      if (event.cancelled) {
        finish({ cancelled: true });
      } else if (event.update >= target) {
        finish({ ended: true, error: event.error });
      }
    });
    timer = setTimeout(() => finish({ timedOut: true }), timeoutMs);
  });
}

/**
 * Be told when in-flight work is forgotten (resetPolySegInFlight): whatever else waits on the
 * polySeg worker (the Segmentation Editor's imports voxelize models on it) can give up its own
 * pending jobs then. Returns an unsubscribe function.
 */
export function subscribePolySegReset(listener) {
  resetListeners.add(listener);
  return () => resetListeners.delete(listener);
}

/**
 * Forget every computation and update in flight (their promises are left to whoever holds
 * them): after the worker is terminated they can never settle, and a later call must not join
 * them. Waiters are released with `cancelled`, and reset listeners are told.
 */
export function resetPolySegInFlight() {
  generation += 1;
  inFlightComputes.clear();
  updateChains.clear();
  const updating = Array.from(queuedUpdate.keys()).filter(isSurfaceUpdating);
  updating.forEach(segmentationId => endedUpdate.set(segmentationId, queuedUpdate.get(segmentationId)));
  updating.forEach(segmentationId => _notify({
    segmentationId, phase: 'end', update: queuedUpdate.get(segmentationId), cancelled: true,
  }));
  resetListeners.forEach(listener => {
    try {
      listener();
    } catch (error) {
      console.error('[polySegSingleFlight] reset listener failed', error);
    }
  });
}

export function createSingleFlightPolySeg(polySeg) {
  const keyFor = (segmentationId, options = {}) => {
    const indices = options.segmentIndices?.length
      ? [...options.segmentIndices].sort((a, b) => a - b).join(',')
      : 'all';
    return `${segmentationId}::${indices}`;
  };

  const computeSurfaceData = (segmentationId, options = {}) => {
    const key = keyFor(segmentationId, options);

    const existing = inFlightComputes.get(key);
    if (existing) {
      return existing;
    }

    const job = Promise.resolve(polySeg.computeSurfaceData(segmentationId, options));

    inFlightComputes.set(key, job);
    job.then(
      () => surfaceComputeFailures.delete(segmentationId),
      error => surfaceComputeFailures.set(segmentationId, { error, at: Date.now() })
    );
    job
      .finally(() => {
        if (inFlightComputes.get(key) === job) {
          inFlightComputes.delete(key);
        }
      })
      .catch(() => {});

    return job;
  };

  const updateSurfaceData = (segmentationId, options) => {
    const startedIn = generation;
    const previous = updateChains.get(segmentationId) || Promise.resolve();

    const update = (queuedUpdate.get(segmentationId) || 0) + 1;
    queuedUpdate.set(segmentationId, update);
    _notify({ segmentationId, phase: 'start', update });

    const end = extra => {
      // A reset has already released the waiters of an older generation
      if (startedIn !== generation) {
        return;
      }
      endedUpdate.set(segmentationId, Math.max(endedUpdate.get(segmentationId) || 0, update));
      _notify({ segmentationId, phase: 'end', update, ...extra });
    };

    // Queued behind the previous update of the same segmentation, whatever became of it
    const job = previous
      .catch(() => {})
      .then(() => polySeg.updateSurfaceData(segmentationId, options))
      .then(result => { end({}); return result; }, error => { end({ error }); throw error; });

    updateChains.set(segmentationId, job);
    job
      .finally(() => {
        if (updateChains.get(segmentationId) === job) {
          updateChains.delete(segmentationId);
        }
      })
      .catch(() => {});

    return job;
  };

  return {
    ...polySeg,
    computeSurfaceData,
    updateSurfaceData,
  };
}

export default createSingleFlightPolySeg;
