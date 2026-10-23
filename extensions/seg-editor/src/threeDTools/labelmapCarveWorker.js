// Carve worker for the 3D Selection tool (ohif-viewers#142, AR-14): voxelizes the surfaces before
// and after an edit within the edit's index box and carves the labelmap, off the main thread. It
// also runs the surface diagnostics the canvas shows, which walk every edge of a surface, the
// delta of an edit that moved the surface (ohif-viewers#148, AR-5), and the smoothing itself.

import { expose } from 'comlink';

import { assembleCut, prepareCut, prepareRepair } from './deleteSelection.js';
import { carveLabelmap, deltaLabelmap } from './labelmapCarve.js';
import { conditionSurface, edgeStatistics, surfaceDiagnostics, triangleTopology } from './meshRepair.js';
import { smoothAndDiagnose } from './smoothSelection.js';


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
   * The smooth and the diagnosis of its result as the delta write would voxelize it
   * (`written`), in one call: the geometry does not travel twice.
   *
   * @param {Object} args - see smoothSurface
   */
  async smooth(args) {
    return smoothAndDiagnose(args);
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
   * The health of a surface, once per surface version (ohif-viewers#149 FR-1, FR-3): its open,
   * non-manifold and inconsistently wound edges (in raw vertex indices of the surface), the
   * pre-existing degenerate and duplicate triangles, what the conditioning did with a requested
   * weld, and the edge-length statistics the weld cap and relative settings derive from.
   *
   * @param {{ points, polys, weldTolerance? }} args
   */
  async diagnose({ points, polys, weldTolerance = 0 }) {
    const conditioned = conditionSurface({ points, polys }, { weldTolerance });
    const { triangles, degenerate, duplicate } = conditioned;
    return {
      ...surfaceDiagnostics(triangles),
      degenerate,
      duplicate,
      triangles: triangles.length / 3,
      conditioning: {
        requestedWeldTolerance: conditioned.requestedWeldTolerance,
        effectiveWeldTolerance: conditioned.effectiveWeldTolerance,
        fellBack: conditioned.fellBack,
        preservation: conditioned.preservation,
      },
      edges: edgeStatistics(points, triangles),
    };
  },
};

expose(carve);
