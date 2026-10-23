// The 3D Selection tool's delete (ohif-viewers#142, FR-20..FR-27): remove the selected points from
// a segment's surface, close the holes, and remove from the segment's labelmap the voxels the
// edited surface no longer contains. Two stages:
//
//   cutAndPatch (foreground, before the surface is shown edited)
//     1. Cut (prepareCut; the carve worker when the canvas runs it): the selected triangles (and
//        any triangle touching a selected vertex) are removed, the rim is cleaned, and the
//        boundary loops of the resulting holes are found.
//     2. Patch (hole-filling worker, OpenCascade): one smooth patch per hole, stitched to it.
//     3. Assemble (assembleCut; the carve worker again): the kept triangles and the patches become
//        the edited surface, and its diagnostics are taken.
//
//   carveLabelmap (background, after the surface is shown edited; labelmapCarve)
//     3. Voxelize both surfaces within the edit's index box, on the labelmap grid.
//     4. Carve: the segment's voxels the edit moved outside.
//
// The steps that need workers or Cornerstone3D state are injected (`deps`), so the pipeline itself
// is plain data in, plain data out. `deleteSelection` runs both stages in turn.

import {
  carveLabelmap,
  extractIndexBox,
  volumeAxes,
  worldBoxToIndexBox,
} from './labelmapCarve.js';
import {
  assembleSurface,
  findBoundaryLoopsDetailed,
  loopPositions,
} from './meshCut.js';
import { cleanRim, compareDefects, conditionSurface, surfaceDiagnostics } from './meshRepair.js';
import { validateBox, validatePatch, validateSurface } from './surfaceValidity.js';


/** Thrown when an edit is abandoned (its session or target became invalid) before writing. */
export class SurfaceEditCancelledError extends Error {
  constructor(message = 'The edit was cancelled') {
    super(message);
    this.name = 'SurfaceEditCancelledError';
  }
}

export { SurfaceEditCancelledError as DeleteCancelledError };

export const DELETE_STEPS = {
  cut: 'cut',
  patch: 'patch',
  smooth: 'smooth',
  voxelize: 'voxelize',
  write: 'write',
};

// Index cells added on each side of the edit's index domain (ohif-viewers#149, FR-6): the world
// box of the removed triangles, their patches and the removal depth is mapped to index space and
// grown by exactly this many cells per axis, whatever the spacing. The carve's shell passes reach
// at most this far from a removed voxel.
export const EDIT_BOX_PADDING_CELLS = 2;

export const RIM_CLEANUPS = {
  off: 'off',
  light: 'light',
  full: 'full',
};

// Ear-removal passes per rim cleanup level; islands are removed at every level but off
const RIM_CLEANUP_PASSES = { [RIM_CLEANUPS.off]: 0, [RIM_CLEANUPS.light]: 1, [RIM_CLEANUPS.full]: 3 };

/**
 * Defaults of the cut-and-patch options (the 3D tool state holds the user's values). The weld is
 * exact by default and the fit ladder is capped at eight constraints (ohif-viewers#149, FR-1 and
 * FR-7).
 */
export const EDIT_OPTION_DEFAULTS = Object.freeze({
  closure: 'auto',
  rimCleanup: RIM_CLEANUPS.full,
  weldTolerance: 0,
  islandMaxTriangles: 50,
  maxConstraints: 8,
});

export const EMPTY_SURFACE = Object.freeze({ points: new Float32Array(0), polys: new Int32Array(0) });

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

const _summary = diagnostics => ({
  boundaryEdgeCount: diagnostics.boundaryEdgeCount,
  nonManifoldEdgeCount: diagnostics.nonManifoldEdgeCount,
  inconsistentEdgeCount: diagnostics.inconsistentEdgeCount,
  closed: diagnostics.closed,
});

// The defect edges of the input, kept for the comparison with the result (compareDefects)
const _defectEdges = diagnostics => ({
  boundaryEdges: diagnostics.boundaryEdges,
  nonManifoldEdges: diagnostics.nonManifoldEdges,
  inconsistentEdges: diagnostics.inconsistentEdges,
});

