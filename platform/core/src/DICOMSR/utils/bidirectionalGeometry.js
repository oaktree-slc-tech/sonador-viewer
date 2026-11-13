// Geometry of the Bidirectional measurement in DICOM-SR: a long axis and a short axis, each a line
// segment with its own length. One measurement group per Bidirectional, tracking identifier
// `cornerstoneTools@^4.0.0:Bidirectional` (the Cornerstone3D prefix accepted on read), with two NUM
// items in this order, each in mm and each INFERRED FROM its own two-point POLYLINE:
//   Long Axis (103339001, SCT), then Short Axis (103340004, SCT).
// Readers accept the SRT codes (G-A185, G-A186) and match by meaning as well, in any order; a
// measurement read with an SRT code keeps it on re-save.
//
// * Image domain: two SCOORD POLYLINEs, (column, row), each SELECTED FROM the same image.
// * Patient domain: two SCOORD3D POLYLINEs with the Frame of Reference.
//
// The axes are taken as labelled: the long axis is the pair under the Long Axis NUM, whatever the
// lengths. The classic tool is cornerstone-tools `Bidirectional` (handles `start`, `end`, then
// `perpendicularStart`, `perpendicularEnd`), the Cornerstone3D tool `BidirectionalTool`
// (`points[0..3]` in that order); both keep the short axis perpendicular to the long one and give the
// longer pair the long axis when a drawing ends. A pair is placed in the tools only when its short
// axis crosses its long axis and is perpendicular to it within 1 degree (`axesProblem`).

import _ from 'lodash';

export const BIDIRECTIONAL_TOOL = 'Bidirectional';
export const HANDLE_NAMES = Object.freeze(['start', 'end', 'perpendicularStart', 'perpendicularEnd']);

// An axis shorter than this (mm) is degenerate: kept with a warning on read, refused on write
export const MIN_AXIS_LENGTH = 0.01;
// The short axis is perpendicular to the long axis within this angle
const PERPENDICULAR_TOLERANCE_DEGREES = 1;
// The two axes cross when they come this close (in the units of the points), within their ends
const CROSSING_TOLERANCE = 0.01;

const unitCode = (CodeValue, CodeMeaning) => Object.freeze({
  CodeValue, CodingSchemeDesignator: 'UCUM', CodingSchemeVersion: '1.4', CodeMeaning,
});
export const MILLIMETRE = unitCode('mm', 'millimeter');

const code = (CodeValue, CodingSchemeDesignator, CodeMeaning) => Object.freeze({ CodeValue, CodingSchemeDesignator, CodeMeaning });

// The NUM items in the order they are written: the SCT concept written, the SRT concept read (and
// written again for a measurement read with it), the handles of the axis
export const BIDIRECTIONAL_AXES = Object.freeze([
  Object.freeze({
    name: 'long',
    concept: code('103339001', 'SCT', 'Long Axis'),
    srt: code('G-A185', 'SRT', 'Long Axis'),
    handles: Object.freeze(['start', 'end']),
  }),
  Object.freeze({
    name: 'short',
    concept: code('103340004', 'SCT', 'Short Axis'),
    srt: code('G-A186', 'SRT', 'Short Axis'),
    handles: Object.freeze(['perpendicularStart', 'perpendicularEnd']),
  }),
]);

// The value each axis is held as: Cornerstone3D statistics (`length`, `width`) and the classic tool
// data (`longestDiameter`, `shortestDiameter`)
const VALUE_NAMES = Object.freeze({ long: 'length', short: 'width' });
const CLASSIC_VALUE_NAMES = Object.freeze({ long: 'longestDiameter', short: 'shortestDiameter' });

const isBidirectionalTool = toolType => toolType === BIDIRECTIONAL_TOOL;

const toVector = point => (_.isArray(point) ? Array.from(point, Number)
  : [point.x, point.y, point.z].filter(v => !_.isNil(v)).map(Number));
