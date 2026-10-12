// Registers the carve worker with Cornerstone3D's web worker manager, as the hole-filling worker
// is registered. It idles out between edits and is started again on the next one.

import { getWebWorkerManager } from '@cornerstonejs/core';


export const LABELMAP_CARVE_WORKER = 'segEditorLabelmapCarve';

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

let registered = false;

export function registerLabelmapCarveWorker() {
  if (registered) {
    return;
  }
  registered = true;

  getWebWorkerManager().registerWorker(
    LABELMAP_CARVE_WORKER,
    () => new Worker(new URL('./labelmapCarveWorker.js', import.meta.url), {
      name: LABELMAP_CARVE_WORKER,
      type: 'module',
    }),
    {
      maxWorkerInstances: 1,
      autoTerminateOnIdle: { enabled: true, idleTimeThreshold: IDLE_TIMEOUT_MS },
    },
  );
}

/** Stop the worker (editor teardown); it is started again on the next request. */
export function terminateLabelmapCarveWorker() {
  const manager = getWebWorkerManager();
  if (registered && manager?.workerRegistry?.[LABELMAP_CARVE_WORKER]) {
    manager.terminate(LABELMAP_CARVE_WORKER);
  }
}

export default registerLabelmapCarveWorker;
