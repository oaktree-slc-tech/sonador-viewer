// Image plane geometry for DICOM-SR measurements: conversion between image (SCOORD)
// and patient (SCOORD3D, LPS mm) coordinates, and matching patient points to image planes.
//
// The conversions mirror @cornerstonejs/core `imageToWorldCoords` / `worldToImageCoords`, so a
// read-only measurement and the same measurement hydrated through the Cornerstone3D adapters land
// on the same points. Image coordinates follow DICOM SCOORD: (0, 0) is the top left corner of the
// top left pixel, so the centre of the first pixel (ImagePositionPatient) is (0.5, 0.5). The module
// has no Cornerstone dependency; imagePlane.js adds the metadata lookup.

// Distance (mm) a patient point may lie from an image plane and still be drawn on that image
export const DEFAULT_PLANE_TOLERANCE = 1;


const toNumbers = values => (values ? Array.from(values, Number) : undefined);

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];


function _plane({ imagePositionPatient, rowCosines, columnCosines, rowPixelSpacing, columnPixelSpacing,
  frameOfReferenceUID, sliceThickness }) {
  if (!imagePositionPatient || !rowCosines || !columnCosines
      || imagePositionPatient.length < 3 || rowCosines.length < 3 || columnCosines.length < 3) {
    return null;
  }

  const row = toNumbers(rowCosines);
  const column = toNumbers(columnCosines);

  return {
    imagePositionPatient: toNumbers(imagePositionPatient),
    rowCosines: row,
    columnCosines: column,
    normal: cross(row, column),
    rowPixelSpacing: Number(rowPixelSpacing) || 1,
    columnPixelSpacing: Number(columnPixelSpacing) || 1,
    frameOfReferenceUID: frameOfReferenceUID || undefined,
    sliceThickness: Number(sliceThickness) || undefined,
  };
}


/**
 * Image plane from naturalized instance metadata (ImagePositionPatient, ImageOrientationPatient,
 * PixelSpacing, FrameOfReferenceUID), or null when the instance has no plane.
 */
export function planeFromInstance(instance) {
  if (!instance) {
    return null;
  }

  const orientation = toNumbers(instance.ImageOrientationPatient);
  const spacing = toNumbers(instance.PixelSpacing) || [];

  return _plane({
    imagePositionPatient: instance.ImagePositionPatient,
    rowCosines: orientation && orientation.slice(0, 3),
    columnCosines: orientation && orientation.slice(3, 6),
    rowPixelSpacing: spacing[0],
    columnPixelSpacing: spacing[1],
    frameOfReferenceUID: instance.FrameOfReferenceUID,
    sliceThickness: instance.SliceThickness,
  });
}


/** Image plane of a Cornerstone3D `imagePlaneModule`, or null when it has no plane */
export function planeFromModule(module) {
  return module ? _plane({
    imagePositionPatient: module.imagePositionPatient,
    rowCosines: module.rowCosines,
    columnCosines: module.columnCosines,
    rowPixelSpacing: module.rowPixelSpacing,
    columnPixelSpacing: module.columnPixelSpacing,
    frameOfReferenceUID: module.frameOfReferenceUID,
    sliceThickness: module.sliceThickness,
  }) : null;
}


/**
 * Patient point [x, y, z] of an image point [column, row]. As DICOM defines the Image Plane Module
 * (PS3.3 C.7.6.2): the column index runs along the row direction in steps of the column spacing
 * (PixelSpacing[1]), and the row index along the column direction in steps of the row spacing
 * (PixelSpacing[0]).
 */
export function imageToWorld(plane, [x, y]) {
  const { imagePositionPatient: origin, rowCosines, columnCosines, rowPixelSpacing, columnPixelSpacing } = plane;
  const u = columnPixelSpacing * (x - 0.5);
  const v = rowPixelSpacing * (y - 0.5);

  return [0, 1, 2].map(i => origin[i] + rowCosines[i] * u + columnCosines[i] * v);
}


/** Image point [column, row] of a patient point, projected onto the image plane */
export function worldToImage(plane, point) {
  const { imagePositionPatient: origin, rowCosines, columnCosines, rowPixelSpacing, columnPixelSpacing } = plane;
  const offset = sub(point, origin);

  return [
    dot(offset, rowCosines) / columnPixelSpacing + 0.5,
    dot(offset, columnCosines) / rowPixelSpacing + 0.5,
  ];
}


/** Signed distance (mm) of a patient point from the image plane, along the plane normal */
export function distanceFromPlane(plane, point) {
  return dot(sub(point, plane.imagePositionPatient), plane.normal);
}


/**
 * The candidate whose image plane is nearest to the patient points, when every point lies within
 * `tolerance` of it and the Frame of Reference matches; otherwise undefined.
 *
 * @param {Array<{ plane: object }>} candidates - images with their planes
 * @param {Array<number[]>} points - patient points
 * @param {object} [options]
 * @param {string} [options.FrameOfReferenceUID] - required Frame of Reference, when known: an image
 *   with another, or none, is not a candidate
 * @param {number} [options.tolerance] - mm, DEFAULT_PLANE_TOLERANCE by default
 */
export function findImageForPoints(candidates, points, options = {}) {
  const { FrameOfReferenceUID, tolerance = DEFAULT_PLANE_TOLERANCE } = options;
  if (!points || !points.length) {
    return undefined;
  }

  let best;
  let bestDistance = Infinity;

  (candidates || []).forEach(candidate => {
    const { plane } = candidate || {};
    if (!plane) {
      return;
    }
    // Nearness says nothing about an image whose Frame of Reference is unknown
    if (FrameOfReferenceUID && plane.frameOfReferenceUID !== FrameOfReferenceUID) {
      return;
    }

    const distance = Math.max(...points.map(point => Math.abs(distanceFromPlane(plane, point))));
    if (distance <= tolerance && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  });

  return best;
}
