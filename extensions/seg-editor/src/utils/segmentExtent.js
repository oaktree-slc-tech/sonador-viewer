// Where a segment is, for framing it (Follow Selected Segment, owner's request of 2026-10-27),
// in world coordinates. Read from the segment's cached 3D surface when one exists (one pass over
// its vertices and faces), else from the labelmap's voxels (one pass over the volume, cached
// until the segmentation's data changes).
//
// An extent carries two targets. `center` is the slice target for the 2D views: the centroid,
// moved along each volume axis onto the nearest slice that holds the segment when the
// centroid's own slice holds none (a hollow or C-shaped segment), so every 2D view that scrolls
// to it shows the segment; `radius` covers the whole segment from that centre. `frame` is the
// segment's bounding sphere (the box's centre and half its diagonal) for a 3D view to frame it
// from any direction, as Blender's View Selected frames the bounds. The two were one before
// review (!109): a centre moved onto a slice with the bounding box's radius left part of the
// segment outside the view.

import { cache as c3dCache, eventTarget as c3dEventTarget } from '@cornerstonejs/core';
import { Enums as c3dToolsEnums, segmentation as c3dSegmentations } from '@cornerstonejs/tools';

import { volumeAxes } from '../threeDTools/labelmapCarve';


const _dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const _length = v => Math.hypot(v[0], v[1], v[2]);

/**
 * The volume's index axes as unit vectors with their spacing, from its index -> world mapping.
 *
 * @param {Function} indexToWorld - ([i, j, k]) => [x, y, z]
 * @returns {{ unit: number[], spacing: number }[]}
 */
export function snapAxes(indexToWorld) {
  const { di, dj, dk } = volumeAxes(indexToWorld);
  return [di, dj, dk].map(step => {
    const spacing = _length(step);
    return { unit: spacing ? step.map(value => value / spacing) : [0, 0, 0], spacing };
  });
}

// The bounding sphere of a box, and the radius that covers the box from a given centre
function _boundingSphere({ min, max }) {
  return {
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    radius: _length([max[0] - min[0], max[1] - min[1], max[2] - min[2]]) / 2,
  };
}

function _coveringRadius(center, { min, max }) {
  let radius = 0;
  [min[0], max[0]].forEach(x => [min[1], max[1]].forEach(y => [min[2], max[2]].forEach(z => {
    radius = Math.max(radius, _length([x - center[0], y - center[1], z - center[2]]));
  })));
  return radius;
}

// Whether a surface crosses the slab [at - half, at + half] along an axis: a face whose vertex
// projections span the slab. The slice through a closed surface's inside always cuts faces, with
// or without a vertex nearby (a coarse mesh has vertices only at its corners).
function _facesCrossSlab(projection, polys, at, half) {
  const low = at - half;
  const high = at + half;
  for (let i = 0; i < polys.length;) {
    const count = polys[i];
    if (!(count > 0) || i + count >= polys.length) {
      break;
    }
    let min = Infinity;
    let max = -Infinity;
    for (let k = 1; k <= count; k++) {
      const value = projection[polys[i + k]];
      if (value < min) {
        min = value;
      }
      if (value > max) {
        max = value;
      }
    }
    if (min <= high && max >= low) {
      return true;
    }
    i += count + 1;
  }
  return false;
}

/**
 * The extent of a surface (its vertices, and its faces when given).
 *
 * @param {ArrayLike<number>} points - x, y, z triples
 * @param {Object} [options]
 * @param {{ unit: number[], spacing: number }[]} [options.axes] - the volume axes to snap the
 *   centre along (snapAxes); without them the centre is the plain centroid
 * @param {ArrayLike<number>} [options.polys] - the surface's cells ([n, a, b, c, ...]); with
 *   them a slice holds the segment when a face crosses it, without them when a vertex lies on it
 * @returns {{ center: number[], radius: number, bounds: { min: number[], max: number[] },
 *   frame: { center: number[], radius: number }, count: number }|null} null without points
 */
