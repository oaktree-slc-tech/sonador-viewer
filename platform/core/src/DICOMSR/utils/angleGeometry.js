// Geometry of the Angle and Cobb angle measurements in DICOM-SR. Both tools are written as a NUM
// `(285285000, SCT, "Cobb angle")` in degrees, INFERRED FROM a POLYLINE of four points:
// * Cobb angle: two independent lines, `p1, p2` and `p3, p4`, four handles;
// * Angle: three handles `p1, vertex, p3`, encoded `p1, vertex, vertex, p3` and read back from
//   encoded points 0, 1 and 3.
// The tracking identifier decides the tool, never the geometry. The value is the Cornerstone3D
// `angleBetweenLines` result for the encoded points: `v1 = p2 - p1`, `v2 = p3 - p4`,
// `acos(v1 . v2 / (|v1| |v2|))` in degrees, 0 to 180. Endpoint order matters (reversing one line
// gives the supplement) and no acute normalisation is applied.

import _ from 'lodash';

export const ANGLE_TOOL_NAMES = Object.freeze({ ANGLE: 'Angle', COBB_ANGLE: 'CobbAngle' });
export const ANGLE_TOOLS = [ANGLE_TOOL_NAMES.ANGLE, ANGLE_TOOL_NAMES.COBB_ANGLE];

// Points closer than this (in the units of the points) are coincident
const EPSILON = 1e-6;

const isAngleTool = toolType => ANGLE_TOOLS.includes(toolType);

const toVector = point => (_.isArray(point) ? point.map(Number) : [point.x, point.y, point.z].filter(v => !_.isNil(v)).map(Number));
const sub = (a, b) => a.map((value, i) => value - b[i]);
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const norm = a => Math.sqrt(dot(a, a));

const coincident = (a, b) => norm(sub(toVector(a), toVector(b))) <= EPSILON;


/**
 * Angle in degrees between the lines `p1 -> p2` and `p4 -> p3` (2D or 3D points, arrays or
 * `{ x, y[, z] }`), or NaN when either line has zero length.
 */
function angleBetweenLines([p1, p2], [p3, p4]) {
  const v1 = sub(toVector(p2), toVector(p1));
  const v2 = sub(toVector(p3), toVector(p4));
  const lengths = norm(v1) * norm(v2);
  if (!(lengths > EPSILON * EPSILON)) {
    return NaN;
  }
  const cos = _.clamp(dot(v1, v2) / lengths, -1, 1);
  return Math.acos(cos) * (180 / Math.PI);
}


/** The four encoded points of a tool's handle points (three for Angle, four for Cobb angle) */
function encodedPoints(toolType, handlePoints) {
  if (toolType === ANGLE_TOOL_NAMES.ANGLE) {
    const [p1, vertex, p3] = handlePoints;
    return [p1, vertex, vertex, p3];
  }
  return handlePoints.slice(0, 4);
}


/** The handle points of a tool read from its four encoded points */
function handlePointsOf(toolType, points) {
  if (toolType === ANGLE_TOOL_NAMES.ANGLE) {
    return [points[0], points[1], points[3]];
  }
  return points.slice(0, 4);
}


/** The value of four encoded points, in degrees (NaN for a degenerate line) */
function encodedAngle(points) {
  const [p1, p2, p3, p4] = points;
  return angleBetweenLines([p1, p2], [p3, p4]);
}


/**
 * Problems of an encoded polyline read for `toolType`, as messages: a point count other than
 * four, a zero-length line, and for Angle middle points that differ (read from points 0, 1, 3).
 */
function encodingWarnings(toolType, points) {
  const warnings = [];
  if (!points || points.length !== 4) {
    warnings.push(`expected four points, found ${points ? points.length : 0}`);
    return warnings;
  }
  if (coincident(points[0], points[1]) || coincident(points[2], points[3])) {
    warnings.push('a line has zero length');
  }
  if (toolType === ANGLE_TOOL_NAMES.ANGLE && !coincident(points[1], points[2])) {
    warnings.push('the middle points differ; the angle is read from points 0, 1 and 3');
  }
  return warnings;
}


// Image <-> patient coordinates of an image plane (an `imagePlaneModule`: imagePositionPatient,
// rowCosines, columnCosines, rowPixelSpacing = PixelSpacing[0] between rows, columnPixelSpacing =
// PixelSpacing[1] between columns), as DICOM defines them: x runs along the row direction in steps
// of the column spacing, y along the column direction in steps of the row spacing. Image
// coordinates follow SCOORD: the centre of the first pixel is (0.5, 0.5). Every angle conversion
// (hydration, the classic bridge, the writer and the Cornerstone3D mirror) uses these, so a value
// computed for new or edited geometry agrees with the points written with it. An unchanged
// hydrated measurement keeps its stored value, which may differ from its geometry.

const positive = value => _.isFinite(Number(value)) && Number(value) > 0;

function isPlane(module) {
  return !!module && [module.imagePositionPatient, module.rowCosines, module.columnCosines]
    .every(vector => vector && vector.length >= 3 && Array.from(vector).every(v => _.isFinite(Number(v))))
    && positive(module.rowPixelSpacing) && positive(module.columnPixelSpacing);
}

