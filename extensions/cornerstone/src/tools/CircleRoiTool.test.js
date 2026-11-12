// The classic circle's values follow the exchange profile: the radius is the distance between the
// patient points of the center and the edge, in millimetres on any pixel spacing, and the label
// shows the radius and the area.

const mockPlanes = {};
jest.mock('cornerstone-tools', () => {
  class CircleRoiTool {
    constructor(props = {}) {
      this.name = props.name || 'CircleRoi';
    }
  }
  const internals = {
    'util/getPixelSpacing': image => ({ rowPixelSpacing: image.rowPixelSpacing, colPixelSpacing: image.columnPixelSpacing }),
  };
  const csTools = { CircleRoiTool, importInternal: name => internals[name], external: {} };
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
  expect(Object.keys(data.cachedStats).sort()).toEqual(['area', 'perimeter', 'radius', 'unit']);

  expect(statsOf({ start: { x: 0, y: 0 }, end: { x: 0, y: 10 } }, { imageId: 'wadors:anisotropic' }).cachedStats.radius)
    .toBeCloseTo(8, 9);
});

it('measures in pixels on an image without a plane or spacing', () => {
  const data = statsOf({ start: { x: 0, y: 0 }, end: { x: 3, y: 4 } }, { imageId: 'wadors:none' });
  expect(data.cachedStats).toMatchObject({ radius: 5, unit: 'px' });
});

it('labels the radius and the area on two lines', () => {
  expect(circleTextLines({ radius: 12, area: 144 * Math.PI, unit: 'mm' })).toEqual(['Radius: 12.00 mm', 'Area: 452.39 mm²']);
  expect(circleTextLines(undefined)).toEqual(['Radius: – mm', 'Area: – mm²']);
});
