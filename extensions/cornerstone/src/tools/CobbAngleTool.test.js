// The classic Cobb angle shows the exchange-profile value: the Cornerstone3D formula with the
// endpoint order kept (no acute normalisation) and the pixel spacing applied.

jest.mock('cornerstone-tools', () => {
  class CobbAngleTool {
    constructor(props = {}) {
      this.name = props.name || 'CobbAngle';
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