function imageToPatient(module, [x, y]) {
  const origin = Array.from(module.imagePositionPatient, Number);
  const row = Array.from(module.rowCosines, Number);
  const column = Array.from(module.columnCosines, Number);
  const u = Number(module.columnPixelSpacing) * (x - 0.5);
  const v = Number(module.rowPixelSpacing) * (y - 0.5);
  return [0, 1, 2].map(i => origin[i] + row[i] * u + column[i] * v);
}

function patientToImage(module, point) {
  const offset = sub(toVector(point), Array.from(module.imagePositionPatient, Number));
  return [
    dot(offset, Array.from(module.rowCosines, Number)) / Number(module.columnPixelSpacing) + 0.5,
    dot(offset, Array.from(module.columnCosines, Number)) / Number(module.rowPixelSpacing) + 0.5,
  ];
}


/**
 * How a new or edited angle on an image can be measured: `patient` when the image has a complete
 * plane with finite, positive pixel spacing; `square` when it has no spacing but declares square
 * pixels (Pixel Aspect Ratio 1:1), measured in pixels; otherwise null, and no value can be written.
 *
 * @param {object} [module] - the image's `imagePlaneModule`
 * @param {Array<number>} [pixelAspectRatio] - Pixel Aspect Ratio (0028,0034) of the image
 */
function calibrationOf(module, pixelAspectRatio) {
  if (isPlane(module)) {
    return 'patient';
  }
  const hasSpacing = module && (!_.isNil(module.rowPixelSpacing) || !_.isNil(module.columnPixelSpacing));
  const ratio = Array.from(pixelAspectRatio || [], Number);
  if (!hasSpacing && ratio.length === 2 && positive(ratio[0]) && ratio[0] === ratio[1]) {
    return 'square';
  }
  return null;
}


// Patient points closer than this (mm) are the same point
const SAME_POINT_TOLERANCE = 1e-6;

/**
 * The value of the measurement record a Cornerstone3D annotation mirrors (`data.recordValue`,
 * { value, points }) while the annotation's `handles.points` are those points (within 1e-6);
 * undefined otherwise.
 */
function unchangedRecordValue(data) {
  const { handles, recordValue } = data || {};
  const points = (handles && handles.points) || [];
  const unchanged = recordValue && _.isFinite(recordValue.value) && recordValue.points
    && recordValue.points.length === points.length
    && recordValue.points.every((point, i) => point.length === points[i].length
      && point.every((value, j) => Math.abs(value - points[i][j]) <= SAME_POINT_TOLERANCE));
  return unchanged ? recordValue.value : undefined;
}

/**
 * Value of a Cornerstone3D Angle / Cobb angle annotation (`data` with `handles.points` in patient
 * coordinates): the value of the record it mirrors while the points are unchanged
 * (`unchangedRecordValue`), otherwise the value computed from its points. A computed value is NaN
 * for incomplete or degenerate geometry; a matching record value is returned as stored.
 */
function annotationAngle(toolType, data) {
  const recorded = unchangedRecordValue(data);
  if (recorded !== undefined) {
    return recorded;
  }
  const points = (data && data.handles && data.handles.points) || [];
  const count = toolType === ANGLE_TOOL_NAMES.ANGLE ? 3 : 4;
  return points.length === count ? encodedAngle(encodedPoints(toolType, points)) : NaN;
}

/**
 * The length (mm) of a Length annotation: the record's value while the annotation has the points it
 * belongs to (a measurement read from a report keeps the value it was stored with), else the
 * distance between its two patient points; NaN without two points.
 */
function annotationLength(data) {
  const recorded = unchangedRecordValue(data);
  if (recorded !== undefined) {
    return recorded;
  }
  const points = (data && data.handles && data.handles.points) || [];
  if (points.length !== 2) {
    return NaN;
  }
  const [a, b] = points;
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}


/**
 * The coordinates a read-only display draws for a measurement read from a report. A Cobb angle's
 * POLYLINE holds its two lines end to end (p1, p2, p3, p4); drawn as one polyline it would join
 * p2 to p3, so it is returned as the two lines, each with the original image reference. Other
 * coordinates are returned as they are.
 *
 * @param {string} TrackingIdentifier - the measurement group's tracking identifier
 * @param {Array} coords - its SCOORD / SCOORD3D items (GraphicType, GraphicData, ValueType, ...)
 */
function displayCoordsOf(TrackingIdentifier, coords) {
  const toolType = typeof TrackingIdentifier === 'string' ? TrackingIdentifier.split(':').pop() : undefined;
  if (toolType !== ANGLE_TOOL_NAMES.COBB_ANGLE || !Array.isArray(coords)) {
    return coords;
  }
  return coords.flatMap(coord => {
    const dimensions = coord && coord.ValueType === 'SCOORD3D' ? 3 : 2;
    const data = Array.from((coord && coord.GraphicData) || []);
    if (!coord || coord.GraphicType !== 'POLYLINE' || data.length !== 4 * dimensions) {
      return [coord];
    }
    const half = 2 * dimensions;
    return [{ ...coord, GraphicData: data.slice(0, half) }, { ...coord, GraphicData: data.slice(half) }];
  });
}


export {
  angleBetweenLines,
  annotationAngle,
  annotationLength,
  calibrationOf,
  unchangedRecordValue,
  imageToPatient,
  isPlane,
  patientToImage,
  encodedAngle,
  encodedPoints,
  encodingWarnings,
  handlePointsOf,
  displayCoordsOf,
  isAngleTool,
};
