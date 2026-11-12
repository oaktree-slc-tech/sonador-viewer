// Geometry of the circle measurement in DICOM-SR (oak-tree/medical-imaging/sonador-client#41). One
// measurement group per circle, tracking identifier `cornerstoneTools@^4.0.0:CircleROI` (the
// Cornerstone3D prefix accepted on read), with three NUM items in this order, each INFERRED FROM
// its own copy of the geometry:
//   Area (42798000, SCT) in mm2, Perimeter (131191004, SCT) in mm, Radius (131190003, SCT) in mm,
//   then the pixel statistics the circle has (CIRCLE_STATISTICS below).
// Readers accept the SRT codes (G-A166, G-A197, G-A196) and match by meaning as well, in any order.
//
// * Image domain: SCOORD CIRCLE of two points, the center then one point on the circumference,
//   SELECTED FROM the image.
// * Patient domain: SCOORD3D ELLIPSE of four points, two perpendicular diameters of length 2r
//   through the center: `c - r u`, `c + r u`, `c - r v`, `c + r v`, where `u` runs from the center
//   to the edge point and `v = n x u` for the normal `n` of the plane the circle was drawn in. The
//   undefined CIRCLE SCOORD3D written by stock Cornerstone3D is read (center and radius, no plane)
//   and never written.
//
// The classic tool is cornerstone-tools `CircleRoi` (handles `start`, the center, and `end`, the
// edge point); the Cornerstone3D tool is `CircleROI` (`points[0]` the center, `points[1]` the edge
// point). The values follow from the radius: perimeter 2 pi r, area pi r^2.

import _ from 'lodash';

export const CIRCLE_TOOL_NAMES = Object.freeze({ CLASSIC: 'CircleRoi', CORNERSTONE_3D: 'CircleROI' });
export const CIRCLE_TOOLS = [CIRCLE_TOOL_NAMES.CLASSIC, CIRCLE_TOOL_NAMES.CORNERSTONE_3D];
// The tool name of the tracking identifier
export const CIRCLE_TRACKING_TOOL = CIRCLE_TOOL_NAMES.CORNERSTONE_3D;

// A radius below this (mm) is degenerate: kept with a warning on read, refused on write
export const MIN_RADIUS = 0.01;
// An ELLIPSE reads as a circle when its diameters' midpoints and half-lengths agree within this (mm)
// and the diameters are perpendicular within ELLIPSE_PERPENDICULAR_TOLERANCE (|cos|)
const ELLIPSE_TOLERANCE = 0.01;
const ELLIPSE_PERPENDICULAR_TOLERANCE = 1e-3;

const unitCode = (CodeValue, CodeMeaning) => Object.freeze({
  CodeValue, CodingSchemeDesignator: 'UCUM', CodingSchemeVersion: '1.4', CodeMeaning,
});

// The NUM items in the order they are written: the concept written, the codes and meaning read
export const CIRCLE_VALUES = Object.freeze([
  Object.freeze({
    name: 'area',
    concept: Object.freeze({ CodeValue: '42798000', CodingSchemeDesignator: 'SCT', CodeMeaning: 'Area' }),
    codes: Object.freeze(['42798000', 'G-A166']),
    unit: unitCode('mm2', 'SquareMilliMeter'),
  }),
  Object.freeze({
    name: 'perimeter',
    concept: Object.freeze({ CodeValue: '131191004', CodingSchemeDesignator: 'SCT', CodeMeaning: 'Perimeter' }),
    codes: Object.freeze(['131191004', 'G-A197']),
    unit: unitCode('mm', 'millimeter'),
  }),
  Object.freeze({
    name: 'radius',
    concept: Object.freeze({ CodeValue: '131190003', CodingSchemeDesignator: 'SCT', CodeMeaning: 'Radius' }),
    codes: Object.freeze(['131190003', 'G-A196']),
    unit: unitCode('mm', 'millimeter'),
  }),
]);

// The circle's pixel statistics (TID 1419 style): one NUM per statistic after the Radius, named by
// the quantity the pixels measure, in that quantity's unit, its statistic a Derivation (121401, DCM)
// modifier from CID 7464, INFERRED FROM the same geometry. A statistic is written only when it is a
// finite number and the quantity is known: the attenuation coefficient of CT (HU), SUVbw of PT (SUV),
// MR signal intensity (no units). Readers also accept the stock Cornerstone3D form, a NUM named by
// the CID 7464 code itself.
export const DERIVATION = Object.freeze({ CodeValue: '121401', CodingSchemeDesignator: 'DCM', CodeMeaning: 'Derivation' });

