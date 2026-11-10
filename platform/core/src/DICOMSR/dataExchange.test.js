// A save reports its outcome only once the report is stored: full, partial (with the measurements
// left out), or failed.

const mockStow = jest.fn();
jest.mock('./handleStructuredReport', () => ({
  retrieveMeasurementFromSR: () => {},
  stowSRFromMeasurements: (...args) => mockStow(...args),
}));
jest.mock('../log', () => ({ __esModule: true, default: { info: () => {}, warn: () => {}, error: () => {} } }));
const mockDeleteStudyMetadata = jest.fn();
jest.mock('../studies', () => ({ __esModule: true, default: { deleteStudyMetadataPromise: (...args) => mockDeleteStudyMetadata(...args) } }));
jest.mock('../utils', () => ({ __esModule: true, default: {} }));
jest.mock('../display', () => ({
  __esModule: true,
  default: {
    Enums: { EVENTS: {} },
    DisplaySetApi: { Instance: { displaySetService: { triggerApiEvent: () => {} } } },
  },
}));
const mockService = { getMeasurement: jest.fn(), update: jest.fn() };
jest.mock('../measurements', () => ({
  __esModule: true,
  default: { MeasurementApi: { get Instance() { return { measurementService: mockService }; } } },
}));
const mockSession = { value: 7 };
jest.mock('./utils/srDocument', () => ({ currentSession: () => mockSession.value }));
jest.mock('./Cornerstone3d/utils/findMostRecentStructuredReport', () => ({ __esModule: true, default: () => {} }));
jest.mock('./Cornerstone3d/utils/findStructuredReports', () => ({ __esModule: true, default: () => [] }));

import { storeMeasurements } from './dataExchange';

const server = { type: 'dicomWeb', wadoRoot: 'https://dicomweb', name: 'Sonador' };
const measurementData = { allTools: [{ StudyInstanceUID: '2.25.1001' }] };

it('reports a full save after the upload', async () => {
  mockStow.mockResolvedValueOnce({ omitted: [] });
  await expect(storeMeasurements(measurementData, undefined, server)).resolves.toMatchObject({
    title: 'Measurements saved successfully', type: 'success',
  });
});

it('reports the measurements a stored report left out', async () => {
  mockStow.mockResolvedValueOnce({ omitted: [{ toolType: 'CobbAngle', label: '', reason: 'degenerate' }], saved: 1, uploaded: true });
  const result = await storeMeasurements(measurementData, undefined, server);
  expect(result).toMatchObject({ title: 'Measurements partly saved', type: 'warning' });
  expect(result.message).toContain('One measurement was not saved. Cobb angle: move its endpoints apart');
});

it('claims nothing when the upload fails', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockStow.mockRejectedValueOnce(new Error('503'));
  await expect(storeMeasurements(measurementData, undefined, server)).rejects.toThrow('Error while saving the measurements.');
});


it('reports no save, and keeps the study metadata, when every measurement was left out', async () => {
  mockDeleteStudyMetadata.mockClear();
  mockStow.mockResolvedValueOnce({ omitted: [{ toolType: 'CobbAngle', label: '', reason: 'degenerate' }], saved: 0, uploaded: false });
  const result = await storeMeasurements(measurementData, undefined, server);
  expect(result).toMatchObject({ title: 'Measurements not saved', type: 'error', saved: 0 });
  expect(mockDeleteStudyMetadata).not.toHaveBeenCalled();
});


describe('the measurements a stored report holds', () => {
  const { measurementVersion } = jest.requireActual('./utils/saveResult');
  const stored = { uid: 'angle-uid', toolName: 'CobbAngle', points: [{ x: 1, y: 2 }], metadata: { TrackingUniqueIdentifier: '2.25.8100' } };
  const versionIn = session => measurementVersion(stored, undefined, session);

  beforeEach(() => {
    mockService.update.mockClear();
    mockService.getMeasurement.mockReset().mockImplementation(uid => (uid === 'angle-uid' ? stored : undefined));
  });

  it('are locked and read-only once the report is uploaded, as they were written, through the service', async () => {
    mockStow.mockResolvedValueOnce({ omitted: [], saved: 1, written: [versionIn(mockSession.value), { ...versionIn(mockSession.value), uid: 'gone' }], uploaded: true });
    await storeMeasurements(measurementData, undefined, server);
    expect(mockService.update).toHaveBeenCalledTimes(1);
    const [uid, measurement, notYetUpdatedAtSource] = mockService.update.mock.calls[0];
    expect(uid).toBe('angle-uid');
    expect(measurement).toMatchObject({
      isLocked: true, isDirty: false, metadata: { isReadOnly: true, isLocked: true, TrackingUniqueIdentifier: '2.25.8100' },
    });
    expect(notYetUpdatedAtSource).toBe(true);
  });

  it('stay pending when edited during the upload', async () => {
    const encoded = versionIn(mockSession.value);
    mockService.getMeasurement.mockImplementation(() => ({ ...stored, points: [{ x: 1, y: 3 }] }));
    mockStow.mockResolvedValueOnce({ omitted: [], saved: 1, written: [encoded], uploaded: true });
    await storeMeasurements(measurementData, undefined, server);
    expect(mockService.update).not.toHaveBeenCalled();
  });

  it('are not locked when the session ended while the report was uploading', async () => {
    const encoded = versionIn(mockSession.value);
    mockStow.mockImplementationOnce(async () => {
      mockSession.value += 1;
      return { omitted: [], saved: 1, written: [encoded], uploaded: true };
    });
    await storeMeasurements(measurementData, undefined, server);
    expect(mockService.update).not.toHaveBeenCalled();
  });

  it('stay pending when nothing was uploaded or the upload fails', async () => {
    mockStow.mockResolvedValueOnce({ omitted: [{ toolType: 'CobbAngle', label: '', reason: 'degenerate' }], saved: 0, uploaded: false });
    await storeMeasurements(measurementData, undefined, server);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockStow.mockRejectedValueOnce(new Error('503'));
    await expect(storeMeasurements(measurementData, undefined, server)).rejects.toThrow();
    expect(mockService.update).not.toHaveBeenCalled();
  });
});
