// Each classic Length / Angle / Cobb angle measurement has one editable Cornerstone3D annotation;
// edits and deletions travel both ways, and the measurement service keeps a single record. A
// measurement drawn in a Cornerstone3D view on an acquired image becomes that record; drawn on any
// other plane, with a tool that has no classic mapping, or when it cannot be added, it stays in the
// view, marked and announced as not saved with the reason.

const mockAnnotations = new Map();
const mockLocked = new Set();
const mockHidden = new Set();
const mockListeners = {};
const mockRender = jest.fn();
const mockUpdateImage = jest.fn();
const mockStyles = {};
const mockClassic = { toAnnotationSchema: jest.fn(), annotationToMeasurement: jest.fn() };
const mockVisibilitySources = new Set();

jest.mock('cornerstone-core', () => ({
  getEnabledElements: () => [{ element: 'classic-element', image: {} }],
  updateImage: element => mockUpdateImage(element),
  metaData: {
    get: (type, imageId) => (type === 'instance' && imageId === 'wadors:image'
      ? { SOPInstanceUID: '2.25.1003', SeriesInstanceUID: '2.25.1002', StudyInstanceUID: '2.25.1001', PatientID: 'ANONYMOUS' }
      : undefined),
  },
}), { virtual: true });
jest.mock('@cornerstonejs/core', () => ({
  eventTarget: {
    addEventListener: (name, fn) => { mockListeners[name] = fn; },
    removeEventListener: name => { delete mockListeners[name]; },
  },
  getRenderingEngines: () => [{ getViewports: () => [{ id: 'inspection' }] }],
  // The image maps patient (x, y, 0) to image (x + 0.5, y + 0.5)
  metaData: {
    get: (type, imageId) => {
      if (imageId === 'wadors:lookup-fails') {
        throw new Error('metadata provider failed');
      }
      return imageId === 'wadors:image' && {
      imagePositionPatient: [0, 0, 0], rowCosines: [1, 0, 0], columnCosines: [0, 1, 0],
      rowPixelSpacing: 1, columnPixelSpacing: 1, frameOfReferenceUID: '2.25.7001', rows: 40, columns: 30,
      };
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
    config: { style: { setAnnotationStyles: (uid, styles) => { mockStyles[uid] = styles; } } },
    state: {
      getAnnotation: uid => mockAnnotations.get(uid),
      getAllAnnotations: () => [...mockAnnotations.values()],
      addAnnotation: annotation => mockAnnotations.set(annotation.annotationUID, annotation),
      removeAnnotation: uid => {
        const annotation = mockAnnotations.get(uid);
        mockAnnotations.delete(uid);
        // As the library: removal raises ANNOTATION_REMOVED
        mockListeners.ANNOTATION_REMOVED && mockListeners.ANNOTATION_REMOVED({ detail: { annotation } });
      },
    },
  },
  Enums: {
    Events: { ANNOTATION_COMPLETED: 'ANNOTATION_COMPLETED', ANNOTATION_MODIFIED: 'ANNOTATION_MODIFIED', ANNOTATION_REMOVED: 'ANNOTATION_REMOVED' },
  },
  utilities: { triggerAnnotationRenderForViewportIds: ids => mockRender(ids) },
}), { virtual: true });
// The DICOMSR enums the out-of-plane modules read
jest.mock('@cornerstonejs/adapters', () => ({
  adaptersSR: { Cornerstone3D: { CodeScheme: { CodingSchemeDesignator: 'CORNERSTONEJS', codeValues: {} } } },
}), { virtual: true });
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: {
    log: { warn: () => {}, info: () => {}, debug: () => {} },
    DICOMSR: {
      angleGeometry: jest.requireActual('../../../../platform/core/src/DICOMSR/utils/angleGeometry'),
      circleGeometry: jest.requireActual('../../../../platform/core/src/DICOMSR/utils/circleGeometry'),
      outOfPlane: jest.requireActual('../../../../platform/core/src/DICOMSR/utils/outOfPlane'),
      drawingPlane: jest.requireActual('../../../../platform/core/src/DICOMSR/utils/drawingPlane'),
      measurementView: jest.requireActual('../../../../platform/core/src/DICOMSR/utils/measurementView'),
    },
    utils: { dataProc: { firstDefinedValue: (...values) => values.find(value => value !== undefined) }, guid: () => 'guid-1' },
    measurements: {
      Enums: {},
      getImagePath: () => '',
      MeasurementApi: {
        addAnnotationVisibilitySource: (source) => {
          mockVisibilitySources.add(source);
          return () => mockVisibilitySources.delete(source);
        },
        Instance: {
          _serviceManagedTool: toolName => (['Length', 'Angle', 'CobbAngle', 'ArrowAnnotate', 'CircleRoi'].includes(toolName)
            ? { toolServiceManaged: true, source: { name: 'CornerstoneTools', version: '4', ...mockClassic }, toolMapping: mockClassic }
            : { toolServiceManaged: false }),
        },
      },
    },
  },
}), { virtual: true });

import { annotationUIDFor, connectMeasurementAnnotationSync } from './measurementAnnotationSync';

// The tools end a drag on mouse up; the window receives it after them
global.window = new EventTarget();
const endDrag = () => window.dispatchEvent(new Event('mouseup'));

const classicSource = { name: 'CornerstoneTools', version: '4' };
const c3dSource = { name: 'Cornerstone3DTools-Sonador', version: '0.1' };

function fakeMeasurementService() {
  const handlers = {};
  const measurements = new Map();
  const service = {
    EVENTS: {
      MEASUREMENT_ADDED: 'added', MEASUREMENT_UPDATED: 'updated', MEASUREMENT_REMOVED: 'removed', MEASUREMENTS_CLEARED: 'cleared',
      RAW_MEASUREMENT_ADDED: 'raw-added',
    },
    subscribe: (name, fn) => {
      (handlers[name] = handlers[name] || []).push(fn);
      return { unsubscribe: () => { handlers[name] = handlers[name].filter(h => h !== fn); } };
    },
    publish: (name, payload) => (handlers[name] || []).forEach(fn => fn(payload)),
    getMeasurement: uid => measurements.get(uid),
    add: measurement => {
      measurements.set(measurement.uid, measurement);
      service.publish('added', { source: measurement.source, measurement });
    },
    update: jest.fn((uid, measurement) => {
      measurements.set(uid, measurement);
      service.publish('updated', { source: measurement.source, measurement });
    }),
    _broadcastEvent: (name, payload) => service.publish(name, payload),
    addRawMeasurement: jest.fn((source, annotationType, data, toMeasurementSchema) => {
      const measurement = { ...toMeasurementSchema(data), source, uid: data.id };
      measurements.set(measurement.uid, measurement);
      service.publish('raw-added', { source, measurement });
      return measurement.uid;
    }),
    remove: jest.fn(uid => {
      measurements.delete(uid);
      service.publish('removed', { source: classicSource, measurement: uid });
    }),
    measurements,
  };
  return service;
}

