// The units of the Segmentation Editor's lengths, and where they come from (ohif-viewers#142 §12;
// ohif-viewers#151 FR-1, FR-2).
//
// The editor's segments live on the reference series' grid, in patient coordinates, and every 3D
// surface it edits is in those coordinates: models imported from STL are placed in them too (the
// import declares their unit, see importers/stlScale.js). Patient coordinates are millimetres
// whenever the images carry a patient-plane pixel spacing. Without it, the metadata provider falls
// back to a spacing of 1, and lengths are in the grid's own steps, shown as generic units.
//
// The record keeps apart three things the image-plane module runs together:
// - the patient-plane spacing (Pixel Spacing, or the Pixel Measures of an enhanced object), which
//   calibrates the grid;
// - the detector spacing of a projection image (Imager Pixel Spacing). The core's
//   getPixelSpacingInformation puts it in a radiograph's image-plane module when no Pixel Spacing
//   is given, so the plane module reports a spacing with nothing defaulted; it is a distance on the
//   detector, not in the patient, and never calibrates the grid;
// - the grid's own steps (the volume's spacing), which exist whatever the calibration and are
//   what a voxel-relative setting is measured in.
//
// The spacing is read from the instance's own attributes, not from the image-plane module's
// `usingDefaultValues`: that flag is also raised when Image Position or Image Orientation is
// missing, while the supplied spacing is kept (Cornerstone3dMetadataProvider), so it cannot tell
// a synthesized spacing of 1 from a real one. Intensity settings (the threshold range) are in
// Hounsfield units on a CT series.

import { useEffect, useState } from 'react';
import { cache as c3dCache, Enums, eventTarget as c3dEventTarget, metaData as c3dMetaData } from '@cornerstonejs/core';

import { getSegEditorToolContext, subscribeSegEditorToolContext } from '../toolbox/segEditorToolContext';


export const LENGTH_UNITS = {
  mm: 'mm',
  // The grid's own steps: the images have no pixel spacing
  generic: 'units',
};

/** Whether the grid's world coordinates are known to be millimetres. */
export const CALIBRATION = {
  mm: 'mm',
  unknown: 'unknown',
};

/** The attribute that calibrated the grid. */
export const SPACING_SOURCE = {
  pixelSpacing: 'PixelSpacing',
  pixelMeasures: 'PixelMeasures',
  // No instance metadata: the image-plane module, with nothing defaulted
  imagePlane: 'ImagePlaneModule',
  none: 'none',
};

/** Why the calibration is unknown. */
export const UNKNOWN_REASON = {
  // No image, or no metadata for it
  noMetadata: 'no-metadata',
  // Instance metadata with no spacing attribute at all
  noSpacing: 'no-spacing',
  // Only Imager Pixel Spacing: a projection image's detector spacing
  detectorOnly: 'detector-spacing',
  // No instance metadata, and the image-plane module's spacing may be the loader's default of 1
  defaulted: 'defaulted',
  // A spacing attribute is present but is not two positive numbers
  invalid: 'invalid-spacing',
};

/** The hint shown on a generic unit: why the setting is not in millimetres. */
export const GENERIC_UNIT_HINT =
  'The images do not give their pixel spacing, so lengths are in the image grid\'s own steps rather than millimetres';

const UNIT_HINTS = {
  [UNKNOWN_REASON.noMetadata]:
    'The images give no metadata, so lengths are in the image grid\'s own steps rather than millimetres',
  [UNKNOWN_REASON.noSpacing]: GENERIC_UNIT_HINT,
  [UNKNOWN_REASON.detectorOnly]:
    'The images give only the detector\'s pixel spacing (Imager Pixel Spacing), a distance on the detector rather than in the patient, so lengths are in the image grid\'s own steps rather than millimetres',
  [UNKNOWN_REASON.defaulted]:
    'The images\' spacing may be the loader\'s default of 1 rather than a measured value, so lengths are in the image grid\'s own steps rather than millimetres',
  [UNKNOWN_REASON.invalid]:
    'The images\' pixel spacing is not two positive numbers, so lengths are in the image grid\'s own steps rather than millimetres',
};

