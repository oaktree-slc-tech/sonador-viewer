// The read-only pass after Cornerstone3D hydration: a hydrated measurement is never shown again;
// the others are placed on the image they reference, or for SCOORD3D content on the image plane
// that holds them, and patient content in no image plane goes to the Cornerstone3D viewports only.

jest.mock('@cornerstonejs/core', () => ({ metaData: { get: () => undefined } }), { virtual: true });
const mockInfo = jest.fn();
jest.mock('../../log', () => ({ __esModule: true, default: { info: (...args) => mockInfo(...args), warn: () => {}, error: () => {} } }));

const mockHydrated = new Set();
const mockApi = {
  getMeasurementByTrackingUid: uid => (mockHydrated.has(uid) ? { uid } : undefined),
  syncMeasurementsAndToolData: jest.fn(),
};
jest.mock('../../measurements/classes/MeasurementApi', () => ({
  __esModule: true, default: { get Instance() { return mockApi; } },
}));

const mockPlaced = [];
const mockListed = new Map();
const mockFailing = new Set();
jest.mock('../SCOORD3D/utils/addMeasurement', () => ({
  __esModule: true,
  default: (measurement, imageId, instance, displaySetInstanceUID, options = {}) => {
    if (mockFailing.has(measurement.TrackingUniqueIdentifier)) {
      throw new Error('measurement not added');
    }
    measurement.loaded = true;
    mockPlaced.push({ uid: measurement.TrackingUniqueIdentifier, imageId, SOPInstanceUID: instance.SOPInstanceUID, displaySetInstanceUID });
    mockListed.set(measurement.TrackingUniqueIdentifier, options.listed !== false);
  },
}));

const mockPatientOnly = [];
jest.mock('./srDisplayAnnotations', () => ({
  addSRDisplayAnnotation: ({ measurement }) => {
    const drawable = (measurement.coords || []).some(coord => coord.GraphicType);
    if (drawable) {
      mockPatientOnly.push(measurement.TrackingUniqueIdentifier);
    }
    return drawable ? {} : null;
  },
  renderSRDisplayAnnotations: jest.fn(),
}));

import addReadOnlyMeasurements from './addReadOnlyMeasurements';

// Sagittal slices at x = 0 and 2 mm
const image = (SOPInstanceUID, x) => ({
  getData: () => ({
    metadata: {
      SOPInstanceUID, SOPClassUID: '1.2.840.10008.5.1.4.1.1.2', FrameOfReferenceUID: '2.25.1',
      ImagePositionPatient: [x, -100, 100], ImageOrientationPatient: [0, 1, 0, 0, 0, -1], PixelSpacing: [1, 1],
    },
  }),
});
const imageDisplaySet = () => ({
  displaySetInstanceUID: 'ds-ct', SRLabels: [], images: [image('2.25.10', 0), image('2.25.12', 2)],
});
const imageIds = {
  sopInstanceUIDToImageId: { '2.25.10': 'wadors:10', '2.25.12': 'wadors:12' },
  imageIdsForToolState: { '2.25.10': [undefined, 'wadors:10'], '2.25.12': [undefined, 'wadors:12'] },
};

const angleOnImage = {
  TrackingUniqueIdentifier: '2.25.500', labels: [{ label: 'Angle', value: '45 deg' }],
  coords: [{ ValueType: 'SCOORD', GraphicType: 'POLYLINE', GraphicData: [1, 1, 5, 5, 9, 1],
    ReferencedSOPSequence: { ReferencedSOPInstanceUID: '2.25.12' } }],
};
const hydratedLength = {
  TrackingUniqueIdentifier: '2.25.501',
  coords: [{ ValueType: 'SCOORD', GraphicType: 'POLYLINE', GraphicData: [1, 1, 5, 5],
    ReferencedSOPSequence: { ReferencedSOPInstanceUID: '2.25.12' } }],
};
const lengthInSagittalPlane = () => ({
  TrackingUniqueIdentifier: '2.25.502',
  coords: [{ ValueType: 'SCOORD3D', GraphicType: 'POLYLINE', GraphicData: [2, -40, 60, 2, 10, -30],
    ReferencedFrameOfReferenceSequence: '2.25.1' }],
});
const lengthAcrossPlanes = {
  TrackingUniqueIdentifier: '2.25.503',
  coords: [{ ValueType: 'SCOORD3D', GraphicType: 'POLYLINE', GraphicData: [0, 0, 0, 2, 10, 10],
    ReferencedFrameOfReferenceSequence: '2.25.1' }],
};
const finding = {
  TrackingUniqueIdentifier: '2.25.504', labels: [{ label: 'CORNERSTONEFREETEXT', value: 'Lesion' }],
  coords: [{ ReferencedSOPSequence: [{ ReferencedSOPInstanceUID: '2.25.10' }] }],
};