const cobbAngle = (uid = 'm-1') => ({
  uid,
  toolName: 'CobbAngle',
  source: classicSource,
  referencedImageId: 'wadors:image',
  FrameOfReferenceUID: '2.25.7001',
  label: 'Hip abduction',
  points: [{ x: 0.5, y: 0.5 }, { x: 10.5, y: 0.5 }, { x: 0.5, y: 10.5 }, { x: 10.5, y: 20.5 }],
  data: {
    rAngle: 135,
    handles: {
      start: { x: 0.5, y: 0.5 }, end: { x: 10.5, y: 0.5 }, start2: { x: 0.5, y: 10.5 }, end2: { x: 10.5, y: 20.5 }, textBox: {},
    },
  },
  metadata: { TrackingUniqueIdentifier: '2.25.8100' },
});

let service;
let disconnect;
beforeEach(() => {
  mockAnnotations.clear();
  mockLocked.clear();
  mockHidden.clear();
  mockRender.mockClear();
  mockUpdateImage.mockClear();
  service = fakeMeasurementService();
  disconnect = connectMeasurementAnnotationSync(service, classicSource);
});
afterEach(() => disconnect());

const mirror = (uid = 'm-1') => mockAnnotations.get(annotationUIDFor(uid));

// A drawing is taken up after the completing code has run
const flush = () => new Promise(resolve => setTimeout(resolve, 0));


it('creates one editable annotation for a classic measurement, in patient coordinates on its image plane', () => {
  service.add(cobbAngle());

  expect(mockAnnotations.size).toBe(1);
  expect(mirror()).toMatchObject({
    isLocked: false,
    metadata: { toolName: 'CobbAngle', FrameOfReferenceUID: '2.25.7001', referencedImageId: 'wadors:image', viewPlaneNormal: [0, 0, 1] },
  });
  expect(mirror().data.handles.points).toEqual([[0, 0, 0], [10, 0, 0], [0, 10, 0], [10, 20, 0]]);
  expect(mockRender).toHaveBeenCalledWith(['inspection']);
  expect(service.measurements.size).toBe(1);
});

it('ignores measurements of other tools and of the Cornerstone3D source', () => {
  service.add({ ...cobbAngle('bidirectional'), toolName: 'Bidirectional' });
  service.add({ ...cobbAngle('c3d'), source: c3dSource });
  expect(mockAnnotations.size).toBe(0);
});

it('moves the annotation when the classic measurement is edited', () => {
  service.add(cobbAngle());
  const edited = cobbAngle();
  edited.data.handles.end2 = { x: 0.5, y: 20.5 };
  service.publish('updated', { source: classicSource, measurement: edited });

  expect(mirror().data.handles.points[3]).toEqual([0, 20, 0]);
  expect(mockAnnotations.size).toBe(1);
});

it("carries a Length's record value (its stored length) with the points it belongs to", () => {
  service.add({
    uid: 'len-1', toolName: 'Length', source: classicSource, referencedImageId: 'wadors:image', FrameOfReferenceUID: '2.25.7001',
    points: [{ x: 0.5, y: 0.5 }, { x: 30.5, y: 40.5 }], length: 49.876,
    data: { length: 49.876, handles: { start: { x: 0.5, y: 0.5 }, end: { x: 30.5, y: 40.5 }, textBox: {} } }, metadata: {},
  });
  expect(mirror('len-1').data.recordValue).toEqual({ value: 49.876, points: [[0, 0, 0], [30, 40, 0]] });
});

it('carries the record value with the points it belongs to', () => {
  service.add(cobbAngle());
  expect(mirror().data.recordValue).toEqual({ value: 135, points: mirror().data.handles.points });
  expect(mirror().data.recordValue.points).not.toBe(mirror().data.handles.points);
});

it('updates the classic measurement when the annotation is edited in a Cornerstone3D view', () => {
  service.add(cobbAngle());
  const annotation = mirror();
  annotation.data.handles.points[3] = [0, 20, 0];
  mockListeners.ANNOTATION_MODIFIED({ detail: { annotation } });

  expect(service.update).toHaveBeenCalledTimes(1);
  const [uid, measurement, notYetUpdatedAtSource] = service.update.mock.calls[0];
  expect(uid).toBe('m-1');
  expect(notYetUpdatedAtSource).toBe(true);
  expect(measurement.data.handles.end2).toEqual({ x: 0.5, y: 20.5 });
  expect(measurement.data.rAngle).toBe(90);
  expect(measurement.points[3]).toEqual({ x: 0.5, y: 20.5 });
  expect(measurement.metadata.TrackingUniqueIdentifier).toBe('2.25.8100');
  expect(mockUpdateImage).toHaveBeenCalledWith('classic-element');

  // The update returns to the annotation unchanged: no second update
  mockListeners.ANNOTATION_MODIFIED({ detail: { annotation } });
  expect(service.update).toHaveBeenCalledTimes(1);
});

it('removes the measurement when its annotation is deleted in a Cornerstone3D view', () => {
  service.add(cobbAngle());
  const annotation = mirror();
  mockAnnotations.delete(annotation.annotationUID);
  mockListeners.ANNOTATION_REMOVED({ detail: { annotation } });

  expect(service.remove).toHaveBeenCalledWith('m-1');
  expect(service.measurements.size).toBe(0);
});

it('removes the annotation when the measurement is deleted, without removing anything else', () => {
  service.add(cobbAngle('m-1'));
  service.add(cobbAngle('m-2'));
  service.remove('m-1');

  expect(mirror('m-1')).toBeUndefined();
  expect(mirror('m-2')).toBeDefined();
  expect(service.remove).toHaveBeenCalledTimes(1);
  expect(service.measurements.has('m-2')).toBe(true);
});

it('removes the annotations of cleared measurements', () => {
  service.add(cobbAngle('m-1'));
  service.measurements.clear();
  service.publish('cleared', { measurements: [] });
  expect(mockAnnotations.size).toBe(0);
});

it('draws nothing for a measurement whose image has no plane', () => {
  service.add({ ...cobbAngle(), referencedImageId: 'wadors:unknown' });
  expect(mockAnnotations.size).toBe(0);
});


it('takes the value from the moved geometry, not a stats cache that has not caught up', () => {
  service.add(cobbAngle());
  const annotation = mirror();

  // HandlesUpdated: the new points with the previous value still cached
  annotation.data.handles.points[3] = [0, 20, 0];
  annotation.data.cachedStats = { 'volumeId:inspection': { angle: 135 } };
  mockListeners.ANNOTATION_MODIFIED({ detail: { annotation, changeType: 'HandlesUpdated' } });

  // StatsUpdated: the same points, the recalculated value
  annotation.data.cachedStats = { 'volumeId:inspection': { angle: 90 } };
  mockListeners.ANNOTATION_MODIFIED({ detail: { annotation, changeType: 'StatsUpdated' } });

  expect(service.update).toHaveBeenCalledTimes(1);
  expect(service.getMeasurement('m-1').data.rAngle).toBeCloseTo(90, 6);
  expect(mirror().data.recordValue.value).toBeCloseTo(90, 6);
  expect(service.measurements.size).toBe(1);
});