const UNKNOWN_UNITS = Object.freeze({
  length: LENGTH_UNITS.generic,
  intensity: null,
  modality: null,
  calibration: CALIBRATION.unknown,
  source: SPACING_SOURCE.none,
  reason: UNKNOWN_REASON.noMetadata,
  planeSpacing: null,
  detectorSpacing: null,
  spacing: null,
});

const INVALID = Symbol('invalid spacing');

/**
 * A DICOM spacing value ('0.7\\0.7', ['0.7', '0.7'] or numbers) as two positive numbers: null when
 * absent, INVALID when present but not two positive numbers.
 */
function _parseSpacing(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const values = (Array.isArray(value) ? value : String(value).split('\\')).slice(0, 2).map(Number);
  return values.length === 2 && values.every(spacing => Number.isFinite(spacing) && spacing > 0) ? values : INVALID;
}

const _positive = values => Array.isArray(values) && values.length > 0
  && values.every(value => Number.isFinite(value) && value > 0);

/**
 * The spacings an instance carries, kept apart: the patient-plane spacing that calibrates the
 * grid (Pixel Spacing (0028,0030), or the Pixel Measures (0028,9110) of the shared or first
 * per-frame functional group of an enhanced object), and the detector spacing of a projection
 * image (Imager Pixel Spacing (0018,1164)), which is recorded but never a calibration.
 *
 * @returns {{ plane: number[]|null, source: string, detector: number[]|null, invalid: boolean }}
 *   `invalid` when a plane spacing attribute is present but malformed and no valid one follows
 */
export function instanceSpacing(instance) {
  if (!instance) {
    return { plane: null, source: SPACING_SOURCE.none, detector: null, invalid: false };
  }
  const measures = groups => groups?.[0]?.PixelMeasuresSequence?.[0]?.PixelSpacing;
  const detectorValue = _parseSpacing(instance.ImagerPixelSpacing);
  const detector = detectorValue === INVALID ? null : detectorValue;
  const candidates = [
    [instance.PixelSpacing, SPACING_SOURCE.pixelSpacing],
    [measures(instance.SharedFunctionalGroupsSequence), SPACING_SOURCE.pixelMeasures],
    [measures(instance.PerFrameFunctionalGroupsSequence), SPACING_SOURCE.pixelMeasures],
  ];
  let invalid = false;
  for (const [value, source] of candidates) {
    const parsed = _parseSpacing(value);
    if (parsed === INVALID) {
      invalid = true;
    } else if (parsed) {
      return { plane: parsed, source, detector, invalid: false };
    }
  }
  return { plane: null, source: SPACING_SOURCE.none, detector, invalid };
}

/**
 * Whether an instance carries a patient-plane pixel spacing: Pixel Spacing (0028,0030), or Pixel
 * Measures (0028,9110) in the shared or first per-frame functional group of an enhanced object.
 * Imager Pixel Spacing alone does not count: it is the detector's spacing.
 */
export function instanceHasPixelSpacing(instance) {
  return !!instanceSpacing(instance).plane;
}

/** The volume's grid steps as three positive numbers, or null. */
function _gridSpacing(volume) {
  const spacing = volume?.spacing ? Array.from(volume.spacing, Number) : null;
  return spacing && spacing.length === 3 && _positive(spacing) ? spacing : null;
}

/**
 * The units of a series' patient coordinates and pixel values, from its first image's metadata,
 * with the provenance of that answer.
 *
 * @param {string[]} imageIds
 * @param {Function} [getMetadata] - (module, imageId) => metadata (Cornerstone3D's metaData.get)
 * @param {Object} [options]
 * @param {number[]|null} [options.spacing] - the grid's steps in world coordinates, recorded
 *   whatever the calibration
 * @returns {{ length: string, intensity: string|null, modality: string|null, calibration: string,
 *   source: string, reason: string|null, planeSpacing: number[]|null, detectorSpacing: number[]|null,
 *   spacing: number[]|null }}
 */