// Each with its retired SNOMED-RT (SRT) code, which readers also accept
export const CIRCLE_STATISTICS = Object.freeze([
  Object.freeze({
    name: 'mean', code: Object.freeze({ CodeValue: '373098007', CodingSchemeDesignator: 'SCT', CodeMeaning: 'Mean' }), srt: 'R-00317',
  }),
  Object.freeze({
    name: 'stdDev',
    code: Object.freeze({ CodeValue: '386136009', CodingSchemeDesignator: 'SCT', CodeMeaning: 'Standard Deviation' }),
    srt: 'R-10047',
  }),
  Object.freeze({
    name: 'max', code: Object.freeze({ CodeValue: '56851009', CodingSchemeDesignator: 'SCT', CodeMeaning: 'Maximum' }), srt: 'G-A437',
  }),
]);

// The quantity of statistics read without one the circle writes (no units, or a unit of no known
// quantity): they are shown, and not written again under a quantity the image suggests
export const UNKNOWN_QUANTITY = 'unknown';

// The quantities, with the unit written and the modality unit it reads back as
const STATISTIC_QUANTITIES = Object.freeze({
  CT: Object.freeze({
    concept: Object.freeze({ CodeValue: '112031', CodingSchemeDesignator: 'DCM', CodeMeaning: 'Attenuation Coefficient' }),
    unit: unitCode("[hnsf'U]", 'Hounsfield Unit'),
    modalityUnit: 'HU',
  }),
  PT: Object.freeze({
    concept: Object.freeze({ CodeValue: '126401', CodingSchemeDesignator: 'DCM', CodeMeaning: 'SUVbw' }),
    unit: unitCode('g/ml{SUVbw}', 'Standardized Uptake Value body weight'),
    modalityUnit: 'SUV',
  }),
  MR: Object.freeze({
    concept: Object.freeze({ CodeValue: '110852', CodingSchemeDesignator: 'DCM', CodeMeaning: 'MR signal intensity' }),
    unit: unitCode('1', 'no units'),
    modalityUnit: '',
  }),
});

const BODY_WEIGHT_SUV = ['SUV', 'SUVBW', 'G/ML{SUVBW}'];

/**
 * The quantity a circle's pixel statistics measure, from the image's modality and the statistics'
 * modality unit (HU: CT; SUV: PT); undefined when it is not one the circle's statistics are written in.
 */
function statisticQuantity({ modality, modalityUnit } = {}) {
  const unitValue = String(modalityUnit || '').toUpperCase();
  const of = expected => !modality || modality === expected;
  if ((unitValue === 'HU' && of('CT')) || (modality === 'CT' && !unitValue)) {
    return STATISTIC_QUANTITIES.CT;
  }
  // SUV is body weight SUV (the Cornerstone3D scaling); another normalization is not SUVbw
  if (BODY_WEIGHT_SUV.includes(unitValue) && of('PT')) {
    return STATISTIC_QUANTITIES.PT;
  }
  if (modality === 'MR' && !unitValue) {
    return STATISTIC_QUANTITIES.MR;
  }
  return undefined;
}

/**
 * The statistic NUM items of a circle (in CIRCLE_STATISTICS order) for its statistics
 * ({ mean, stdDev, max, modalityUnit }) on an image of `modality`, each with a copy of the geometry
 * from `geometryItem()`. The quantity the statistics carry (`statisticsModality`, as computed or read)
 * names them before the image's modality does. None without a known quantity; a statistic that is not
 * a finite number is left out.
 */
function circleStatisticItems(statistics, modality, geometryItem) {
  const quantity = statistics && statisticQuantity({
    modality: statistics.statisticsModality || modality, modalityUnit: statistics.modalityUnit,
  });
  if (!statistics || !quantity) {
    return [];
  }
  return CIRCLE_STATISTICS
    .filter(({ name }) => _.isFinite(statistics[name]))
    .map(({ name, code }) => ({
      RelationshipType: 'CONTAINS',
      ValueType: 'NUM',
      ConceptNameCodeSequence: { ...quantity.concept },
      MeasuredValueSequence: { MeasurementUnitsCodeSequence: { ...quantity.unit }, NumericValue: statistics[name] },
      ContentSequence: [
        { RelationshipType: 'HAS CONCEPT MOD', ValueType: 'CODE', ConceptNameCodeSequence: { ...DERIVATION }, ConceptCodeSequence: { ...code } },
        geometryItem(),
      ],
    }));
}

