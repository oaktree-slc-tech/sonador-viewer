// The units the Segmentation Editor's settings are given in (ohif-viewers#142, §12).
//
// The editor's segments live on the reference series' grid, in patient coordinates, and every 3D
// surface it edits is in those coordinates: models imported from STL are placed in them too (the
// import checks their scale, see importers/stlScale.js). Patient coordinates are millimetres
// whenever the images carry their pixel spacing. Without it, the metadata provider falls back to a
// spacing of 1, and lengths are in the grid's own steps, shown as generic units.
//
// The spacing is read from the instance's own attributes, not from the image-plane module's
// `usingDefaultValues`: that flag is also raised when Image Position or Image Orientation is
// missing, while the supplied spacing is kept (Cornerstone3dMetadataProvider), so it cannot tell
// a synthesized spacing of 1 from a real one. Intensity settings (the threshold range) are in
// Hounsfield units on a CT series.

import { useEffect, useState } from 'react';
import { cache as c3dCache, metaData as c3dMetaData } from '@cornerstonejs/core';

import { getSegEditorToolContext, subscribeSegEditorToolContext } from '../toolbox/segEditorToolContext';


export const LENGTH_UNITS = {
  mm: 'mm',
  // The grid's own steps: the images have no pixel spacing
  generic: 'units',
};

const UNKNOWN_UNITS = Object.freeze({ length: LENGTH_UNITS.generic, intensity: null, modality: null });

/** Whether a DICOM spacing value ('0.7\\0.7', ['0.7', '0.7'] or numbers) gives two positive spacings. */
function _validSpacing(value) {
  if (value === undefined || value === null) {
    return false;
  }
  const values = (Array.isArray(value) ? value : String(value).split('\\')).slice(0, 2).map(Number);
  return values.length === 2 && values.every(spacing => Number.isFinite(spacing) && spacing > 0);
}

/**
 * Whether an instance carries its pixel spacing: Pixel Spacing (0028,0030), Imager Pixel Spacing
 * (0018,1164) for projection images, or Pixel Measures (0028,9110) in the shared or first per-frame
 * functional group of an enhanced object.
 */
export function instanceHasPixelSpacing(instance) {
  if (!instance) {
    return false;
  }
  const measures = groups => groups?.[0]?.PixelMeasuresSequence?.[0]?.PixelSpacing;
  return [
    instance.PixelSpacing,
    instance.ImagerPixelSpacing,
    measures(instance.SharedFunctionalGroupsSequence),
    measures(instance.PerFrameFunctionalGroupsSequence),
  ].some(_validSpacing);
}

/**
 * Whether a series' coordinates are calibrated in millimetres. The instance's spacing attributes
 * decide; without instance metadata, only an image-plane module whose every value was supplied
 * (`usingDefaultValues` false) counts, since a raised flag may hide a synthesized spacing.
 */
function _calibrated(imageId, getMetadata) {
  const instance = getMetadata('instance', imageId);
  if (instance) {
    return instanceHasPixelSpacing(instance);
  }
  const plane = getMetadata('imagePlaneModule', imageId);
  const spacing = [plane?.rowPixelSpacing, plane?.columnPixelSpacing].map(Number);
  return !!plane && plane.usingDefaultValues === false && spacing.every(value => Number.isFinite(value) && value > 0);
}

/**
 * The units of a series' patient coordinates and pixel values, from its first image's metadata.
 *
 * @param {string[]} imageIds
 * @param {Function} [getMetadata] - (module, imageId) => metadata (Cornerstone3D's metaData.get)
 * @returns {{ length: string, intensity: string|null, modality: string|null }}
 */
export function unitsOfImages(imageIds, getMetadata = (type, imageId) => c3dMetaData.get(type, imageId)) {
  const imageId = imageIds?.[0];
  if (!imageId) {
    return UNKNOWN_UNITS;
  }
  const calibrated = _calibrated(imageId, getMetadata);
  const modality = getMetadata('generalSeriesModule', imageId)?.modality || null;
  return {
    length: calibrated ? LENGTH_UNITS.mm : LENGTH_UNITS.generic,
    intensity: modality === 'CT' ? 'HU' : null,
    modality,
  };
}

/** The units of the editor's reference series, or generic units while no editor is open. */
export function getSegEditorUnits(deps = {}) {
  const {
    getContext = getSegEditorToolContext,
    getVolume = volumeId => c3dCache.getVolume(volumeId),
    getMetadata,
  } = deps;
  const volumeId = getContext()?.referenceVolumeId;
  const imageIds = volumeId ? getVolume(volumeId)?.imageIds : undefined;
  return imageIds ? unitsOfImages(imageIds, getMetadata) : UNKNOWN_UNITS;
}

/** The hint shown on a generic unit: why the setting is not in millimetres. */
export const GENERIC_UNIT_HINT =
  'The images do not give their pixel spacing, so lengths are in the image grid\'s own steps rather than millimetres';

/** The editor's units, following the editor as it opens and closes. */
export function useSegEditorUnits() {
  const [units, setUnits] = useState(() => getSegEditorUnits());
  useEffect(() => {
    setUnits(getSegEditorUnits());
    return subscribeSegEditorToolContext(() => setUnits(getSegEditorUnits()));
  }, []);
  return units;
}