export function pointsExtent(points, { axes, polys } = {}) {
  const count = points ? Math.floor(points.length / 3) : 0;
  if (!count) {
    return null;
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const sum = [0, 0, 0];
  for (let p = 0; p < count * 3; p += 3) {
    for (let d = 0; d < 3; d++) {
      const value = points[p + d];
      sum[d] += value;
      if (value < min[d]) {
        min[d] = value;
      }
      if (value > max[d]) {
        max[d] = value;
      }
    }
  }
  const center = sum.map(value => value / count);
  const withFaces = polys?.length > 0;
  const projection = withFaces ? new Float64Array(count) : null;

  // Along each axis, the slab half a spacing thick around the centre must hold the segment: a
  // face crossing it, or without faces a vertex in it. When it does not, the centre moves to the
  // nearest vertex's coordinate along that axis
  (axes || []).forEach(({ unit, spacing }) => {
    if (!spacing) {
      return;
    }
    const at = _dot(center, unit);
    let nearest = Infinity;
    for (let p = 0, v = 0; p < count * 3; p += 3, v++) {
      const value = points[p] * unit[0] + points[p + 1] * unit[1] + points[p + 2] * unit[2];
      if (projection) {
        projection[v] = value;
      }
      const offset = value - at;
      if (Math.abs(offset) < Math.abs(nearest)) {
        nearest = offset;
      }
    }
    const held = withFaces ? _facesCrossSlab(projection, polys, at, spacing / 2) : Math.abs(nearest) <= spacing / 2;
    if (!held) {
      for (let d = 0; d < 3; d++) {
        center[d] += nearest * unit[d];
      }
    }
  });

  const bounds = { min, max };
  return { center, radius: _coveringRadius(center, bounds), bounds, frame: _boundingSphere(bounds), count };
}

// The nearest index with a non-zero count, searching outward from `at`
function _nearestOccupied(occupancy, at) {
  const start = Math.min(occupancy.length - 1, Math.max(0, Math.round(at)));
  if (occupancy[start]) {
    return at;
  }
  for (let step = 1; step < occupancy.length; step++) {
    if (start + step < occupancy.length && occupancy[start + step]) {
      return start + step;
    }
    if (start - step >= 0 && occupancy[start - step]) {
      return start - step;
    }
  }
  return at;
}

/**
 * The extent of a segment's voxels in a labelmap.
 *
 * @param {Object} params
 * @param {ArrayLike<number>} params.scalarData - the labelmap voxels, i fastest
 * @param {number[]} params.dimensions - [ni, nj, nk]
 * @param {number} params.segmentIndex
 * @param {Function} params.indexToWorld - ([i, j, k]) => [x, y, z]
 * @returns {{ center: number[], radius: number, bounds: { min: number[], max: number[] },
 *   frame: { center: number[], radius: number }, count: number }|null} null when the segment
 *   has no voxels
 */
export function labelmapExtent({ scalarData, dimensions, segmentIndex, indexToWorld }) {
  const [ni, nj, nk] = dimensions;
  const occupancy = [new Uint32Array(ni), new Uint32Array(nj), new Uint32Array(nk)];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const sum = [0, 0, 0];
  let count = 0;
  let index = 0;
  for (let k = 0; k < nk; k++) {
    for (let j = 0; j < nj; j++) {
      for (let i = 0; i < ni; i++, index++) {
        if (scalarData[index] !== segmentIndex) {
          continue;
        }
        count++;
        sum[0] += i;
        sum[1] += j;
        sum[2] += k;
        occupancy[0][i]++;
        occupancy[1][j]++;
        occupancy[2][k]++;
        if (i < min[0]) { min[0] = i; }
        if (i > max[0]) { max[0] = i; }
        if (j < min[1]) { min[1] = j; }
        if (j > max[1]) { max[1] = j; }
        if (k < min[2]) { min[2] = k; }
        if (k > max[2]) { max[2] = k; }
      }
    }
  }
  if (!count) {
    return null;
  }

  const centroid = sum.map(value => value / count);
  const snapped = centroid.map((value, d) => _nearestOccupied(occupancy[d], value));
  const center = Array.from(indexToWorld(snapped));

  // The world box of the occupied index box, each voxel taken whole
  const worldMin = [Infinity, Infinity, Infinity];
  const worldMax = [-Infinity, -Infinity, -Infinity];
  [min[0] - 0.5, max[0] + 0.5].forEach(i => [min[1] - 0.5, max[1] + 0.5].forEach(j => [min[2] - 0.5, max[2] + 0.5].forEach(k => {
    const corner = indexToWorld([i, j, k]);
    for (let d = 0; d < 3; d++) {
      if (corner[d] < worldMin[d]) { worldMin[d] = corner[d]; }
      if (corner[d] > worldMax[d]) { worldMax[d] = corner[d]; }
    }
  })));

  const bounds = { min: worldMin, max: worldMax };
  return { center, radius: _coveringRadius(center, bounds), bounds, frame: _boundingSphere(bounds), count };
}

// Labelmap extents already computed, by `${segmentationId}:${segmentIndex}`; a segmentation's
// entries go when its data changes
const _labelmapExtents = new Map();
let _invalidating = false;

function _watchLabelmaps() {
  if (_invalidating || !c3dEventTarget?.addEventListener) {
    return;
  }
  _invalidating = true;
  c3dEventTarget.addEventListener(c3dToolsEnums.Events.SEGMENTATION_DATA_MODIFIED, evt => {
    invalidateSegmentExtents(evt?.detail?.segmentationId);
  });
}

/** Forget the cached labelmap extents of a segmentation (all of them without an id). */
export function invalidateSegmentExtents(segmentationId) {
  if (!segmentationId) {
    _labelmapExtents.clear();
    return;
  }
  Array.from(_labelmapExtents.keys())
    .filter(key => key.startsWith(`${segmentationId}:`))
    .forEach(key => _labelmapExtents.delete(key));
}

/**
 * The extent of a segment of the editor's working segmentation: from its cached surface when
 * the 3D copy has one, else from the labelmap.
 *
 * @param {Object} params
 * @param {string} params.labelmapSegmentationId - the working (2D) segmentation
 * @param {string} [params.surfaceSegmentationId] - the segmentation whose Surface representation
 *   holds the segment's geometry (the editor's 3D copy)
 * @param {number} params.segmentIndex
 * @param {Object} [deps] - for tests
 * @returns {{ center: number[], radius: number, bounds: Object, frame: Object, count: number,
 *   source: 'surface'|'labelmap' }|null} null when the segment has no surface and no voxels
 */
export function lookupSegmentExtent({ labelmapSegmentationId, surfaceSegmentationId, segmentIndex }, {
  getSegmentation = id => c3dSegmentations.state.getSegmentation(id),
  getGeometry = id => c3dCache.getGeometry(id),
  getVolume = id => c3dCache.getVolume(id),
} = {}) {
  if (!labelmapSegmentationId || !segmentIndex) {
    return null;
  }
  const volumeId = getSegmentation(labelmapSegmentationId)?.representationData?.Labelmap?.volumeId;
  const volume = volumeId ? getVolume(volumeId) : undefined;
  const indexToWorld = volume?.imageData ? ijk => Array.from(volume.imageData.indexToWorld(ijk)) : undefined;

  const geometryIds = getSegmentation(surfaceSegmentationId || labelmapSegmentationId)?.representationData?.Surface?.geometryIds;
  const geometryId = geometryIds?.get?.(segmentIndex) ?? geometryIds?.get?.(String(segmentIndex));
  const surface = geometryId ? getGeometry(geometryId)?.data : undefined;
  if (surface?.points?.length) {
    const extent = pointsExtent(surface.points, {
      axes: indexToWorld ? snapAxes(indexToWorld) : undefined, polys: surface.polys,
    });
    if (extent) {
      return { ...extent, source: 'surface' };
    }
  }

  if (!volume?.voxelManager || !indexToWorld) {
    return null;
  }
  const key = `${labelmapSegmentationId}:${segmentIndex}`;
  if (_labelmapExtents.has(key)) {
    return _labelmapExtents.get(key);
  }
  _watchLabelmaps();
  const extent = labelmapExtent({
    scalarData: volume.voxelManager.getCompleteScalarDataArray(),
    dimensions: volume.dimensions,
    segmentIndex,
    indexToWorld,
  });
  const result = extent ? { ...extent, source: 'labelmap' } : null;
  _labelmapExtents.set(key, result);
  return result;
}