const sub = (a, b) => a.map((value, i) => value - b[i]);
const add = (a, b) => a.map((value, i) => value + b[i]);
const scale = (a, s) => a.map(value => value * s);
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const norm = a => Math.sqrt(dot(a, a));


/** The length of an axis between two points (2D or 3D, arrays or `{ x, y[, z] }`) */
function axisLength(a, b) {
  return norm(sub(toVector(b), toVector(a)));
}

/** The values of four points as labelled: { length (points 0, 1), width (points 2, 3) } */
function bidirectionalValues(points) {
  const [p0, p1, p2, p3] = points || [];
  return {
    length: p0 && p1 ? axisLength(p0, p1) : NaN,
    width: p2 && p3 ? axisLength(p2, p3) : NaN,
  };
}

const samePoint = (a, b, tolerance) => !!a && !!b && a.length === b.length
  && a.every((value, i) => Math.abs(value - b[i]) <= tolerance);

/**
 * The values of four points: { length, width, unit, widthUnit }, each axis keeping the recorded value
 * and unit (`recordValue`, { values: { length, width, unit, widthUnit }, points }) while its own two
 * points are those recorded (within `tolerance`): a moved handle recomputes the length of its axis
 * only, in `computedUnit`. `computed` gives the lengths of the points when they are measured elsewhere
 * (image points compared, patient points measured).
 */
function valuesKeepingAxes(points, recordValue, tolerance = 1e-6, computed = bidirectionalValues(points), computedUnit = 'mm') {
  const recorded = recordValue && recordValue.values;
  const recordedPoints = (recordValue && recordValue.points) || [];
  const fresh = { length: computed.length, width: computed.width, unit: computedUnit, widthUnit: computedUnit };
  if (!recorded || !points || points.length !== 4 || recordedPoints.length !== 4) {
    return fresh;
  }
  const current = points.map(toVector);
  const before = recordedPoints.map(toVector);
  const kept = (first, name) => _.isFinite(recorded[name])
    && samePoint(current[first], before[first], tolerance) && samePoint(current[first + 1], before[first + 1], tolerance);
  const [keepLength, keepWidth] = [kept(0, 'length'), kept(2, 'width')];
  return {
    length: keepLength ? recorded.length : fresh.length,
    width: keepWidth ? recorded.width : fresh.width,
    unit: keepLength ? recorded.unit || 'mm' : computedUnit,
    widthUnit: keepWidth ? recorded.widthUnit || recorded.unit || 'mm' : computedUnit,
  };
}

// Millimetres in one unit of each UCUM length unit
const MILLIMETRES_PER_UNIT = Object.freeze({ mm: 1, cm: 10, dm: 100, m: 1000, um: 0.001 });

/** A length in millimetres, from a value and its UCUM unit code; undefined for another unit */
function inMillimetres(value, unitCode = 'mm') {
  const factor = MILLIMETRES_PER_UNIT[unitCode];
  return factor === undefined || !_.isFinite(value) ? undefined : value * factor;
}

/**
 * Values of a Cornerstone3D Bidirectional annotation (`data` with `handles.points`, long axis then
 * short axis, in patient coordinates): each axis the record's value while its points are those the
 * record holds (`data.recordValue`, within 1e-6), else the length of its points.
 */
function annotationBidirectional(data) {
  const { handles, recordValue } = data || {};
  return valuesKeepingAxes((handles && handles.points) || [], recordValue);
}


/** The distance between the segments `p + s u` and `q + t v` (s, t in [0, 1]), neither of zero length */
function segmentDistance(p, u, q, v) {
  const r = sub(p, q);
  const [a, b, c, e, f] = [dot(u, u), dot(u, v), dot(u, r), dot(v, v), dot(v, r)];
  const denominator = a * e - b * b;
  let s = denominator > 0 ? _.clamp((b * f - c * e) / denominator, 0, 1) : 0;
  let t = (b * s + f) / e;
  if (t < 0) {
    t = 0;
    s = _.clamp(-c / a, 0, 1);
  } else if (t > 1) {
    t = 1;
    s = _.clamp((b - c) / a, 0, 1);
  }
  return norm(sub(add(p, scale(u, s)), add(q, scale(v, t))));
}

