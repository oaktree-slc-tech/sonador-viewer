// Registers the hole-filling worker with Cornerstone3D's web worker manager, as polymorphic
// segmentation registers its own. The worker stays alive for a while after a delete, so the next
// delete does not load OpenCascade again.

import { getWebWorkerManager } from '@cornerstonejs/core';


export const HOLE_FILLING_WORKER = 'segEditorHoleFilling';

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

let registered = false;

export function registerHoleFillingWorker() {
  if (registered) {
    return;
  }
  registered = true;

  getWebWorkerManager().registerWorker(
    HOLE_FILLING_WORKER,
    () => new Worker(new URL('./holeFillingWorker.js', import.meta.url), {
      name: HOLE_FILLING_WORKER,
      type: 'module',
    }),
    {
      maxWorkerInstances: 1,
      autoTerminateOnIdle: { enabled: true, idleTimeThreshold: IDLE_TIMEOUT_MS },
    },
  );
}

/** Stop the worker (editor teardown); it is started again on the next request. */
export function terminateHoleFillingWorker() {
  const manager = getWebWorkerManager();
  if (registered && manager?.workerRegistry?.[HOLE_FILLING_WORKER]) {
    manager.terminate(HOLE_FILLING_WORKER);
  }
}

export default registerHoleFillingWorker;
