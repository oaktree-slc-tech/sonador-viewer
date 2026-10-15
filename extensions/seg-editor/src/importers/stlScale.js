// The scale check of an STL import (ohif-viewers#142, §12). STL files carry no unit: an import takes
// a model's coordinates as patient millimetres, which is what an STL made from a series is in. A
// model saved in another unit (metres and inches are common in CAD and printing tools) would land
// at the wrong size and, since patient coordinates are absolute, in the wrong place. Each model is
// compared with the image at each common unit: the unit at which it lies on the image, at a
// plausible size, is suggested when it is not millimetres.

// Common STL units, as millimetres per unit
export const STL_UNITS = [
  { unit: 'mm', name: 'millimetres', factor: 1 },
  { unit: 'cm', name: 'centimetres', factor: 10 },
  { unit: 'in', name: 'inches', factor: 25.4 },
  { unit: 'm', name: 'metres', factor: 1000 },
];

// A model lies on the image when at least this fraction of its bounding box is inside the image's
const MIN_OVERLAP = 0.5;
// ... and is plausibly sized when it is at least this many mm across and at most this many times
// the image's size
const MIN_EXTENT_MM = 1;
const MAX_EXTENT_RATIO = 2;

/** The largest side of a bounding box. */
export function extentOf(bounds) {
  return Math.max(...[0, 1, 2].map(d => bounds.max[d] - bounds.min[d]));
}

function _scaled(bounds, factor) {
  return { min: bounds.min.map(v => v * factor), max: bounds.max.map(v => v * factor) };
}

/**
 * The fraction of a model's bounding box inside the image's. A flat side (a planar model) counts
 * as inside when it is within the image's span on that axis.
 */
export function overlapFraction(model, image) {
  let fraction = 1;
  for (let d = 0; d < 3; d++) {
    const length = model.max[d] - model.min[d];
    const inside = Math.min(model.max[d], image.max[d]) - Math.max(model.min[d], image.min[d]);
    if (length <= 0) {
      fraction *= model.min[d] >= image.min[d] && model.min[d] <= image.max[d] ? 1 : 0;
    } else {
      fraction *= Math.max(0, inside) / length;
    }
  }
  return fraction;
}

function _assess(bounds, imageBounds, { factor }) {
  const scaled = _scaled(bounds, factor);
  const extent = extentOf(scaled);
  return {
    extent,
    overlap: overlapFraction(scaled, imageBounds),
    plausible: extent >= MIN_EXTENT_MM && extent <= MAX_EXTENT_RATIO * extentOf(imageBounds),
  };
}

/**
 * The unit an STL model looks to be in, when it is not millimetres.
 *
 * - Taken as millimetres, a model that lies on the image at a plausible size needs no rescaling.
 * - Otherwise, the unit at which it lies on the image is suggested (the best overlap wins, then
 *   the unit that brings it nearest the image's scale).
 * - A model that lies on the image at no unit is in another frame of reference; only its size can
 *   be judged, so a unit is suggested only when it is implausibly small as millimetres, and then
 *   the unit that brings it nearest the image's scale.
 *
 * @param {{ min: number[], max: number[] }} modelBounds - the model's bounds, as read
 * @param {{ min: number[], max: number[] }} imageBounds - the image grid's bounds (mm)
 * @returns {{ unit: string, name: string, factor: number, extent: number, scaledExtent: number }|null}
 *   the suggested unit (`extent` the model's size as read, `scaledExtent` its size rescaled), or
 *   null when the model is taken as millimetres
 */
export function suggestStlUnit(modelBounds, imageBounds) {
  if (!modelBounds || !imageBounds) {
    return null;
  }
  const assessed = STL_UNITS.map(unit => ({ ...unit, ..._assess(modelBounds, imageBounds, unit) }));
  const [asMm, ...others] = assessed;
  if (asMm.plausible && asMm.overlap >= MIN_OVERLAP) {
    return null;
  }

  const suggest = unit => ({
    unit: unit.unit, name: unit.name, factor: unit.factor, extent: asMm.extent, scaledExtent: unit.extent,
  });
  // Anatomy is about the size of the scan that holds it: how far a unit leaves the model from half
  // the image's size (in orders of magnitude)
  const typical = extentOf(imageBounds) / 2;
  const distance = unit => Math.abs(Math.log(unit.extent / typical));

  // Near the origin, a model can lie on an image that holds the origin at several units: the
  // overlaps are compared coarsely, and the unit nearest the image's scale breaks a tie
  const coarse = unit => Math.round(unit.overlap * 10);
  const onImage = others
    .filter(unit => unit.plausible && unit.overlap >= MIN_OVERLAP)
    .sort((a, b) => coarse(b) - coarse(a) || distance(a) - distance(b));
  if (onImage.length) {
    return suggest(onImage[0]);
  }
  if (asMm.overlap > 0 || asMm.extent >= MIN_EXTENT_MM) {
    return null;
  }
  // Off the image at every unit: of the units at which the model is plausibly sized, the one
  // nearest the image's scale
  const sized = others.filter(unit => unit.plausible).sort((a, b) => distance(a) - distance(b));
  return sized.length ? suggest(sized[0]) : null;
}

/** The bounds of a flat point list ([x, y, z, x, y, z, ...]), or null without points. */
export function pointBounds(points) {
  if (!points?.length) {
    return null;
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < points.length; i += 3) {
    for (let d = 0; d < 3; d++) {
      const value = points[i + d];
      if (value < min[d]) {
        min[d] = value;
      }
      if (value > max[d]) {
        max[d] = value;
      }
    }
  }
  return { min, max };
}

/** A model rescaled to millimetres: its surface's points multiplied by the unit's factor. */
export function rescaleModel(model, factor) {
  const points = model.surface.points;
  const scaled = new (points.constructor)(points.length);
  for (let i = 0; i < points.length; i++) {
    scaled[i] = points[i] * factor;
  }
  return { ...model, surface: { ...model.surface, points: scaled } };
}

/**
 * The models of an import grouped by the unit they look to be in, for the ones that do not look
 * like millimetres.
 *
 * @param {Array<{ label: string, surface: { points } }>} models
 * @param {{ min: number[], max: number[] }} imageBounds
 * @returns {Array<{ suggestion: Object, models: Object[] }>} one entry per suggested unit
 */
export function modelsNeedingRescale(models, imageBounds) {
  const groups = new Map();
  models.forEach(model => {
    const suggestion = suggestStlUnit(pointBounds(model.surface?.points), imageBounds);
    if (suggestion) {
      const group = groups.get(suggestion.unit) || { suggestion, models: [] };
      group.models.push(model);
      groups.set(suggestion.unit, group);
    }
  });
  return [...groups.values()];
}
