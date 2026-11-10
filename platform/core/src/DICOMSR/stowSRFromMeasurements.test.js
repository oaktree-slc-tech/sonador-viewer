// A save uploads a report only when it holds at least one measurement; the measurements left out
// and the number written reach the save result.

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
jest.mock('../services/LocalCacheService/LocalCacheService', () => ({ __esModule: true, default: {} }));
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
