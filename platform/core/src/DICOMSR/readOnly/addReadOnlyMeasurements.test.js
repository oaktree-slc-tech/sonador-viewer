// The read-only pass after Cornerstone3D hydration: a hydrated measurement is never shown again;
// the others are placed on the image they reference, or for SCOORD3D content on the image plane
// that holds them, and patient content in no image plane goes to the Cornerstone3D viewports only.

jest.mock('@cornerstonejs/core', () => ({ metaData: { get: () => undefined } }), { virtual: true });
jest.mock('../../log', () => ({ __esModule: true, default: { info: () => {}, warn: () => {}, error: () => {} } }));

const mockHydrated = new Set();
const mockApi = {
  getMeasurementByTrackingUid: uid => (mockHydrated.has(uid) ? { uid } : undefined),
  syncMeasurementsAndToolData: jest.fn(),
};
jest.mock('../../measurements/classes/MeasurementApi', () => ({
  __esModule: true, default: { get Instance() { return mockApi; } },
}));

const mockPlaced = [];
jest.mock('../SCOORD3D/utils/addMeasurement', () => ({
  __esModule: true,
  default: (measurement, imageId, instance, displaySetInstanceUID) => {
    measurement.loaded = true;
    mockPlaced.push({ uid: measurement.TrackingUniqueIdentifier, imageId, SOPInstanceUID: instance.SOPInstanceUID, displaySetInstanceUID });
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
