// A Cornerstone3D Angle or Cobb angle hydrated from a report reaches the classic tool with its
// handles in order, its stored value, its tracking identity and its properties; a drawn classic
// tool becomes a service measurement whose top-level keys are those the service accepts.

jest.mock('cornerstone-core', () => ({}), { virtual: true });
// Image planes by image id: the hydrated image maps patient (x, y, 0) to image (x + 0.5, y + 0.5);
// frame 2 of a multiframe instance sits at (100, 0, 20)
const mockPlanes = {
  'synthetic:2.25.1003': { imagePositionPatient: [0, 0, 0] },
  'synthetic:2.25.1006/2': { imagePositionPatient: [100, 0, 20] },
};
jest.mock('@cornerstonejs/core', () => ({
  utilities: { worldToImageCoords: (imageId, [x, y]) => [x + 0.5, y + 0.5] },
  metaData: {
    get: (type, imageId) => mockPlanes[imageId] && {
      ...mockPlanes[imageId], rowCosines: [1, 0, 0], columnCosines: [0, 1, 0], rowPixelSpacing: 1, columnPixelSpacing: 1,
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
    DICOMSR: { angleGeometry: jest.requireActual('../../../../../../platform/core/src/DICOMSR/utils/angleGeometry') },
  },
}), { virtual: true });

import { Angle, CobbAngle } from './Angle';

const measurementService = { VALUE_TYPES: { ANGLE: 'value_type::polyline', POLYLINE: 'value_type::polyline' } };
const classicSource = { name: 'CornerstoneTools', version: '4' };
const c3dSource = { name: 'Cornerstone3DTools-Sonador', version: '0.1' };

// The keys MeasurementService accepts at the top level of a measurement
const SCHEMA_KEYS = ['uid', 'color', 'data', 'getReport', 'displayText', 'SOPInstanceUID', 'FrameOfReferenceUID',
  'referenceStudyUID', 'referenceSeriesUID', 'frameNumber', 'displaySetInstanceUID', 'label', 'isLocked', 'isVisible',
  'description', 'value', 'type', 'unit', 'points', 'source', 'toolName', 'metadata', 'area', 'mean', 'stdDev',
  'perimeter', 'length', 'shortestDiameter', 'longestDiameter', 'cachedStats', 'isSelected', 'textBox',
  'referencedImageId', 'isDirty'];

// As the Cornerstone3D Cobb angle mapping returns a measurement hydrated from a patient-domain group
const hydratedCobbAngle = {
  uid: 'm-1',
  toolName: 'CobbAngle',
  points: [[0, 0, 0], [10, 0, 0], [0, 10, 0], [10, 20, 0]],
  SOPInstanceUID: '2.25.1003',
  referencedImageId: 'synthetic:2.25.1003',
  referenceSeriesUID: '2.25.1002',
  referenceStudyUID: '2.25.1001',
  data: { 'imageId:synthetic:2.25.1003': { angle: 135 } },
  metadata: {
    toolName: 'CobbAngle', description: 'cobb-angle measurement', text: 'Synthetic', location: 'Synthetic location',
    views: ['coronal'], coordinateDomain: 'patient',
    TrackingUniqueIdentifier: '2.25.8100', TrackingIdentifier: 'cornerstoneTools@^4.0.0:CobbAngle',
    displayAttributes: { Color: { Border: '#FF8800' } },
    SeriesInstanceUID: '2.25.1002', StudyInstanceUID: '2.25.1001',
  },
};

const bridge = (mapping, measurement) => {
  // createRenderVersion: Cornerstone3D measurement -> classic schema -> classic annotation -> classic measurement
  const converted = mapping.toAltSourceMeasurementSchema(measurementService, classicSource, measurement, c3dSource);
  const annotation = converted && mapping.toAnnotation(measurementService, converted, mapping.toolName);
  return { converted, annotation };
};


describe('Cornerstone3D -> classic', () => {
  it('converts a Cobb angle to four named handles with the stored value', () => {
    const { converted, annotation } = bridge(CobbAngle, hydratedCobbAngle);

    expect(converted.data.rAngle).toBe(135);
    expect(Object.keys(converted).filter(key => !SCHEMA_KEYS.includes(key))).toEqual([]);
    expect(annotation.handles).toMatchObject({
      start: { x: 0.5, y: 0.5 }, end: { x: 10.5, y: 0.5 }, start2: { x: 0.5, y: 10.5 }, end2: { x: 10.5, y: 20.5 },
      textBox: expect.any(Object),
    });
    expect(annotation.measurementData.handles).toEqual(annotation.handles);
    expect(annotation.rAngle).toBe(135);
    expect(annotation.measurementData.rAngle).toBe(135);
  });

  it('carries the tracking identity, coordinate domain, views and properties to the writer', () => {
    const { annotation } = bridge(CobbAngle, hydratedCobbAngle);
    const carried = {
      TrackingUniqueIdentifier: '2.25.8100', TrackingIdentifier: 'cornerstoneTools@^4.0.0:CobbAngle',
      coordinateDomain: 'patient', views: ['coronal'],
    };

    expect(annotation.measurementData).toMatchObject({
      ...carried, description: 'cobb-angle measurement', location: 'Synthetic location', text: 'Synthetic',
      displayAttributes: { Color: { Border: '#FF8800' } },
    });
    expect(annotation.metadata).toMatchObject(carried);
  });

  it('converts an Angle to three named handles', () => {
    const hydratedAngle = {
      ...hydratedCobbAngle, toolName: 'Angle', points: [[10, 0, 0], [0, 0, 0], [0, 10, 0]],
      data: { 'imageId:synthetic:2.25.1003': { angle: 90 } }, metadata: { ...hydratedCobbAngle.metadata, toolName: 'Angle' },
    };
    const { annotation } = bridge(Angle, hydratedAngle);

    expect(Object.keys(annotation.handles).sort()).toEqual(['end', 'middle', 'start', 'textBox']);
    expect(annotation.handles).toMatchObject({ start: { x: 10.5, y: 0.5 }, middle: { x: 0.5, y: 0.5 }, end: { x: 0.5, y: 10.5 } });
    expect(annotation.rAngle).toBe(90);
  });

  it('converts with the plane of the referenced frame', () => {
    const onFrame2 = {
      ...hydratedCobbAngle, referencedImageId: 'synthetic:2.25.1006/2',
      points: [[100, 0, 20], [110, 0, 20], [100, 10, 20], [110, 20, 20]],
      data: { 'imageId:synthetic:2.25.1006/2': { angle: 135 } },
    };
    const { annotation } = bridge(CobbAngle, onFrame2);
    expect(annotation.handles).toMatchObject({
      start: { x: 0.5, y: 0.5 }, end: { x: 10.5, y: 0.5 }, start2: { x: 0.5, y: 10.5 }, end2: { x: 10.5, y: 20.5 },
    });
  });

  it('carries the source geometry the writer compares an unchanged re-save with', () => {
    const sourceGeometry = { valueType: 'SCOORD3D', graphicData: [0, 0, 0, 10, 0, 0, 0, 10, 0, 10, 20, 0], value: 135 };
    const { annotation } = bridge(CobbAngle, { ...hydratedCobbAngle, metadata: { ...hydratedCobbAngle.metadata, sourceGeometry } });
    expect(annotation.measurementData.sourceGeometry).toEqual(sourceGeometry);
  });

  it('keeps a measurement read from a report read-only and locked, through the classic measurement', () => {
    const fromReport = { ...hydratedCobbAngle, metadata: { ...hydratedCobbAngle.metadata, isReadOnly: true, isLocked: true } };
    const { annotation } = bridge(CobbAngle, fromReport);
    expect(annotation.metadata.isReadOnly).toBe(true);

    const measurement = CobbAngle.toMeasurement(measurementService, annotation);
    expect(measurement.metadata.isReadOnly).toBe(true);
  });

  it('makes a hydrated Cobb angle complete, so cornerstone-tools draws its second line and does not offer it for completion', () => {
    const { annotation } = bridge(CobbAngle, hydratedCobbAngle);
    expect(annotation.complete).toBe(true);
    expect(annotation.measurementData.complete).toBe(true);
  });

  it('keeps a Cobb angle still being drawn incomplete', () => {
    const { converted } = bridge(CobbAngle, hydratedCobbAngle);
    const drawing = CobbAngle.toAnnotation(measurementService, { ...converted, data: { ...converted.data, complete: false } }, 'CobbAngle');
    expect(drawing.complete).toBe(false);
  });

  it('keeps a finished Cobb angle drawn and complete through a labelling update (stale nested copy)', () => {
    // The representation as cornerstone-tools leaves it: the live top level finished by the second
    // step; the nested copy made on the first step still holds its placeholders and `complete: false`
    const placeholders = {
      start: { x: 0.5, y: 0.5 }, end: { x: 10.5, y: 0.5 }, start2: { x: 0.5, y: 0.5 }, end2: { x: 1.5, y: 0.5 }, textBox: {},
    };
    const live = {
      start: { x: 0.5, y: 0.5 }, end: { x: 10.5, y: 0.5 }, start2: { x: 0.5, y: 10.5 }, end2: { x: 10.5, y: 20.5 }, textBox: {},
    };
    const representation = {
      _id: 'cobb-1', toolType: 'CobbAngle', toolName: 'CobbAngle', complete: true, handles: live, rAngle: 135,
      measurementData: { _id: 'cobb-1', toolType: 'CobbAngle', complete: false, handles: placeholders, rAngle: 0 },
      metadata: { toolName: 'CobbAngle', _id: 'cobb-1' },
    };
    const labelled = { ...representation, location: 'Bone' };

    const measurement = CobbAngle.toMeasurement(measurementService, labelled);
    expect(measurement.data.complete).toBe(true);
    expect(measurement.data.handles.start2).toMatchObject({ x: 0.5, y: 10.5 });
    expect(measurement.points).toEqual([{ x: 0.5, y: 0.5 }, { x: 10.5, y: 0.5 }, { x: 0.5, y: 10.5 }, { x: 10.5, y: 20.5 }]);
    expect(measurement.data.rAngle).toBe(135);

    const annotation = CobbAngle.toAnnotation(measurementService, measurement, 'CobbAngle');
    expect(annotation.complete).toBe(true);
    expect(annotation.handles.end2).toMatchObject({ x: 10.5, y: 20.5 });
  });

  it('keeps a Cobb angle whose second step has not begun incomplete through an update', () => {
    const representation = {
      _id: 'cobb-2', toolType: 'CobbAngle', complete: false,
      handles: { start: { x: 0.5, y: 0.5 }, end: { x: 10.5, y: 0.5 }, start2: { x: 0.5, y: 0.5 }, end2: { x: 1.5, y: 0.5 }, textBox: {} },
      metadata: { toolName: 'CobbAngle', _id: 'cobb-2' },
    };
    const measurement = CobbAngle.toMeasurement(measurementService, representation);
    expect(measurement.data.complete).toBe(false);
    expect(CobbAngle.toAnnotation(measurementService, measurement, 'CobbAngle').complete).toBe(false);
  });

  it('adds no completion flag to an Angle', () => {
    const hydratedAngle = {
      ...hydratedCobbAngle, toolName: 'Angle', points: [[10, 0, 0], [0, 0, 0], [0, 10, 0]],
      data: { 'imageId:synthetic:2.25.1003': { angle: 90 } }, metadata: { ...hydratedCobbAngle.metadata, toolName: 'Angle' },
    };
    expect(bridge(Angle, hydratedAngle).annotation.complete).toBeUndefined();
  });

  it('converts nothing without the image plane', () => {
    expect(bridge(CobbAngle, { ...hydratedCobbAngle, referencedImageId: 'synthetic:unknown' }).converted).toBeNull();
  });

  it('refuses a point count that does not match the tool', () => {
    expect(bridge(Angle, hydratedCobbAngle).converted).toBeNull();
  });
});


describe('classic -> service measurement', () => {
  it('maps a drawn Angle to ordered points and its value, with schema keys only', () => {
    const csToolsAnnotation = {
      toolName: 'Angle',
      measurementData: {
        _id: 'cs-1',
        rAngle: 90,
        handles: { start: { x: 10, y: 0 }, middle: { x: 0, y: 0 }, end: { x: 0, y: 10 }, textBox: {} },
      },
    };
    const measurement = Angle.toMeasurement(measurementService, csToolsAnnotation);

    expect(measurement.points).toEqual([{ x: 10, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 10 }]);
    expect(measurement.data.rAngle).toBe(90);
    expect(measurement.type).toBe(measurementService.VALUE_TYPES.ANGLE);
    expect(Object.keys(measurement).filter(key => !SCHEMA_KEYS.includes(key))).toEqual([]);
  });

  it('keeps the hydrated identity through an edit of the classic tool', () => {
    const { annotation } = bridge(CobbAngle, hydratedCobbAngle);
    annotation.handles.end2 = { x: 20.5, y: 20.5 };
    annotation.rAngle = 120;
    const measurement = CobbAngle.toMeasurement(measurementService, annotation);

    expect(measurement.points).toHaveLength(4);
    expect(measurement.points[3]).toEqual({ x: 20.5, y: 20.5 });
    expect(measurement.data.rAngle).toBe(120);
    expect(measurement.metadata).toMatchObject({
      TrackingUniqueIdentifier: '2.25.8100', TrackingIdentifier: 'cornerstoneTools@^4.0.0:CobbAngle', coordinateDomain: 'patient',
    });

    // The writer reads the annotation the service rebuilds from it
    const rebuilt = CobbAngle.toAnnotation(measurementService, { ...measurement, uid: 'm-2' }, 'CobbAngle');
    expect(rebuilt.measurementData).toMatchObject({ rAngle: 120, TrackingUniqueIdentifier: '2.25.8100' });
    expect(rebuilt.measurementData.handles.end2).toMatchObject({ x: 20.5, y: 20.5 });
  });
});
