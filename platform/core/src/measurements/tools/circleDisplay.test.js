import { circleRoi } from './circleRoi';
import { circleDetailItems, circleDisplayValues } from './circleDisplay';

const VALUES = { radius: 12, area: 144 * Math.PI, perimeter: 24 * Math.PI };

describe('circle measurements-table text', () => {
  const display = circleRoi.options.measurementTable.displayFunction;

  it.each([
    [{ cachedStats: VALUES }], [{ data: { cachedStats: VALUES } }], [{ measurementData: { cachedStats: VALUES } }],
    [{ data: { 'imageId:wadors:1': { ...VALUES, mean: 40 } } }],
  ])('shows the radius in mm, wherever the values are kept (%o)', data => {
    expect(display(data)).toBe('12.00 mm');
  });

  it.each([[{}], [{ cachedStats: {} }], [{ data: { cachedStats: { radius: 'x' } } }], [undefined]])(
    'shows nothing without a radius (%o)', data => {
      expect(display(data)).toBe('');
    });

  it.each([
    [{ cachedStats: { ...VALUES, unit: 'px' } }], [{ data: { 'imageId:wadors:1': { ...VALUES, radiusUnit: 'px' } } }],
    [{ unit: 'px', data: { cachedStats: VALUES } }],
  ])('shows pixels, never millimetres, for a circle measured without calibration (%o)', data => {
    expect(display(data)).toBe('12.00 px');
    expect(circleDetailItems(circleDisplayValues(data)).map(item => item.value)).toEqual(['452.39 px²', '75.40 px', '12.00 px']);
  });

  it('lists the area, perimeter and radius for the detail line, without intensity statistics', () => {
    const values = circleDisplayValues({ cachedStats: { ...VALUES, mean: 40, stdDev: 2 } });
    expect(values).toEqual({ ...VALUES, unit: 'mm' });
    expect(circleDetailItems(values)).toEqual([
      { label: 'Area', value: '452.39 mm²' },
      { label: 'Perimeter', value: '75.40 mm' },
      { label: 'Radius', value: '12.00 mm' },
    ]);
    expect(circleDetailItems(undefined)).toEqual([]);
  });
});
