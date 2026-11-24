// A save uploads a report only when it holds at least one measurement; the measurements left out
// and the number written reach the save result. A report the server has stored joins the offline
// copy of its study, so a later cached open of the study presents it.

const mockStoreInstances = jest.fn(() => Promise.resolve());
const mockLocalCreate = jest.fn();
const mockParse = jest.fn();
jest.mock('dicomweb-client', () => ({
  api: { DICOMwebClient: class { storeInstances(...args) { return mockStoreInstances(...args); } } },
}), { virtual: true });
jest.mock('./parseMeasurementsData', () => ({ __esModule: true, default: (...args) => mockParse(...args) }));
jest.mock('./parseDicomStructuredReport', () => ({ __esModule: true, default: () => {} }));
jest.mock('./Cornerstone3d/utils/getAllDisplaySets', () => ({ __esModule: true, default: () => [] }));
jest.mock('../services/DicomMetadataStore', () => ({ __esModule: true, default: {} }));
jest.mock('../utils', () => ({ __esModule: true, default: {} }));
jest.mock('../measurements', () => ({ __esModule: true, default: { MeasurementApi: { Instance: {} } } }));
jest.mock('../display', () => ({
  __esModule: true,
  default: {
    Enums: { EVENTS: { DCM_LOCAL_CREATE: 'create' } },
    DisplaySetApi: { Instance: { displaySetService: { triggerApiEvent: (...args) => mockLocalCreate(...args) } } },
  },
}));
jest.mock('../DICOMWeb', () => ({ __esModule: true, default: { getAuthorizationHeader: () => ({}) } }));
jest.mock('../errorHandler', () => ({ __esModule: true, default: { getHTTPErrorHandler: () => () => {} } }));
// The offline cache as the save sees it; a study is cached only when a test says so. The real
// cache's lifecycle (downloads, clears) is covered in LocalCacheService/viewerAdditions.test.js
const mockCache = {
  isStudyCachedSync: jest.fn(() => false),
  cacheViewerInstance: jest.fn(() => Promise.resolve(true)),
};
jest.mock('../services/LocalCacheService/LocalCacheService', () => ({
  __esModule: true,
  get default() { return mockCache; },
}));
jest.mock('../utils/dicomPart10', () => ({ isUsablePart10: () => false }));
jest.mock('../utils/xhrRetryRequestHook', () => ({ __esModule: true, default: () => () => {} }));
// The unconfirmed-report registry as srDocument.js keeps it
jest.mock('./utils/srDocument', () => {
  const unconfirmed = new Set();
  return {
    currentSession: () => 0,
    markReportUnconfirmed: uid => unconfirmed.add(uid),
    confirmReport: uid => unconfirmed.delete(uid),
    isUnconfirmedReport: uid => unconfirmed.has(uid),
  };
});

import { stowSRFromMeasurements } from './handleStructuredReport';
import { isUnconfirmedReport } from './utils/srDocument';

const DATASET = {
  SOPClassUID: '1.2.840.10008.5.1.4.1.1.88.34', SOPInstanceUID: '2.25.1',
  _meta: { FileMetaInformationVersion: { Value: [new Uint8Array([0, 1]).buffer] } },
};
const omission = { toolType: 'CobbAngle', label: '', reason: 'degenerate' };

beforeEach(() => mockStoreInstances.mockClear());

it('uploads nothing when every measurement was left out', async () => {
  mockParse.mockReturnValueOnce({ dataset: DATASET, omitted: [omission], saved: 0 });
  await expect(stowSRFromMeasurements({}, 'https://dicomweb')).resolves
    .toEqual({ omitted: [omission], saved: 0, uploaded: false });
  expect(mockStoreInstances).not.toHaveBeenCalled();
});

it('uploads a report holding at least one measurement and returns what it left out', async () => {
  mockParse.mockReturnValueOnce({ dataset: DATASET, omitted: [omission], saved: 1, written: [{ uid: 'angle-uid' }] });
  await expect(stowSRFromMeasurements({}, 'https://dicomweb')).resolves
    .toEqual({ omitted: [omission], saved: 1, written: [{ uid: 'angle-uid' }], uploaded: true });
  expect(mockStoreInstances).toHaveBeenCalledTimes(1);
});


