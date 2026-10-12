// The VTK surface actors of a segmentation, refreshed after a surface edit (ohif-viewers#142, §11).
//
// Cornerstone3D's surface display (`addOrUpdateSurfaceToElement`, pinned 4.22.13) replaces an
// actor's polydata only when the surface's point or cell array LENGTH changed. An edit that moves
// vertices and keeps the topology (Smooth, and its undo and redo) changes neither, so the actor
// would keep the old positions. The cached surface is therefore pushed into the actor's polydata
// here, in place, whenever an actor for the surface exists; a surface whose lengths changed is
// left to the display's own replacement on the next render.

import { getEnabledElements } from '@cornerstonejs/core';
import { segmentation as c3dSegmentations } from '@cornerstonejs/tools';


const SURFACE = 'Surface';

function _representationUID(segmentationId, segmentIndex) {
  // getSurfaceRepresentationUID in the pinned library (not exported)
  return `${segmentationId}-${SURFACE}-${segmentIndex}`;
}

/** The segment index a geometry id belongs to in a segmentation's Surface representation. */
export function segmentIndexOfGeometry(segmentationId, geometryId, deps = {}) {
  const { getSegmentation = id => c3dSegmentations.state.getSegmentation(id) } = deps;
  const geometryIds = getSegmentation(segmentationId)?.representationData?.Surface?.geometryIds;
  if (!geometryIds) {
    return undefined;
  }
  for (const [segmentIndex, id] of geometryIds) {
    if (id === geometryId) {
      return segmentIndex;
    }
  }
  return undefined;
}

/**
 * Push a surface into every VTK actor that shows it, in place. Only actors whose polydata has the
 * surface's array lengths are touched (the others are replaced by the display on render).
 *
 * @param {string} segmentationId
 * @param {string} geometryId
 * @param {{ points, polys }} surface
 * @param {Object} [deps]
 * @returns {number} actors updated
 */
export function refreshSurfaceActors(segmentationId, geometryId, surface, deps = {}) {
  const {
    enabledElements = () => getEnabledElements(),
    segmentIndex = segmentIndexOfGeometry(segmentationId, geometryId, deps),
  } = deps;
  if (segmentIndex === undefined) {
    return 0;
  }
  const uid = _representationUID(segmentationId, segmentIndex);
  let updated = 0;
  enabledElements().forEach(({ viewport }) => {
    const entries = viewport?.getActors?.() || [];
    entries.forEach(entry => {
      if (entry.representationUID !== uid || !entry.actor) {
        return;
      }
      const mapper = entry.actor.getMapper?.();
      const polyData = mapper?.getInputData?.();
      if (!polyData) {
        return;
      }
      const points = polyData.getPoints();
      const polys = polyData.getPolys();
      if (points.getData().length !== surface.points.length || polys.getData().length !== surface.polys.length) {
        return;
      }
      points.setData(surface.points, 3);
      polys.setData(Float32Array.from(surface.polys));
      points.modified();
      polys.modified();
      polyData.modified();
      mapper.modified();
      updated++;
      viewport.render?.();
    });
  });
  return updated;
}