it('keeps the handle array a tool may be dragging when the record returns the same points', () => {
  service.add(cobbAngle());
  const annotation = mirror();
  const handlePoints = annotation.data.handles.points;
  handlePoints[3] = [0, 20, 0];
  mockListeners.ANNOTATION_MODIFIED({ detail: { annotation } });
  expect(mirror().data.handles.points).toBe(handlePoints);
});



describe('a measurement read from a report or saved (read-only, locked)', () => {
  const readOnly = (uid = 'm-1') => {
    const measurement = cobbAngle(uid);
    measurement.metadata = { ...measurement.metadata, isReadOnly: true, isLocked: true };
    return measurement;
  };

  it('has a locked annotation, drawn with the stored value', () => {
    service.add(readOnly());
    expect(mirror().isLocked).toBe(true);
    expect(mockLocked.has(annotationUIDFor('m-1'))).toBe(true);
    expect(mirror().data.recordValue.value).toBe(135);
  });

  it('is not changed by an edit of its annotation', () => {
    service.add(readOnly());
    const annotation = mirror();
    annotation.data.handles.points[3] = [20, 40, 0];
    mockListeners.ANNOTATION_MODIFIED({ detail: { annotation } });
    expect(service.update).not.toHaveBeenCalled();
  });

  it('locks the annotation of a pending measurement once the measurement is locked (saved)', () => {
    service.add(cobbAngle());
    expect(mockLocked.has(annotationUIDFor('m-1'))).toBe(false);
    service.update('m-1', readOnly());
    expect(mockLocked.has(annotationUIDFor('m-1'))).toBe(true);
  });

  it('unlocks the annotation it removes', () => {
    service.add(readOnly());
    service.remove('m-1');
    expect(mirror()).toBeUndefined();
    expect(mockLocked.size).toBe(0);
  });
});


describe('lock and colors set in the Measurements panel', () => {
  it('locks and unlocks the annotation of a pending measurement the user locks', () => {
    service.add(cobbAngle());
    service.update('m-1', { ...service.getMeasurement('m-1'), isLocked: true, metadata: { ...cobbAngle().metadata, isLocked: true } });
    expect(mockLocked.has(annotationUIDFor('m-1'))).toBe(true);
    service.update('m-1', { ...service.getMeasurement('m-1'), isLocked: false, metadata: { ...cobbAngle().metadata, isLocked: false } });
    expect(mockLocked.has(annotationUIDFor('m-1'))).toBe(false);
  });

  it("draws the annotation in the measurement's line and text colors, locked or not, and clears them", () => {
    const uid = annotationUIDFor('m-1');
    service.add(cobbAngle());
    expect(mockStyles[uid]).toBeUndefined();

    const displayAttributes = { Color: { Line: '#FF8800', Text: '#00FF00' } };
    service.update('m-1', { ...cobbAngle(), data: { ...cobbAngle().data, displayAttributes } });
    expect(mockStyles[uid]).toEqual({ color: '#FF8800', colorLocked: '#FF8800', textBoxColor: '#00FF00', textBoxColorLocked: '#00FF00' });

    // A line color alone colors the text too
    service.update('m-1', { ...cobbAngle(), metadata: { ...cobbAngle().metadata, displayAttributes: { Color: { Line: '#123456' } } } });
    expect(mockStyles[uid]).toEqual({ color: '#123456', colorLocked: '#123456', textBoxColor: '#123456', textBoxColorLocked: '#123456' });

    service.update('m-1', cobbAngle());
    expect(mockStyles[uid]).toEqual({});
  });
});


describe('visibility', () => {
  it('hides and shows the annotation of a measurement toggled in the Measurements panel', () => {
    service.add(cobbAngle());
    const annotation = mirror();
    expect(annotation.isVisible).toBe(true);

    service.update('m-1', { ...service.getMeasurement('m-1'), isVisible: false });
    expect(annotation.isVisible).toBe(false);
    expect(mockHidden.has(annotationUIDFor('m-1'))).toBe(true);

    service.update('m-1', { ...service.getMeasurement('m-1'), isVisible: true });
    expect(annotation.isVisible).toBe(true);
    expect(mockHidden.size).toBe(0);
  });

  it('creates the annotation of a hidden measurement hidden, and leaves no hidden state when removed', () => {
    service.add({ ...cobbAngle(), isVisible: false });
    expect(mirror().isVisible).toBe(false);
    expect(mockHidden.has(annotationUIDFor('m-1'))).toBe(true);
    service.remove('m-1');
    expect(mockHidden.size).toBe(0);
  });
});


describe('Length', () => {
  const length = (uid = 'l-1') => ({
    uid, toolName: 'Length', source: classicSource, referencedImageId: 'wadors:image', length: 10,
    points: [{ x: 0.5, y: 0.5 }, { x: 10.5, y: 0.5 }],
    data: { length: 10, handles: { start: { x: 0.5, y: 0.5 }, end: { x: 10.5, y: 0.5 }, textBox: {} } },
    metadata: { TrackingUniqueIdentifier: '2.25.8200' },
  });

  it('has an editable annotation, and an edit there updates the classic length', () => {
    service.add(length());
    const annotation = mirror('l-1');
    expect(annotation.metadata.toolName).toBe('Length');
    expect(annotation.data.handles.points).toEqual([[0, 0, 0], [10, 0, 0]]);
    // Its length belongs to these points (the 3D display shows it while they match)
    expect(annotation.data.recordValue).toEqual({ value: 10, points: [[0, 0, 0], [10, 0, 0]] });

    annotation.data.handles.points[1] = [0, 20, 0];
    mockListeners.ANNOTATION_MODIFIED({ detail: { annotation } });
    const updated = service.getMeasurement('l-1');
    expect(updated.length).toBeCloseTo(20, 6);
    expect(updated.data.length).toBeCloseTo(20, 6);
    expect(updated.data.handles.end).toEqual({ x: 0.5, y: 20.5 });
    expect(updated.metadata.TrackingUniqueIdentifier).toBe('2.25.8200');
  });
});