describe('the report shown before its upload completes', () => {
  beforeEach(() => mockLocalCreate.mockReset());

  it('is unconfirmed while it is shown and uploading, and confirmed once stored', async () => {
    const seen = [];
    mockLocalCreate.mockImplementation(() => seen.push(['shown', isUnconfirmedReport('2.25.11')]));
    mockStoreInstances.mockImplementationOnce(() => { seen.push(['uploading', isUnconfirmedReport('2.25.11')]); return Promise.resolve(); });
    mockParse.mockReturnValueOnce({ dataset: { ...DATASET, SOPInstanceUID: '2.25.11' }, omitted: [], saved: 1, written: [] });

    await stowSRFromMeasurements({}, 'https://dicomweb');
    expect(seen).toEqual([['shown', true], ['uploading', true]]);
    expect(isUnconfirmedReport('2.25.11')).toBe(false);
  });

  it('stays unconfirmed when the upload fails, so its measurements stay editable for a retry', async () => {
    mockStoreInstances.mockImplementationOnce(() => Promise.reject(new Error('503')));
    mockParse.mockReturnValueOnce({ dataset: { ...DATASET, SOPInstanceUID: '2.25.12' }, omitted: [], saved: 1, written: [] });

    await expect(stowSRFromMeasurements({}, 'https://dicomweb')).rejects.toThrow('503');
    expect(isUnconfirmedReport('2.25.12')).toBe(true);
  });
});


describe('the offline copy of the stored report\'s study', () => {
  const STUDY = '2.25.100';
  const SERIES = '2.25.101';
  const REPORT = {
    ...DATASET,
    SOPInstanceUID: '2.25.102',
    StudyInstanceUID: STUDY,
    SeriesInstanceUID: SERIES,
    Modality: 'SR',
    SeriesNumber: 9001,
  };

  beforeEach(() => {
    Object.values(mockCache).forEach(fn => fn.mockClear());
    mockCache.isStudyCachedSync.mockImplementation(uid => uid === STUDY);
    mockParse.mockReturnValue({ dataset: REPORT, omitted: [], saved: 1, written: [] });
  });

  afterEach(() => {
    mockCache.isStudyCachedSync.mockImplementation(() => false);
    mockParse.mockReset();
  });

  it('gains the report, bytes and metadata payload, once the server has stored it', async () => {
    const order = [];
    mockStoreInstances.mockImplementationOnce(() => { order.push('stored'); return Promise.resolve(); });
    mockCache.cacheViewerInstance.mockImplementationOnce(() => { order.push('cached'); return Promise.resolve(true); });

    await expect(stowSRFromMeasurements({}, 'https://dicomweb')).resolves.toMatchObject({ StudyInstanceUID: STUDY, uploaded: true });

    expect(order).toEqual(['stored', 'cached']);
    expect(mockCache.cacheViewerInstance).toHaveBeenCalledTimes(1);
    const { StudyInstanceUID, bytes, metadata, instance, series } = mockCache.cacheViewerInstance.mock.calls[0][0];
    expect(StudyInstanceUID).toBe(STUDY);
    expect(bytes).toBe(mockStoreInstances.mock.calls[mockStoreInstances.mock.calls.length - 1][0].datasets[0]);
    expect(metadata).toMatchObject({ SeriesInstanceUID: SERIES, SOPInstanceUID: '2.25.102' });
    expect(instance['00080018'].Value).toEqual(['2.25.102']);
    expect(instance['0020000E'].Value).toEqual([SERIES]);
    expect(series['0020000E'].Value).toEqual([SERIES]);
    expect(series['00080060'].Value).toEqual(['SR']);
    expect(series['00200011'].Value.map(Number)).toEqual([9001]);
    expect(series['00080018']).toBeUndefined();
  });

  it('is not changed when the upload fails', async () => {
    mockStoreInstances.mockImplementationOnce(() => Promise.reject(new Error('503')));
    await expect(stowSRFromMeasurements({}, 'https://dicomweb')).rejects.toThrow('503');
    expect(mockCache.cacheViewerInstance).not.toHaveBeenCalled();
  });

  it('does not fail the save when its write fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockCache.cacheViewerInstance.mockImplementationOnce(() => Promise.reject(new Error('QuotaExceededError')));
    await expect(stowSRFromMeasurements({}, 'https://dicomweb')).resolves.toMatchObject({ StudyInstanceUID: STUDY, uploaded: true });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('is not written for a study without one', async () => {
    mockCache.isStudyCachedSync.mockImplementation(() => false);
    await stowSRFromMeasurements({}, 'https://dicomweb');
    expect(mockCache.cacheViewerInstance).not.toHaveBeenCalled();
  });
});