// What the conditioning did, for the report: the pre-existing degenerates and duplicates apart
// from anything the action removes, and whether a requested weld was kept
const _conditioning = conditioned => ({
  degenerate: conditioned.degenerate,
  duplicate: conditioned.duplicate,
  requestedWeldTolerance: conditioned.requestedWeldTolerance,
  effectiveWeldTolerance: conditioned.effectiveWeldTolerance,
  fellBack: conditioned.fellBack,
  preservation: conditioned.preservation,
});

// An input, patch or result that fails the data-integrity checks: nothing is assembled, and the
// caller refuses the edit before anything is shown (ohif-viewers#149 FR-4)
const _invalid = (invalid, diagnostics, extra = {}) => ({
  changed: false, invalid, edited: null, editBox: null, selectedPoints: new Float64Array(0),
  holes: 0, cappedHoles: 0, patchErrors: [], diagnostics: { ...diagnostics, invalid }, ...extra,
});

/**
 * Assemble the edited surface from the kept triangles and the patches, and report on it. Plain
 * data in and out, so it runs in the carve worker (segmentEdits.assembleCutInWorker). The
 * result's defects are compared with the input's, so the report can tell the ones the cut
 * introduced from the openings it left alone (ohif-viewers#149 FR-5); the result is `acceptable`
 * for a labelmap write only when it has no open, non-manifold or inconsistent edge at all, of
 * either origin. A detected defect, retained or new, needs the user's explicit acknowledgement
 * before voxelization (FR-4, ohif-viewers#152 §3), which this stage cannot give. The patches and
 * the result are checked for finite coordinates and valid indices first: an invalid result is
 * returned as `invalid`, unassembled (FR-4's data-integrity refusal).
 *
 * @param {Object} params
 * @param {ArrayLike<number>} params.surfacePoints - the surface's flat xyz
 * @param {ArrayLike<number>} params.kept - the kept triangles (canonical vertex triples)
 * @param {Int32Array[]} params.loops - the holes' boundary loops to close (vertex indices)
 * @param {Array} params.results - the patches, one per loop (patchHoles)
 * @param {{ min, max }} params.editBox - the world box the edit can affect so far (grown here)
 * @param {Float64Array} params.selectedPoints
 * @param {Object} params.diagnostics - prepareCut's, with `inputEdges` for the comparison
 * @param {Object} params.options - EDIT_OPTION_DEFAULTS
 */
export function assembleCut({ surfacePoints, kept, loops, results, editBox, selectedPoints, diagnostics, options }) {
  const opts = { ...EDIT_OPTION_DEFAULTS, ...options };
  const { inputEdges } = diagnostics;
  const rest = { ...diagnostics };
  delete rest.inputEdges;
  const patchErrors = results.map(result => result.error).filter(Boolean);

  for (let i = 0; i < results.length; i++) {
    const problem = validatePatch(results[i].patch);
    if (problem) {
      return _invalid({ ...problem, where: 'patch', loop: i }, rest, { patchErrors, holes: loops.length, selectedPoints });
    }
  }
  const loopPoints = loops.map(loop => loopPositions(surfacePoints, loop));
  const patches = loops.map((loop, i) => ({ loop, patch: results[i].patch }));
  const edited = kept.length
    ? assembleSurface({ points: surfacePoints, triangles: kept, patches })
    : null;
  const editedProblem = edited && validateSurface(edited);
  if (editedProblem) {
    return _invalid({ ...editedProblem, where: 'after' }, rest, { patchErrors, holes: loops.length, selectedPoints });
  }

  const box = { min: [...editBox.min], max: [...editBox.max] };
  loopPoints.forEach(points => _bounds(points, box));
  results.forEach(({ patch }) => _bounds(patch.points, box));
  const boxProblem = edited && validateBox(box);
  if (boxProblem) {
    return _invalid({ ...boxProblem, where: 'editBox' }, rest, { patchErrors, holes: loops.length, selectedPoints });
  }

  const methods = { fitted: 0, flat: 0, cap: 0 };
  let fallbacks = 0;
  results.forEach(result => {
    methods[result.method] = (methods[result.method] || 0) + 1;
    // Not closed the way the closure asked: a fit that fell back, or a fan
    if (result.error || (result.method === 'cap' && opts.closure !== 'flat')) {
      fallbacks++;
    }
  });
  let output = null;
  let introduced = null;
  if (edited) {
    const outputDiagnostics = surfaceDiagnostics(conditionSurface(edited).triangles);
    output = _summary(outputDiagnostics);
    introduced = compareDefects(
      { points: surfacePoints, diagnostics: inputEdges },
      { points: edited.points, diagnostics: outputDiagnostics });
  }
  return {
    changed: true,
    invalid: null,
    edited,
    editBox: box,
    selectedPoints,
    holes: loops.length,
    cappedHoles: fallbacks,
    patchErrors,
    diagnostics: {
      ...rest,
      methods,
      fallbacks,
      fits: results.map(result => result.attempts || []),
      output,
      introduced,
      // No open, non-manifold or inverted edge is left, of either origin: the result can be
      // written without an acknowledgement. An emptied surface (the whole segment removed) is a
      // valid deletion with nothing to diagnose.
      acceptable: !output || output.closed,
      emptied: !edited,
    },
  };
}