describe('a measurement drawn in a Cornerstone3D view', () => {
  const notified = [];
  beforeEach(() => {
    disconnect();
    notified.length = 0;
    Object.keys(mockStyles).forEach(key => delete mockStyles[key]);
    mockClassic.toAnnotationSchema.mockReset();
    mockClassic.annotationToMeasurement.mockReset();
    disconnect = connectMeasurementAnnotationSync(service, classicSource, { notify: message => notified.push(message) });
  });

  const drawn = async (toolName, points, referencedImageId = 'wadors:image') => {
    const annotation = {
      annotationUID: `native-${toolName}`,
      metadata: { toolName, FrameOfReferenceUID: '2.25.7001', referencedImageId },
      data: { handles: { points }, cachedStats: {} },
    };
    mockAnnotations.set(annotation.annotationUID, annotation);
    mockListeners.ANNOTATION_COMPLETED({ detail: { annotation } });
    await flush();
    return annotation;
  };

  it('on an acquired image becomes a classic measurement, and its annotation the mirror of it', async () => {
    mockClassic.toAnnotationSchema.mockImplementation(measurement => ({ toolName: measurement.toolName, measurement }));
    mockClassic.annotationToMeasurement.mockImplementation((toolName, annotation) => {
      const { measurement } = annotation;
      service.measurements.set('c-new', { ...measurement, uid: 'c-new', source: classicSource });
      return 'c-new';
    });
    await drawn('CobbAngle', [[0, 0, 0], [10, 0, 0], [0, 10, 0], [10, 20, 0]]);

    const [measurement, toolName] = mockClassic.toAnnotationSchema.mock.calls[0];
    expect(toolName).toBe('CobbAngle');
    expect(measurement.points).toEqual([{ x: 0.5, y: 0.5 }, { x: 10.5, y: 0.5 }, { x: 0.5, y: 10.5 }, { x: 10.5, y: 20.5 }]);
    expect(measurement.data.rAngle).toBeCloseTo(135, 6);
    expect(measurement.data.handles.end2).toMatchObject({ x: 10.5, y: 20.5 });
    expect(measurement.metadata).toMatchObject({
      _id: 'guid-1', SOPInstanceUID: '2.25.1003', SeriesInstanceUID: '2.25.1002', StudyInstanceUID: '2.25.1001',
      referencedImageId: 'wadors:image', FrameOfReferenceUID: '2.25.7001',
    });

    // One annotation: the mirror of the new record; the drawn one is gone, the record stays
    expect(mockAnnotations.has('native-CobbAngle')).toBe(false);
    expect(mirror('c-new')).toBeDefined();
    expect(mockAnnotations.size).toBe(1);
    expect(service.remove).not.toHaveBeenCalled();
    expect(notified).toEqual([]);
  });

  it('saves a Length with its length in mm', async () => {
    mockClassic.toAnnotationSchema.mockImplementation(measurement => ({ measurement }));
    mockClassic.annotationToMeasurement.mockImplementation(() => undefined);
    await drawn('Length', [[0, 0, 0], [3, 4, 0]]);
    const [measurement] = mockClassic.toAnnotationSchema.mock.calls[0];
    expect(measurement.length).toBeCloseTo(5, 6);
    expect(measurement.data.length).toBeCloseTo(5, 6);
  });

  it('without a referenced image stays in the view, dashed, announced without claiming why no image was found', async () => {
    // The reference lookup returns none for an unaligned view and for images without position metadata
    const annotation = await drawn('Angle', [[10, 0, 0], [0, 0, 0], [0, 10, 0]], null);
    expect(mockClassic.toAnnotationSchema).not.toHaveBeenCalled();
    expect(mockAnnotations.get('native-Angle')).toBe(annotation);
    expect(annotation.data.unsaved).toBe(true);
    expect(mockStyles['native-Angle']).toEqual({ lineDash: '4,4' });
    expect(notified).toHaveLength(1);
    expect(notified[0]).toMatchObject({ title: 'Measurement not saved', type: 'warning' });
    expect(notified[0].message).toBe('No acquired image could be identified for this Angle: the view may not be '
      + "aligned with one, or the images may lack position information. It stays in this session's 3D views and "
      + 'is not saved. To save it, draw it in the 2D viewport.');
    expect(notified[0].message).not.toContain('is drawn on a plane');
  });

  it('off the plane of the image it references stays in the view, not saved', async () => {
    await drawn('Length', [[0, 0, 5], [10, 0, 5]]);
    expect(mockClassic.toAnnotationSchema).not.toHaveBeenCalled();
    expect(notified).toHaveLength(1);
    expect(notified[0].message).toBe("This Length is drawn on a plane that is not an acquired image. It stays in "
      + "this session's 3D views and is not saved. To save it, draw it with the view aligned to the acquisition, "
      + 'or in the 2D viewport.');
  });

  it.each([
    ['Bidirectional', 'bidirectional measurement', [[0, 0, 0], [10, 0, 0], [5, -3, 0], [5, 3, 0]]],
    ['EllipticalROI', 'ellipse', [[0, 0, 0], [10, 0, 0], [5, -3, 0], [5, 3, 0]]],
    ['RectangleROI', 'rectangle', [[0, 0, 0], [10, 0, 0], [0, 10, 0], [10, 10, 0]]],
    ['PlanarFreehandROI', 'freehand outline', []],
    ['Probe', 'probe', [[2, 2, 0]]],
  ])('of a tool without a classic mapping (%s) stays in the view, announced as one that cannot be saved', async (toolName, name, points) => {
    const annotation = await drawn(toolName, points);
    expect(mockClassic.toAnnotationSchema).not.toHaveBeenCalled();
    expect(mockAnnotations.get(`native-${toolName}`)).toBe(annotation);
    expect(annotation.data.unsaved).toBe(true);
    expect(mockStyles[`native-${toolName}`]).toEqual({ lineDash: '4,4' });
    expect(notified).toEqual([{
      title: 'Measurement not saved',
      message: `This ${name} cannot be saved as a measurement from the 3D views. It stays in this session's 3D views and is not saved.`,
      type: 'warning',
    }]);
  });

  it('follows the global visibility while unsaved: hidden and shown with the measurements, and counted in their state', async () => {
    service.add(cobbAngle());
    const probe = await drawn('Probe', [[2, 2, 0]]);
    expect(mockVisibilitySources.size).toBe(1);
    const [source] = mockVisibilitySources;

    // Only the unsaved annotation: the measurement's mirror follows its measurement
    expect(source.visibilities()).toEqual([true]);
    source.setVisibility(false);
    expect(probe.isVisible).toBe(false);
    expect(mockHidden.has('native-Probe')).toBe(true);
    expect(mirror().isVisible).toBe(true);
    expect(source.visibilities()).toEqual([false]);

    source.setVisibility(true);
    expect(probe.isVisible).toBe(true);
    expect(mockHidden.has('native-Probe')).toBe(false);

    disconnect();
    expect(mockVisibilitySources.size).toBe(0);
    disconnect = () => {};
  });

  it('on an acquired image that cannot be added to the measurements is announced as such, not as a plane problem', async () => {
    mockClassic.toAnnotationSchema.mockImplementation(measurement => ({ measurement }));
    mockClassic.annotationToMeasurement.mockImplementation(() => undefined);
    const annotation = await drawn('CobbAngle', [[0, 0, 0], [10, 0, 0], [0, 10, 0], [10, 20, 0]]);
    expect(annotation.data.unsaved).toBe(true);
    expect(notified).toHaveLength(1);
    expect(notified[0].message).toBe("This Cobb angle could not be added to the measurements. It stays in this "
      + "session's 3D views and is not saved. To save it, draw it in the 2D viewport.");
  });

  it('that fails while being added is announced without the error text', async () => {
    mockClassic.toAnnotationSchema.mockImplementation(() => { throw new Error('mapping exploded'); });
    await drawn('Angle', [[10, 0, 0], [0, 0, 0], [0, 10, 0]]);
    expect(notified).toHaveLength(1);
    expect(notified[0].message).toContain('This Angle could not be added to the measurements.');
    expect(notified[0].message).not.toContain('exploded');
    expect(notified[0].message).not.toContain('plane');
  });

  it.each([['wadors:unplaced'], ['wadors:lookup-fails']])(
    'on an image whose plane is unavailable (%s) is announced as such, not as an off-plane drawing', async imageId => {
      const annotation = await drawn('Length', [[0, 0, 0], [10, 0, 0]], imageId);
      expect(mockClassic.toAnnotationSchema).not.toHaveBeenCalled();
      expect(annotation.data.unsaved).toBe(true);
      expect(notified).toHaveLength(1);
      expect(notified[0].message).toBe('The image this Length is drawn on has no usable position, orientation or pixel '
        + "spacing, so the Length cannot be saved. It stays in this session's 3D views and is not saved.");
      expect(notified[0].message).not.toContain('acquired');
      expect(notified[0].message).not.toContain('failed');
    });

  // As the stock tools' cancel(): the new drawing is completed, then the view removes it
  const cancelWhileDrawing = (toolName, points) => {
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
  };

  it.each([
    ['Length', [[0, 0, 0], [10, 0, 0]]],
    ['Angle', [[10, 0, 0], [0, 0, 0], [0, 10, 0]]],
    ['CobbAngle', [[0, 0, 0], [10, 0, 0], [0, 10, 0], [10, 20, 0]]],
    ['EllipticalROI', [[0, 0, 0], [10, 0, 0], [5, -3, 0], [5, 3, 0]]],
  ])('cancelled with Escape while drawing (%s) is neither saved nor announced', async (toolName, points) => {
    mockClassic.toAnnotationSchema.mockImplementation(measurement => ({ measurement }));
    mockClassic.annotationToMeasurement.mockImplementation(() => 'c-new');
    cancelWhileDrawing(toolName, points);
    await flush();
    expect(mockClassic.toAnnotationSchema).not.toHaveBeenCalled();
    expect(mockClassic.annotationToMeasurement).not.toHaveBeenCalled();
    expect(mockAnnotations.size).toBe(0);
    expect(notified).toEqual([]);
  });

  it('is not taken up after the synchronisation stops', async () => {
    const annotation = {
      annotationUID: 'native-late', metadata: { toolName: 'Length', referencedImageId: 'wadors:image' },
      data: { handles: { points: [[0, 0, 0], [10, 0, 0]] }, cachedStats: {} },
    };
    mockAnnotations.set(annotation.annotationUID, annotation);
    const completed = mockListeners.ANNOTATION_COMPLETED;
    completed({ detail: { annotation } });
    disconnect();
    await flush();
    expect(mockClassic.toAnnotationSchema).not.toHaveBeenCalled();
    expect(notified).toEqual([]);
    disconnect = connectMeasurementAnnotationSync(service, classicSource);
  });

  it('leaves mirrors alone', async () => {
    service.add(cobbAngle());
    mockListeners.ANNOTATION_COMPLETED({ detail: { annotation: mirror() } });
    await flush();
    expect(mockClassic.toAnnotationSchema).not.toHaveBeenCalled();
    expect(notified).toEqual([]);
  });

  it('leaves other tools without a mapping and incomplete measurements alone', async () => {
    const other = { annotationUID: 'crosshair', metadata: { toolName: 'Crosshairs' }, data: { handles: { points: [[0, 0, 0]] } } };
    mockListeners.ANNOTATION_COMPLETED({ detail: { annotation: other } });
    await flush();
    await drawn('Angle', [[10, 0, 0], [0, 0, 0]]);
    expect(mockClassic.toAnnotationSchema).not.toHaveBeenCalled();
    expect(notified).toEqual([]);
  });
});



