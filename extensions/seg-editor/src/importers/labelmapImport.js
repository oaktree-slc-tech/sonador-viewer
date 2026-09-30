// Import into the Segmentation Editor's working segmentation: new segments, numbered on from the
// highest segment the segmentation has, with their voxels placed on the editor's labelmap grid.
//
// One entry point for every source. A source hands over either 3D models (closed surfaces, one
// segment each: STL files, or the models of an M3D series) or a labelled voxel grid (a DICOM SEG,
// NRRD or NIfTI, one segment per value). Models are voxelized as the models-to-segmentation
// conversion voxelizes them (threeDTools/modelsToLabelmap); grids are resampled nearest-voxel
// (labelmapGrid). Either way the result is a labelmap on the editor's grid, which is then
// committed: the segments are added to the segmentation and the voxels written through the
// editor's undo history, so an import can be undone like any edit.
//
// The commit is where identities are settled. Rasterizing waits on a worker, and the segmentation
// can change meanwhile (another import, Add Segment, the editor closing), so the segment numbers
// are allocated from the segmentation as it is at commit time, imports into one segmentation run
// one after another, and a segmentation that is gone by then is refused. The commit itself is
// synchronous, and is undone if a segment add or the voxel write throws: the segments added so far
// are removed (a service call that mutated before throwing included), the voxels written so far
// are put back, and the active segment is restored, so a failed import leaves the segmentation as
// it was and nothing of it in the undo history. The boundary is the recorded voxel write: once
// it is committed the import stands, and a listener failing while the views are told is logged
// by the write (threeDTools/segmentEdits), not unwound.
//
// The worker the models are voxelized on is the polySeg worker, which the editor terminates when
// the surface is turned off or the editor closes; a job it was running never settles. Imports
// follow the wrapper's reset (polySegSingleFlight): the import in flight and those queued behind
// it are cancelled, so a later import does not wait behind a dead one; the model loop sends no
// further model to the worker and reports no further progress, and a late result cannot commit.
//
// Where an imported voxel lands on a voxel that already has a segment, the import wins, unless
// that segment is locked: locked segments are not modified by any tool (ohif-viewers#142), so
// their voxels are left as they are and counted for the caller.

import { segmentation as c3dSegmentations } from '@cornerstonejs/tools';

import log from '@ohif/core/src/log.js';
import { subscribePolySegReset } from '@ohif/core/src/utils/polySegSingleFlight';

import { volumeAxes } from '../threeDTools/labelmapCarve.js';
import { VoxelizationCancelledError, voxelizeModels } from '../threeDTools/modelsToLabelmap.js';
import { editLabelmapVoxels, getLabelmapForEdit, voxelizeSurfaceInWorker } from '../threeDTools/segmentEdits.js';

import { gridWorldBounds, resampleGridToLabelmap } from './labelmapGrid.js';


// The labelmap's voxels are 8-bit (extension-vtk labelmapBridge canonicalScalarTypeFor)
export const MAX_SEGMENT_INDEX = 255;

// Imports run one after another per segmentation (segmentationId -> promise of the last one)
const importChains = new Map();

// Cancellation: every import belongs to the generation it started in; a reset of the polySeg
// worker starts a new one and releases everything waiting on the old
let importGeneration = 0;
let cancelPending = () => {};
let cancelled = new Promise(resolve => { cancelPending = resolve; });

export class ImportCancelledError extends Error {
  constructor() {
    super('The import was cancelled');
    this.name = 'ImportCancelledError';
    this.cancelled = true;
  }
}

function _cancelImports() {
  importGeneration += 1;
  importChains.clear();
  const release = cancelPending;
  cancelled = new Promise(resolve => { cancelPending = resolve; });
  release();
}

subscribePolySegReset(_cancelImports);

/**
 * The segment numbers an import of `count` segments gets: consecutive, from one past the highest
 * segment the segmentation has.
 *
 * @param {Object} segmentation - the Cornerstone3D segmentation
 * @param {number} count
 * @returns {number[]}
 */
