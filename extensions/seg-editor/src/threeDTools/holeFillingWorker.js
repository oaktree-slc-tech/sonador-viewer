// Hole-filling worker for the 3D Selection tool (ohif-viewers#142, AR-12): fits the OpenCascade
// patches for a delete's holes off the main thread. OpenCascade.js (~27 MB of wasm) is loaded on
// the first request and kept while the worker lives.

import { expose } from 'comlink';

import { loadOpenCascade } from '../threejs/openCascade.js';
import { patchHole } from './holePatches.js';


const holeFilling = {
  /**
   * @param {{ loops: Float64Array[] }} args - flat xyz of each hole's boundary
   * @param {Function} [progressCallback] - (progress: 0..100) => void
   * @returns {Promise<Array<{ patch, method, error }>>}
   */
  async patchHoles({ loops }, progressCallback) {
    let oc = null;
    let loadError;
    try {
      oc = await loadOpenCascade();
    } catch (err) {
      loadError = `OpenCascade could not be loaded: ${err?.message || err}`;
    }

    const results = [];
    for (let i = 0; i < loops.length; i++) {
      const result = patchHole(oc, loops[i]);
      results.push(loadError ? { ...result, error: loadError } : result);
      progressCallback?.(Math.round(((i + 1) / loops.length) * 100));
    }
    return results;
  },
};

expose(holeFilling);