describe('arrow annotations', () => {
  const arrow = (uid = 'r-1') => ({
    uid, toolName: 'ArrowAnnotate', source: classicSource, referencedImageId: 'wadors:image', label: 'Fracture',
    points: [{ x: 0.5, y: 0.5 }, { x: 10.5, y: 10.5 }],
    data: { text: 'Fracture', handles: { start: { x: 0.5, y: 0.5 }, end: { x: 10.5, y: 10.5 }, textBox: {} } },
    metadata: { text: 'Fracture', TrackingUniqueIdentifier: '2.25.8300' },
  });

  it('mirror the classic arrow with its tip first and its text as the label', async () => {
    service.add(arrow());
    expect(mirror('r-1').metadata.toolName).toBe('ArrowAnnotate');
    expect(mirror('r-1').data.handles.points).toEqual([[0, 0, 0], [10, 10, 0]]);
    expect(mirror('r-1').data.label).toBe('Fracture');
  });

  it('carry a text edited in a Cornerstone3D view, and a moved tip, to the classic measurement', async () => {
    service.add(arrow());
    const annotation = mirror('r-1');
    annotation.data.label = 'Healed fracture';
    mockListeners.ANNOTATION_MODIFIED({ detail: { annotation } });
    let updated = service.getMeasurement('r-1');
    expect(updated).toMatchObject({ label: 'Healed fracture', metadata: { text: 'Healed fracture', TrackingUniqueIdentifier: '2.25.8300' } });
    expect(updated.data.text).toBe('Healed fracture');

    annotation.data.handles.points[0] = [5, 5, 0];
    mockListeners.ANNOTATION_MODIFIED({ detail: { annotation } });
    updated = service.getMeasurement('r-1');
    expect(updated.data.handles.start).toEqual({ x: 5.5, y: 5.5 });
    expect(service.update).toHaveBeenCalledTimes(2);
  });

  it('drawn on an acquired image become classic arrows with their text', async () => {
    disconnect();
    disconnect = connectMeasurementAnnotationSync(service, classicSource, { notify: () => {} });
    mockClassic.toAnnotationSchema.mockReset().mockImplementation(measurement => ({ measurement }));
    mockClassic.annotationToMeasurement.mockReset().mockImplementation(() => undefined);
    const annotation = {
      annotationUID: 'native-arrow',
      metadata: { toolName: 'ArrowAnnotate', FrameOfReferenceUID: '2.25.7001', referencedImageId: 'wadors:image' },
      data: { label: 'Fracture', handles: { points: [[0, 0, 0], [10, 10, 0]] }, cachedStats: {} },
    };
    mockAnnotations.set(annotation.annotationUID, annotation);
    mockListeners.ANNOTATION_COMPLETED({ detail: { annotation } });
    await flush();

    const [measurement, toolName] = mockClassic.toAnnotationSchema.mock.calls[0];
    expect(toolName).toBe('ArrowAnnotate');
    expect(measurement).toMatchObject({ label: 'Fracture', metadata: { text: 'Fracture' }, data: { text: 'Fracture' } });
    expect(measurement.data.handles.start).toMatchObject({ x: 0.5, y: 0.5 });
  });
});


