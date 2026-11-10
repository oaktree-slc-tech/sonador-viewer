// A measurement drawn in a Cornerstone3D view with a point on an image edge (image x or y of 0)
// becomes a classic measurement with every point, through the real classic Length, Angle and
// arrow mappings: 0 is a coordinate.

const mockAnnotations = new Map();
const mockLocked = new Set();
const mockHidden = new Set();
const mockListeners = {};

jest.mock('cornerstone-core', () => ({
  getEnabledElements: () => [],
  updateImage: () => {},
  metaData: {
    get: (type, imageId) => (type === 'instance' && imageId === 'wadors:image'
      ? { SOPInstanceUID: '2.25.1003', SeriesInstanceUID: '2.25.1002', StudyInstanceUID: '2.25.1001', PatientID: 'ANONYMOUS' }
      : undefined),
  },
}), { virtual: true });
jest.mock('cornerstone-tools', () => ({ EVENTS: {} }), { virtual: true });
jest.mock('@cornerstonejs/core', () => ({
  eventTarget: {
    addEventListener: (name, fn) => { mockListeners[name] = fn; },
    removeEventListener: name => { delete mockListeners[name]; },
  },
  getRenderingEngines: () => [],
  utilities: {},
  // The image maps patient (x, y, 0) to image (x + 0.5, y + 0.5)
  metaData: {
    get: (type, imageId) => imageId === 'wadors:image' && {
      imagePositionPatient: [0, 0, 0], rowCosines: [1, 0, 0], columnCosines: [0, 1, 0],
      rowPixelSpacing: 1, columnPixelSpacing: 1, frameOfReferenceUID: '2.25.7001',
    },
  },
}), { virtual: true });
jest.mock('@cornerstonejs/tools', () => ({
  annotation: {
    visibility: {
      isAnnotationVisible: uid => (mockAnnotations.has(uid) ? !mockHidden.has(uid) : undefined),
      setAnnotationVisibility: (uid, visible) => (visible ? mockHidden.delete(uid) : mockHidden.add(uid)),
    },
    locking: {
      isAnnotationLocked: uid => mockLocked.has(uid),
      setAnnotationLocked: (uid, locked) => (locked ? mockLocked.add(uid) : mockLocked.delete(uid)),
    },
    config: { style: { setAnnotationStyles: () => {} } },
    state: {
      getAnnotation: uid => mockAnnotations.get(uid),
      getAllAnnotations: () => [...mockAnnotations.values()],
      addAnnotation: annotation => mockAnnotations.set(annotation.annotationUID, annotation),
      removeAnnotation: uid => mockAnnotations.delete(uid),
    },
  },
  Enums: {
    Events: { ANNOTATION_COMPLETED: 'ANNOTATION_COMPLETED', ANNOTATION_MODIFIED: 'ANNOTATION_MODIFIED', ANNOTATION_REMOVED: 'ANNOTATION_REMOVED' },
  },
  utilities: { triggerAnnotationRenderForViewportIds: () => {} },
}), { virtual: true });

const mockManaged = {};
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: {
    log: { warn: () => {}, info: () => {}, debug: () => {} },
    DICOMSR: {
      angleGeometry: jest.requireActual('../../../../platform/core/src/DICOMSR/utils/angleGeometry'),
      SREnums: { TOOL_NAMES: {} },
    },
    utils: { dataProc: { firstDefinedValue: (...values) => values.find(value => value !== undefined) }, guid: () => 'guid-1' },
    measurements: {
      Enums: {
        CORNERSTONE_TOOLS_SOURCE_NAME: 'CornerstoneTools', CORNERSTONE_TOOLS_SOURCE_VERSION: '4',
        CORNERSTONE_3D_TOOLS_SOURCE_NAME: 'Cornerstone3DTools-Sonador', CORNERSTONE_3D_TOOLS_SOURCE_VERSION: '0.1',
      },
      getImagePath: () => 'image-path',
      MeasurementApi: { Instance: { _serviceManagedTool: toolName => mockManaged[toolName] || { toolServiceManaged: false } } },
    },
  },
}), { virtual: true });

import { connectMeasurementAnnotationSync } from './measurementAnnotationSync';
import measurementServiceMappingsFactory from './measurementServiceMappings/Cornerstone/measurementServiceMappingsFactory';

const VALUE_TYPES = { POLYLINE: 'value_type::polyline', POINT: 'value_type::point', ELLIPSE: 'value_type::ellipse', ANGLE: 'value_type::polyline' };