/**
 * Why a pair of axes cannot be placed in the tools, or undefined when it can: its short axis must
 * cross its long axis (the segments meet within CROSSING_TOLERANCE, ends included) and be
 * perpendicular to it within 1 degree. `points` are the four points (2D or 3D), long axis first, in
 * the space where the angle is measured (patient millimetres when the image plane is known).
 */
function axesProblem(points) {
  if (!points || points.length !== 4) {
    return 'not two axes of two points';
  }
  const [a0, a1, b0, b1] = points.map(toVector);
  const u = sub(a1, a0);
  const v = sub(b1, b0);
  const lengths = norm(u) * norm(v);
  if (!(lengths > 0)) {
    return 'an axis has no length';
  }
  const sin = Math.sin(PERPENDICULAR_TOLERANCE_DEGREES * Math.PI / 180);
  if (Math.abs(dot(u, v)) / lengths > sin) {
    return 'not perpendicular';
  }
  return segmentDistance(a0, u, b0, v) > CROSSING_TOLERANCE ? 'no intersection' : undefined;
}


const conceptOf = item => {
  const concept = item && item.ConceptNameCodeSequence;
  return Array.isArray(concept) ? concept[0] : concept;
};
const firstOf = sequence => (Array.isArray(sequence) ? sequence[0] : sequence);
const codeValueOf = concept => concept && (concept.CodeValue || concept.LongCodeValue || concept.URNCodeValue);
const isCode = (concept, expected) => !!concept && codeValueOf(concept) === expected.CodeValue
  && concept.CodingSchemeDesignator === expected.CodingSchemeDesignator;

/**
 * The Bidirectional's NUM items of a measurement group, by axis: { long, short }, each { item, value,
 * unit, scheme } or undefined. A NUM is matched by its code (SCT, or SRT: `scheme` 'SRT'), else by
 * its meaning, in any order; a NUM answers one axis only.
 */
function bidirectionalNumItems(groupItems) {
  const nums = (groupItems || []).filter(item => item && item.ValueType === 'NUM');
  const used = new Set();
  const found = {};
  const take = (name, item, scheme) => {
    used.add(item);
    const measured = firstOf(item.MeasuredValueSequence);
    const value = measured && !_.isNil(measured.NumericValue) ? Number(measured.NumericValue) : NaN;
    found[name] = {
      item,
      value: Number.isFinite(value) ? value : undefined,
      unit: measured && firstOf(measured.MeasurementUnitsCodeSequence),
      scheme,
    };
  };
  // Codes first, for both axes, then meanings: a coded NUM is never claimed by the other axis' meaning
  BIDIRECTIONAL_AXES.forEach(({ name, concept, srt }) => {
    const item = nums.find(num => !used.has(num) && (isCode(conceptOf(num), concept) || isCode(conceptOf(num), srt)));
    if (item) {
      take(name, item, isCode(conceptOf(item), srt) ? 'SRT' : 'SCT');
    }
  });
  BIDIRECTIONAL_AXES.forEach(({ name, concept }) => {
    if (found[name]) {
      return;
    }
    const item = nums.find(num => !used.has(num) && conceptOf(num)
      && String(conceptOf(num).CodeMeaning).toLowerCase() === concept.CodeMeaning.toLowerCase());
    if (item) {
      take(name, item, 'SCT');
    }
  });
  return { long: found.long, short: found.short };
}

