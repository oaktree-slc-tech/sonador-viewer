// What the Annotations panel shows about a measurement beyond its row: the tool that drew it (name,
// descriptor, toolbar icon), its primary value (the row's value line), and every value the tool
// computes, grouped in sections for the measurement detail card. Each value says whether the
// viewport label draws it. The reference line's `+N` counts the values beyond the primary one.
//
// One builder per tool, next to the tools' display functions. A measurement can carry classic tool
// data, a measurement-service record (`data`), or Cornerstone3D statistics by target id; the
// builders read all three. Values are formatted here, with two decimals.
//
// Which values a measurement's viewport label draws is `viewportValues` (keys) on the measurement,
// else the tool's default. Only the tools whose labels the Viewer draws itself (the circle and the
// Cobb angle) let a pending measurement change it; the others show what their label draws.

import { angleBetweenLines } from '../../DICOMSR/utils/angleGeometry';
import { classicToolName } from '../../DICOMSR/utils/circleGeometry';
import { circleDetailItems, circleDisplayValues } from './circleDisplay';

const DEGREE = String.fromCharCode(176);

// The lead value of the region tools (Ellipse, Rectangle, Freehand): a display preference
export const REGION_LEAD_VALUES = Object.freeze({ AREA: 'area', MEAN: 'mean' });
export const REGION_TOOLS = ['EllipticalRoi', 'RectangleRoi', 'FreehandMouse'];

// The tools whose viewport label a pending measurement can change from its detail card
export const VIEWPORT_TOGGLE_TOOLS = ['CircleRoi', 'CobbAngle'];

// The values each tool's viewport label draws by default
export const DEFAULT_VIEWPORT_VALUES = Object.freeze({
  CircleRoi: ['radius', 'area'],
  CobbAngle: ['angle'],
  Bidirectional: ['long', 'short'],
  EllipticalRoi: ['area', 'mean', 'stdDev'],
  RectangleRoi: ['area', 'mean', 'stdDev'],
  FreehandMouse: ['area', 'mean', 'stdDev'],
});

const isNumber = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const fixed = value => Number(value).toFixed(2);
const withUnit = (value, unit) => (unit ? `${value} ${unit}` : value);

/** The sections of a measurement: itself, its data and its classic tool data */
const sectionsOf = measurement => [measurement, measurement && measurement.data, measurement && measurement.measurementData]
  .filter(section => section && typeof section === 'object');

/** The first value of `key` in a measurement's sections */
const firstOf = (measurement, key) => sectionsOf(measurement).map(section => section[key]).find(isNumber);

/** A measurement's statistics: classic `cachedStats`, else the first Cornerstone3D target's */
function statsOf(measurement) {
  const candidates = sectionsOf(measurement).flatMap(section => [
    section.cachedStats,
    ...Object.keys(section).filter(key => /^(imageId|volumeId|stackTarget):/.test(key)).map(key => section[key]),
  ]);
  return candidates.find(stats => stats && typeof stats === 'object' && Object.keys(stats).length) || {};
}

/** The viewport values of a measurement: its own, else the tool's default */
function viewportValuesOf(measurement, tool) {
  const own = sectionsOf(measurement).flatMap(section => [section.viewportValues, section.metadata && section.metadata.viewportValues])
    .find(Array.isArray);
  return own && own.length ? own : (DEFAULT_VIEWPORT_VALUES[tool] || []);
}

/** The unit of a pixel value: the statistics' own, else HU on CT, else none */
function pixelUnitOf(stats, modality) {
  if (typeof stats.modalityUnit === 'string') {
    return stats.modalityUnit;
  }
  return modality === 'CT' ? 'HU' : '';
}

const item = (key, label, value) => ({ key, label, value });

function pixelItems(stats, unit, mean = stats.mean, stdDev = stats.stdDev) {
  return [
    isNumber(mean) && item('mean', 'Mean', withUnit(fixed(mean), unit)),
    isNumber(stdDev) && item('stdDev', 'Std dev', withUnit(fixed(stdDev), unit)),
    isNumber(stats.max) && item('max', 'Max', withUnit(fixed(stats.max), unit)),
  ].filter(Boolean);
}

const primaryOf = (key, value, unit, text) => ({ key, value, unit, text: text || (unit === DEGREE ? `${value}${unit}` : withUnit(value, unit)) });

/** The angle of an Angle or Cobb angle, wherever it is kept */
const angleOf = measurement => firstOf(measurement, 'rAngle');

/** The four points of a Cobb angle (start, end, start2, end2), in patient coordinates when known */
function cobbPoints(measurement, { pixelSpacing } = {}) {
  const points = measurement.points || [];
  if (points.length === 4 && points.every(Array.isArray)) {
    return points;
  }
  const handles = sectionsOf(measurement).map(section => section.handles).find(h => h && h.start && h.end && h.start2 && h.end2);
  const imagePoints = handles ? [handles.start, handles.end, handles.start2, handles.end2] : points;
  if (imagePoints.length !== 4 || !imagePoints.every(point => point && isNumber(point.x) && isNumber(point.y))) {
    return undefined;
  }
  // Scaled by the pixel spacing, as the classic tool measures the angle
  const row = (pixelSpacing && pixelSpacing.row) || 1;
  const column = (pixelSpacing && pixelSpacing.column) || 1;
  return imagePoints.map(({ x, y }) => [x * column, y * row]);
}