export function allocateSegmentIndices(segmentation, count) {
  const existing = Object.keys(segmentation?.segments || {}).map(Number).filter(Number.isFinite);
  const first = (existing.length ? Math.max(...existing) : 0) + 1;
  if (first + count - 1 > MAX_SEGMENT_INDEX) {
    throw new Error(`The segmentation can hold at most ${MAX_SEGMENT_INDEX} segments`);
  }
  return Array.from({ length: count }, (_, i) => first + i);
}

function _extendBounds(bounds, points) {
  for (let p = 0; p < points.length; p += 3) {
    for (let d = 0; d < 3; d++) {
      bounds.min[d] = Math.min(bounds.min[d], points[p + d]);
      bounds.max[d] = Math.max(bounds.max[d], points[p + d]);
    }
  }
  return bounds;
}

const _emptyBounds = () => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });

/**
 * World-space extent of an import payload (its models' points, or its grid's voxel centres) and
 * of a target labelmap grid, for telling the user where things are when they do not meet.
 *
 * @returns {{ min: number[], max: number[] }|null} null when there is nothing to measure
 */
export function payloadWorldBounds(payload) {
  if (payload.grid) {
    return gridWorldBounds(payload.grid);
  }
  const bounds = _emptyBounds();
  (payload.models || []).forEach(model => model.surface?.points && _extendBounds(bounds, model.surface.points));
  return Number.isFinite(bounds.min[0]) ? bounds : null;
}

export function labelmapWorldBounds({ dimensions, axes }) {
  const { origin, di, dj, dk } = axes;
  const corners = [];
  for (let corner = 0; corner < 8; corner++) {
    const i = corner & 1 ? dimensions[0] - 1 : 0;
    const j = corner & 2 ? dimensions[1] - 1 : 0;
    const k = corner & 4 ? dimensions[2] - 1 : 0;
    corners.push(...[0, 1, 2].map(d => origin[d] + i * di[d] + j * dj[d] + k * dk[d]));
  }
  return _extendBounds(_emptyBounds(), corners);
}

/**
 * Voxelize an import's models, or resample its grid, onto the editor's labelmap grid. The
 * entries are numbered 1..n in the returned labelmap (the commit maps those to segment numbers).
 *
 * @returns {Promise<{ labelmap: Uint16Array, voxelsByEntry: Map<number, number>,
 *   failures: Array<{ entry: number, error: Error }> }>}
 */
export async function rasterizeImport({
  payload, dimensions, axes, voxelize, onProgress, isCancelled = () => false,
}) {
  const entries = payload.models || payload.segments;
  const entryNumbers = entries.map((_entry, i) => i + 1);

  if (payload.models) {
    const { labelmap, emptySegments, failures } = await voxelizeModels({
      models: payload.models.map((model, i) => ({ segmentIndex: entryNumbers[i], surface: model.surface })),
      dimensions,
      axes,
      voxelize,
      onProgress,
      isCancelled,
    });
    const voxelsByEntry = new Map();
    for (let i = 0; i < labelmap.length; i++) {
      if (labelmap[i]) {
        voxelsByEntry.set(labelmap[i], (voxelsByEntry.get(labelmap[i]) || 0) + 1);
      }
    }
    emptySegments.forEach(entry => voxelsByEntry.set(entry, 0));
    return { labelmap, voxelsByEntry, failures: failures.map(({ segmentIndex, error }) => ({ entry: segmentIndex, error })) };
  }

  const entryOfValue = new Map(payload.segments.map((segment, i) => [segment.value, entryNumbers[i]]));
  const { labelmap, voxelsByValue } = resampleGridToLabelmap({
    grid: payload.grid,
    dimensions,
    axes,
    mapValue: value => entryOfValue.get(value) || 0,
  });
  onProgress(1);
  return { labelmap, voxelsByEntry: voxelsByValue, failures: [] };
}