/**
 * The statistics a circle carries (`cachedStats`, or a record's statistics by image): the first with a
 * finite mean, standard deviation or maximum, as { mean, stdDev, max, modalityUnit, statisticsModality }.
 * `statisticsModality` is the modality of the pixels measured: the Cornerstone3D statistics' `Modality`,
 * or the quantity a stored circle was read with; it names the quantity when no image does.
 */
function circleStatisticsOf(...candidates) {
  const stats = candidates.find(candidate => candidate && CIRCLE_STATISTICS.some(({ name }) => _.isFinite(candidate[name])));
  if (!stats) {
    return undefined;
  }
  const statisticsModality = stats.statisticsModality || stats.Modality;
  return CIRCLE_STATISTICS.reduce((picked, { name }) => (_.isFinite(stats[name]) ? { ...picked, [name]: stats[name] } : picked), {
    ...(_.isNil(stats.modalityUnit) ? {} : { modalityUnit: stats.modalityUnit }),
    ...(statisticsModality ? { statisticsModality } : {}),
  });
}

const isCircleTool = toolType => CIRCLE_TOOLS.includes(toolType);

// The circle's name in the other library, any other tool name as it is: the classic tool name of
// a Cornerstone3D one, and the Cornerstone3D name of a classic one
// Circle values measured on an image without calibration are in pixels: kept, shown and stored
// with that unit, never with millimetres; every other circle value is in millimetres
export const PIXEL_UNIT = 'px';
const circleUnit = stats => (stats && (stats.unit === PIXEL_UNIT || stats.radiusUnit === PIXEL_UNIT) ? PIXEL_UNIT : 'mm');

const classicToolName = toolName => (toolName === CIRCLE_TOOL_NAMES.CORNERSTONE_3D ? CIRCLE_TOOL_NAMES.CLASSIC : toolName);
const cornerstone3DToolName = toolName => (toolName === CIRCLE_TOOL_NAMES.CLASSIC ? CIRCLE_TOOL_NAMES.CORNERSTONE_3D : toolName);

const toVector = point => (_.isArray(point) ? Array.from(point, Number)
  : [point.x, point.y, point.z].filter(v => !_.isNil(v)).map(Number));
const sub = (a, b) => a.map((value, i) => value - b[i]);
const add = (a, b) => a.map((value, i) => value + b[i]);
const scale = (a, s) => a.map(value => value * s);
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const norm = a => Math.sqrt(dot(a, a));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => (norm(a) > 0 ? scale(a, 1 / norm(a)) : undefined);
const mean = points => points[0].map((_value, i) => points.reduce((sum, point) => sum + point[i], 0) / points.length);


/** The values of a circle of radius `radius` (mm): { radius, area, perimeter } */
function circleValues(radius) {
  const r = Number(radius);
  return { radius: r, area: Math.PI * r * r, perimeter: 2 * Math.PI * r };
}

/** The radius of a circle given by its center and one point on its circumference (2D or 3D) */
function circleRadius(center, edge) {
  return norm(sub(toVector(edge), toVector(center)));
}

/**
 * The four ELLIPSE points of a circle in the patient domain: `c - r u`, `c + r u`, `c - r v`,
 * `c + r v`, with `u` from the center to the edge point and `v = n x u`. The edge point is first
 * projected onto the plane of normal `n` through the center. Undefined for a degenerate circle or
 * a normal along `u`.
 */
function ellipseOfCircle(center, edge, normal) {
  const c = toVector(center);
  const n = unit(toVector(normal || []));
  if (!n || n.length !== 3 || c.length !== 3) {
    return undefined;
  }
  const offset = sub(toVector(edge), c);
  const inPlane = sub(offset, scale(n, dot(offset, n)));
  const radius = norm(inPlane);
  if (!(radius >= MIN_RADIUS)) {
    return undefined;
  }
  const u = scale(inPlane, 1 / radius);
  const v = cross(n, u);
  return [sub(c, scale(u, radius)), add(c, scale(u, radius)), sub(c, scale(v, radius)), add(c, scale(v, radius))];
}

/**
 * `count` points around a circle in the plane of `normal`, from its edge point (patient
 * coordinates), for drawing; undefined for a degenerate circle or a normal along the radius.
 */
