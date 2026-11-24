// A report the server has stored joins the offline copy of its study, so a later cached open of
// the study presents it.

const mockStoreInstances = jest.fn(() => Promise.resolve());
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
    DisplaySetApi: { Instance: { displaySetService: { triggerApiEvent: () => {} } } },
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

import { stowSRFromMeasurements } from './handleStructuredReport';

const STUDY = '2.25.100';
const SERIES = '2.25.101';
const REPORT = {
  SOPClassUID: '1.2.840.10008.5.1.4.1.1.88.34',
  SOPInstanceUID: '2.25.102',
  StudyInstanceUID: STUDY,
  SeriesInstanceUID: SERIES,
  Modality: 'SR',
  SeriesNumber: 9001,
  _meta: { FileMetaInformationVersion: { Value: [new Uint8Array([0, 1]).buffer] } },
};

beforeEach(() => {
  mockStoreInstances.mockClear();
  Object.values(mockCache).forEach(fn => fn.mockClear());
  mockCache.isStudyCachedSync.mockImplementation(uid => uid === STUDY);
  mockParse.mockReturnValue({ dataset: REPORT });
});

it('adds the report to the offline copy, bytes and metadata payload, once the server has stored it', async () => {
  const order = [];
  mockStoreInstances.mockImplementationOnce(() => { order.push('stored'); return Promise.resolve(); });
  mockCache.cacheViewerInstance.mockImplementationOnce(() => { order.push('cached'); return Promise.resolve(true); });

  await stowSRFromMeasurements({}, 'https://dicomweb');

  expect(order).toEqual(['stored', 'cached']);
  expect(mockCache.cacheViewerInstance).toHaveBeenCalledTimes(1);
  const { StudyInstanceUID, bytes, metadata, instance, series } = mockCache.cacheViewerInstance.mock.calls[0][0];
  expect(StudyInstanceUID).toBe(STUDY);
  expect(bytes).toBe(mockStoreInstances.mock.calls[0][0].datasets[0]);
  expect(metadata).toMatchObject({ SeriesInstanceUID: SERIES, SOPInstanceUID: '2.25.102' });
  expect(instance['00080018'].Value).toEqual(['2.25.102']);
  expect(instance['0020000E'].Value).toEqual([SERIES]);
  expect(series['0020000E'].Value).toEqual([SERIES]);
  expect(series['00080060'].Value).toEqual(['SR']);
  expect(series['00200011'].Value.map(Number)).toEqual([9001]);
  expect(series['00080018']).toBeUndefined();
});

it('does not cache the report when the upload fails', async () => {
  mockStoreInstances.mockImplementationOnce(() => Promise.reject(new Error('503')));
  await expect(stowSRFromMeasurements({}, 'https://dicomweb')).rejects.toThrow('503');
  expect(mockCache.cacheViewerInstance).not.toHaveBeenCalled();
});

it('completes the save when the cache write fails', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockCache.cacheViewerInstance.mockImplementationOnce(() => Promise.reject(new Error('QuotaExceededError')));
  await expect(stowSRFromMeasurements({}, 'https://dicomweb')).resolves.toEqual({ StudyInstanceUID: STUDY });
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});

it('does not cache a report for a study without an offline copy', async () => {
  mockCache.isStudyCachedSync.mockImplementation(() => false);
  await stowSRFromMeasurements({}, 'https://dicomweb');
  expect(mockCache.cacheViewerInstance).not.toHaveBeenCalled();
});