describe('a measurement on an image, edited in a Cornerstone3D view', () => {
  const drag = (index, point) => {
    const annotation = mirror();
    annotation.data.handles.points[index] = point;
    mockListeners.ANNOTATION_MODIFIED({ detail: { annotation, changeType: 'HandlesUpdated' } });
    return annotation;
  };
  const end2Of = () => service.getMeasurement('m-1').data.handles.end2;

  it('keeps a handle dragged off the image plane on the plane, in the array the tool drags, without a warning', () => {
    const notify = jest.fn();
    disconnect();
    disconnect = connectMeasurementAnnotationSync(service, classicSource, { notify });
    service.add(cobbAngle());
    const points = mirror().data.handles.points;

    drag(3, [12, 20, 3]);
    expect(mirror().data.handles.points).toBe(points);
    expect(points[3]).toEqual([12, 20, 0]);
    expect(end2Of()).toEqual({ x: 12.5, y: 20.5 });
    endDrag();
    expect(points[3]).toEqual([12, 20, 0]);
    expect(notify).not.toHaveBeenCalled();
  });

  it('returns a handle dragged outside the rows and columns to where it was before the drag, unclipped', () => {
    service.add(cobbAngle());
    drag(3, [10, 55, 0]);
    // While outside, the measurement keeps its points
    expect(service.update).not.toHaveBeenCalled();
    expect(mirror().data.handles.points[3]).toEqual([10, 55, 0]);

    endDrag();
    expect(mirror().data.handles.points[3]).toEqual([10, 20, 0]);
    expect(end2Of()).toEqual({ x: 10.5, y: 20.5 });
    expect(mirror().invalidated).toBe(true);
  });

  it('returns it to before the drag, not to the last point inside the image', () => {
    service.add(cobbAngle());
    drag(3, [5, 25, 0]);
    expect(end2Of()).toEqual({ x: 5.5, y: 25.5 });
    drag(3, [5, -4, 0]);
    endDrag();

    expect(mirror().data.handles.points[3]).toEqual([10, 20, 0]);
    expect(end2Of()).toEqual({ x: 10.5, y: 20.5 });
    expect(service.getMeasurement('m-1').data.rAngle).toBeCloseTo(135, 6);
  });

  it('keeps a drag that ends inside the image, and starts the next drag from there', () => {
    service.add(cobbAngle());
    drag(3, [10, 60, 0]);
    drag(3, [8, 30, 0]);
    endDrag();
    expect(mirror().data.handles.points[3]).toEqual([8, 30, 0]);
    expect(end2Of()).toEqual({ x: 8.5, y: 30.5 });

    drag(3, [40, 30, 0]);
    endDrag();
    expect(mirror().data.handles.points[3]).toEqual([8, 30, 0]);
  });

  it('applies to a whole measurement moved outside the image', () => {
    service.add(cobbAngle());
    const annotation = mirror();
    annotation.data.handles.points.forEach((point) => { point[0] -= 15; });
    mockListeners.ANNOTATION_MODIFIED({ detail: { annotation, changeType: 'HandlesUpdated' } });
    endDrag();
    expect(mirror().data.handles.points).toEqual([[0, 0, 0], [10, 0, 0], [0, 10, 0], [10, 20, 0]]);
  });

  it('leaves the annotation of a locked measurement alone', () => {
    service.add({ ...cobbAngle(), metadata: { isLocked: true } });
    drag(3, [10, 55, 2]);
    endDrag();
    expect(mirror().data.handles.points[3]).toEqual([10, 55, 2]);
    expect(service.update).not.toHaveBeenCalled();
  });

  it('stops listening for the end of a drag once disconnected', () => {
    service.add(cobbAngle());
    drag(3, [10, 55, 0]);
    disconnect();
    endDrag();
    expect(mirror().data.handles.points[3]).toEqual([10, 55, 0]);
    disconnect = () => {};
  });
});