function circleOutline(center, edge, normal, count = 64) {
  const axes = ellipseOfCircle(center, edge, normal);
  if (!axes) {
    return undefined;
  }
  const c = toVector(center);
  const radius = norm(sub(axes[1], axes[0])) / 2;
  const u = scale(sub(axes[1], c), 1 / radius);
  const v = scale(sub(axes[3], c), 1 / radius);
  return Array.from({ length: count }, (_value, i) => {
    const angle = (2 * Math.PI * i) / count;
    return add(c, add(scale(u, radius * Math.cos(angle)), scale(v, radius * Math.sin(angle))));
  });
}

/**
 * The circle of four ELLIPSE points (`c - r u`, `c + r u`, `c - r v`, `c + r v`):
 * { center, edge (`c + r u`), radius, normal (`u x v`) }, or undefined when the ellipse is not a
 * circle: the diameters' midpoints or half-lengths differ by more than 0.01 mm, or the diameters
 * are not perpendicular (|cos| above 1e-3).
 */
function circleOfEllipse(points) {
  if (!points || points.length !== 4 || points.some(point => toVector(point).length !== 3)) {
    return undefined;
  }
  const [a1, a2, b1, b2] = points.map(toVector);
  const midA = scale(add(a1, a2), 0.5);
  const midB = scale(add(b1, b2), 0.5);
  const halfA = norm(sub(a2, a1)) / 2;
  const halfB = norm(sub(b2, b1)) / 2;
  const u = unit(sub(a2, a1));
  const v = unit(sub(b2, b1));
  if (!u || !v || norm(sub(midA, midB)) > ELLIPSE_TOLERANCE || Math.abs(halfA - halfB) > ELLIPSE_TOLERANCE
      || Math.abs(dot(u, v)) > ELLIPSE_PERPENDICULAR_TOLERANCE) {
    return undefined;
  }
  const center = mean([a1, a2, b1, b2]);
  const radius = (halfA + halfB) / 2;
  return { center, edge: add(center, scale(u, radius)), radius, normal: unit(cross(u, v)) };
}

const isLegacyGeometry = sourceGeometry => !!sourceGeometry
  && sourceGeometry.valueType === 'SCOORD3D' && sourceGeometry.graphicType === 'CIRCLE';

/**
 * The points a circle's plane is found from (DICOMSR drawingPlane `navigationPlaneOf`), for its
 * center and edge `points` and the geometry it was read from (`sourceGeometry`): the four points of
 * a patient-domain ELLIPSE, which hold its plane, while the circle is still that ELLIPSE's; else the
 * center and edge. Undefined for the CIRCLE SCOORD3D of stock Cornerstone3D, whose plane is not known.
 */
function circlePlanePoints(points, sourceGeometry) {
  if (isLegacyGeometry(sourceGeometry)) {
    return undefined;
  }
  const graphic = sourceGeometry && sourceGeometry.valueType === 'SCOORD3D' && sourceGeometry.graphicType === 'ELLIPSE'
    ? Array.from(sourceGeometry.graphicData || [], Number) : [];
  if (graphic.length === 12 && points && points.length === 2) {
    const ellipse = [0, 3, 6, 9].map(i => graphic.slice(i, i + 3));
    const circle = circleOfEllipse(ellipse);
    const [center, edge] = points.map(toVector);
    if (circle && norm(sub(center, circle.center)) <= ELLIPSE_TOLERANCE && norm(sub(edge, circle.edge)) <= ELLIPSE_TOLERANCE) {
      return ellipse;
    }
  }
  return points;
}

/** The circle of the two points of a CIRCLE (center, then a point on the circumference) */
function circleOfCenterAndEdge(points) {
  if (!points || points.length !== 2) {
    return undefined;
  }
  const [center, edge] = points.map(toVector);
  return { center, edge, radius: circleRadius(center, edge), normal: undefined };
}

/**
 * The circle of an SR geometry item (`{ ValueType, GraphicType, points }`): CIRCLE in the image
 * domain; ELLIPSE in the patient domain; the undefined CIRCLE SCOORD3D of stock Cornerstone3D as
 * `legacy` (no plane). Undefined when the item is none of these or the ELLIPSE is not a circle.
 */
