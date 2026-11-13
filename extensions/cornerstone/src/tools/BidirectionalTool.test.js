// The classic Bidirectional's lengths follow the exchange profile: each axis as labelled, in
// millimetres between the patient points of its handles on any pixel spacing, an axis keeping a
// held length while its handles are those it belongs to. The label reads L: and W:. The stock tool
// sets its pointer callbacks on the instance; the subclass puts them on the prototype chain, so the
// lockable tools (lockableMeasurementTool.js) decline a locked measurement.

const mockPlanes = {};
jest.mock('cornerstone-tools', () => {
  // As cornerstone-tools 6.0.10 BidirectionalTool: callbacks bound on the instance
  class BidirectionalTool {
    constructor(props = {}) {
      this.name = props.name || 'Bidirectional';
      this.renderToolData = () => 'stock-render';
      this.pointNearTool = () => true;
      this.handleSelectedCallback = () => 'handle-selected';
    }
    toolSelectedCallback() { return 'tool-selected'; }
  }
  const internals = {
    'util/getPixelSpacing': image => ({ rowPixelSpacing: image.rowPixelSpacing, colPixelSpacing: image.columnPixelSpacing }),
  };
  const csTools = { BidirectionalTool, importInternal: name => internals[name] || (() => undefined), external: {}, getToolState: () => undefined };
  return { __esModule: true, default: csTools, ...csTools };
}, { virtual: true });
jest.mock('@cornerstonejs/core', () => ({ metaData: { get: (type, imageId) => mockPlanes[imageId] } }), { virtual: true });
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: {
    DICOMSR: {
      angleGeometry: jest.requireActual('../../../../platform/core/src/DICOMSR/utils/angleGeometry'),
      bidirectionalGeometry: jest.requireActual('../../../../platform/core/src/DICOMSR/utils/bidirectionalGeometry'),
    },
  },
}), { virtual: true });

const { default: BidirectionalTool, bidirectionalTextLines } = require('./BidirectionalTool');
const { lockable } = require('./lockableMeasurementTool');

// Rows 0.8 mm apart, columns 1.2 mm apart
mockPlanes['wadors:anisotropic'] = {
  imagePositionPatient: [0, 0, 0], rowCosines: [1, 0, 0], columnCosines: [0, 1, 0], rowPixelSpacing: 0.8, columnPixelSpacing: 1.2,
};

const handlesOf = points => Object.fromEntries(['start', 'end', 'perpendicularStart', 'perpendicularEnd']
  .map((name, i) => [name, { x: points[i][0], y: points[i][1] }]));
const statsOf = (points, image, recordValue) => {
  const data = { toolName: 'Bidirectional', handles: handlesOf(points), invalidated: true, recordValue };
  new BidirectionalTool().updateCachedStats(image, {}, data);
  return data;
};

it('measures each axis as labelled between patient points on an anisotropic image', () => {
  // 10 columns of 1.2 mm, then 10 rows of 0.8 mm: the short axis is the longer one, and stays the short axis
  const data = statsOf([[0, 5], [10, 5], [5, 0], [5, 10]], { imageId: 'wadors:anisotropic' });
  expect(data.invalidated).toBe(false);
  expect(data.longestDiameter).toBeCloseTo(12, 9);
  expect(data.shortestDiameter).toBeCloseTo(8, 9);
  expect(data.unit).toBe('mm');
});

it('measures in pixels on an image without a plane or spacing', () => {
  const data = statsOf([[0, 0], [3, 4], [0, 0], [0, 2]], { imageId: 'wadors:none' });
  expect(data).toMatchObject({ longestDiameter: 5, shortestDiameter: 2, unit: 'px' });
});

it('keeps a held length while its axis has the image points it belongs to, and recomputes a moved axis', () => {
  const points = [[0, 5], [10, 5], [5, 0], [5, 10]];
  const recordValue = { values: { length: 12.04, width: 7.98 }, points: points.map(point => point.slice()) };
  expect(statsOf(points, { imageId: 'wadors:anisotropic' }, recordValue)).toMatchObject({ longestDiameter: 12.04, shortestDiameter: 7.98 });
  const moved = statsOf([[0, 5], [20, 5], [5, 0], [5, 10]], { imageId: 'wadors:anisotropic' }, recordValue);
  expect(moved.longestDiameter).toBeCloseTo(24, 9);
  expect(moved.shortestDiameter).toBe(7.98);
});

it('labels the drawing L: and W:, two decimals, with its unit', () => {
  expect(bidirectionalTextLines({ longestDiameter: 12, shortestDiameter: 7.996, unit: 'mm' })).toEqual(['L: 12.00 mm', 'W: 8.00 mm']);
  expect(bidirectionalTextLines({})).toEqual([]);
});

it('keeps the stock pointer callbacks, and lets the lockable tool decline a locked measurement', () => {
  const tool = new BidirectionalTool();
  expect(tool.pointNearTool('element', {}, {})).toBe(true);
  expect(tool.handleSelectedCallback({}, {}, {})).toBe('handle-selected');
  expect(Object.prototype.hasOwnProperty.call(tool, 'renderToolData')).toBe(false);

  const LockableBidirectional = lockable(BidirectionalTool);
  const lockableTool = new LockableBidirectional();
  expect(lockableTool.pointNearTool('element', { isLocked: true }, {})).toBe(false);
  expect(lockableTool.handleSelectedCallback({}, { metadata: { isReadOnly: true } }, {})).toBe(false);
  expect(lockableTool.pointNearTool('element', {}, {})).toBe(true);
});

it('keeps the unit of a held axis, and labels each axis in its unit', () => {
  const points = [[0, 5], [10, 5], [5, 0], [5, 10]];
  const recordValue = { values: { length: 12, width: 0.8, unit: 'mm', widthUnit: 'cm' }, points: points.map(point => point.slice()) };
  const data = statsOf(points, { imageId: 'wadors:anisotropic' }, recordValue);
  expect(data).toMatchObject({ longestDiameter: 12, shortestDiameter: 0.8, unit: 'mm', widthUnit: 'cm' });
  expect(bidirectionalTextLines(data)).toEqual(['L: 12.00 mm', 'W: 0.80 cm']);
  // The moved short axis is measured again in millimetres
  const moved = statsOf([[0, 5], [10, 5], [5, 0], [5, 20]], { imageId: 'wadors:anisotropic' }, recordValue);
  expect(moved).toMatchObject({ unit: 'mm', widthUnit: 'mm' });
  expect(moved.shortestDiameter).toBeCloseTo(16, 9);
});
