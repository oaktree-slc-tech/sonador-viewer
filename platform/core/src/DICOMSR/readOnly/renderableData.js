// Patient-space (LPS mm) renderable geometry for a DICOM-SR SCOORD / SCOORD3D content item,
// shared by the read-only display in every view. Adapted from the OHIF v3 cornerstone-dicom-sr
// `getRenderableData`, with two differences: the image plane comes from `imagePlane.js` instead of
// the metadata provider, and CIRCLE / ELLIPSE are sampled as closed polylines, so they draw at any
// orientation (OHIF v3 drops oblique ellipses).

import SCOORD_TYPES from '../constants/scoordTypes';
import { imageToWorld } from './imagePlane';

// Segments used to draw a CIRCLE or ELLIPSE
const CURVE_SEGMENTS = 64;

export const SHAPES = {
  POINT: 'point',
  MULTIPOINT: 'multipoint',
  POLYLINE: 'polyline',
};


const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const length = a => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);


/** Patient points of a content item's GraphicData; an SCOORD item needs the image plane */
export function patientPoints({ GraphicData, ValueType }, plane) {
  const data = Array.from(GraphicData || [], Number);
  const points = [];

  if (ValueType === 'SCOORD3D') {
    for (let i = 0; i + 2 < data.length; i += 3) {
      points.push([data[i], data[i + 1], data[i + 2]]);
    }
    return points;
  }

  if (!plane) {
    return points;
  }
  for (let i = 0; i + 1 < data.length; i += 2) {
    points.push(imageToWorld(plane, [data[i], data[i + 1]]));
  }
  return points;
}


function _curve(center, axisA, axisB) {
  const points = [];
  for (let i = 0; i <= CURVE_SEGMENTS; i++) {
    const t = (2 * Math.PI * i) / CURVE_SEGMENTS;
    points.push(add(center, add(scale(axisA, Math.cos(t)), scale(axisB, Math.sin(t)))));
  }
  return points;
}


/**
 * Renderable geometry of a SCOORD / SCOORD3D content item, or null when it cannot be drawn.
 *
 * @param {object} coord - { GraphicType, GraphicData, ValueType }
 * @param {object} [plane] - image plane (imagePlane.js); required for SCOORD, and for a SCOORD3D
 *   CIRCLE (its orientation)
 * @returns {{ GraphicType: string, shape: string, points: number[][], closed: boolean } | null}
 */
export function getRenderableData(coord, plane) {
  const { GraphicType } = coord || {};
  const points = patientPoints(coord || {}, plane);

  switch (GraphicType) {
    case SCOORD_TYPES.POINT:
      return points.length ? { GraphicType, shape: SHAPES.POINT, points, closed: false } : null;

    case SCOORD_TYPES.MULTIPOINT:
      return points.length ? { GraphicType, shape: SHAPES.MULTIPOINT, points, closed: false } : null;

    case SCOORD_TYPES.POLYLINE:
      return points.length > 1 ? { GraphicType, shape: SHAPES.POLYLINE, points, closed: false } : null;

    case SCOORD_TYPES.POLYGON: {
      if (points.length < 3) {
        return null;
      }
      const first = points[0];
      const last = points[points.length - 1];
      const closedPoints = length(sub(first, last)) > 0 ? [...points, first] : points;
      return { GraphicType, shape: SHAPES.POLYLINE, points: closedPoints, closed: true };
    }

    case SCOORD_TYPES.CIRCLE: {
      // Centre and a point on the perimeter. The circle lies in the image plane.
      if (points.length < 2 || !plane) {
        return null;
      }

      // An image circle is defined in column/row coordinates (PS3.3 C.18.6): it is sampled there
      // and each point converted, so unequal pixel spacing gives the ellipse it covers
      if (coord.ValueType !== 'SCOORD3D') {
        const [cx, cy, px, py] = Array.from(coord.GraphicData, Number);
        const r = Math.hypot(px - cx, py - cy);
        const imagePoints = [];
        for (let i = 0; i <= CURVE_SEGMENTS; i++) {
          const t = (2 * Math.PI * i) / CURVE_SEGMENTS;
          imagePoints.push(imageToWorld(plane, [cx + r * Math.cos(t), cy + r * Math.sin(t)]));
        }
        return { GraphicType, shape: SHAPES.POLYLINE, points: imagePoints, closed: true };
      }

      const [center, perimeter] = points;
      const radius = length(sub(perimeter, center));
      return {
        GraphicType,
        shape: SHAPES.POLYLINE,
        points: _curve(center, scale(plane.rowCosines, radius), scale(plane.columnCosines, radius)),
        closed: true,
      };
    }

    case SCOORD_TYPES.ELLIPSE: {
      // Major axis end points, then minor axis end points
      if (points.length < 4) {
        return null;
      }
      const [majorStart, majorEnd, minorStart, minorEnd] = points;
      const center = scale(add(majorStart, majorEnd), 0.5);
      return {
        GraphicType,
        shape: SHAPES.POLYLINE,
        points: _curve(center, scale(sub(majorEnd, majorStart), 0.5), scale(sub(minorEnd, minorStart), 0.5)),
        closed: true,
      };
    }

    default:
      return null;
  }
}


/**
 * Up to two unit vectors spanning the plane the points lie in: none for a single point, one for
 * collinear points, two otherwise.
 */
export function inPlaneVectors(points) {
  const vectors = [];
  if (!points || points.length < 2) {
    return vectors;
  }

  const origin = points[0];
  for (let i = 1; i < points.length && vectors.length < 2; i++) {
    let v = sub(points[i], origin);
    const raw = length(v);

    // Remove the component along the vector already found
    if (vectors.length === 1) {
      const [u] = vectors;
      const projection = v[0] * u[0] + v[1] * u[1] + v[2] * u[2];
      v = sub(v, scale(u, projection));
    }

    // Rounding in stored coordinates must not turn a straight line into a plane
    const magnitude = length(v);
    if (magnitude > Math.max(1e-3, 1e-3 * raw)) {
      vectors.push(scale(v, 1 / magnitude));
    }
  }

  return vectors;
}


export default getRenderableData;