export function unitsOfImages(imageIds, getMetadata = (type, imageId) => c3dMetaData.get(type, imageId), { spacing = null } = {}) {
  const imageId = imageIds?.[0];
  if (!imageId) {
    return { ...UNKNOWN_UNITS, spacing };
  }
  let calibration = CALIBRATION.unknown;
  let source = SPACING_SOURCE.none;
  let reason = null;
  let planeSpacing = null;
  let detectorSpacing = null;

  const instance = getMetadata('instance', imageId);
  if (instance) {
    const found = instanceSpacing(instance);
    detectorSpacing = found.detector;
    if (found.plane) {
      calibration = CALIBRATION.mm;
      source = found.source;
      planeSpacing = found.plane;
    } else if (found.invalid) {
      reason = UNKNOWN_REASON.invalid;
    } else {
      reason = found.detector ? UNKNOWN_REASON.detectorOnly : UNKNOWN_REASON.noSpacing;
    }
  } else {
    // No instance metadata: the image-plane module counts only when nothing in it was defaulted,
    // since a raised flag may hide a synthesized spacing
    const plane = getMetadata('imagePlaneModule', imageId);
    const planeValues = plane ? [plane.rowPixelSpacing, plane.columnPixelSpacing].map(Number) : null;
    if (plane && plane.usingDefaultValues === false && _positive(planeValues) && planeValues.length === 2) {
      calibration = CALIBRATION.mm;
      source = SPACING_SOURCE.imagePlane;
      planeSpacing = planeValues;
    } else {
      reason = plane ? UNKNOWN_REASON.defaulted : UNKNOWN_REASON.noMetadata;
    }
  }

  const modality = getMetadata('generalSeriesModule', imageId)?.modality || null;
  return {
    length: calibration === CALIBRATION.mm ? LENGTH_UNITS.mm : LENGTH_UNITS.generic,
    intensity: modality === 'CT' ? 'HU' : null,
    modality,
    calibration,
    source,
    reason,
    planeSpacing,
    detectorSpacing,
    spacing,
  };
}

/** Why a record's lengths are not in millimetres, for the unit's hover text; undefined when they are. */
export function unitHintFor(units) {
  if (!units) {
    return undefined;
  }
  // A record without provenance (a caller that built `{ length }` by hand) is read by its length
  const calibrated = units.calibration ? units.calibration === CALIBRATION.mm : units.length === LENGTH_UNITS.mm;
  if (calibrated) {
    return undefined;
  }
  return UNIT_HINTS[units.reason] || GENERIC_UNIT_HINT;
}

// The record per reference volume, bound to the geometry it was read from (ohif-viewers#151
// integration item 3: cached per target and geometry revision). A volume id is not a revision:
// the volume lease derives a stable id from the display set and view, and an evicted volume comes
// back under the same id. An entry therefore holds the volume object, its image list and its grid
// steps, and is used only while all three are the ones in the cache. A record decided without the
// instance's attributes (no metadata yet, or only the image-plane module) is read again on every
// lookup, since the metadata may still arrive; it keeps its identity while the answer is unchanged.
// Bounded, since an editor session visits few volumes.
const _records = new Map();
const MAX_RECORDS = 8;
const _listeners = new Set();
let _unwatchCache = null;
// Volumes being removed from the cache. Cornerstone3D announces a removal before it decaches the
// volume (Cache.removeVolumeLoadObject at 4.22.13: VOLUME_CACHE_VOLUME_REMOVED, then
// _decacheVolume), so a listener reading the units while the event is dispatched would still find
// the departing volume. It is treated as gone from the announcement on, and the listeners are told
// again once the removal has completed.
const _departing = new Set();

function _sameSpacing(a, b) {
  return a === b || (!!a && !!b && a.length === b.length && a.every((value, i) => value === b[i]));
}

function _sameRecord(a, b) {
  return Object.keys(a).every(key => (Array.isArray(a[key]) ? _sameSpacing(a[key], b[key]) : a[key] === b[key]));
}

// Whether the record was decided from the instance's own attributes, which do not change for an
// image id, rather than from an absence the metadata store may yet fill
function _settled(record) {
  return record.source === SPACING_SOURCE.pixelSpacing || record.source === SPACING_SOURCE.pixelMeasures
    || [UNKNOWN_REASON.noSpacing, UNKNOWN_REASON.detectorOnly, UNKNOWN_REASON.invalid].includes(record.reason);
}

function _notify() {
  _listeners.forEach(listener => listener());
}

/** Forget the cached records (tests; an editor closing). */
export function clearSegEditorUnitsCache() {
  _records.clear();
  _departing.clear();
}