const _unchanged = diagnostics => ({
  changed: false, edited: null, editBox: null, selectedPoints: new Float64Array(0),
  holes: 0, cappedHoles: 0, patchErrors: [], diagnostics,
});

/**
 * Split the boundary loops of the cut surface into the ones the cut opened (sharing a vertex with
 * a removed triangle or the rim cleanup) and the pre-existing ones it did not touch, which are
 * reported and left as they are (ohif-viewers#149, FR-5).
 */
export function splitTouchingLoops(loops, touching) {
  const touchingLoops = [];
  const preexisting = [];
  loops.forEach(loop => {
    if (loop.some(v => touching.has(v))) {
      touchingLoops.push(loop);
    } else {
      preexisting.push(loop);
    }
  });
  return {
    loops: touchingLoops,
    preexistingLoops: { count: preexisting.length, vertexCounts: preexisting.map(loop => loop.length) },
  };
}

function _points(surfacePoints, vertices) {
  const points = new Float64Array(vertices.length * 3);
  vertices.forEach((v, i) => points.set(
    [surfacePoints[3 * v], surfacePoints[3 * v + 1], surfacePoints[3 * v + 2]], 3 * i));
  return points;
}

/**
 * The cut before the patches: condition the surface, remove the selected triangles, clean the
 * rim, and find the holes' boundary loops. Plain data in and out, so it runs in the carve worker
 * (segmentEdits.prepareCutInWorker). The removed points, which the removal depth is measured
 * from and the edit box starts from, are the selected vertices and the vertices of every removed
 * triangle, the rim cleanup's included (nothing removed may fall outside the labelmap write).
 *
 * @param {Object} params - cutAndPatch's surface, selected, selectedTriangles and options
 * @returns {{ changed: boolean, kept?: Int32Array, loops?: Int32Array[], loopPoints?: Float64Array[],
 *   selectedPoints?: Float64Array, editBox?: Object, diagnostics: Object }}
 */