/**
 * Add an import's segments to a segmentation and write their voxels: the commit of an import.
 *
 * A segment that ends up with no voxels on the labelmap grid (a model or grid lying outside the
 * image, or a model the voxelizer rejects) is not added: an empty segment would look like something
 * was imported when nothing was. The segments that are added are numbered consecutively without it.
 *
 * @param {Object} params
 * @param {string} params.segmentationId - the editor's working segmentation
 * @param {Object} params.payload - `{ models: [{ label, color?, surface }] }` or
 *   `{ grid, segments: [{ value, label, color? }] }` (colours are RGB 0-255)
 * @param {Object} params.segmentationService - the OHIF segmentation service (segments are added
 *   through it so the panels and viewports hear of them)
 * @param {Function} [params.onProgress] - (fraction 0..1) => void
 * @param {Object} [params.deps] - injectable (tests)
 * @returns {Promise<{ segments: Array<{ segmentIndex: number, label: string, voxels: number }>,
 *   emptySegments: Array<{ label: string, error?: Error }>, overlapVoxels: number,
 *   lockedVoxels: number, writtenVoxels: number, sourceBounds: Object|null,
 *   targetBounds: Object }>} `segments` are the segments added; `emptySegments` those left out;
 *   `lockedVoxels` the imported voxels left out because a locked segment held their place; the
 *   bounds are world-space extents (mm) of the import and of the labelmap grid
 */
export function importIntoSegmentation(params) {
  const { segmentationId } = params;
  const generation = importGeneration;
  const previous = importChains.get(segmentationId) || Promise.resolve();
  // Waits for the import before it, or for the reset that would leave it waiting forever
  const job = Promise.race([previous.catch(() => {}), cancelled]).then(() => {
    if (generation !== importGeneration) {
      throw new ImportCancelledError();
    }
    return _importIntoSegmentation(params, generation);
  });
  importChains.set(segmentationId, job);
  job
    .finally(() => {
      if (importChains.get(segmentationId) === job) {
        importChains.delete(segmentationId);
      }
    })
    .catch(() => {});
  return job;
}