/**
 * Forget a volume's record: its geometry was replaced or evicted. The listeners are told when the
 * record was cached or the volume is the editor's reference, whose units are then read again.
 */
export function invalidateSegEditorUnits(volumeId, { getContext = getSegEditorToolContext } = {}) {
  if (!volumeId) {
    return;
  }
  const cached = _records.delete(volumeId);
  if (cached || getContext()?.referenceVolumeId === volumeId) {
    _notify();
  }
}

/**
 * Follow changes to the units: a volume added to or removed from Cornerstone3D's cache drops its
 * record, and when it is the editor's reference every listener is told to read the units again. The cache events are
 * watched while anyone listens.
 *
 * @returns {Function} unsubscribe
 */
export function subscribeSegEditorUnits(listener, { eventTarget = c3dEventTarget } = {}) {
  _listeners.add(listener);
  if (!_unwatchCache) {
    const volumeIdOf = event => {
      const detail = event?.detail || {};
      return detail.volumeId || detail.volume?.volumeId || detail.volume?.volume?.volumeId;
    };
    const onAdded = event => {
      const volumeId = volumeIdOf(event);
      _departing.delete(volumeId);
      invalidateSegEditorUnits(volumeId);
    };
    const onRemoved = event => {
      const volumeId = volumeIdOf(event);
      if (!volumeId) {
        return;
      }
      _departing.add(volumeId);
      invalidateSegEditorUnits(volumeId);
      // The removal completes synchronously after the event: read again once it has
      queueMicrotask(() => {
        if (_departing.delete(volumeId)) {
          invalidateSegEditorUnits(volumeId);
        }
      });
    };
    const handlers = [
      [Enums?.Events?.VOLUME_CACHE_VOLUME_ADDED, onAdded],
      [Enums?.Events?.VOLUME_CACHE_VOLUME_REMOVED, onRemoved],
    ].filter(([name]) => name);
    handlers.forEach(([name, handler]) => eventTarget.addEventListener(name, handler));
    _unwatchCache = () => handlers.forEach(([name, handler]) => eventTarget.removeEventListener(name, handler));
  }
  return () => {
    _listeners.delete(listener);
    if (!_listeners.size && _unwatchCache) {
      _unwatchCache();
      _unwatchCache = null;
    }
  };
}

/**
 * The units of the editor's reference series, with their provenance and the grid's steps, or
 * generic units while no editor is open.
 */
export function getSegEditorUnits(deps = {}) {
  const {
    getContext = getSegEditorToolContext,
    getVolume = volumeId => c3dCache.getVolume(volumeId),
    getMetadata,
    records = _records,
  } = deps;
  const volumeId = getContext()?.referenceVolumeId;
  if (!volumeId) {
    return UNKNOWN_UNITS;
  }
  // A volume being removed is gone, though the cache still holds it while the removal is announced
  const volume = _departing.has(volumeId) ? undefined : getVolume(volumeId);
  const imageIds = volume?.imageIds;
  if (!imageIds) {
    // The volume may still be loading, or was evicted
    records.delete(volumeId);
    return UNKNOWN_UNITS;
  }
  const spacing = _gridSpacing(volume);
  const cached = records.get(volumeId);
  const current = cached && cached.volume === volume && cached.imageIds === imageIds && _sameSpacing(cached.spacing, spacing);
  if (current && cached.settled) {
    return cached.record;
  }
  const read = unitsOfImages(imageIds, getMetadata, { spacing });
  if (current && _sameRecord(cached.record, read)) {
    return cached.record;
  }
  const record = Object.freeze(read);
  records.delete(volumeId);
  if (records.size >= MAX_RECORDS) {
    records.delete(records.keys().next().value);
  }
  records.set(volumeId, { volume, imageIds, spacing, record, settled: _settled(record) });
  return record;
}

/** The editor's units, following the editor as it opens and closes. */
export function useSegEditorUnits() {
  const [units, setUnits] = useState(() => getSegEditorUnits());
  useEffect(() => {
    const refresh = () => setUnits(getSegEditorUnits());
    refresh();
    const unsubscribers = [subscribeSegEditorToolContext(refresh), subscribeSegEditorUnits(refresh)];
    return () => unsubscribers.forEach(unsubscribe => unsubscribe());
  }, []);
  return units;
}