describe('a measurement drawn in the 3D Inspector', () => {
  const { registerDrawingVolume } = jest.requireActual('../../../../platform/core/src/DICOMSR/utils/outOfPlane');
  const outOfPlaneSource = { name: 'Cornerstone3DTools-Sonador', version: '0.1' };
  const SERIES = { StudyInstanceUID: '2.25.1001', SeriesInstanceUID: '2.25.1002', FrameOfReferenceUID: '2.25.7001' };
  const notified = [];
  const unregister = [];
  beforeEach(() => {
    disconnect();
    notified.length = 0;
    Object.keys(mockStyles).forEach(key => delete mockStyles[key]);
    mockClassic.toAnnotationSchema.mockReset();
    mockClassic.annotationToMeasurement.mockReset();
    unregister.push(registerDrawingVolume('volume::inspection', SERIES));
    unregister.push(registerDrawingVolume('volume::inspection#decimated', { ...SERIES, reducedResolution: true }));
    unregister.push(registerDrawingVolume('volume-without-frame::inspection', { ...SERIES, FrameOfReferenceUID: undefined }));
    disconnect = connectMeasurementAnnotationSync(service, classicSource, { notify: message => notified.push(message), outOfPlaneSource });
  });
  afterEach(() => unregister.splice(0).forEach(fn => fn()));

  // A sagittal Inspector view (Cornerstone3D camera: normal +x, up +z) of the axial image
  const SAGITTAL = { viewPlaneNormal: [1, 0, 0], viewUp: [0, 0, 1] };
  const AXIAL = { viewPlaneNormal: [0, 0, -1], viewUp: [0, -1, 0] };
  let count = 0;
  const drawn = async (toolName, points, { volumeId = 'volume::inspection', view = SAGITTAL, referencedImageId = null, frame = '2.25.7001' } = {}) => {
    count += 1;
    const annotation = {
      annotationUID: `native-${toolName}-${count}`,
      metadata: { toolName, FrameOfReferenceUID: frame, referencedImageId, volumeId, ...view },
      data: { label: '', handles: { points }, cachedStats: {} },
    };
    mockAnnotations.set(annotation.annotationUID, annotation);
    mockListeners.ANNOTATION_COMPLETED({ detail: { annotation } });
    await flush();
    return annotation;
  };
  const records = () => [...service.measurements.values()];

  it('off the acquired plane becomes a pending out-of-plane measurement with its source series, Drawing-Plane and View', async () => {
    const annotation = await drawn('Length', [[12, 0, 0], [12, 30, -40]]);

    expect(service.addRawMeasurement).toHaveBeenCalledTimes(1);
    expect(service.addRawMeasurement.mock.calls[0][0]).toBe(outOfPlaneSource);
    const [record] = records();
    expect(record).toMatchObject({
      toolName: 'Length', points: [[12, 0, 0], [12, 30, -40]], FrameOfReferenceUID: '2.25.7001',
      referenceStudyUID: '2.25.1001', referenceSeriesUID: '2.25.1002', isLocked: false, unit: 'mm',
      metadata: { outOfPlane: true, sourceSeries: '2.25.1002', drawingPlane: '0,1,0,0,0,-1', views: ['sagittal'], isReadOnly: false },
    });
    expect(record.length).toBeCloseTo(50, 9);
    expect(record.source).toBe(outOfPlaneSource);

    // Not a classic measurement; the drawing gives way to the record's annotation, editable
    expect(mockClassic.toAnnotationSchema).not.toHaveBeenCalled();
    expect(mockAnnotations.has(annotation.annotationUID)).toBe(false);
    expect(mirror(record.uid)).toMatchObject({ isLocked: false, metadata: { toolName: 'Length', FrameOfReferenceUID: '2.25.7001' } });
    expect(mirror(record.uid).data.handles.points).toEqual([[12, 0, 0], [12, 30, -40]]);
    expect(Math.abs(mirror(record.uid).metadata.viewPlaneNormal[0])).toBeCloseTo(1, 9);
    expect(mockStyles[annotationUIDFor(record.uid)]).toBeUndefined();
  });

  it('off the acquired plane, a circle becomes a pending out-of-plane CircleROI with its values', async () => {
    await drawn('CircleROI', [[12, 0, 0], [12, 3, -4]]);

    const [record] = records();
    expect(record).toMatchObject({
      toolName: 'CircleROI', points: [[12, 0, 0], [12, 3, -4]], unit: 'mm',
      metadata: { outOfPlane: true, sourceSeries: '2.25.1002', views: ['sagittal'] },
    });
    expect(record.data.cachedStats.radius).toBeCloseTo(5, 9);
    expect(record.data.cachedStats.area).toBeCloseTo(25 * Math.PI, 9);
    expect(mockClassic.toAnnotationSchema).not.toHaveBeenCalled();
    expect(mirror(record.uid).metadata.toolName).toBe('CircleROI');
  });

  it('is announced once a session as shown in the MPR and 3D views only', async () => {
    await drawn('Length', [[12, 0, 0], [12, 30, -40]]);
    await drawn('CobbAngle', [[12, 0, 0], [12, 10, 0], [12, 0, -10], [12, 0, -20]]);
    expect(notified).toEqual([{
      title: '3D measurement', type: 'info',
      message: 'This measurement is pending: it is saved with the other measurements when you save them. '
        + 'It is shown in the MPR and 3D views only.',
    }]);
    const cobb = records().find(record => record.toolName === 'CobbAngle');
    expect(cobb.value).toBeCloseTo(90, 9);
    expect(cobb.data.rAngle).toBeCloseTo(90, 9);

    service.publish('cleared', {});
    await drawn('Angle', [[12, 10, 0], [12, 0, 0], [12, 0, -10]]);
    expect(notified).toHaveLength(2);
  });

  it('on the acquired plane with a point outside the rows and columns is out-of-plane, its points unchanged', async () => {
    await drawn('Length', [[2, 3, 0], [45, 3, 0]], { view: AXIAL, referencedImageId: 'wadors:image' });
    // The notice says it is pending, and claims neither a save nor a plane off the acquisition
    expect(notified.map(n => n.message)).toEqual(['This measurement is pending: it is saved with the other measurements '
      + 'when you save them. It is shown in the MPR and 3D views only.']);
    expect(mockClassic.toAnnotationSchema).not.toHaveBeenCalled();
    const [record] = records();
    expect(record.points).toEqual([[2, 3, 0], [45, 3, 0]]);
    expect(record.metadata).toMatchObject({ drawingPlane: '1,0,0,0,1,0', views: ['axial'] });
  });

  it('on the acquired plane and inside the image is saved as before, in the image domain', async () => {
    mockClassic.toAnnotationSchema.mockImplementation(measurement => ({ measurement }));
    mockClassic.annotationToMeasurement.mockImplementation(() => undefined);
    await drawn('Length', [[2, 3, 0], [12, 3, 0]], { view: AXIAL, referencedImageId: 'wadors:image' });
    expect(mockClassic.toAnnotationSchema).toHaveBeenCalledTimes(1);
    expect(service.addRawMeasurement).not.toHaveBeenCalled();
  });

  it('on a volume at reduced resolution stays dashed in the session, in-plane or not', async () => {
    const offPlane = await drawn('Length', [[12, 0, 0], [12, 30, -40]], { volumeId: 'volume::inspection#decimated' });
    const inPlane = await drawn('Angle', [[10, 0, 0], [0, 0, 0], [0, 10, 0]],
      { volumeId: 'volume::inspection#decimated', view: AXIAL, referencedImageId: 'wadors:image' });
    expect(service.addRawMeasurement).not.toHaveBeenCalled();
    expect(mockClassic.toAnnotationSchema).not.toHaveBeenCalled();
    [offPlane, inPlane].forEach(annotation => expect(mockStyles[annotation.annotationUID]).toEqual({ lineDash: '4,4' }));
    expect(notified.map(n => n.message)).toEqual([
      "This series is shown at reduced resolution, so the Length cannot be saved from this view. It stays in this session's 3D views and is not saved.",
      "This series is shown at reduced resolution, so the Angle cannot be saved from this view. It stays in this session's 3D views and is not saved.",
    ]);
  });

  it('on a series without a Frame of Reference stays dashed, with the reason', async () => {
    const annotation = await drawn('Length', [[12, 0, 0], [12, 30, -40]], { volumeId: 'volume-without-frame::inspection', frame: null });
    expect(service.addRawMeasurement).not.toHaveBeenCalled();
    expect(annotation.data.unsaved).toBe(true);
    expect(notified[0].message).toBe('This series has no Frame of Reference, so a Length drawn off its acquired images cannot be saved. '
      + "It stays in this session's 3D views and is not saved.");
  });

  it('in an MPR pane (no drawing volume) stays dashed, as before', async () => {
    await drawn('Length', [[12, 0, 0], [12, 30, -40]], { volumeId: 'mpr-volume' });
    expect(service.addRawMeasurement).not.toHaveBeenCalled();
    expect(notified[0].title).toBe('Measurement not saved');
  });

  it('is edited on its drawing plane while pending, its value following; locked once saved', async () => {
    await drawn('Length', [[12, 0, 0], [12, 30, -40]]);
    const [{ uid }] = records();
    const annotation = mirror(uid);
    const points = annotation.data.handles.points;
    points[1] = [15, 30, 0];
    mockListeners.ANNOTATION_MODIFIED({ detail: { annotation, changeType: 'HandlesUpdated' } });

    expect(points[1]).toEqual([12, 30, 0]);
    expect(service.getMeasurement(uid).points).toEqual([[12, 0, 0], [12, 30, 0]]);
    expect(service.getMeasurement(uid).length).toBeCloseTo(30, 9);
    expect(service.getMeasurement(uid).metadata.drawingPlane).toBe('0,1,0,0,0,-1');

    // Saved: locked, and its annotation with it
    service.update(uid, { ...service.getMeasurement(uid), isLocked: true, metadata: { ...service.getMeasurement(uid).metadata, isLocked: true } });
    expect(mockLocked.has(annotationUIDFor(uid))).toBe(true);
    const calls = service.update.mock.calls.length;
    mirror(uid).data.handles.points[1] = [12, 40, 0];
    mockListeners.ANNOTATION_MODIFIED({ detail: { annotation: mirror(uid), changeType: 'HandlesUpdated' } });
    expect(service.update.mock.calls.length).toBe(calls);
  });

  it('keeps the drawing, editable and marked unsaved, when the record is not accepted or adding it fails', async () => {
    const outcomes = [() => undefined, () => { throw new Error('rejected'); }];
    for (const outcome of outcomes) {
      service.addRawMeasurement.mockImplementationOnce(outcome);
      notified.length = 0;
      const annotation = await drawn('Length', [[12, 0, 0], [12, 30, -40]]);
      expect(mockAnnotations.get(annotation.annotationUID)).toBe(annotation);
      expect(annotation.data.unsaved).toBe(true);
      expect(mockLocked.has(annotation.annotationUID)).toBe(false);
      expect(mockStyles[annotation.annotationUID]).toEqual({ lineDash: '4,4' });
      expect(notified.map(n => n.title)).toEqual(['Measurement not saved']);
    }
    expect(records()).toEqual([]);
  });

  it('keeps a Cobb angle whose lines lie in no common plane for the 3D display only, its points as stored', () => {
    const skew = [[0, 0, 0], [10, 0, 0], [0, 10, 10], [0, 20, 10]];
    service.addRawMeasurement(outOfPlaneSource, 'CobbAngle', { id: 'skew-1' }, () => ({
      toolName: 'CobbAngle', points: skew, FrameOfReferenceUID: '2.25.7001', isLocked: true, data: { rAngle: 90 },
      metadata: { outOfPlane: true, isLocked: true, isReadOnly: true, views: [] },
    }));
    const annotation = mirror('skew-1');
    expect(annotation.metadata.toolName).toBe('SonadorNonPlanarCobbAngle');
    expect(annotation.metadata.viewPlaneNormal).toBeUndefined();
    expect(annotation.data.handles.points).toEqual(skew);
    expect(annotation.data.recordValue).toEqual({ value: 90, points: skew });
    expect(mockLocked.has(annotationUIDFor('skew-1'))).toBe(true);
  });

  // A held circle read from an ELLIPSE on the coronal plane y = 20, without a Drawing-Plane
  const heldCircle = (id, sourceGeometry) => service.addRawMeasurement(outOfPlaneSource, 'CircleROI', { id }, () => ({
    toolName: 'CircleROI', points: [[10, 20, 30], [15, 20, 30]], FrameOfReferenceUID: '2.25.7001', isLocked: true,
    data: { cachedStats: { radius: 5, area: 25 * Math.PI, perimeter: 10 * Math.PI } },
    metadata: { outOfPlane: true, isLocked: true, isReadOnly: true, views: ['coronal'], sourceGeometry },
  }));

  it('draws a held circle in the plane of the ELLIPSE it was read from, not a plane chosen for its center and edge', () => {
    heldCircle('coronal-1', {
      valueType: 'SCOORD3D', graphicType: 'ELLIPSE', graphicData: [5, 20, 30, 15, 20, 30, 10, 20, 25, 10, 20, 35],
      FrameOfReferenceUID: '2.25.7001',
    });
    const annotation = mirror('coronal-1');
    expect(annotation.metadata.toolName).toBe('CircleROI');
    expect(annotation.metadata.viewPlaneNormal.map(value => Math.abs(value) + 0)).toEqual([0, 1, 0]);
    expect(annotation.metadata.planeUnknown).toBeUndefined();
    expect(annotation.data.handles.points).toEqual([[10, 20, 30], [15, 20, 30]]);
  });

  it('marks a held circle read from a stock CIRCLE SCOORD3D as having no known plane', () => {
    heldCircle('legacy-1', { valueType: 'SCOORD3D', graphicType: 'CIRCLE', graphicData: [10, 20, 30, 15, 20, 30], FrameOfReferenceUID: '2.25.7001' });
    const annotation = mirror('legacy-1');
    expect(annotation.metadata).toMatchObject({ toolName: 'CircleROI', planeUnknown: true });
  });

  it('is removed with its annotation, either way', async () => {
    await drawn('Length', [[12, 0, 0], [12, 30, -40]]);
    const [{ uid }] = records();
    mockAnnotations.get(annotationUIDFor(uid)) && jest.requireMock('@cornerstonejs/tools').annotation.state.removeAnnotation(annotationUIDFor(uid));
    expect(service.remove).toHaveBeenCalledWith(uid);
  });
});



