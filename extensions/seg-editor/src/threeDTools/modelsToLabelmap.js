// 3D models -> labelmap (ohif-viewers#143, FR-6/FR-7/AR-5): the STL models of a series voxelized
// onto the image grid of the series they were made from, one segment per model.
//
// Each model's surface is voxelized in the polymorphic segmentation worker, which chooses its own
// fine axis-aligned grid over the surface's bounds; the image grid is then filled by sampling that
// result at each image voxel's centre (labelmapCarve's createGridLookup), within the model's
// bounds. Models are applied in order, so where they overlap the later model wins the voxel.

import { cache as c3dCache, utilities as c3dUtilities } from '@cornerstonejs/core';
import { segmentation as c3dSegmentations } from '@cornerstonejs/tools';

import {
  acquireGeometry,
  getM3DSegmentationId,
  releaseGeometry,
} from '@ohif/extension-viewerm3d';

import { createGridLookup, worldBoxToIndexBox } from './labelmapCarve.js';
import { voxelizeSurfaceInWorker } from './segmentEdits.js';


// Holder id for the geometry the conversion reads (the M3D cache counts references per viewport)
const GEOMETRY_HOLDER = 'models-to-segmentation';

/**
 * A welded, indexed surface from a triangle soup (THREE non-indexed `position` array: three
 * vertices per triangle), as the voxelizer expects: shared vertices merged, so the surface is
 * closed where the model is.
 *
 * @param {ArrayLike<number>} positions - flat xyz, 9 values per triangle
 * @returns {{ points: Float32Array, polys: Int32Array }}
 */
export function surfaceFromTriangleSoup(positions) {
  const indexOf = new Map();
  const points = [];
  const polys = [];
  const vertex = offset => {
    const key = `${positions[offset]},${positions[offset + 1]},${positions[offset + 2]}`;
    let index = indexOf.get(key);
    if (index === undefined) {
      index = points.length / 3;
      indexOf.set(key, index);
      points.push(positions[offset], positions[offset + 1], positions[offset + 2]);
    }
    return index;
  };

  for (let t = 0; t + 8 < positions.length; t += 9) {
    const a = vertex(t);
    const b = vertex(t + 3);
    const c = vertex(t + 6);
    if (a !== b && b !== c && a !== c) {
      polys.push(3, a, b, c);
    }
  }
  return { points: Float32Array.from(points), polys: Int32Array.from(polys) };
}

/**
 * Index -> world of an image volume from Cornerstone3D volume props (generateVolumePropsFromImageIds):
 * `direction` is [row cosines, column cosines, slice normal], and the volume's vtkImageData maps
 * index (i, j, k) to origin + i*spacing[0]*row + j*spacing[1]*column + k*spacing[2]*normal.
 *
 * @returns {{ origin: number[], di: number[], dj: number[], dk: number[] }}
 */
export function volumeAxesFromProps({ origin, spacing, direction }) {
  const axis = (a, s) => [0, 1, 2].map(d => direction[3 * a + d] * spacing[s]);
  return { origin: [...origin], di: axis(0, 0), dj: axis(1, 1), dk: axis(2, 2) };
}

function _bounds(points) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let p = 0; p < points.length; p += 3) {
    for (let d = 0; d < 3; d++) {
      min[d] = Math.min(min[d], points[p + d]);
      max[d] = Math.max(max[d], points[p + d]);
    }
  }
  return { min, max };
}

/**
 * Voxelize models onto an image grid.
 *
 * @param {Object} params
 * @param {Array<{ segmentIndex: number, surface: { points, polys } }>} params.models - in order
 *   (later models win overlapping voxels)
 * @param {number[]} params.dimensions - image grid dimensions
 * @param {{ origin, di, dj, dk }} params.axes - image grid index -> world
 * @param {Function} params.voxelize - async (surface) => voxelizer result
 * @param {Function} [params.onProgress] - (fraction 0..1) => void
 * @returns {Promise<{ labelmap: Uint16Array, overlapVoxels: number, emptySegments: number[],
 *   failures: Array<{ segmentIndex: number, error: Error }> }>} a model that cannot be voxelized
 *   (an invalid surface the worker rejects) becomes an empty segment, listed in `failures`, and
 *   the other models are still converted
 */