let measurements;
let notified;
let disconnect;
beforeEach(() => {
  mockAnnotations.clear();
  measurements = new Map();
  notified = [];
  const service = {
    VALUE_TYPES,
    EVENTS: { MEASUREMENT_ADDED: 'added', MEASUREMENT_UPDATED: 'updated', MEASUREMENT_REMOVED: 'removed', MEASUREMENTS_CLEARED: 'cleared' },
    subscribe: () => ({ unsubscribe: () => {} }),
    getMeasurement: uid => measurements.get(uid),
    _broadcastEvent: () => {},
  };
  const mappings = measurementServiceMappingsFactory(service);
  const byTool = { Length: mappings.Length, Angle: mappings.Angle, CobbAngle: mappings.CobbAngle, ArrowAnnotate: mappings.ArrowAnnotateTool };
  // As the measurement service source: the tool's annotation mapped to a stored measurement
  const source = {
    name: 'CornerstoneTools',
    version: '4',
    annotationToMeasurement: (toolName, annotation) => {
      const uid = `c-${measurements.size + 1}`;
      measurements.set(uid, { ...byTool[toolName].toMeasurement(annotation), uid });
      return uid;
    },
  };
  Object.entries(byTool).forEach(([toolName, mapping]) => {
    mockManaged[toolName] = {
      toolServiceManaged: true,
      source,
      toolMapping: { toAnnotationSchema: (measurement, annotationType) => mapping.toAnnotation(measurement, annotationType) },
    };
  });
  disconnect = connectMeasurementAnnotationSync(service, source, { notify: message => notified.push(message) });
});
afterEach(() => disconnect());

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

async function draw(toolName, points, label) {
  const annotation = {
    annotationUID: `native-${toolName}`,
    metadata: { toolName, FrameOfReferenceUID: '2.25.7001', referencedImageId: 'wadors:image' },
    data: { label, handles: { points }, cachedStats: {} },
  };
  mockAnnotations.set(annotation.annotationUID, annotation);
  mockListeners.ANNOTATION_COMPLETED({ detail: { annotation } });
  await flush();
  return measurements.get('c-1');
}

// Patient x or y of -0.5 is image x or y of 0
it('saves a Length with an end at image x = 0 and one at image y = 0', async () => {
  const measurement = await draw('Length', [[-0.5, 9.5, 0], [9.5, -0.5, 0]]);
  expect(notified).toEqual([]);
  expect(measurement.points).toEqual([{ x: 0, y: 10 }, { x: 10, y: 0 }]);
  expect(measurement.data.handles.start).toMatchObject({ x: 0, y: 10 });
  expect(measurement.data.handles.end).toMatchObject({ x: 10, y: 0 });
});

it('saves an Angle whose vertex is the image origin', async () => {
  const measurement = await draw('Angle', [[9.5, -0.5, 0], [-0.5, -0.5, 0], [-0.5, 9.5, 0]]);
  expect(notified).toEqual([]);
  expect(measurement.points).toEqual([{ x: 10, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 10 }]);
  expect(measurement.data.rAngle).toBeCloseTo(90, 6);
});

it('saves a Cobb angle with points on both image edges', async () => {
  const measurement = await draw('CobbAngle', [[-0.5, -0.5, 0], [9.5, -0.5, 0], [-0.5, 9.5, 0], [9.5, 19.5, 0]]);
  expect(notified).toEqual([]);
  expect(measurement.points).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 20 }]);
  expect(measurement.data.rAngle).toBeCloseTo(135, 6);
});

it('saves an arrow whose tip is at image y = 0', async () => {
  const measurement = await draw('ArrowAnnotate', [[4.5, -0.5, 0], [9.5, 9.5, 0]], 'Edge');
  expect(notified).toEqual([]);
  expect(measurement.points).toEqual([{ x: 5, y: 0 }, { x: 10, y: 10 }]);
  expect(measurement.label).toBe('Edge');
});

// As the stock tools' cancel(): the new drawing is completed, then the view removes it
it.each([
  ['Length', [[-0.5, 9.5, 0], [9.5, -0.5, 0]]],
  ['Angle', [[9.5, -0.5, 0], [-0.5, -0.5, 0], [-0.5, 9.5, 0]]],
  ['CobbAngle', [[-0.5, -0.5, 0], [9.5, -0.5, 0], [-0.5, 9.5, 0], [9.5, 19.5, 0]]],
])('a %s cancelled with Escape while drawing leaves no record and no mirror', async (toolName, points) => {
  const annotation = {
    annotationUID: `cancelled-${toolName}`,
    metadata: { toolName, FrameOfReferenceUID: '2.25.7001', referencedImageId: 'wadors:image' },
    data: { handles: { points }, cachedStats: {} },
  };
  mockAnnotations.set(annotation.annotationUID, annotation);
  const cancel = () => {
    mockListeners.ANNOTATION_COMPLETED({ detail: { annotation } });
    return annotation.annotationUID;
  };
  mockAnnotations.delete(cancel());
  await flush();

  expect(measurements.size).toBe(0);
  expect(mockAnnotations.size).toBe(0);
  expect(notified).toEqual([]);

  // The same drawing completed normally is one record and one mirror
  const measurement = await draw(toolName, points);
  expect(measurements.size).toBe(1);
  expect(measurement.toolName).toBe(toolName);
});
