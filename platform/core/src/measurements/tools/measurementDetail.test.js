import measurementDetail, { cobbArcs, toolIcon, toolDisplayName } from './measurementDetail';

const labelsOf = detail => detail.sections.flatMap(section => section.items.map(entry => entry.label));
const shownOf = detail => detail.sections.flatMap(section => section.items.filter(entry => entry.inViewport).map(entry => entry.key));

describe('the detail of each tool', () => {
  it('Length: its length on the value line, no further values', () => {
    const detail = measurementDetail('Length', { length: 20.4, unit: 'mm', data: {} });
    expect(detail).toMatchObject({ toolName: 'Length', descriptor: 'Distance between two points', icon: 'measure-temp', extraCount: 0, sections: [] });
    expect(detail.primary).toEqual({ key: 'length', value: '20.40', unit: 'mm', text: '20.40 mm' });
  });

  it('Angle: its angle, no further values', () => {
    const detail = measurementDetail('Angle', { data: { rAngle: 123.27 } });
    expect(detail.primary.text).toBe('123.27°');
    expect(detail.extraCount).toBe(0);
  });

  it('Cobb angle: the angle and its two arcs, the angle drawn in the viewport by default', () => {
    // Line 1 along x, line 2 at 45 degrees; the midpoints joined along y
    const detail = measurementDetail('CobbAngle', {
      data: { rAngle: 45, handles: { start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, start2: { x: 0, y: 20 }, end2: { x: 10, y: 30 } } },
    });
    expect(labelsOf(detail)).toEqual(['Cobb angle', 'Arc 1', 'Arc 2']);
    expect(detail.extraCount).toBe(2);
    expect(shownOf(detail)).toEqual(['angle']);
    expect(detail.viewportToggles).toBe(true);
  });

  it('Target: long by short axis with its unit', () => {
    const detail = measurementDetail('Bidirectional', { longestDiameter: '27.76', shortestDiameter: '14.2' });
    expect(detail.primary.text).toBe('27.76 × 14.20 mm');
    expect(labelsOf(detail)).toEqual(['Long axis', 'Short axis']);
    expect(detail.extraCount).toBe(1);
    expect(detail.viewportToggles).toBe(false);
  });

  it('Target: its axes in the unit of the image calibration, pixels without one', () => {
    const target = { longestDiameter: 10, shortestDiameter: 5 };
    const uncalibrated = measurementDetail('Bidirectional', target, { calibrated: false });
    expect(uncalibrated.primary.text).toBe('10.00 × 5.00 px');
    expect(uncalibrated.sections[0].items.map(entry => entry.value)).toEqual(['10.00 px', '5.00 px']);
    // A calibrated image, and a measurement in patient coordinates (calibrated by definition)
    const calibrated = measurementDetail('Bidirectional', target, { calibrated: true, pixelSpacing: { row: 0.8, column: 0.8 } });
    expect(calibrated.primary.text).toBe('10.00 × 5.00 mm');
    expect(calibrated.sections[0].items.map(entry => entry.value)).toEqual(['10.00 mm', '5.00 mm']);
    expect(measurementDetail('Bidirectional', target, { calibrated: true }).primary.text).toBe('10.00 × 5.00 mm');
  });

  it('Circle: radius, diameter, area and perimeter, then the pixel values in the unit of the image', () => {
    const measurement = { data: { cachedStats: { radius: 16.84, area: 890.81, perimeter: 105.81, mean: 412.6, stdDev: 58.31, max: 611, min: 1 } } };
    const detail = measurementDetail('CircleRoi', measurement, { modality: 'MR' });
    expect(detail.primary.text).toBe('16.84 mm');
    expect(detail.sections.map(section => section.title)).toEqual(['Geometry', 'Pixel values']);
    expect(detail.sections[0].items.map(entry => [entry.label, entry.value])).toEqual([
      ['Radius', '16.84 mm'], ['Diameter', '33.68 mm'], ['Area', '890.81 mm²'], ['Perimeter', '105.81 mm'],
    ]);
    // No unit on MR, no Min
    expect(detail.sections[1].items.map(entry => [entry.label, entry.value])).toEqual([['Mean', '412.60'], ['Std dev', '58.31'], ['Max', '611.00']]);
    expect(detail.extraCount).toBe(6);
    expect(shownOf(detail)).toEqual(['radius', 'area']);
  });

  it('Circle: HU on CT, and the unit the statistics carry when they carry one', () => {
    const ct = measurementDetail('CircleRoi', { cachedStats: { radius: 5, area: 78.5, perimeter: 31.4, mean: 40 } }, { modality: 'CT' });
    expect(ct.sections[1].items[0].value).toBe('40.00 HU');
    const pt = measurementDetail('CircleROI', { data: { cachedStats: { radius: 5, mean: 2.5, modalityUnit: 'SUV' } } }, { modality: 'PT' });
    expect(pt.sections[1].items[0].value).toBe('2.50 SUV');
  });

  it('Circle: the values its measurement chose for the viewport label', () => {
    const detail = measurementDetail('CircleRoi', { data: { cachedStats: { radius: 5, area: 78.5, perimeter: 31.4 } }, metadata: { viewportValues: ['diameter'] } });
    expect(shownOf(detail)).toEqual(['diameter']);
  });

  it.each([['EllipticalRoi', 'Ellipse'], ['RectangleRoi', 'Rectangle']])('%s: led by the area, or by the mean when chosen', (tool, name) => {
    const measurement = { cachedStats: { area: 412.5, mean: 38.2, stdDev: 12.41, max: 71 } };
    const byArea = measurementDetail(tool, measurement, { modality: 'CT' });
    expect(byArea).toMatchObject({ toolName: name, descriptor: 'Region statistics', extraCount: 3 });
    expect(byArea.primary.text).toBe('412.50 mm²');
    expect(labelsOf(byArea)).toEqual(['Area', 'Mean', 'Std dev', 'Max']);
    expect(shownOf(byArea)).toEqual(['area', 'mean', 'stdDev']);
    expect(measurementDetail(tool, measurement, { modality: 'CT', regionLeadValue: 'mean' }).primary.text).toBe('38.20 HU');
    // The mean of an MR region has no unit
    expect(measurementDetail(tool, measurement, { modality: 'MR', regionLeadValue: 'mean' }).primary.text).toBe('38.20');
  });

  it('Freehand: the area and its mean and standard deviation', () => {
    const detail = measurementDetail('FreehandMouse', { area: 455.1, meanStdDev: { mean: 10, stdDev: 2 } }, { modality: 'CT' });
    expect(detail.primary.text).toBe('455.10 mm²');
    expect(labelsOf(detail)).toEqual(['Area', 'Mean', 'Std dev']);
  });

  it('Arrow: its text, no values', () => {
    const detail = measurementDetail('ArrowAnnotate', { text: 'Osteophyte' });
    expect(detail.primary.text).toBe('Osteophyte');
    expect(detail.extraCount).toBe(0);
  });

  it('a value not yet computed: no primary value and no sections', () => {
    const detail = measurementDetail('CircleRoi', { data: {} });
    expect(detail.primary).toBeNull();
    expect(detail.sections).toEqual([]);
    expect(detail.extraCount).toBe(0);
  });

  it('none for a tool without a detail card', () => {
    expect(measurementDetail('DICOMSRSeriesTagTool', {})).toBeUndefined();
    expect(toolIcon('DICOMSRSeriesTagTool')).toBe('tags');
    expect(toolIcon('CircleROI')).toBe('circle-radius');
    expect(toolDisplayName('CobbAngle')).toBe('Cobb Angle');
  });
});

describe('Cobb angle arcs', () => {
  it('are the angles between each line and the line joining their midpoints', () => {
    // Line 1 along x, line 2 at 45 degrees, the midpoints (5, 0) and (5, 25) joined along y
    const arcs = cobbArcs([[0, 0, 0], [10, 0, 0], [0, 20, 0], [10, 30, 0]]);
    expect(arcs.arc1).toBeCloseTo(90, 9);
    expect(arcs.arc2).toBeCloseTo(135, 9);
    expect(cobbArcs([[0, 0], [1, 0]])).toBeUndefined();
  });
});
