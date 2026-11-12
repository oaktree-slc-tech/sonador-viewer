// The classic circle's values follow the exchange profile: the radius is the distance between the
// patient points of the center and the edge, in millimetres on any pixel spacing. Its pixel
// statistics are read inside the circle (HU on CT), and announced as a change of the measurement.
// The label shows the values the measurement chose, else the radius and the area.

const mockPlanes = {};
const mockEvents = [];
const mockModality = { value: 'CT' };
jest.mock('cornerstone-tools', () => {
  class CircleRoiTool {
    constructor(props = {}) {
      this.name = props.name || 'CircleRoi';
    }
  }
  const internals = {
    'util/getPixelSpacing': image => ({ rowPixelSpacing: image.rowPixelSpacing, colPixelSpacing: image.columnPixelSpacing }),
    'util/triggerEvent': (element, type, detail) => mockEvents.push({ type, detail }),
    // As the stock statistics: the mean, standard deviation and range of the pixels read
    'util/ellipseUtils': {
      calculateEllipseStatistics: pixels => ({ mean: 40, stdDev: 2, max: Math.max(...pixels), min: Math.min(...pixels) }),
    },
  };
  const external = {
    cornerstone: {
      getPixels: (element, left, top, width, height) => new Array(width * height).fill(0).map((value, i) => i),
      metaData: { get: type => (type === 'generalSeriesModule' ? { modality: mockModality.value } : undefined) },
    },
  };
  const csTools = { CircleRoiTool, importInternal: name => internals[name], external, EVENTS: { MEASUREMENT_MODIFIED: 'modified' } };
  return { __esModule: true, default: csTools, ...csTools };
}, { virtual: true });
jest.mock('@cornerstonejs/core', () => ({ metaData: { get: (type, imageId) => mockPlanes[imageId] } }), { virtual: true });
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: {
    DICOMSR: {
      angleGeometry: jest.requireActual('../../../../platform/core/src/DICOMSR/utils/angleGeometry'),
      circleGeometry: jest.requireActual('../../../../platform/core/src/DICOMSR/utils/circleGeometry'),
    },
  },
}), { virtual: true });

beforeEach(() => {
  mockEvents.length = 0;
  mockModality.value = 'CT';
});

const { default: CircleRoiTool, circleTextLines } = require('./CircleRoiTool');

// Rows 0.8 mm apart, columns 1.2 mm apart
mockPlanes['wadors:anisotropic'] = {
  imagePositionPatient: [0, 0, 0], rowCosines: [1, 0, 0], columnCosines: [0, 1, 0], rowPixelSpacing: 0.8, columnPixelSpacing: 1.2,
};

const statsOf = (handles, image) => {
  const data = { handles, invalidated: true };
  new CircleRoiTool().updateCachedStats(image, {}, data);
  return data;
};

it('measures the radius between patient points on an anisotropic image', () => {
  const data = statsOf({ start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }, { imageId: 'wadors:anisotropic' });
  expect(data.invalidated).toBe(false);
  expect(data.cachedStats.unit).toBe('mm');
  expect(data.cachedStats.radius).toBeCloseTo(12, 9);
  expect(data.cachedStats.area).toBeCloseTo(144 * Math.PI, 9);
  expect(data.cachedStats.perimeter).toBeCloseTo(24 * Math.PI, 9);
  expect(Object.keys(data.cachedStats).sort()).toEqual(['area', 'max', 'mean', 'modalityUnit', 'perimeter', 'radius', 'stdDev', 'unit']);

  expect(statsOf({ start: { x: 0, y: 0 }, end: { x: 0, y: 10 } }, { imageId: 'wadors:anisotropic' }).cachedStats.radius)
    .toBeCloseTo(8, 9);
});

it('measures in pixels on an image without a plane or spacing', () => {
  const data = statsOf({ start: { x: 0, y: 0 }, end: { x: 3, y: 4 } }, { imageId: 'wadors:none' });
  expect(data.cachedStats).toMatchObject({ radius: 5, unit: 'px' });
});

it('reads the pixel statistics inside the circle, in HU on CT and without a unit otherwise, and announces them', () => {
  const element = {};
  const data = { handles: { start: { x: 10, y: 10 }, end: { x: 13, y: 14 } }, invalidated: true };
  new CircleRoiTool().updateCachedStats({ imageId: 'wadors:anisotropic' }, element, data);
  expect(data.cachedStats).toMatchObject({ mean: 40, stdDev: 2, modalityUnit: 'HU' });
  // The pixels of the circle's bounding square, 10 x 10 around a radius of 5
  expect(data.cachedStats.max).toBe(99);
  expect(data.cachedStats).not.toHaveProperty('min');
  expect(mockEvents).toEqual([{ type: 'modified', detail: { toolName: 'CircleRoi', toolType: 'CircleRoi', element, measurementData: data } }]);

  // The same statistics again: no new announcement
  data.invalidated = true;
  new CircleRoiTool().updateCachedStats({ imageId: 'wadors:anisotropic' }, element, data);
  expect(mockEvents).toHaveLength(1);

  mockModality.value = 'MR';
  const mr = { handles: { start: { x: 10, y: 10 }, end: { x: 13, y: 14 } }, invalidated: true };
  new CircleRoiTool().updateCachedStats({ imageId: 'wadors:anisotropic' }, element, mr);
  expect(mr.cachedStats.modalityUnit).toBe('');
});

it('labels the radius and the area by default, the values the measurement chose otherwise, nothing without values', () => {
  const stats = { radius: 12, area: 144 * Math.PI, perimeter: 24 * Math.PI, unit: 'mm', mean: 40, modalityUnit: 'HU' };
  expect(circleTextLines(stats)).toEqual(['Radius: 12.00 mm', 'Area: 452.39 mm²']);
  expect(circleTextLines(stats, ['diameter', 'mean'])).toEqual(['Diameter: 24.00 mm', 'Mean: 40.00 HU']);
  expect(circleTextLines(undefined)).toEqual([]);
});

it('adds the pixel statistics of a circle whose values are held once, its values unchanged', () => {
  const element = {};
  const held = { radius: 12.5, area: 490.87, perimeter: 78.54, unit: 'mm' };
  const data = { handles: { start: { x: 10, y: 10 }, end: { x: 13, y: 14 } }, cachedStats: { ...held } };
  const tool = new CircleRoiTool();
  tool._addPixelStats({ imageId: 'wadors:anisotropic' }, element, data);
  expect(data.cachedStats).toMatchObject({ ...held, mean: 40, stdDev: 2, modalityUnit: 'HU' });
  expect(mockEvents).toHaveLength(1);

  // Read once: a second pass leaves it alone
  data.cachedStats = { ...held };
  tool._addPixelStats({ imageId: 'wadors:anisotropic' }, element, data);
  expect(data.cachedStats).toEqual(held);
  expect(mockEvents).toHaveLength(1);
});
