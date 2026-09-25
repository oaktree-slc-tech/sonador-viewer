// The 3D Selection tool's delete (ohif-viewers#142, FR-20..FR-22): remove the selected points from
// a segment's surface, close the holes, and remove from the segment's labelmap the voxels the
// edited surface no longer contains.
//
//   1. Cut (main thread): the triangles touching the selected vertices are removed, and the
//      boundary loops of the resulting holes are found.
//   2. Patch (hole-filling worker, OpenCascade): one smooth patch per hole, stitched to it.
//   3. Voxelize (polymorphic segmentation worker): the original and the edited surfaces, on one
//      grid.
//   4. Carve (main thread): the segment's voxels the edit moved outside (labelmapCarve).
//   5. Write: those voxels are cleared in the working labelmap, recorded for undo.
//
// The steps that need workers or Cornerstone3D state are injected (`deps`), so the pipeline itself
// is plain data in, plain data out.

import {
  assembleSurface,
  cutSurface,
  findBoundaryLoops,
  loopPositions,
} from './meshCut.js';
import {
  computeCarvedVoxels,
  createGridLookup,
  createPointProximity,
  volumeAxes,
  worldBoxToIndexBox,
} from './labelmapCarve.js';


/** Thrown when a delete is abandoned (its session or target became invalid) before writing. */
export class DeleteCancelledError extends Error {
  constructor(message = 'The removal was cancelled') {
    super(message);
    this.name = 'DeleteCancelledError';
  }
}

export const DELETE_STEPS = {
  cut: 'cut',
  patch: 'patch',
  voxelize: 'voxelize',
  write: 'write',
};

function _bounds(points, into = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }) {
  for (let v = 0; v < points.length; v += 3) {
    for (let d = 0; d < 3; d++) {
      into.min[d] = Math.min(into.min[d], points[v + d]);
      into.max[d] = Math.max(into.max[d], points[v + d]);
    }
  }
  return into;
}

function _pad(box, amount) {
  return { min: box.min.map(v => v - amount), max: box.max.map(v => v + amount) };
}

/**
 * The surface with two extra, unreferenced points at the corners of `box`. The voxelizer sizes its
 * grid to the points' bounds, so giving both surfaces the same corners puts them on one grid.
 */
export function withGridCorners({ points, polys }, box) {
  const out = new Float32Array(points.length + 6);
  out.set(points);
  out.set(box.min, points.length);
  out.set(box.max, points.length + 3);
  return { points: out, polys };
}

/**
 * @param {Object} params
 * @param {{ points: ArrayLike<number>, polys: ArrayLike<number> }} params.surface - the segment's
 *   surface (world coordinates)
 * @param {Iterable<number>} params.selected - selected vertex indices of that surface
 * @param {number} params.segmentIndex
 * @param {number} [params.depth] - removal depth (world units, mm): segment voxels within this
 *   distance of the selected points are removed as well (labelmapCarve)
 * @param {Object} params.labelmap - the working labelmap
 * @param {ArrayLike<number>} params.labelmap.scalarData
 * @param {number[]} params.labelmap.dimensions
 * @param {Function} params.labelmap.indexToWorld - ([i, j, k]) => [x, y, z]
 * @param {Object} params.deps
 * @param {Function} params.deps.patchHoles - async (loops: Float64Array[]) => [{ patch, method, error }]
 * @param {Function} params.deps.voxelize - async ({ points, polys }) => voxelizer result
 * @param {Function} params.deps.removeVoxels - (indices: Int32Array) => void
 * @param {Function} [params.deps.isCancelled] - () => true once the delete must not continue;
 *   checked after each awaited stage, and so before the voxel write
 * @param {Function} [params.onStep] - (step) => void, for progress display
 * @returns {Promise<{ removedVoxels: number, holes: number, cappedHoles: number, patchErrors: string[] }>}
 */
export async function deleteSelection({
  surface, selected, segmentIndex, depth = 0, labelmap, deps, onStep = () => {},
}) {
  const checkCancelled = () => {
    if (deps.isCancelled?.()) {
      throw new DeleteCancelledError();
    }
  };

  onStep(DELETE_STEPS.cut);
  const selectedList = Array.from(selected);
  const cut = cutSurface({ points: surface.points, polys: surface.polys, selected: selectedList });
  if (!cut.removedCount) {
    return { removedVoxels: 0, holes: 0, cappedHoles: 0, patchErrors: [] };
  }
  const loops = findBoundaryLoops(cut.triangles);
  const loopPoints = loops.map(loop => loopPositions(surface.points, loop));

  onStep(DELETE_STEPS.patch);
  const results = loops.length ? await deps.patchHoles(loopPoints) : [];
  checkCancelled();
  const patches = loops.map((loop, i) => ({ loop, patch: results[i].patch }));
  const edited = cut.triangles.length
    ? assembleSurface({ points: surface.points, triangles: cut.triangles, patches })
    : null;

  // One voxelization grid for both surfaces, a little larger than either
  onStep(DELETE_STEPS.voxelize);
  const bounds = _bounds(surface.points);
  if (edited) {
    _bounds(edited.points, bounds);
  }
  const extent = Math.max(...bounds.max.map((v, d) => v - bounds.min[d]));
  const gridBox = _pad(bounds, extent * 0.02);

  const originalGrid = await deps.voxelize(withGridCorners(surface, gridBox));
  checkCancelled();
  const editedGrid = edited ? await deps.voxelize(withGridCorners(edited, gridBox)) : null;
  checkCancelled();

  // Only the neighbourhood of the edit can change: the removed points, the hole boundaries and the
  // patches, padded by a few labelmap voxels and one voxelizer cell
  const selectedPoints = new Float64Array(selectedList.length * 3);
  selectedList.forEach((v, i) => selectedPoints.set(
    [surface.points[3 * v], surface.points[3 * v + 1], surface.points[3 * v + 2]], 3 * i));
  const editBox = _bounds(selectedPoints);
  loopPoints.forEach(points => _bounds(points, editBox));
  results.forEach(({ patch }) => _bounds(patch.points, editBox));

  const axes = volumeAxes(labelmap.indexToWorld);
  const voxelSize = Math.max(...[axes.di, axes.dj, axes.dk].map(v => Math.hypot(...v)));
  const gridSpacing = Math.max(...Array.from(originalGrid?.spacing || [0]));
  const indexBox = worldBoxToIndexBox(
    _pad(editBox, 3 * voxelSize + gridSpacing + Math.max(depth, 0)), axes, labelmap.dimensions);

  const indices = indexBox
    ? computeCarvedVoxels({
      scalarData: labelmap.scalarData,
      dimensions: labelmap.dimensions,
      segmentIndex,
      axes,
      indexBox,
      insideOriginal: createGridLookup(originalGrid),
      insideEdited: editedGrid ? createGridLookup(editedGrid) : () => false,
      nearRemoved: createPointProximity(selectedPoints, depth),
    })
    : new Int32Array(0);

  onStep(DELETE_STEPS.write);
  if (indices.length) {
    deps.removeVoxels(indices);
  }

  const capped = results.filter(result => result.method !== 'fitted');
  return {
    removedVoxels: indices.length,
    holes: loops.length,
    cappedHoles: capped.length,
    patchErrors: capped.map(result => result.error).filter(Boolean),
  };
}