async function _importIntoSegmentation({
  segmentationId, payload, segmentationService, onProgress = () => {}, deps = {},
}, generation) {
  const {
    getLabelmap = getLabelmapForEdit,
    getSegmentation = id => segmentationService.getSegmentation(id),
    addSegment = (id, config) => segmentationService.addSegment(id, config),
    removeSegment = (id, index) => segmentationService.removeSegment(id, index, { skipRecordingHistory: true }),
    getActiveSegmentIndex = id => c3dSegmentations.segmentIndex.getActiveSegmentIndex(id),
    setActiveSegmentIndex = (id, index) => segmentationService.setActiveSegment(id, index),
    isSegmentLocked = (id, index) => c3dSegmentations.segmentLocking.isSegmentIndexLocked(id, index),
    writeVoxels = editLabelmapVoxels,
    restoreVoxels = _restoreVoxels,
    voxelize = voxelizeSurfaceInWorker,
  } = deps;

  const entries = payload.models || payload.segments || [];
  if (!entries.length) {
    throw new Error('There is nothing to import');
  }

  const labelmap = getLabelmap(segmentationId);
  if (!labelmap) {
    throw new Error('The segmentation\'s labelmap is not available');
  }
  const axes = volumeAxes(labelmap.indexToWorld);
  // Fail early on a segmentation that is already full; the numbers themselves are settled at commit
  allocateSegmentIndices(getSegmentation(segmentationId), entries.length);

  // Voxelizing waits on the worker, or on the reset that would leave it waiting forever. The loop
  // is told of the cancellation too, so a model result arriving after it neither reaches the
  // labelmap nor sends the next model, and progress stops with the import.
  const isCancelled = () => generation !== importGeneration;
  let rasterized;
  try {
    rasterized = await Promise.race([
      rasterizeImport({
        payload,
        dimensions: labelmap.dimensions,
        axes,
        voxelize,
        onProgress: fraction => !isCancelled() && onProgress(fraction),
        isCancelled,
      }),
      cancelled.then(() => null),
    ]);
  } catch (error) {
    if (error instanceof VoxelizationCancelledError) {
      throw new ImportCancelledError();
    }
    throw error;
  }
  if (!rasterized || isCancelled()) {
    throw new ImportCancelledError();
  }
  const { labelmap: imported, voxelsByEntry, failures } = rasterized;
  const bounds = {
    sourceBounds: payloadWorldBounds(payload),
    targetBounds: labelmapWorldBounds({ dimensions: labelmap.dimensions, axes }),
  };

  // Only the entries with voxels become segments
  const emptySegments = [];
  const added = [];
  entries.forEach((entry, i) => {
    const voxels = voxelsByEntry.get(i + 1) || 0;
    if (!voxels) {
      emptySegments.push({ label: entry.label, error: failures.find(f => f.entry === i + 1)?.error });
      return;
    }
    added.push({ entry: i + 1, label: entry.label, color: entry.color, voxels });
  });
  if (!added.length) {
    return { segments: [], emptySegments, overlapVoxels: 0, lockedVoxels: 0, writtenVoxels: 0, ...bounds };
  }

  // ---- The commit: from here on everything is synchronous, against the segmentation as it is now
  const segmentation = getSegmentation(segmentationId);
  const target = getLabelmap(segmentationId);
  if (!segmentation || !target || target.scalarData?.length !== imported.length) {
    throw new Error('The segmentation is no longer open');
  }
  const segmentIndices = allocateSegmentIndices(segmentation, added.length);
  const indexOfEntry = new Map(added.map((segment, i) => [segment.entry, segmentIndices[i]]));

  const existing = target.scalarData;
  const lockedDestination = new Map();
  const isLockedValue = value => {
    if (!lockedDestination.has(value)) {
      lockedDestination.set(value, !!isSegmentLocked(segmentationId, value));
    }
    return lockedDestination.get(value);
  };

  // Segments first, so the voxels are drawn with their label and colour from the first render.
  // A segment counts as added from the moment the service is asked: the service updates the
  // segmentation, the active segment and the colours before it tells the panels, and a listener
  // that throws leaves all of that in place.
  const previousActive = getActiveSegmentIndex(segmentationId);
  const addedIndices = [];
  const restore = { indices: [], values: [] };
  let overlapVoxels = 0;
  let lockedVoxels = 0;
  let writtenVoxels = 0;
  try {
    added.forEach(({ label, color }, i) => {
      const segmentIndex = segmentIndices[i];
      addedIndices.push(segmentIndex);
      addSegment(segmentationId, {
        segmentIndex,
        label,
        ...(color ? { color: [...color.slice(0, 3), 255] } : {}),
      });
    });

    writeVoxels({
      segmentationId,
      volume: target.volume,
      edit: setAtIndex => {
        for (let i = 0; i < imported.length; i++) {
          const value = imported[i] && indexOfEntry.get(imported[i]);
          if (!value) {
            continue;
          }
          const current = existing[i];
          if (current && current !== value) {
            if (isLockedValue(current)) {
              lockedVoxels++;
              continue;
            }
            overlapVoxels++;
          }
          setAtIndex(i, value);
          restore.indices.push(i);
          restore.values.push(current);
          writtenVoxels++;
        }
      },
    });
  } catch (error) {
    // Put the segmentation back as it was: the voxels written so far, the segments added, the
    // active segment. Each step is attempted whatever became of the others.
    const attempt = (what, run) => {
      try {
        run();
      } catch (cleanupError) {
        log.error(`[SegEditor-import] ${what} failed while undoing a failed import`, cleanupError);
      }
    };
    if (restore.indices.length) {
      attempt('putting the voxels back', () => restoreVoxels({ segmentationId, volume: target.volume, ...restore }));
    }
    addedIndices.forEach(segmentIndex => attempt(`removing segment ${segmentIndex}`,
      () => getSegmentation(segmentationId)?.segments?.[segmentIndex] && removeSegment(segmentationId, segmentIndex)));
    if (previousActive !== undefined && previousActive !== null) {
      attempt('restoring the active segment', () => setActiveSegmentIndex(segmentationId, previousActive));
    }
    throw error;
  }

  return {
    segments: added.map(({ label, voxels }, i) => ({ segmentIndex: segmentIndices[i], label, voxels })),
    emptySegments,
    overlapVoxels,
    lockedVoxels,
    writtenVoxels,
    ...bounds,
  };
}

function _restoreVoxels({ segmentationId, volume, indices, values }) {
  // Written outside the undo history: the failed write was never committed to it
  const { voxelManager } = volume;
  indices.forEach((index, i) => voxelManager.setAtIndex(index, values[i]));
  c3dSegmentations.triggerSegmentationEvents.triggerSegmentationDataModified(segmentationId);
}

/** For tests: forget the import queues (the reset of the polySeg wrapper does this in production) */
export function _resetImportChains() {
  _cancelImports();
}
