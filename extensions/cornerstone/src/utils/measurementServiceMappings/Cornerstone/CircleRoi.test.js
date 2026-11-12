// A Cornerstone3D circle hydrated from a report reaches the classic CircleRoi with its center and
// edge as the `start` and `end` handles, its stored values and its tracking identity; a drawn
// classic circle becomes a measurement with the two points and its values.

jest.mock('cornerstone-core', () => ({}), { virtual: true });
// The classic tool's base class and internals, for its label lines
jest.mock('cornerstone-tools', () => {
  const csTools = { CircleRoiTool: class {}, importInternal: () => () => ({}), external: {} };
  return { __esModule: true, default: csTools, ...csTools };
}, { virtual: true });
// The image maps patient (x, y, 0) to image (x + 0.5, y + 0.5)
jest.mock('@cornerstonejs/core', () => ({
  utilities: { worldToImageCoords: (imageId, [x, y]) => [x + 0.5, y + 0.5] },
  metaData: {
    get: (type, imageId) => imageId === 'synthetic:2.25.1003' && {
      imagePositionPatient: [0, 0, 0], rowCosines: [1, 0, 0], columnCosines: [0, 1, 0], rowPixelSpacing: 1, columnPixelSpacing: 1,
    },
  },
}), { virtual: true });
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: {
    measurements: {
      Enums: {
        CORNERSTONE_TOOLS_SOURCE_NAME: 'CornerstoneTools', CORNERSTONE_TOOLS_SOURCE_VERSION: '4',
        CORNERSTONE_3D_TOOLS_SOURCE_NAME: 'Cornerstone3DTools-Sonador', CORNERSTONE_3D_TOOLS_SOURCE_VERSION: '0.1',
      },
      getImagePath: () => 'image-path',
    },
    utils: { dataProc: { firstDefinedValue: (...values) => values.find(value => value !== undefined) }, guid: () => 'guid' },
    log: { warn: () => {}, info: () => {}, debug: () => {} },
    DICOMSR: {
      angleGeometry: jest.requireActual('../../../../../../platform/core/src/DICOMSR/utils/angleGeometry'),
      circleGeometry: jest.requireActual('../../../../../../platform/core/src/DICOMSR/utils/circleGeometry'),
    },
  },
}), { virtual: true });

import { CircleRoi } from './CircleRoi';
import { circleTextLines } from '../../../tools/CircleRoiTool';
import circleDisplay, { circleDetailItems, circleDisplayValues } from '@ohif/core/src/measurements/tools/circleDisplay';

const measurementService = { VALUE_TYPES: { CIRCLE: 'value_type::circle' } };
const classicSource = { name: 'CornerstoneTools', version: '4' };
const c3dSource = { name: 'Cornerstone3DTools-Sonador', version: '0.1' };

const VALUES = { radius: 5, area: 25 * Math.PI, perimeter: 10 * Math.PI };
const hydratedCircle = {
  uid: 'm-1',
  toolName: 'CircleROI',
  points: [[0, 0, 0], [3, 4, 0]],
  SOPInstanceUID: '2.25.1003',
  referencedImageId: 'synthetic:2.25.1003',
  referenceSeriesUID: '2.25.1002',
  referenceStudyUID: '2.25.1001',
  data: { 'imageId:synthetic:2.25.1003': { ...VALUES, mean: 12, radiusUnit: 'mm' } },
  metadata: {
    toolName: 'CircleROI', description: 'Lesion',
    coordinateDomain: 'image', TrackingUniqueIdentifier: '2.25.8200', TrackingIdentifier: 'cornerstoneTools@^4.0.0:CircleROI',
    SeriesInstanceUID: '2.25.1002', StudyInstanceUID: '2.25.1001',
  },
};

describe('Cornerstone3D -> classic', () => {
  it('converts the center and edge to start and end with the stored values only', () => {
    const converted = CircleRoi.toAltSourceMeasurementSchema(measurementService, classicSource, hydratedCircle, c3dSource);
    const annotation = CircleRoi.toAnnotation(measurementService, converted, CircleRoi.toolName);

    expect(converted.toolName).toBe('CircleRoi');
    expect(converted.data.cachedStats).toEqual({ ...VALUES, unit: 'mm' });
    expect(annotation.handles).toMatchObject({ start: { x: 0.5, y: 0.5 }, end: { x: 3.5, y: 4.5 }, textBox: expect.any(Object) });
    expect(annotation.cachedStats).toEqual({ ...VALUES, unit: 'mm' });
    expect(annotation.measurementData).toMatchObject({
      TrackingUniqueIdentifier: '2.25.8200', TrackingIdentifier: 'cornerstoneTools@^4.0.0:CircleROI', coordinateDomain: 'image',
    });
  });

  it('refuses a circle without an image plane', () => {
    const offImage = { ...hydratedCircle, referencedImageId: 'synthetic:unknown' };
    expect(CircleRoi.toAltSourceMeasurementSchema(measurementService, classicSource, offImage, c3dSource)).toBeNull();
  });
});

describe('classic -> measurement', () => {
  it('keeps the two points in order and the live values', () => {
    const drawn = {
      toolType: 'CircleRoi', measurementId: 'c-1', SOPInstanceUID: '2.25.1003', imagePath: 'image-path',
      handles: { start: { x: 1, y: 2 }, end: { x: 4, y: 6 }, textBox: {} },
      cachedStats: { ...VALUES, unit: 'mm' },
    };
    const measurement = CircleRoi.toMeasurement(
      { ...measurementService, getMeasurement: () => undefined }, { ...drawn, measurementData: drawn });

    expect(measurement.points).toEqual([{ x: 1, y: 2 }, { x: 4, y: 6 }]);
    expect(measurement.data.cachedStats).toEqual({ ...VALUES, unit: 'mm' });
    expect(measurement.type).toBe('value_type::circle');
    expect(measurement.unit).toBe('mm');
  });

  // An image without calibration: the classic tool measures in pixels (CircleRoiTool.test.js)
  it('keeps pixels through the measurement, the panel and the annotation made back from it, never millimetres', () => {
    const service = { ...measurementService, getMeasurement: () => undefined };
    const drawn = {
      toolType: 'CircleRoi', measurementId: 'c-2', SOPInstanceUID: '2.25.1003', imagePath: 'image-path',
      handles: { start: { x: 0, y: 0 }, end: { x: 3, y: 4 }, textBox: {} },
      cachedStats: { ...VALUES, unit: 'px' },
    };
    expect(circleTextLines(drawn.cachedStats)).toEqual(['Radius: 5.00 px', 'Area: 78.54 px²']);

    const measurement = CircleRoi.toMeasurement(service, { ...drawn, measurementData: drawn });
    expect(measurement.unit).toBe('px');
    expect(measurement.data.cachedStats.unit).toBe('px');
    expect(circleDisplay(measurement)).toBe('5.00 px');
    expect(circleDetailItems(circleDisplayValues(measurement))).toEqual([
      { label: 'Area', value: '78.54 px²' }, { label: 'Perimeter', value: '31.42 px' }, { label: 'Radius', value: '5.00 px' },
    ]);

    const annotation = CircleRoi.toAnnotation(service, measurement, CircleRoi.toolName);
    expect(annotation.cachedStats.unit).toBe('px');
    expect(circleTextLines(annotation.cachedStats)).toEqual(['Radius: 5.00 px', 'Area: 78.54 px²']);
  });
});