describe('circles', () => {
  const circle = (uid = 'circle-1') => ({
    uid,
    toolName: 'CircleRoi',
    source: classicSource,
    referencedImageId: 'wadors:image',
    FrameOfReferenceUID: '2.25.7001',
    points: [{ x: 0.5, y: 0.5 }, { x: 3.5, y: 4.5 }],
    data: {
      cachedStats: { radius: 5, area: 25 * Math.PI, perimeter: 10 * Math.PI },
      handles: { start: { x: 0.5, y: 0.5 }, end: { x: 3.5, y: 4.5 }, textBox: {} },
    },
    metadata: { TrackingUniqueIdentifier: '2.25.8200' },
  });

  it('mirror the classic CircleRoi as a Cornerstone3D CircleROI, center first, with its values', () => {
    service.add(circle());

    expect(mirror('circle-1').metadata.toolName).toBe('CircleROI');
    expect(mirror('circle-1').data.handles.points).toEqual([[0, 0, 0], [3, 4, 0]]);
    expect(mirror('circle-1').data.recordValue).toEqual({
      values: { radius: 5, area: 25 * Math.PI, perimeter: 10 * Math.PI }, points: [[0, 0, 0], [3, 4, 0]],
    });
  });

  it('carry an edit in a Cornerstone3D view to the classic handles and values', () => {
    service.add(circle());
    const annotation = mirror('circle-1');
    annotation.data.handles.points[1] = [6, 8, 0];
    mockListeners.ANNOTATION_MODIFIED({ detail: { annotation } });

    expect(service.update).toHaveBeenCalledTimes(1);
    const [, measurement] = service.update.mock.calls[0];
    expect(measurement.toolName).toBe('CircleRoi');
    expect(measurement.data.handles.end).toEqual({ x: 6.5, y: 8.5 });
    expect(measurement.data.cachedStats.radius).toBeCloseTo(10, 9);
    expect(measurement.data.cachedStats.area).toBeCloseTo(100 * Math.PI, 9);
    expect(measurement.metadata.TrackingUniqueIdentifier).toBe('2.25.8200');
  });

  it('draw nothing for an update whose measurement carries no uid', () => {
    const { uid, ...withoutUid } = circle();
    service.publish('updated', { source: classicSource, measurement: withoutUid });
    expect(mockAnnotations.size).toBe(0);
    expect(mockAnnotations.has(annotationUIDFor(undefined))).toBe(false);
  });

  it('move their annotation when the classic circle is edited', () => {
    service.add(circle());
    const edited = circle();
    edited.data.handles.end = { x: 6.5, y: 8.5 };
    service.publish('updated', { source: classicSource, measurement: edited });

    expect(mirror('circle-1').data.handles.points[1]).toEqual([6, 8, 0]);
  });
});
