// A Cornerstone3D Bidirectional hydrated from a report reaches the classic Bidirectional with its
// four points as the `start`, `end`, `perpendicularStart`, `perpendicularEnd` handles, its stored
// lengths and its tracking identity; a classic Bidirectional becomes a measurement with the four
// points and both lengths, and its tool data holds the lengths with the points they belong to.

jest.mock('cornerstone-core', () => ({}), { virtual: true });
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
      bidirectionalGeometry: jest.requireActual('../../../../../../platform/core/src/DICOMSR/utils/bidirectionalGeometry'),
    },
  },
}), { virtual: true });

import { Bidirectional } from './Bidirectional';

const measurementService = { VALUE_TYPES: { BIDIRECTIONAL: 'value_type::shortAxisLongAxis' } };
const classicSource = { name: 'CornerstoneTools', version: '4' };
const c3dSource = { name: 'Cornerstone3DTools-Sonador', version: '0.1' };

const hydrated = {
  uid: 'm-1',
  toolName: 'Bidirectional',
  points: [[0, 0, 0], [20, 0, 0], [10, -6, 0], [10, 6, 0]],
  SOPInstanceUID: '2.25.1003',
  referencedImageId: 'synthetic:2.25.1003',
  referenceSeriesUID: '2.25.1002',
  referenceStudyUID: '2.25.1001',
  data: { 'imageId:synthetic:2.25.1003': { length: 20.04, width: 11.98, unit: 'mm', widthUnit: 'mm' } },
  metadata: {
    toolName: 'Bidirectional', description: 'Lesion axes',
    coordinateDomain: 'image', TrackingUniqueIdentifier: '2.25.8300', TrackingIdentifier: 'cornerstoneTools@^4.0.0:Bidirectional',
    SeriesInstanceUID: '2.25.1002', StudyInstanceUID: '2.25.1001',
    sourceGeometry: { valueType: 'SCOORD', graphicType: 'POLYLINE', graphicData: [0.5, 0.5, 20.5, 0.5, 10.5, -5.5, 10.5, 6.5] },
  },
};
const IMAGE_POINTS = [[0.5, 0.5], [20.5, 0.5], [10.5, -5.5], [10.5, 6.5]];

it('converts a hydrated Cornerstone3D Bidirectional to the classic handles in order, with its stored lengths and identity', () => {
  const converted = Bidirectional.toAltSourceMeasurementSchema(measurementService, classicSource, hydrated, c3dSource);
  expect(converted.toolName).toBe('Bidirectional');
  expect(converted.points).toEqual(IMAGE_POINTS);
  const { handles } = converted.data;
  expect(['start', 'end', 'perpendicularStart', 'perpendicularEnd'].map(name => [handles[name].x, handles[name].y])).toEqual(IMAGE_POINTS);
  expect(handles.perpendicularStart.locked).toBe(false);
  expect(converted.data).toMatchObject({ longestDiameter: 20.04, shortestDiameter: 11.98 });
  expect(converted.unit).toBe('mm');
  expect(converted.metadata).toMatchObject({
    TrackingUniqueIdentifier: '2.25.8300', TrackingIdentifier: 'cornerstoneTools@^4.0.0:Bidirectional', coordinateDomain: 'image',
    sourceGeometry: hydrated.metadata.sourceGeometry,
  });
  expect(converted.description).toBe('Lesion axes');
});

it('gives the classic tool the stored lengths with the image points they belong to, and never re-places the short axis', () => {
  const converted = Bidirectional.toAltSourceMeasurementSchema(measurementService, classicSource, hydrated, c3dSource);
  const annotation = Bidirectional.toAnnotation(measurementService, { ...converted, uid: 'c-1' }, 'Bidirectional');
  expect(annotation).toMatchObject({ longestDiameter: 20.04, shortestDiameter: 11.98, unit: 'mm' });
  expect(annotation.recordValue).toEqual({ values: { length: 20.04, width: 11.98, unit: 'mm', widthUnit: 'mm' }, points: IMAGE_POINTS });
  expect(annotation.handles.perpendicularStart.locked).toBe(false);
  expect(annotation.measurementData.sourceGeometry).toEqual(hydrated.metadata.sourceGeometry);
});

it('maps the live classic tool data to the measurement: four points, both lengths as numbers, no tool-only fields', () => {
  const handles = {
    start: { x: 1, y: 1 }, end: { x: 21, y: 1 }, perpendicularStart: { x: 11, y: -5 }, perpendicularEnd: { x: 11, y: 7 }, textBox: {},
  };
  const measurement = Bidirectional.toMeasurement(measurementService, {
    toolName: 'Bidirectional',
    measurementData: { toolType: 'Bidirectional', handles, longestDiameter: '19.0', shortestDiameter: '1.0', _id: 'b-1' },
    handles, longestDiameter: 20, shortestDiameter: 12, unit: 'mm', recordValue: { values: {}, points: [] },
    metadata: { _id: 'b-1', referencedImageId: 'synthetic:2.25.1003' },
  });
  expect(measurement.points).toEqual([{ x: 1, y: 1 }, { x: 21, y: 1 }, { x: 11, y: -5 }, { x: 11, y: 7 }]);
  expect(measurement.data).toMatchObject({ longestDiameter: 20, shortestDiameter: 12 });
  expect(measurement.data).not.toHaveProperty('recordValue');
  expect(measurement.type).toBe('value_type::shortAxisLongAxis');
  expect(measurement.unit).toBe('mm');
});

it('converts nothing without an image plane or four points', () => {
  expect(Bidirectional.toAltSourceMeasurementSchema(measurementService, classicSource,
    { ...hydrated, referencedImageId: 'synthetic:unknown' }, c3dSource)).toBeNull();
  expect(Bidirectional.toAltSourceMeasurementSchema(measurementService, classicSource,
    { ...hydrated, points: hydrated.points.slice(0, 3) }, c3dSource)).toBeNull();
});

it('carries each axis in its own unit: a Short Axis read in centimetres stays in centimetres in the record and the tool', () => {
  const mixed = { ...hydrated, data: { 'imageId:synthetic:2.25.1003': { length: 20, width: 1.2, unit: 'mm', widthUnit: 'cm' } } };
  const converted = Bidirectional.toAltSourceMeasurementSchema(measurementService, classicSource, mixed, c3dSource);
  expect(converted.data).toMatchObject({ longestDiameter: 20, shortestDiameter: 1.2, unit: 'mm', widthUnit: 'cm' });
  const annotation = Bidirectional.toAnnotation(measurementService, { ...converted, uid: 'c-1' }, 'Bidirectional');
  expect(annotation).toMatchObject({ unit: 'mm', widthUnit: 'cm' });
  expect(annotation.recordValue.values).toEqual({ length: 20, width: 1.2, unit: 'mm', widthUnit: 'cm' });

  const measurement = Bidirectional.toMeasurement(measurementService, { ...annotation, measurementData: annotation.measurementData });
  expect(measurement.data).toMatchObject({ longestDiameter: 20, shortestDiameter: 1.2, unit: 'mm', widthUnit: 'cm' });
});