function circleOfGeometry({ ValueType, GraphicType, points }) {
  if (GraphicType === 'CIRCLE') {
    const circle = circleOfCenterAndEdge(points);
    return circle && { ...circle, legacy: ValueType === 'SCOORD3D' };
  }
  if (GraphicType === 'ELLIPSE' && ValueType === 'SCOORD3D') {
    return circleOfEllipse(points);
  }
  return undefined;
}


const conceptOf = item => {
  const concept = item && item.ConceptNameCodeSequence;
  return Array.isArray(concept) ? concept[0] : concept;
};

/**
 * The circle's NUM items of a measurement group, by value: { area, perimeter, radius }, each
 * { item, value } or undefined. A NUM is matched by its code (SCT or SRT), else by its meaning, in
 * any order.
 */
function circleNumItems(groupItems) {
  const nums = (groupItems || []).filter(item => item && item.ValueType === 'NUM');
  const valueOf = (item) => {
    const measured = item.MeasuredValueSequence;
    const first = Array.isArray(measured) ? measured[0] : measured;
    const value = first && !_.isNil(first.NumericValue) ? Number(first.NumericValue) : NaN;
    return Number.isFinite(value) ? value : undefined;
  };
  return CIRCLE_VALUES.reduce((found, { name, codes, concept }) => {
    const item = nums.find(num => codes.includes(conceptOf(num) && (conceptOf(num).CodeValue || conceptOf(num).LongCodeValue)))
      || nums.find(num => conceptOf(num) && String(conceptOf(num).CodeMeaning).toLowerCase() === concept.CodeMeaning.toLowerCase());
    return { ...found, [name]: item ? { item, value: valueOf(item) } : undefined };
  }, {});
}

const childrenOf = item => (Array.isArray(item && item.ContentSequence) ? item.ContentSequence
  : [item && item.ContentSequence].filter(Boolean));
const firstCode = sequence => (Array.isArray(sequence) ? sequence[0] : sequence);
const codeValue = code => code && (code.CodeValue || code.LongCodeValue || code.URNCodeValue);

const UCUM_SCHEMES = ['UCUM'];
const sameCode = (code, expected, schemes = [expected.CodingSchemeDesignator]) => Boolean(code)
  && codeValue(code) === expected.CodeValue && schemes.includes(code.CodingSchemeDesignator);
/** Whether `code` is a statistic's SCT code, or its SRT code */
const isStatisticCode = (code, { code: sct, srt }) => sameCode(code, sct)
  || sameCode(code, { CodeValue: srt, CodingSchemeDesignator: 'SRT' });

/**
 * The quantity of a stock statistic NUM, from its UCUM unit: { modalityUnit, statisticsModality }, or
 * undefined when the unit is not UCUM or names an SUV normalization other than body weight. No
 * units, or a unit of no known quantity, is UNKNOWN_QUANTITY: the image's modality does not name it.
 */
function stockQuantityOfUnit(code) {
  const value = codeValue(code);
  if (!value || value === '1') {
    return !code || UCUM_SCHEMES.includes(code.CodingSchemeDesignator)
      ? { modalityUnit: '', statisticsModality: UNKNOWN_QUANTITY } : undefined;
  }
  if (!UCUM_SCHEMES.includes(code.CodingSchemeDesignator)) {
    return undefined;
  }
  const quantity = Object.entries(STATISTIC_QUANTITIES).find(([, candidate]) => candidate.unit.CodeValue === value);
  if (quantity) {
    return { modalityUnit: quantity[1].modalityUnit, statisticsModality: quantity[0] };
  }
  const unitValue = value.toUpperCase();
  if (unitValue === 'HU') {
    return { modalityUnit: 'HU', statisticsModality: 'CT' };
  }
  if (BODY_WEIGHT_SUV.includes(unitValue)) {
    return { modalityUnit: 'SUV', statisticsModality: 'PT' };
  }
  return unitValue.startsWith('SUV') || unitValue.includes('{SUV') ? undefined
    : { modalityUnit: value, statisticsModality: UNKNOWN_QUANTITY };
}

/**
 * The circle's pixel statistics in a measurement group: { mean, stdDev, max, modalityUnit,
 * statisticsModality } with the finite values found, or undefined when it has none. A statistic is a
 * NUM whose Derivation modifier is a CIRCLE_STATISTICS code (SCT, or its SRT code), named by a quantity of
 * STATISTIC_QUANTITIES in that quantity's unit; or the stock Cornerstone3D NUM named by the statistic's
 * code (SCT) in a UCUM unit. A statistic of another quantity, scheme or SUV normalization is not read,
 * and statistics of different quantities are not read at all: one quantity is never relabelled as another.
 */