/**
 * The arcs of a Cobb angle, as Cornerstone3D computes them: the angle between each line and the line
 * joining their midpoints. Undefined without four points.
 */
export function cobbArcs(points) {
  if (!points || points.length !== 4) {
    return undefined;
  }
  const mid = (a, b) => a.map((value, i) => (value + b[i]) / 2);
  const link = [mid(points[0], points[1]), mid(points[2], points[3])];
  const arc1 = angleBetweenLines([points[0], points[1]], link);
  const arc2 = angleBetweenLines([points[2], points[3]], link);
  return isNumber(arc1) && isNumber(arc2) ? { arc1, arc2 } : undefined;
}


const TOOLS = {
  Length: {
    toolName: 'Length', descriptor: 'Distance between two points', icon: 'measure-temp',
    build: (measurement) => {
      const length = firstOf(measurement, 'length');
      const unit = sectionsOf(measurement).map(section => section.unit).find(Boolean) || 'mm';
      return { primary: isNumber(length) ? primaryOf('length', fixed(length), unit) : null, sections: [] };
    },
  },
  Angle: {
    toolName: 'Angle', descriptor: 'Angle between two arms', icon: 'angle-left',
    build: (measurement) => {
      const angle = angleOf(measurement);
      return { primary: isNumber(angle) ? primaryOf('angle', fixed(angle), DEGREE) : null, sections: [] };
    },
  },
  CobbAngle: {
    toolName: 'Cobb Angle', descriptor: 'Angle between two lines', icon: 'cobb-angle',
    build: (measurement, context) => {
      const angle = angleOf(measurement);
      if (!isNumber(angle)) {
        return { primary: null, sections: [] };
      }
      const arcs = cobbArcs(cobbPoints(measurement, context));
      const items = [
        item('angle', 'Cobb angle', `${fixed(angle)}${DEGREE}`),
        ...(arcs ? [item('arc1', 'Arc 1', `${fixed(arcs.arc1)}${DEGREE}`), item('arc2', 'Arc 2', `${fixed(arcs.arc2)}${DEGREE}`)] : []),
      ];
      return { primary: primaryOf('angle', fixed(angle), DEGREE), sections: [{ title: 'Angles', items }] };
    },
  },
  Bidirectional: {
    toolName: 'Target', descriptor: 'Long and short axis', icon: 'measure-target',
    build: (measurement, { calibrated = true } = {}) => {
      const long = firstOf(measurement, 'longestDiameter');
      const short = firstOf(measurement, 'shortestDiameter');
      if (!isNumber(long)) {
        return { primary: null, sections: [] };
      }
      // The tool measures its axes through the image's pixel spacing: pixels without one
      const unit = calibrated ? 'mm' : 'px';
      const items = [item('long', 'Long axis', withUnit(fixed(long), unit))];
      if (isNumber(short)) {
        items.push(item('short', 'Short axis', withUnit(fixed(short), unit)));
      }
      const value = isNumber(short) ? `${fixed(long)} × ${fixed(short)}` : fixed(long);
      return { primary: primaryOf('long', value, unit), sections: [{ title: 'Axes', items }] };
    },
  },
  CircleRoi: {
    toolName: 'Circle', descriptor: 'Radius', icon: 'circle-radius',
    build: (measurement, { modality } = {}) => {
      const values = circleDisplayValues(measurement);
      if (!values) {
        return { primary: null, sections: [] };
      }
      const { unit } = values;
      // Area, Perimeter and Radius as the circle formats them; Diameter derived from the radius
      const byLabel = Object.fromEntries(circleDetailItems(values).map(entry => [entry.label, entry.value]));
      const geometry = [
        item('radius', 'Radius', byLabel.Radius),
        item('diameter', 'Diameter', withUnit(fixed(2 * values.radius), unit)),
        item('area', 'Area', byLabel.Area),
        item('perimeter', 'Perimeter', byLabel.Perimeter),
      ];
      const stats = { ...values.stats };
      const pixels = pixelItems(stats, pixelUnitOf(stats, modality));
      return {
        primary: primaryOf('radius', fixed(values.radius), unit),
        sections: [{ title: 'Geometry', items: geometry }, ...(pixels.length ? [{ title: 'Pixel values', items: pixels }] : [])],
      };
    },
  },
  ArrowAnnotate: {
    toolName: 'Arrow', descriptor: 'Text annotation', icon: 'measure-non-target',
    build: (measurement) => {
      const text = sectionsOf(measurement).map(section => section.text).find(value => typeof value === 'string' && value);
      return { primary: text ? { key: 'text', value: text, unit: '', text } : null, sections: [] };
    },
  },
};

