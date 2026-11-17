// The image of a stack that holds a patient point: the one whose plane passes within half a slice
// spacing of it. A point beyond the end of a stack, or between two of its images farther than that,
// has none, and a stack that has none is not shown in its place.

import { distanceFromImagePlane, nearestImageIndex, signedDistanceFromImagePlane } from './arrowMarkers';

// Two images this close along the stack's normal are one position (mm)
const SAME_POSITION = 1e-3;
// A point at exactly half a spacing is within it, whatever the rounding of the positions (mm)
const TOLERANCE = 1e-6;

/**
 * The slice spacing of a stack of image planes: the median distance between neighbouring positions
 * along the normal of its first complete plane; for a single image, its slice thickness; undefined
 * when neither is known.
 *
 * @param {Array<object>} planes - image plane modules (imagePositionPatient, rowCosines, columnCosines)
 */
function stackSpacing(planes) {
  const complete = (planes || []).filter(plane => Number.isFinite(signedDistanceFromImagePlane(plane, [0, 0, 0])));
  if (!complete.length) {
    return undefined;
  }
  const reference = complete[0];
  const positions = complete
    .map(plane => signedDistanceFromImagePlane(reference, plane.imagePositionPatient.map(Number)))
    .sort((a, b) => a - b);
  const gaps = positions.slice(1).map((position, i) => position - positions[i]).filter(gap => gap > SAME_POSITION);
  if (!gaps.length) {
    const thickness = Number(reference.sliceThickness);
    return thickness > 0 ? thickness : undefined;
  }
  gaps.sort((a, b) => a - b);
  const middle = Math.floor(gaps.length / 2);
  return gaps.length % 2 ? gaps[middle] : (gaps[middle - 1] + gaps[middle]) / 2;
}

/**
 * The index of the image of a stack within half a slice spacing of a patient point, or -1. A stack
 * whose spacing is not known takes 1 mm.
 *
 * @param {Array<object>} planes - the stack's image plane modules, in stack order
 * @param {number[]} point - patient point (mm)
 */
function imageHoldingPoint(planes, point) {
  const index = nearestImageIndex(planes, point);
  if (index < 0) {
    return -1;
  }
  const spacing = stackSpacing(planes) || 1;
  return distanceFromImagePlane(planes[index], point) <= spacing / 2 + TOLERANCE ? index : -1;
}


export { imageHoldingPoint, stackSpacing };