function circleStatisticNumItems(groupItems) {
  const nums = (groupItems || []).filter(item => item && item.ValueType === 'NUM');
  const identityOf = (num, unit) => {
    // { statistic, modalityUnit, statisticsModality } of a statistic NUM, else undefined
    const modifier = childrenOf(num).find(child => child && child.RelationshipType === 'HAS CONCEPT MOD'
      && sameCode(conceptOf(child), DERIVATION));
    const named = conceptOf(num);
    if (modifier) {
      const derivation = firstCode(modifier.ConceptCodeSequence);
      const statistic = CIRCLE_STATISTICS.find(candidate => isStatisticCode(derivation, candidate));
      const quantity = Object.entries(STATISTIC_QUANTITIES).find(([, candidate]) => sameCode(named, candidate.concept)
        && sameCode(unit, candidate.unit, UCUM_SCHEMES));
      return statistic && quantity
        && { statistic, modalityUnit: quantity[1].modalityUnit, statisticsModality: quantity[0] };
    }
    const statistic = CIRCLE_STATISTICS.find(candidate => isStatisticCode(named, candidate));
    const quantity = statistic && stockQuantityOfUnit(unit);
    return quantity && { statistic, ...quantity };
  };
  const found = [];
  nums.forEach((num) => {
    const measured = firstCode(num.MeasuredValueSequence);
    const value = measured && !_.isNil(measured.NumericValue) ? Number(measured.NumericValue) : NaN;
    const identity = Number.isFinite(value) && identityOf(num, firstCode(measured.MeasurementUnitsCodeSequence));
    if (identity && !found.some(({ statistic }) => statistic === identity.statistic)) {
      found.push({ ...identity, value });
    }
  });
  if (!found.length) {
    return undefined;
  }
  const [{ modalityUnit, statisticsModality }] = found;
  if (found.some(item => item.modalityUnit !== modalityUnit || item.statisticsModality !== statisticsModality)) {
    return undefined;
  }
  return found.reduce((statistics, { statistic, value }) => ({ ...statistics, [statistic.name]: value }), {
    modalityUnit, ...(statisticsModality ? { statisticsModality } : {}),
  });
}

/** The geometry item of a circle group: the first SCOORD / SCOORD3D under one of its NUM items */
function circleGeometryItem(groupItems) {
  const nums = (groupItems || []).filter(item => item && item.ValueType === 'NUM');
  for (const num of nums) {
    const children = Array.isArray(num.ContentSequence) ? num.ContentSequence : [num.ContentSequence].filter(Boolean);
    const coordinates = children.find(item => item && (item.ValueType === 'SCOORD' || item.ValueType === 'SCOORD3D')
      && item.RelationshipType === 'INFERRED FROM');
    if (coordinates) {
      return { num, coordinates };
    }
  }
  return {};
}


/**
 * Values of a Cornerstone3D circle annotation (`data` with `handles.points`, center then edge, in
 * patient coordinates): the record's values while its points are those the record holds
 * (`data.recordValue`, { values, points }, within 1e-6), else the values of the points. NaN values
 * without two points.
 */
function annotationCircle(data) {
  const { handles, recordValue } = data || {};
  const points = (handles && handles.points) || [];
  const unchanged = recordValue && recordValue.values && Number.isFinite(recordValue.values.radius)
    && recordValue.points && recordValue.points.length === points.length
    && recordValue.points.every((point, i) => point.length === points[i].length
      && point.every((value, j) => Math.abs(value - points[i][j]) <= 1e-6));
  if (unchanged) {
    return { ...recordValue.values };
  }
  return points.length >= 2 ? circleValues(circleRadius(points[0], points[1])) : circleValues(NaN);
}


export {
  annotationCircle,
  circleGeometryItem,
  circleNumItems,
  circleStatisticItems,
  circleStatisticNumItems,
  circleStatisticsOf,
  statisticQuantity,
  circleOfCenterAndEdge,
  circleOfEllipse,
  circleOfGeometry,
  circleOutline,
  circlePlanePoints,
  circleRadius,
  circleUnit,
  circleValues,
  classicToolName,
  cornerstone3DToolName,
  ellipseOfCircle,
  isCircleTool,
  isLegacyGeometry,
};