beforeEach(() => {
  mockInfo.mockClear();
  mockListed.clear();
  mockHydrated.clear();
  mockPlaced.length = 0;
  mockPatientOnly.length = 0;
});


describe('addReadOnlyMeasurements', () => {
  it('skips hydrated measurements and places the others on the image they reference', () => {
    mockHydrated.add('2.25.501');
    const srDisplaySet = { measurements: [angleOnImage, hydratedLength], referencedDisplaySets: [] };
    const ct = imageDisplaySet();

    const summary = addReadOnlyMeasurements({ srDisplaySets: [srDisplaySet], imageDisplaySets: [ct], imageIds });

    expect(mockPlaced).toEqual([{ uid: '2.25.500', imageId: 'wadors:12', SOPInstanceUID: '2.25.12', displaySetInstanceUID: 'ds-ct' }]);
    expect(srDisplaySet.referencedDisplaySets).toEqual([ct]);
    expect(summary).toEqual({ placed: 1, patientOnly: 0, skipped: 0 });
    expect(mockApi.syncMeasurementsAndToolData).toHaveBeenCalled();
  });

  it('places SCOORD3D content on the image plane that holds it, along the plane normal', () => {
    const measurement = lengthInSagittalPlane();
    addReadOnlyMeasurements({ srDisplaySets: [{ measurements: [measurement] }], imageDisplaySets: [imageDisplaySet()], imageIds });

    expect(mockPlaced).toEqual([expect.objectContaining({ uid: '2.25.502', SOPInstanceUID: '2.25.12' })]);
    expect(measurement.coords[0].ReferencedSOPSequence).toMatchObject({ ReferencedSOPInstanceUID: '2.25.12' });
  });

  it('draws patient content in no image plane in the Cornerstone3D viewports only', () => {
    const summary = addReadOnlyMeasurements({
      srDisplaySets: [{ measurements: [lengthAcrossPlanes] }], imageDisplaySets: [imageDisplaySet()], imageIds,
    });
    expect(mockPlaced).toEqual([]);
    expect(mockPatientOnly).toEqual(['2.25.503']);
    expect(summary).toEqual({ placed: 0, patientOnly: 1, skipped: 0 });
  });

  it('lists a finding without a graphic as overlay text on its image', () => {
    const ct = imageDisplaySet();
    addReadOnlyMeasurements({ srDisplaySets: [{ measurements: [{ ...finding }] }], imageDisplaySets: [ct], imageIds });

    expect(ct.SRLabels).toEqual([{
      ReferencedSOPInstanceUID: '2.25.10',
      labels: expect.objectContaining({ label: 'CORNERSTONEFREETEXT', value: 'Lesion', visible: true }),
    }]);
    expect(ct.SRLabels[0].labels.color).toMatch(/^hsla\(\d+, 70%, 30%, 1\)$/);
    expect(mockPlaced).toEqual([expect.objectContaining({ uid: '2.25.504', imageId: 'wadors:10' })]);
  });

  it('skips a measurement that fails to be added, and still adds the others', () => {
    mockFailing.add('2.25.500');
    try {
      const other = { ...angleOnImage, TrackingUniqueIdentifier: '2.25.510' };
      const summary = addReadOnlyMeasurements({
        srDisplaySets: [{ measurements: [angleOnImage, other], referencedDisplaySets: [] }], imageDisplaySets: [imageDisplaySet()], imageIds,
      });
      expect(mockPlaced.map(placed => placed.uid)).toEqual(['2.25.510']);
      expect(summary).toEqual({ placed: 1, patientOnly: 0, skipped: 1 });
      expect(mockApi.syncMeasurementsAndToolData).toHaveBeenCalled();
    } finally {
      mockFailing.clear();
    }
  });

  it('skips a measurement whose image the study does not hold', () => {
    const elsewhere = { ...angleOnImage, coords: [{ ...angleOnImage.coords[0], ReferencedSOPSequence: { ReferencedSOPInstanceUID: '2.25.99' } }] };
    const summary = addReadOnlyMeasurements({ srDisplaySets: [{ measurements: [elsewhere] }], imageDisplaySets: [imageDisplaySet()], imageIds });
    expect(mockPlaced).toEqual([]);
    expect(summary.placed).toBe(0);
  });
});


