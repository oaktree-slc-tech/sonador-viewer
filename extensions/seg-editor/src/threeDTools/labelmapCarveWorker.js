// Carve worker for the 3D Selection tool (ohif-viewers#142, AR-14): voxelizes the surfaces before
// and after an edit within the edit's index box and carves the labelmap, off the main thread. It
// also runs the surface diagnostics the canvas shows, which walk every edge of a surface, the
// delta of an edit that moved the surface (ohif-viewers#148, AR-5), and the smoothing itself.

import { expose } from 'comlink';

import { assembleCut, prepareCut, prepareRepair } from './deleteSelection.js';
import { carveLabelmap, deltaLabelmap } from './labelmapCarve.js';
import { conditionSurface, surfaceDiagnostics, triangleTopology } from './meshRepair.js';
import { smoothSurface } from './smoothSelection.js';


const carve = {
  /**
   * @param {Object} args - see carveLabelmap
   * @returns {Promise<Int32Array>} linear labelmap indices to clear
   */
  async carve(args) {
    return carveLabelmap(args);
  },

  /**
   * @param {Object} args - see deltaLabelmap
   * @returns {Promise<{ remove: Int32Array, add: Int32Array }>}
   */
  async delta(args) {
    return deltaLabelmap(args);
  },

  /**
   * @param {Object} args - see smoothSurface
   */
  async smooth(args) {
    return smoothSurface(args);
  },

  /** The whole-mesh stages of a cut, before and after the patches (deleteSelection). */
  async prepareCut(args) {
    return prepareCut(args);
  },

  async prepareRepair(args) {
    return prepareRepair(args);
  },

  async assembleCut(args) {
    return assembleCut(args);
  },

  /** The triangle topology of a surface (meshRepair.triangleTopology), typed arrays throughout. */
  async triangleTopology(surface) {
    return triangleTopology(surface);
  },

  /**
   * Open and non-manifold edges of a surface (edges in raw vertex indices of the surface).
   *
   * @param {{ points, polys, weldTolerance? }} args
   */
  async diagnose({ points, polys, weldTolerance = 0 }) {
    const { triangles, degenerate, duplicate } = conditionSurface({ points, polys }, { weldTolerance });
    return { ...surfaceDiagnostics(triangles), degenerate, duplicate };
  },
};

expose(carve);
