// The classic Cobb angle shows the exchange-profile value: the Cornerstone3D formula with the
// endpoint order kept (no acute normalisation) and the pixel spacing applied.

jest.mock('cornerstone-tools', () => {
  class CobbAngleTool {
    constructor(props = {}) {
      this.name = props.name || 'CobbAngle';
    }

    // As the stock label: the angle as stored, in degrees
    textBoxText({ rAngle }) {
      return rAngle === undefined ? '' : `${rAngle}\u00B0`;
    }
  }
  const internals = {
    'util/getPixelSpacing': image => ({ rowPixelSpacing: image.rowPixelSpacing, colPixelSpacing: image.columnPixelSpacing }),
    'util/roundToDecimal': (value, places) => Math.round(value * 10 ** places) / 10 ** places,
  };
  const csTools = { CobbAngleTool, importInternal: name => internals[name] };
  return { __esModule: true, default: csTools, ...csTools };
}, { virtual: true });
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: { DICOMSR: { angleGeometry: jest.requireActual('../../../../platform/core/src/DICOMSR/utils/angleGeometry') } },
}), { virtual: true });

const { default: CobbAngleTool } = require('./CobbAngleTool');

const statsOf = (handles, image = { rowPixelSpacing: 1, columnPixelSpacing: 1 }) => {
  const data = { handles };
  new CobbAngleTool().updateCachedStats(image, {}, data);
  return data;
};
const point = (x, y) => ({ x, y });

it('gives the worked example 135 degrees, and 45 with the second line reversed', () => {
  expect(statsOf({ start: point(0, 0), end: point(10, 0), start2: point(0, 10), end2: point(10, 20) }).rAngle).toBe(135);
  expect(statsOf({ start: point(0, 0), end: point(10, 0), start2: point(10, 20), end2: point(0, 10) }).rAngle).toBe(45);
});

it('applies the column spacing along x and the row spacing along y', () => {
  const handles = { start: point(0, 0), end: point(5, 0), start2: point(0, 10), end2: point(5, 20) };
  expect(statsOf(handles).rAngle).toBe(116.57);
  expect(statsOf(handles, { rowPixelSpacing: 1, columnPixelSpacing: 2 }).rAngle).toBe(135);
});

it('has no value for a zero-length line', () => {
  const data = statsOf({ start: point(0, 0), end: point(0, 0), start2: point(0, 10), end2: point(5, 20) });
  expect(data.rAngle).toBeUndefined();
  expect(data.invalidated).toBe(false);
});


it('labels the angle alone by default, as the stock tool does, and refreshes the label with the angle', () => {
  const data = statsOf({ start: point(0, 0), end: point(10, 0), start2: point(0, 10), end2: point(10, 20) });
  expect(data.value).toBe('135\u00B0');
  data.handles.end2 = point(0, 20);
  new CobbAngleTool().updateCachedStats({ rowPixelSpacing: 1, columnPixelSpacing: 1 }, {}, data);
  expect(data.value).toBe('90\u00B0');
});

it('labels the values the measurement chose: the angle and its arcs, with the pixel spacing applied', () => {
  // Line 1 along x, line 2 at 45 degrees, the midpoints (5, 0) and (5, 25) joined along y
  const handles = { start: point(0, 0), end: point(10, 0), start2: point(0, 20), end2: point(10, 30) };
  const data = { handles, viewportValues: ['angle', 'arc1', 'arc2'] };
  new CobbAngleTool().updateCachedStats({ rowPixelSpacing: 1, columnPixelSpacing: 1 }, {}, data);
  expect(data.value).toEqual(['Cobb angle: 135.00\u00B0', 'Arc 1: 90.00\u00B0', 'Arc 2: 135.00\u00B0']);
  expect(new CobbAngleTool().textBoxText({ ...data, viewportValues: ['arc2'] }, 1, 1)).toEqual(['Arc 2: 135.00\u00B0']);
});