export function prepareCut({ surface, selected = [], selectedTriangles = [], options = {} }) {
  const opts = { ...EDIT_OPTION_DEFAULTS, ...options };
  const sourceProblem = validateSurface(surface);
  if (sourceProblem) {
    return _invalid({ ...sourceProblem, where: 'before' }, { removedTriangles: 0 });
  }
  const selectedVertices = new Set(selected);
  const selectedCells = new Set(selectedTriangles);
  const conditioned = conditionSurface(surface, { weldTolerance: opts.weldTolerance });
  const inputDiagnostics = surfaceDiagnostics(conditioned.triangles);
  const input = _summary(inputDiagnostics);
  const selectedCanonical = new Set(Array.from(selectedVertices, v => conditioned.canonical[v]));
  const keptRaw = [];
  const rim = new Set();
  let removedCount = 0;
  const { triangles, source } = conditioned;
  for (let t = 0; t < triangles.length; t += 3) {
    const cell = source[t / 3];
    const touchesVertex = selectedCanonical.has(triangles[t]) || selectedCanonical.has(triangles[t + 1])
      || selectedCanonical.has(triangles[t + 2]);
    if (selectedCells.has(cell) || touchesVertex) {
      removedCount++;
      rim.add(triangles[t]);
      rim.add(triangles[t + 1]);
      rim.add(triangles[t + 2]);
      if (selectedCells.has(cell)) {
        selectedVertices.add(surface.polys[4 * cell + 1]);
        selectedVertices.add(surface.polys[4 * cell + 2]);
        selectedVertices.add(surface.polys[4 * cell + 3]);
      }
    } else {
      keptRaw.push(triangles[t], triangles[t + 1], triangles[t + 2]);
    }
  }
  if (!removedCount) {
    return _unchanged({ input, removedTriangles: 0, conditioning: _conditioning(conditioned) });
  }

  const cleanup = cleanRim(keptRaw, {
    passes: RIM_CLEANUP_PASSES[opts.rimCleanup] ?? 0,
    islandMaxTriangles: opts.rimCleanup === RIM_CLEANUPS.off ? 0 : opts.islandMaxTriangles,
    touching: rim,
  });
  // Whatever the cleanup removed is part of the edit too, and its vertices join the rim the
  // affected loops are found from
  const touching = new Set(rim);
  cleanup.removed.forEach(v => {
    selectedVertices.add(v);
    touching.add(v);
  });
  const kept = cleanup.triangles;
  const found = findBoundaryLoopsDetailed(kept);
  const { loops, preexistingLoops } = splitTouchingLoops(found.loops, touching);
  const selectedPoints = _points(surface.points, Array.from(selectedVertices));
  return {
    changed: true,
    kept,
    loops,
    loopPoints: loops.map(loop => loopPositions(surface.points, loop)),
    selectedPoints,
    editBox: _bounds(selectedPoints),
    diagnostics: {
      input,
      inputEdges: _defectEdges(inputDiagnostics),
      conditioning: _conditioning(conditioned),
      degenerate: conditioned.degenerate,
      duplicate: conditioned.duplicate,
      removedTriangles: removedCount,
      earsRemoved: cleanup.earsRemoved,
      islandsRemoved: cleanup.islandsRemoved,
      removedByCleanup: cleanup.removed.length / 3,
      openEdges: found.openEdges,
      preexistingLoops,
    },
  };
}

/**
 * A repair before the patches: condition the surface and find every boundary loop. Runs in the
 * carve worker like prepareCut. Every loop is closed; the rim half-edges no loop could use are
 * reported as `openEdges`, with the input's non-manifold and inconsistent counts, so the caller
 * can say what a repair cannot close yet (ohif-viewers#149, FR-8/FR-10).
 */
export function prepareRepair({ surface, options = {} }) {
  const opts = { ...EDIT_OPTION_DEFAULTS, ...options };
  const sourceProblem = validateSurface(surface);
  if (sourceProblem) {
    return _invalid({ ...sourceProblem, where: 'before' }, { removedTriangles: 0 });
  }
  const conditioned = conditionSurface(surface, { weldTolerance: opts.weldTolerance });
  const inputDiagnostics = surfaceDiagnostics(conditioned.triangles);
  const input = _summary(inputDiagnostics);
  const { loops, openEdges } = findBoundaryLoopsDetailed(conditioned.triangles);
  const diagnostics = {
    input,
    inputEdges: _defectEdges(inputDiagnostics),
    conditioning: _conditioning(conditioned),
    degenerate: conditioned.degenerate,
    duplicate: conditioned.duplicate,
    removedTriangles: 0,
    earsRemoved: 0,
    islandsRemoved: 0,
    removedByCleanup: 0,
    openEdges,
    preexistingLoops: { count: 0, vertexCounts: [] },
  };
  if (!loops.length) {
    const rest = { ...diagnostics };
    delete rest.inputEdges;
    return _unchanged(rest);
  }
  return {
    changed: true,
    kept: conditioned.triangles,
    loops,
    loopPoints: loops.map(loop => loopPositions(surface.points, loop)),
    selectedPoints: new Float64Array(0),
    editBox: { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] },
    diagnostics,
  };
}