// Ellipse, Rectangle and Freehand: the region's area and pixel values, led by the area or the mean
function regionTool(toolName, icon) {
  return {
    toolName, descriptor: 'Region statistics', icon,
    build: (measurement, { modality, calibrated = true, regionLeadValue = REGION_LEAD_VALUES.AREA } = {}) => {
      const stats = statsOf(measurement);
      const meanStdDev = sectionsOf(measurement).map(section => section.meanStdDev).find(Boolean) || {};
      const area = isNumber(stats.area) ? stats.area : firstOf(measurement, 'area');
      const mean = isNumber(stats.mean) ? stats.mean : meanStdDev.mean;
      const stdDev = isNumber(stats.stdDev) ? stats.stdDev : meanStdDev.stdDev;
      const areaUnit = stats.areaUnit || (calibrated ? 'mm²' : 'px²');
      const pixelUnit = pixelUnitOf(stats, modality);
      const geometry = isNumber(area) ? [item('area', 'Area', withUnit(fixed(area), areaUnit))] : [];
      const pixels = pixelItems(stats, pixelUnit, mean, stdDev);
      const sections = [
        ...(geometry.length ? [{ title: 'Geometry', items: geometry }] : []),
        ...(pixels.length ? [{ title: 'Pixel values', items: pixels }] : []),
      ];
      const leadMean = regionLeadValue === REGION_LEAD_VALUES.MEAN && isNumber(mean);
      let primary = null;
      if (leadMean || (!isNumber(area) && isNumber(mean))) {
        primary = primaryOf('mean', fixed(mean), pixelUnit);
      } else if (isNumber(area)) {
        primary = primaryOf('area', fixed(area), areaUnit);
      }
      return { primary, sections };
    },
  };
}

TOOLS.EllipticalRoi = regionTool('Ellipse', 'circle-o');
TOOLS.RectangleRoi = regionTool('Rectangle', 'square-o');
TOOLS.FreehandMouse = regionTool('Freehand', 'inline-edit');

// Icons of the tools that have no detail card
const OTHER_ICONS = Object.freeze({ DICOMSRSeriesTagTool: 'tags' });


/** The toolbar icon of a tool, or undefined */
export function toolIcon(toolType) {
  const tool = classicToolName(toolType);
  return (TOOLS[tool] && TOOLS[tool].icon) || OTHER_ICONS[tool];
}

/** The display name of a tool ("Cobb Angle"), or undefined */
export function toolDisplayName(toolType) {
  const tool = TOOLS[classicToolName(toolType)];
  return tool && tool.toolName;
}

/**
 * The detail of a measurement for the Annotations panel, or undefined for a tool without one:
 * `{ tool, toolName, descriptor, icon, primary: { key, value, unit, text } | null, sections:
 * [{ title, items: [{ key, label, value, inViewport }] }], extraCount, viewportToggles }`.
 *
 * @param {string} toolType - the tool (classic or Cornerstone3D name)
 * @param {object} measurement - the measurement (record, classic tool data or both)
 * @param {object} [context] - `{ modality, calibrated, pixelSpacing: { row, column }, regionLeadValue }`
 */
export default function measurementDetail(toolType, measurement, context = {}) {
  const tool = classicToolName(toolType);
  const definition = TOOLS[tool];
  if (!definition || !measurement) {
    return undefined;
  }
  const { primary, sections } = definition.build(measurement, context);
  const shown = new Set(viewportValuesOf(measurement, tool));
  const marked = (primary ? sections : []).map(section => ({
    ...section,
    items: section.items.map(entry => ({ ...entry, inViewport: shown.has(entry.key) })),
  }));
  const count = marked.reduce((total, section) => total + section.items.length, 0);
  return {
    tool,
    toolName: definition.toolName,
    descriptor: definition.descriptor,
    icon: definition.icon,
    primary,
    sections: marked,
    extraCount: Math.max(0, count - 1),
    viewportToggles: VIEWPORT_TOGGLE_TOOLS.includes(tool),
  };
}

/**
 * The lines of a measurement's viewport label: each value it shows as "Label: value", in the card's
 * order. A Cobb angle that shows its angle alone shows it bare ("85.43°"), as before. Classic and
 * Cornerstone3D tools draw the same lines.
 */
export function viewportLabelLines(toolType, measurement, context) {
  const detail = measurementDetail(toolType, measurement, context);
  if (!detail || !detail.primary) {
    return [];
  }
  const shown = detail.sections.flatMap(section => section.items.filter(entry => entry.inViewport));
  if (detail.tool === 'CobbAngle' && shown.length === 1 && shown[0].key === 'angle') {
    return [detail.primary.text];
  }
  return shown.map(entry => `${entry.label}: ${entry.value}`);
}

export { measurementDetail, viewportValuesOf };