describe('Frame of Reference', () => {
  it('falls back to the Cornerstone3D viewports when only unknown-frame images hold the points', () => {
    const unknownFrame = (SOPInstanceUID, x) => ({
      getData: () => ({ metadata: {
        SOPInstanceUID, ImagePositionPatient: [x, -100, 100], ImageOrientationPatient: [0, 1, 0, 0, 0, -1], PixelSpacing: [1, 1],
      } }),
    });
    const ct = { displaySetInstanceUID: 'ds-ct', SRLabels: [], images: [unknownFrame('2.25.10', 0), unknownFrame('2.25.12', 2)] };

    const summary = addReadOnlyMeasurements({
      srDisplaySets: [{ measurements: [lengthInSagittalPlane()] }], imageDisplaySets: [ct], imageIds,
    });
    expect(mockPlaced).toEqual([]);
    expect(mockPatientOnly).toEqual(['2.25.502']);
    expect(summary).toEqual({ placed: 0, patientOnly: 1, skipped: 0 });
  });
});


describe('an application document', () => {
  const tracked = (tool, measurement) => ({ ...measurement, TrackingIdentifier: `cornerstoneTools@^4.0.0:${tool}` });
  const foreign = {
    TrackingUniqueIdentifier: '2.25.600', TrackingIdentifier: 'Planner landmark',
    coords: [{ ValueType: 'SCOORD3D', GraphicType: 'POINT', GraphicData: [2, 0, 0], ReferencedFrameOfReferenceSequence: '2.25.1' }],
  };
  const patientCircle = tracked('CircleROI', {
    TrackingUniqueIdentifier: '2.25.601',
    coords: [{ ValueType: 'SCOORD3D', GraphicType: 'CIRCLE', GraphicData: [2, 0, 0, 2, 5, 0], ReferencedFrameOfReferenceSequence: '2.25.1' }],
  });
  const application = measurements => ({ SOPInstanceUID: '2.25.900', isApplicationDocument: true, measurements, referencedDisplaySets: [] });

  it('draws only groups with a Cornerstone tracking identifier and a graphic type the read-only layer draws', () => {
    const summary = addReadOnlyMeasurements({
      srDisplaySets: [application([
        tracked('Angle', angleOnImage), { ...tracked('Length', lengthInSagittalPlane()), TrackingIdentifier: 'Cornerstone3DTools@^0.1.0:Length' },
        tracked('Length', lengthAcrossPlanes), foreign, patientCircle,
      ])],
      imageDisplaySets: [imageDisplaySet()], imageIds,
    });

    expect(mockPlaced.map(p => p.uid)).toEqual(['2.25.500', '2.25.502']);
    expect(mockPatientOnly).toEqual(['2.25.503']);
    expect(summary).toEqual({ placed: 2, patientOnly: 1, skipped: 0 });
  });

  it('draws its measurements in the viewports without listing them in the Measurements panel', () => {
    addReadOnlyMeasurements({ srDisplaySets: [application([tracked('Angle', angleOnImage)])], imageDisplaySets: [imageDisplaySet()], imageIds });
    expect(mockListed.get('2.25.500')).toBe(false);

    // An exchange document's read-only measurements are listed, as before
    addReadOnlyMeasurements({ srDisplaySets: [{ measurements: [{ ...angleOnImage, TrackingUniqueIdentifier: '2.25.510' }], referencedDisplaySets: [] }],
      imageDisplaySets: [imageDisplaySet()], imageIds });
    expect(mockListed.get('2.25.510')).toBe(true);
  });

  it('names the groups drawn and the groups ignored in one log line per document', () => {
    addReadOnlyMeasurements({ srDisplaySets: [application([tracked('Angle', angleOnImage), foreign, patientCircle])],
      imageDisplaySets: [imageDisplaySet()], imageIds });
    const lines = mockInfo.mock.calls.filter(([message]) => /application document 2\.25\.900/.test(message));
    expect(lines).toHaveLength(1);
    const [, drawn, , ignored] = lines[0];
    expect(drawn).toEqual(['cornerstoneTools@^4.0.0:Angle 2.25.500']);
    expect(ignored).toEqual([
      'Planner landmark 2.25.600: not a Cornerstone tracking identifier',
      'cornerstoneTools@^4.0.0:CircleROI 2.25.601: SCOORD3D CIRCLE is not drawn',
    ]);
  });

  it('labels a measurement with its description when it has one, else with its value', () => {
    const described = { ...tracked('Angle', angleOnImage), description: 'Tibial slope' };
    addReadOnlyMeasurements({ srDisplaySets: [application([described])], imageDisplaySets: [imageDisplaySet()], imageIds });
    expect(described.labels).toEqual([{ label: 'Tibial slope', value: '' }]);

    const plain = { ...tracked('Angle', angleOnImage), TrackingUniqueIdentifier: '2.25.520' };
    addReadOnlyMeasurements({ srDisplaySets: [application([plain])], imageDisplaySets: [imageDisplaySet()], imageIds });
    expect(plain.labels).toEqual([{ label: 'Angle', value: '45 deg' }]);
  });

  it('labels a circle without a description with its radius only', () => {
    const circle = {
      ...tracked('CircleROI', angleOnImage), TrackingUniqueIdentifier: '2.25.530',
      labels: [{ label: 'Area', value: '452.39 mm2' }, { label: 'Perimeter', value: '75.4 mm' }, { label: 'Radius', value: '12 mm' }],
    };
    addReadOnlyMeasurements({ srDisplaySets: [application([circle])], imageDisplaySets: [imageDisplaySet()], imageIds });
    expect(circle.labels).toEqual([{ label: 'Radius', value: '12 mm' }]);
  });

  it('draws both axes of a Bidirectional, labelled with its description, else with its NUMs in document order', () => {
    const bidirectional = () => tracked('Bidirectional', {
      TrackingUniqueIdentifier: '2.25.540',
      labels: [{ label: 'Long Axis', value: '24 mm' }, { label: 'Short Axis', value: '8 mm' }],
      coords: [[1, 1, 9, 9], [7, 3, 3, 7]].map(GraphicData => ({
        ValueType: 'SCOORD', GraphicType: 'POLYLINE', GraphicData, ReferencedSOPSequence: { ReferencedSOPInstanceUID: '2.25.12' },
      })),
    });
    const plain = bidirectional();
    const summary = addReadOnlyMeasurements({ srDisplaySets: [application([plain])], imageDisplaySets: [imageDisplaySet()], imageIds });
    expect(summary.placed).toBe(1);
    expect(plain.coords).toHaveLength(2);
    // The long axis first (the read-only tool draws them "L 24 mm", "W 8 mm")
    expect(plain.labels).toEqual([{ label: 'Long Axis', value: '24 mm' }, { label: 'Short Axis', value: '8 mm' }]);

    const described = { ...bidirectional(), TrackingUniqueIdentifier: '2.25.541', description: 'Lesion axes' };
    addReadOnlyMeasurements({ srDisplaySets: [application([described])], imageDisplaySets: [imageDisplaySet()], imageIds });
    expect(described.labels).toEqual([{ label: 'Lesion axes', value: '' }]);
  });

  it('leaves an exchange document unfiltered', () => {
    const summary = addReadOnlyMeasurements({ srDisplaySets: [{ measurements: [foreign], referencedDisplaySets: [] }],
      imageDisplaySets: [imageDisplaySet()], imageIds });
    expect(summary.placed + summary.patientOnly).toBe(1);
  });
});

