// Cornerstone3D segmentation-state registration for M3D (STL) series.
//
// Model presentation state (visibility, lock/wireframe, colour) is stored in the Cornerstone3D
// segmentation state as a segmentation whose segments correspond to the STL instances of a series
// — the same state of record used by the segmentation editor and volume viewer. The Three.js
// viewer is NOT part of Cornerstone3D's rendering system: M3D viewports never register a
// Cornerstone3D viewport ID and never attach segmentation representations (the Labelmap
// representation type below is nominal, mirroring Cornerstone3DLabelmapBaseView.loadSegImageVolume).
// Panels and viewports replicate state through SegmentationService events and pull current values
// from this store; colour and visibility live on the segment metadata (segments[idx].color as a
// hex string, segments[idx].visible) because the per-viewport config APIs are unavailable without
// registered viewports.
//
// Segmentation lifetime matches cached-geometry lifetime: reference counting piggybacks on the
// m3dCacheService viewport refcounts for the series' geometry ids, so the segmentation is removed
// when the last M3D viewport for the series releases its models.

import _ from 'lodash';

import {
  // Segmentations
  segmentation as c3dSegmentations,
} from '@cornerstonejs/tools';
import { SegmentationRepresentations } from '@cornerstonejs/tools/enums';

import OHIF from '@ohif/core';

import { getSopInstanceUIDFromGeometryId } from './m3dGeometryId.js';
import { getReferenceCount } from './m3dCacheService.js';
import { DEFAULT_GEOMETRY_COLOR_HEX } from './hydrateM3DInstance.js';

const { DisplaySetApi } = OHIF.display;

// `m3dseg:` scheme parallels the `m3d:<SOPInstanceUID>` geometry-id scheme (m3dGeometryId.js);
// segmentations are per-series rather than per-instance.
export const M3D_SEGMENTATION_SCHEME = 'm3dseg';

export function getM3DSegmentationId(seriesInstanceUID) {
  if (!seriesInstanceUID) {
    throw new Error('getM3DSegmentationId: seriesInstanceUID is required');
  }
  return `${M3D_SEGMENTATION_SCHEME}:${seriesInstanceUID}`;
}

function _instanceMetadata(series, sopInstanceUID) {
  // Instance metadata access pattern shared with OHIFDicomM3DViewport.getInstanceColor
  if (!series || !sopInstanceUID) {
    return undefined;
  }
  const instance = series.getInstanceByUID(sopInstanceUID);
  return instance && instance.getData ? instance.getData().metadata : undefined;
}

function _buildSegments({ series, models }) {
  // Build the segments hash keyed by Instance Number (0020,0013). Label resolves from Content
  // Description (0070,0081), then Content Label (0070,0080), then 'Model <n>'. The
  // sopInstanceUID/geometryId fields provide the segmentIndex <-> Three.js model mapping.

  const segments = {};
  _.each(models, (model) => {
    const sopInstanceUID = getSopInstanceUIDFromGeometryId(model.geometryId);
    const meta = _instanceMetadata(series, sopInstanceUID) || {};

    // Segment index from InstanceNumber; fall back to the next free index when the instance
    // number is missing, non-positive (segment index 0 is background), or already taken.
    let segmentIndex = parseInt(meta.InstanceNumber, 10);
    if (!_.isFinite(segmentIndex) || segmentIndex < 1 || segments[segmentIndex]) {
      segmentIndex = (_.max(_.map(_.keys(segments), Number)) || 0) + 1;
    }

    segments[segmentIndex] = {
      segmentIndex,
      label: meta.ContentDescription || meta.ContentLabel || `Model ${segmentIndex}`,
      active: true,
      locked: false,
      visible: true,
      color: model.modelColor || DEFAULT_GEOMETRY_COLOR_HEX,
      sopInstanceUID,
      geometryId: model.geometryId,
    };
  });

  return segments;
}

export async function registerM3DSegmentation({ displaySet, models }) {
  // Register the presentation-state segmentation for an STL series and publish
  // displaySet.segmentationId so side panels bootstrap through the displaySet service
  // (the same publication pattern as OHIFVtkVolumeViewport / OHIFSegmentationEditorViewport).
  //
  // Only the first viewport for a series initializes the segmentation (labels, colors);
  // subsequent viewports consume the existing state.

  // @returns { segmentationId, created }

  const { series, SeriesInstanceUID, SeriesDescription } = displaySet;
  const segmentationId = getM3DSegmentationId(SeriesInstanceUID);

  const publish = (force) => {
    // Publish force-refreshes after (re)creation even when the id string is unchanged
    // (a re-opened series leaves the stale id on the persistent displaySet object).
    if (force || displaySet.segmentationId != segmentationId) {
      displaySet.segmentationId = segmentationId;
      DisplaySetApi.Instance.displaySetService.addDisplaySets([displaySet]);
    }
  };

  // First-viewport initialization: when the segmentation already exists, consume it as-is.
  if (c3dSegmentations.state.getSegmentation(segmentationId)) {
    publish();
    return { segmentationId, created: false };
  }

  // Publish BEFORE registering so an already-open side panel can bind: the panel bootstrap
  // guards (attachSegmentationAddTableEvents, the first-load block) read
  // displaySet.segmentationId from the displaySet service, and the segmentation events fired
  // by addSegmentations below arrive before any post-registration publish would land.
  publish(true);

  const segments = _buildSegments({ series, models });

  const _seg = {
    segmentationId,
    representation: { type: SegmentationRepresentations.Labelmap, data: {} },
    config: { label: SeriesDescription || undefined, segments },
  };
  await c3dSegmentations.state.addSegmentations([_seg]);

  // addSegmentations normalization only guarantees the core segment fields; re-apply the M3D
  // presentation/mapping fields on the stored segments in case they were stripped.
  const stored = c3dSegmentations.state.getSegmentation(segmentationId);
  if (stored && stored.segments) {
    _.each(segments, (s, idx) => {
      if (stored.segments[idx]) {
        _.defaults(stored.segments[idx], _.pick(s, 'visible', 'color', 'sopInstanceUID', 'geometryId'));
      }
    });
  }

  // Re-broadcast SEGMENTATION_MODIFIED now that the metadata is complete. The events fired
  // inside addSegmentations land BEFORE the field re-apply above, so a side panel that
  // bootstraps from them could read partial segment metadata; this nudge guarantees every
  // subscriber re-pulls the finished state regardless of mount/registration order.
  c3dSegmentations.triggerSegmentationEvents.triggerSegmentationModified(segmentationId);

  return { segmentationId, created: true };
}

export function releaseM3DSegmentation(seriesInstanceUID) {
  // Remove the series segmentation from Cornerstone3D state once the last M3D viewport has
  // released its models. Callers must release their geometry references (releaseGeometry /
  // releaseAcquiredModels) BEFORE calling this, since liveness is derived from the
  // m3dCacheService reference counts of the segments' geometry ids.

  // @returns true when the segmentation was removed

  const segmentationId = getM3DSegmentationId(seriesInstanceUID);
  const _seg = c3dSegmentations.state.getSegmentation(segmentationId);
  if (!_seg) {
    return false;
  }

  const geometryIds = _.compact(_.map(_.values(_seg.segments), 'geometryId'));
  if (_.some(geometryIds, (geometryId) => getReferenceCount(geometryId) > 0)) {
    return false;
  }

  c3dSegmentations.state.removeSegmentation(segmentationId);
  return true;
}