/** The geometry item of an axis' NUM: its first SCOORD / SCOORD3D child INFERRED FROM, or undefined */
function axisGeometryOf(num) {
  const children = Array.isArray(num && num.ContentSequence) ? num.ContentSequence : [num && num.ContentSequence].filter(Boolean);
  return children.find(item => item && (item.ValueType === 'SCOORD' || item.ValueType === 'SCOORD3D')
    && item.RelationshipType === 'INFERRED FROM');
}

/** The concept an axis is written with: SRT for a measurement read with SRT, else SCT */
const axisConcept = (axis, scheme) => ({ ...(scheme === 'SRT' ? axis.srt : axis.concept) });


/**
 * The values of a Bidirectional measurement, wherever it holds them: { length, width, unit, widthUnit },
 * from a classic tool's or record's `longestDiameter` / `shortestDiameter` (with `unit`, `widthUnit`), or
 * Cornerstone3D statistics (`length`, `width`, `unit`, `widthUnit`) by target; undefined without a
 * finite long axis. Each axis has its own unit (the short axis' defaults to the long axis').
 */
function bidirectionalDisplayValues(measurement) {
  if (!measurement) {
    return undefined;
  }
  const sections = [measurement, measurement.data, measurement.measurementData].filter(section => section && typeof section === 'object');
  const numberOf = value => (_.isNil(value) ? NaN : Number(value));
  const withUnits = (length, width, units, fallback) => {
    const unit = units.unit || fallback || 'mm';
    return { length, width, unit, widthUnit: units.widthUnit || unit };
  };
  for (const section of sections) {
    const length = numberOf(section[CLASSIC_VALUE_NAMES.long]);
    if (Number.isFinite(length)) {
      const unit = section.unit || (section.metadata && section.metadata.unit) || measurement.unit;
      return withUnits(length, numberOf(section[CLASSIC_VALUE_NAMES.short]), { unit, widthUnit: section.widthUnit });
    }
  }
  // Cornerstone3D statistics by target: an annotation's `cachedStats`, or a record's `data`
  const targets = section => Object.keys(section).filter(key => /^(imageId|volumeId|stackTarget):/.test(key)).map(key => section[key]);
  const stats = sections.flatMap(section => [section.cachedStats, ...(section.cachedStats ? targets(section.cachedStats) : []), ...targets(section)])
    .find(value => value && typeof value === 'object' && Number.isFinite(numberOf(value.length)));
  return stats ? withUnits(Number(stats.length), numberOf(stats.width), stats) : undefined;
}

const fixed = value => (Number.isFinite(value) ? value.toFixed(2) : '–');
const unitsOf = values => {
  const unit = values.unit || 'mm';
  return [unit, values.widthUnit || unit];
};

/** The two lines of a Bidirectional's label in every view: `L: … mm`, `W: … mm`, each in its own unit */
function bidirectionalLabelLines(values) {
  if (!values || !Number.isFinite(values.length)) {
    return [];
  }
  const [unit, widthUnit] = unitsOf(values);
  return [`L: ${fixed(values.length)} ${unit}`, `W: ${fixed(values.width)} ${widthUnit}`];
}

/** The Measurements panel and 3D view text of a Bidirectional: `L x W mm`, `L cm x W mm` when the units differ */
function bidirectionalText(values) {
  if (!values || !Number.isFinite(values.length)) {
    return '';
  }
  const [unit, widthUnit] = unitsOf(values);
  return unit === widthUnit
    ? `${fixed(values.length)} x ${fixed(values.width)} ${unit}`
    : `${fixed(values.length)} ${unit} x ${fixed(values.width)} ${widthUnit}`;
}


export {
  annotationBidirectional,
  axesProblem,
  axisConcept,
  axisGeometryOf,
  axisLength,
  bidirectionalDisplayValues,
  bidirectionalLabelLines,
  bidirectionalNumItems,
  bidirectionalText,
  bidirectionalValues,
  CLASSIC_VALUE_NAMES,
  inMillimetres,
  isBidirectionalTool,
  VALUE_NAMES,
  valuesKeepingAxes,
};