/**
 * Cut the selected triangles out of a surface and close the holes: prepareCut, the patches, and
 * assembleCut, each injectable so the whole-mesh stages can run in a worker.
 *
 * @param {Object} params
 * @param {{ points: ArrayLike<number>, polys: ArrayLike<number> }} params.surface - the segment's
 *   surface (world coordinates)
 * @param {Iterable<number>} [params.selectedTriangles] - selected triangles of that surface (cell
 *   indices of `polys`): removed as they are
 * @param {Iterable<number>} [params.selected] - selected vertex indices: every triangle touching
 *   one is removed
 * @param {Object} [params.options] - EDIT_OPTION_DEFAULTS
 * @param {Object} params.deps
 * @param {Function} params.deps.patchHoles - async (loops: Float64Array[], options) => [{ patch, method, error }]
 * @param {Function} [params.deps.prepareCut] - async or sync, prepareCut's shape (default: here)
 * @param {Function} [params.deps.assembleCut] - async or sync, assembleCut's shape (default: here)
 * @param {Function} [params.deps.isCancelled] - () => true once the delete must not continue
 * @param {Function} [params.onStep] - (step) => void, for progress display
 * @returns {Promise<{ changed: boolean, edited: { points, polys, patchPolysOffset }|null,
 *   editBox: Object|null, selectedPoints: Float64Array, holes: number, cappedHoles: number,
 *   patchErrors: string[], diagnostics: Object }>} `edited` is null when the whole surface was
 *   removed; `selectedPoints` are the removed triangles' vertices (and the selected ones);
 *   `editBox` is the world box around them, the hole boundaries and the patches; `diagnostics`
 *   reports the input's and the result's open and non-manifold edges, the open chains no patch
 *   could close, the rim cleanup, and the patch methods
 */
export async function cutAndPatch({
  surface, selected = [], selectedTriangles = [], options = {}, deps, onStep = () => {},
}) {
  const opts = { ...EDIT_OPTION_DEFAULTS, ...options };
  const { prepareCut: prepare = prepareCut, assembleCut: assemble = assembleCut } = deps;
  const checkCancelled = () => {
    if (deps.isCancelled?.()) {
      throw new SurfaceEditCancelledError();
    }
  };

  onStep(DELETE_STEPS.cut);
  const prepared = await prepare({
    surface, selected: Array.from(selected), selectedTriangles: Array.from(selectedTriangles), options: opts,
  });
  checkCancelled();
  if (!prepared.changed) {
    return prepared;
  }

  onStep(DELETE_STEPS.patch);
  const results = prepared.loops.length
    ? await deps.patchHoles(prepared.loopPoints, { closure: opts.closure, maxConstraints: opts.maxConstraints })
    : [];
  checkCancelled();

  const assembled = await assemble({
    surfacePoints: surface.points, kept: prepared.kept, loops: prepared.loops, results,
    editBox: prepared.editBox, selectedPoints: prepared.selectedPoints, diagnostics: prepared.diagnostics,
    options: opts,
  });
  checkCancelled();
  return assembled;
}

/**
 * Close the open rims of a surface without removing anything: the surface is conditioned and
 * every boundary loop is patched. Nothing is written to the labelmap for a repair.
 *
 * @param {Object} params - as cutAndPatch, without `selected`; `deps.prepareRepair` injectable
 * @returns {Promise<Object>} as cutAndPatch; `changed` is false when the surface has no open rim
 */