export async function voxelizeModels({ models, dimensions, axes, voxelize, onProgress = () => {} }) {
  const [nx, ny, nz] = dimensions;
  const labelmap = new Uint16Array(nx * ny * nz);
  const { origin, di, dj, dk } = axes;
  let overlapVoxels = 0;
  const emptySegments = [];
  const failures = [];

  for (let m = 0; m < models.length; m++) {
    const { segmentIndex, surface } = models[m];
    let filled = 0;

    if (surface?.polys?.length) {
      const box = worldBoxToIndexBox(_bounds(surface.points), axes, dimensions, 1);
      let grid;
      if (box) {
        try {
          grid = await voxelize(surface);
        } catch (error) {
          failures.push({ segmentIndex, error });
        }
      }
      if (grid) {
        const inside = createGridLookup(grid);
        for (let k = box.min[2]; k <= box.max[2]; k++) {
          for (let j = box.min[1]; j <= box.max[1]; j++) {
            for (let i = box.min[0]; i <= box.max[0]; i++) {
              const x = origin[0] + i * di[0] + j * dj[0] + k * dk[0];
              const y = origin[1] + i * di[1] + j * dj[1] + k * dk[1];
              const z = origin[2] + i * di[2] + j * dj[2] + k * dk[2];
              if (inside(x, y, z)) {
                const index = i + nx * (j + ny * k);
                if (labelmap[index] && labelmap[index] !== segmentIndex) {
                  overlapVoxels++;
                }
                labelmap[index] = segmentIndex;
                filled++;
              }
            }
          }
        }
      }
    }

    if (!filled) {
      emptySegments.push(segmentIndex);
    }
    onProgress((m + 1) / models.length);
  }

  return { labelmap, overlapVoxels, emptySegments, failures };
}

/**
 * The models of an STL series as a labelmap on its source series' image grid.
 *
 * @param {Object} params
 * @param {string} params.m3dSeriesInstanceUID - the model series
 * @param {string[]} params.imageIds - the source series' image ids
 * @param {Function} [params.onProgress]
 * @param {Object} [params.deps] - injectable (tests)
 * @returns {Promise<{ labelmapBuffer: Uint16Array, bufferImageIds: string[],
 *   segments: Array<{ label: string, color: string }>, overlapVoxels: number,
 *   emptySegments: Array<{ segmentIndex: number, label: string }> }>}
 */
export async function modelsToLabelmap({ m3dSeriesInstanceUID, imageIds, onProgress, deps = {} }) {
  const {
    getSegmentation = id => c3dSegmentations.state.getSegmentation(id),
    getGeometry = id => c3dCache.getGeometry(id),
    acquire = acquireGeometry,
    release = releaseGeometry,
    volumeProps = ids => c3dUtilities.generateVolumePropsFromImageIds(ids),
    voxelize = voxelizeSurfaceInWorker,
  } = deps;

  const m3dSegmentation = getSegmentation(getM3DSegmentationId(m3dSeriesInstanceUID));
  const modelSegments = Object.values(m3dSegmentation?.segments || {})
    .filter(segment => segment?.geometryId)
    .sort((a, b) => a.segmentIndex - b.segmentIndex);
  if (!modelSegments.length) {
    throw new Error('The series has no models to convert');
  }

  const props = volumeProps(imageIds);

  // The M3D viewer has loaded the series' models into the geometry cache; hold them while they
  // are read. (A model missing from the cache cannot be fetched from here and becomes an empty
  // segment, reported to the caller.)
  const geometryIds = modelSegments.map(segment => segment.geometryId).filter(id => getGeometry(id));
  await Promise.all(geometryIds.map(id => acquire(id, GEOMETRY_HOLDER)));
  try {
    const models = modelSegments.map((segment, i) => {
      const position = getGeometry(segment.geometryId)?.parsed?.getAttribute?.('position');
      return {
        segmentIndex: i + 1,
        surface: position ? surfaceFromTriangleSoup(position.array) : null,
      };
    });

    const { labelmap, overlapVoxels, emptySegments, failures } = await voxelizeModels({
      models,
      dimensions: props.dimensions,
      axes: volumeAxesFromProps(props),
      voxelize,
      onProgress,
    });

    const segments = modelSegments.map(segment => ({ label: segment.label, color: segment.color }));
    return {
      labelmapBuffer: labelmap,
      bufferImageIds: props.imageIds,
      segments,
      overlapVoxels,
      emptySegments: emptySegments.map(segmentIndex => ({
        segmentIndex,
        label: segments[segmentIndex - 1].label,
        error: failures.find(failure => failure.segmentIndex === segmentIndex)?.error,
      })),
    };
  } finally {
    geometryIds.forEach(id => release(id, GEOMETRY_HOLDER));
  }
}
