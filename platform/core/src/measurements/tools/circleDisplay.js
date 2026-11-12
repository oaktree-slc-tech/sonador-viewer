// Measurements-table text of a circle: the radius, two decimals, as the row's value; the area,
// perimeter and radius for its detail line. The values are a classic tool's `cachedStats`, a
// service measurement's `data.cachedStats`, or a Cornerstone3D one's statistics by image; without
// a finite radius nothing is shown. They are in millimetres, or in pixels when they were measured
// on an image without calibration, and are shown with that unit.

import { circleUnit } from '../../DICOMSR/utils/circleGeometry';

const VALUE_KEYS = ['radius', 'area', 'perimeter'];

const statsWithRadius = value => value && typeof value === 'object' && Number.isFinite(Number(value.radius));

/** The values of a circle measurement: { radius, area, perimeter, unit }, or undefined */
export function circleDisplayValues(data) {
  if (!data) {
    return undefined;
  }
  const sections = [data, data.data, data.measurementData].filter(Boolean);
  const candidates = sections.flatMap(section => [
    section.cachedStats,
    ...Object.values(section).filter(statsWithRadius),
  ]);
  const stats = candidates.find(statsWithRadius);
  if (!stats) {
    return undefined;
  }
  const values = VALUE_KEYS.reduce((result, key) => ({ ...result, [key]: Number(stats[key]) }), {});
  // A measurement records its unit beside the values (`unit` on the measurement itself)
  return { ...values, unit: circleUnit(stats.unit || stats.radiusUnit ? stats : data) };
}

/** The detail-line items of a circle: [{ label, value }] for its area, perimeter and radius */
export function circleDetailItems(values) {
  if (!values) {
    return [];
  }
  const unit = values.unit || 'mm';
  const format = (value, suffix) => (Number.isFinite(value) ? `${value.toFixed(2)} ${suffix}` : '–');
  return [
    { label: 'Area', value: format(values.area, `${unit}²`) },
    { label: 'Perimeter', value: format(values.perimeter, unit) },
    { label: 'Radius', value: format(values.radius, unit) },
  ];
}

export default function circleDisplay(data) {
  const values = circleDisplayValues(data);
  return values ? `${values.radius.toFixed(2)} ${values.unit}` : '';
}