export async function repairSurface({ surface, options = {}, deps, onStep = () => {} }) {
  const opts = { ...EDIT_OPTION_DEFAULTS, ...options };
  const { prepareRepair: prepare = prepareRepair, assembleCut: assemble = assembleCut } = deps;
  const checkCancelled = () => {
    if (deps.isCancelled?.()) {
      throw new SurfaceEditCancelledError();
    }
  };

  onStep(DELETE_STEPS.cut);
  const prepared = await prepare({ surface, options: opts });
  checkCancelled();
  if (!prepared.changed) {
    return prepared;
  }

  onStep(DELETE_STEPS.patch);
  const results = await deps.patchHoles(prepared.loopPoints, { closure: opts.closure, maxConstraints: opts.maxConstraints });
  checkCancelled();

  const assembled = await assemble({
    surfacePoints: surface.points, kept: prepared.kept, loops: prepared.loops, results,
    editBox: prepared.editBox, selectedPoints: prepared.selectedPoints, diagnostics: prepared.diagnostics,
    options: opts,
  });
  checkCancelled();
  return assembled;
}

/**
 * The labelmap index domain an edit may write (ohif-viewers#149, FR-6): its world box (the removed
 * triangles, their patches and whatever else the edit moved) grown by the removal depth in world
 * coordinates, mapped to index space through the volume's own axes, and grown by exactly
 * EDIT_BOX_PADDING_CELLS cells per axis. No voxel outside it may change; the writer checks.
 *
 * @param {Object} params
 * @param {{ min, max }} params.editBox
 * @param {number} [params.depth] - world units
 * @param {{ dimensions: number[], indexToWorld: Function }} params.labelmap
 * @returns {{ axes: Object, indexBox: { min, max }|null }} inclusive index bounds, clamped to the
 *   volume; null when the edit misses it
 */
export function editIndexBox({ editBox, depth = 0, labelmap }) {
  const axes = volumeAxes(labelmap.indexToWorld);
  const indexBox = worldBoxToIndexBox(
    _pad(editBox, Math.max(depth, 0)), axes, labelmap.dimensions, EDIT_BOX_PADDING_CELLS);
  return { axes, indexBox };
}

/**
 * @param {Object} params
 * @param {{ points, polys }} params.surface - the segment's surface (world coordinates)
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
 * @param {Function} [params.deps.carve] - async (args) => Int32Array (default: carveLabelmap in
 *   this thread)
 * @param {Function} params.deps.removeVoxels - (indices: Int32Array) => void
 * @param {Function} [params.deps.isCancelled] - () => true once the delete must not continue;
 *   checked after each awaited stage, and so before the voxel write
 * @param {Function} [params.onStep] - (step) => void, for progress display
 * @returns {Promise<{ removedVoxels: number, holes: number, cappedHoles: number, patchErrors: string[],
 *   edited: { points, polys }|null }>}
 */
export async function deleteSelection({
  surface, selected, segmentIndex, depth = 0, labelmap, options, deps, onStep = () => {},
}) {
  const checkCancelled = () => {
    if (deps.isCancelled?.()) {
      throw new SurfaceEditCancelledError();
    }
  };

  const cut = await cutAndPatch({ surface, selected, options, deps, onStep });
  if (!cut.changed) {
    return { removedVoxels: 0, holes: 0, cappedHoles: 0, patchErrors: [], edited: null };
  }

  onStep(DELETE_STEPS.voxelize);
  const { axes, indexBox } = editIndexBox({ editBox: cut.editBox, depth, labelmap });
  let indices = new Int32Array(0);
  if (indexBox) {
    const carve = deps.carve || (args => carveLabelmap(args));
    indices = await carve({
      original: surface,
      edited: cut.edited,
      boxData: extractIndexBox(labelmap.scalarData, labelmap.dimensions, indexBox),
      dimensions: labelmap.dimensions,
      segmentIndex,
      axes,
      indexBox,
      selectedPoints: cut.selectedPoints,
      depth,
    });
    checkCancelled();
  }

  onStep(DELETE_STEPS.write);
  if (indices.length) {
    deps.removeVoxels(indices);
  }

  return {
    removedVoxels: indices.length,
    holes: cut.holes,
    cappedHoles: cut.cappedHoles,
    patchErrors: cut.patchErrors,
    edited: cut.edited,
    diagnostics: cut.diagnostics,
  };
}
