// The routing wrapper: the classic read-only parser runs ahead of the classic route only. The
// Cornerstone3D route displays what it does not hydrate itself, after hydration. A document with a
// timepoint is supported by the Cornerstone3D route only: the classic route does not hydrate it.

let mockDataset = {};
jest.mock('dcmjs', () => ({ data: { DicomMetaDictionary: { naturalizeDataset: () => mockDataset } } }), { virtual: true });
jest.mock('../utils/dicomCharacterSet', () => ({ readDicomFile: () => ({ dict: {} }) }));
let mockTimepoint = null;
jest.mock('./utils/timepoint', () => ({ timepointOf: () => mockTimepoint }));
jest.mock('cornerstone-core', () => ({}), { virtual: true });
jest.mock('@cornerstonejs/core', () => ({ utilities: {}, metaData: {} }), { virtual: true });
jest.mock('@cornerstonejs/adapters', () => ({ adaptersSR: {} }), { virtual: true });
jest.mock('../services/DicomMetadataStore', () => ({ DicomMetadataStore: {} }));
jest.mock('../store', () => ({ fileLoader: {} }));
jest.mock('../measurements/lib/getImagePath', () => ({ __esModule: true, default: () => '' }));
jest.mock('../measurements/classes/MeasurementApi', () => ({
  __esModule: true, default: { Instance: { measurementService: {} } },
}));
jest.mock('../measurements/enums', () => {
  const Enums = {
    Cornerstone: { sr: { name: 'CornerstoneTools', version: '4' } },
    Cornerstone3D: { sr: { name: 'Cornerstone3DTools-Sonador', version: '0.1' } },
  };
  return { __esModule: true, default: Enums };
});
jest.mock('./utils/initDisplaySetMeasurements', () => ({ __esModule: true, default: () => ({}) }));
jest.mock('./utils/findInstanceMetadataBySopInstanceUid', () => ({ __esModule: true, default: () => undefined }));
jest.mock('./utils/srDocument', () => ({ currentSession: () => 1 }));

const mockCalls = [];
jest.mock('./SCOORD3D/parseSCOORD3D', () => ({ __esModule: true, default: () => mockCalls.push('classic-read-only') }));
jest.mock('./Cornerstone3d', () => ({
  Cornerstone3D: { parseDicomStructuredReport: async () => mockCalls.push('cornerstone3d') },
}));
jest.mock('./SCOORD3D', () => ({
  Cornerstone: { parseDicomStructuredReport: async () => mockCalls.push('classic') },
}));

import parseDicomStructuredReport from './parseDicomStructuredReport';

const external = { servicesManager: { services: { displaySetService: {}, LoggerService: { error: jest.fn(), info: jest.fn() } } } };

beforeEach(() => {
  mockCalls.length = 0;
  mockTimepoint = null;
  external.servicesManager.services.LoggerService.info.mockClear();
});


describe('parseDicomStructuredReport routing', () => {
  it('runs no classic read-only pass ahead of the Cornerstone3D route (the default)', async () => {
    await parseDicomStructuredReport(new ArrayBuffer(0), [], external);
    expect(mockCalls).toEqual(['cornerstone3d']);
  });

  it('keeps the classic read-only pass ahead of the classic route', async () => {
    await parseDicomStructuredReport(new ArrayBuffer(0), [], external, {
      parserModule: { name: 'CornerstoneTools', version: '4' },
    });
    expect(mockCalls).toEqual(['classic-read-only', 'classic']);
  });

  it('does not hydrate a document with a timepoint on the classic route, and says so', async () => {
    mockTimepoint = { uid: '2.25.7' };
    const result = await parseDicomStructuredReport(new ArrayBuffer(0), [], external, {
      parserModule: { name: 'CornerstoneTools', version: '4' },
    });
    expect(result).toBeUndefined();
    expect(mockCalls).toEqual([]);
    expect(external.servicesManager.services.LoggerService.info).toHaveBeenCalledWith(expect.objectContaining({ title: 'Report not loaded', notify: true }));
  });

  it('leaves a document with a timepoint to the Cornerstone3D route', async () => {
    mockTimepoint = { uid: '2.25.7' };
    await parseDicomStructuredReport(new ArrayBuffer(0), [], external);
    expect(mockCalls).toEqual(['cornerstone3d']);
  });
});
