// A report becomes a save parent only once its hydration succeeds, through the production
// retrieval, Cornerstone3D parser and report reader; nothing from a load whose measurement session
// was cleared enters the measurement service or the save parents. Application, network and loader
// services are stubbed at their boundaries.

jest.mock('@cornerstonejs/adapters', () => {
  class MeasurementReport3D {
    static codeValueMatch() {
      return false;
    }
  }
  return {
    adaptersSR: {
      Cornerstone: { MeasurementReport: class {} },
      Cornerstone3D: { CodeScheme: { CodingSchemeDesignator: 'CORNERSTONEJS', codeValues: {} }, MeasurementReport: MeasurementReport3D },
    },
    helpers: {},
  };
}, { virtual: true });
jest.mock('@cornerstonejs/core', () => ({ utilities: {}, metaData: { get: () => undefined } }), { virtual: true });
jest.mock('cornerstone-core', () => ({ metaData: { get: () => undefined } }), { virtual: true });
jest.mock('../../log', () => ({ __esModule: true, default: { info: () => {}, warn: () => {}, error: () => {} } }));
jest.mock('../../utils', () => ({ __esModule: true, dataProc: {}, default: { getImageId: instance => instance.imageId } }));
jest.mock('../../measurements/lib/getImagePath', () => ({ __esModule: true, default: () => '' }));
jest.mock('../utils/initDisplaySetMeasurements', () => ({
  __esModule: true, default: () => ({ imageDisplaySets: [], srDisplaySets: [] }),
}));
jest.mock('./initDisplaySetMeasurements', () => ({ linkMeasurementsToDisplaySets: () => {} }));
jest.mock('./utils/sopInstanceImageIds', () => ({
  buildSopInstanceImageIds: () => ({ sopInstanceUIDToImageId: { '2.25.900': 'wadors:image' }, imageIdsForToolState: { '2.25.900': [] } }),
}));

// Retrieval boundaries: the DICOMweb response is held per SOP instance until released
const mockRetrievals = {};
jest.mock('dicomweb-client', () => ({
  api: {
    DICOMwebClient: class {
      retrieveInstance({ sopInstanceUID }) {
        return (mockRetrievals[sopInstanceUID] || Promise.resolve()).then(() => sopInstanceUID);
      }
    },
  },
}), { virtual: true });
jest.mock('../../measurements', () => ({ __esModule: true, default: {} }));
jest.mock('../../display', () => ({ __esModule: true, default: {} }));
jest.mock('../../DICOMWeb', () => ({ __esModule: true, default: { getAuthorizationHeader: () => ({}) } }));
jest.mock('../../errorHandler', () => ({ __esModule: true, default: { getHTTPErrorHandler: () => () => {} } }));
jest.mock('../../services/LocalCacheService/LocalCacheService', () => ({
  __esModule: true, default: { isInstanceCachedSync: () => false, isStudyCachedSync: () => false },
}));
jest.mock('../../utils/dicomPart10', () => ({ isUsablePart10: () => false }));
jest.mock('../../utils/xhrRetryRequestHook', () => ({ __esModule: true, default: () => () => {} }));
jest.mock('./utils/getAllDisplaySets', () => ({ __esModule: true, default: () => [] }));
jest.mock('../parseMeasurementsData', () => ({ __esModule: true, default: () => ({}) }));
jest.mock('../parseDicomStructuredReport', () => ({
  // The routing wrapper hands the Cornerstone3D route its options, including the load session
  __esModule: true,
  default: (...args) => jest.requireActual('./parseDicomStructuredReport').default(...args),
}));

const mockDatasets = {};
const mockPendingLoads = {};
jest.mock('../../store', () => ({
  fileLoader: {
    Local: {
      fileToStudy: async key => {
        if (mockPendingLoads[key]) {
          await mockPendingLoads[key].promise;
        }
        return mockDatasets[key];
      },
    },
  },
}));
jest.mock('../../services/DicomMetadataStore', () => ({
  __esModule: true,
  default: { getInstanceByImageId: key => mockDatasets[key] },
  DicomMetadataStore: { getInstance: (study, series, sop) => mockDatasets[sop] },
}));

const mockImport = jest.fn(() => 'measurement-uid');
const mockMeasurementApi = {
  measurementService: { _broadcastEvent: () => {}, getMeasurement: () => ({}), EVENTS: {} },
  _serviceSourceMappings: () => ({ source: {}, mappings: [{}], mappingDefinitions: ['DICOMSRSeriesTagTool'] }),
  _serviceManagedTool: () => ({ toolServiceManaged: true, source: { annotationToMeasurement: mockImport } }),
  getMeasurementByTrackingUid: () => undefined,
  _apiSourceServiceMeasurement: () => true,
};

// Tool state the report reader returns for a report holding a finding (other reports are read by
// the production Cornerstone3D reader)
const mockToolStates = {};
jest.mock('../../measurements/classes/MeasurementApi', () => ({
  __esModule: true, default: { get Instance() { return mockMeasurementApi; } },
}));
jest.mock('../../measurements/classes', () => ({ MeasurementApi: { get Instance() { return mockMeasurementApi; } } }));
jest.mock('../../measurements/enums', () => {
  const Enums = {
    SREnums: jest.requireActual('../enums').Enums,
    SERVICE_EVENTS: { MEASUREMENTS_DATASYNC: 'datasync' },
    EVENTS: {},
    Cornerstone3D: { sr: { name: 'Cornerstone3DTools-Sonador', version: '0.1' } },
  };
  Object.defineProperty(Enums.Cornerstone3D.sr, 'measurementReport', {
    get: () => {
      const reader = jest.requireActual('./MeasurementReport').default;
      return {
        generateToolState: (dataset, ...args) => mockToolStates[dataset.SOPInstanceUID]
          || reader.generateToolState(dataset, ...args),
      };
    },
  });
  return { __esModule: true, default: Enums, Enums };
});

import parseDicomStructuredReport from './parseDicomStructuredReport';
import { retrieveMeasurementFromSR } from '../handleStructuredReport';
import { clearHydratedReports, saveParent } from '../utils/srDocument';

const STUDY = '2.25.1001';
const ENHANCED_SR = '1.2.840.10008.5.1.4.1.1.88.22';
const COMPREHENSIVE_3D_SR = '1.2.840.10008.5.1.4.1.1.88.34';

const report = (SOPInstanceUID, SOPClassUID, TemplateIdentifier) => {
  mockDatasets[SOPInstanceUID] = {
    StudyInstanceUID: STUDY, SeriesInstanceUID: `${SOPInstanceUID}.1`, SOPInstanceUID, SOPClassUID,
    ContentTemplateSequence: [{ TemplateIdentifier, MappingResource: 'DCMR' }],
    ContentSequence: [{
      ConceptNameCodeSequence: [{ CodeValue: '126010', CodingSchemeDesignator: 'DCM' }],
      ContentSequence: [],
    }],
  };
  return SOPInstanceUID;
};

const external = { servicesManager: { services: { displaySetService: { getDisplaySetByUID: () => null }, LoggerService: {} } } };
const parse = key => parseDicomStructuredReport(key, [], external);

const holdLoad = key => {
  let release;
  mockPendingLoads[key] = { promise: new Promise(resolve => { release = resolve; }) };
  return () => release();
};
const holdRetrieval = key => {
  let release;
  mockRetrievals[key] = new Promise(resolve => { release = resolve; });
  return () => release();
};
const withFinding = key => {
  mockToolStates[key] = {
    DICOMSRSeriesTagTool: [{
      sopInstanceUid: '2.25.900', TrackingUniqueIdentifier: `${key}.tracking`,
      annotation: { data: { value: 'img-qc.reject' }, metadata: {} },
    }],
  };
  return key;
};
const retrieve = key => retrieveMeasurementFromSR(
  { getFirstInstance: () => ({ imageId: key }), SeriesInstanceUID: `${key}.1` }, [], 'https://dicomweb', {
    servicesManager: { services: { ...external.servicesManager.services, displaySetService: {
      getDisplaySetsForSeries: () => [], getDisplaySetByUID: () => null,
    } } },
  });

beforeEach(() => {
  clearHydratedReports();
  mockImport.mockClear();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());


describe('save parent registration', () => {
  it('registers a report once its hydration succeeds', async () => {
    await parse(report('2.25.10', ENHANCED_SR, '1500'));
    expect(saveParent(STUDY)).toMatchObject({ SOPInstanceUID: '2.25.10', SOPClassUID: ENHANCED_SR, TemplateIdentifier: '1500' });
  });

  it('ignores a load that fails: it is not a parent and does not displace the one that loaded', async () => {
    await expect(parse(report('2.25.20', ENHANCED_SR, '9999'))).rejects.toThrow('TID 1500');
    expect(saveParent(STUDY)).toBeNull();

    await parse(report('2.25.21', ENHANCED_SR, '1500'));
    await expect(parse(report('2.25.22', ENHANCED_SR, 'unsupported'))).rejects.toThrow('TID 1500');
    expect(saveParent(STUDY)).toMatchObject({ SOPInstanceUID: '2.25.21' });
  });

  it('starts each measurement session afresh: a report from a cleared session is not counted', async () => {
    await parse(report('2.25.30', COMPREHENSIVE_3D_SR, 'Sonador-SR.1500'));

    clearHydratedReports(); // what MeasurementApi.clearMeasurements() and the service-cleared handler do
    await parse(report('2.25.31', ENHANCED_SR, '1500'));
    expect(saveParent(STUDY)).toMatchObject({ SOPInstanceUID: '2.25.31', SOPClassUID: ENHANCED_SR, TemplateIdentifier: '1500' });
  });

  it('does not let a load that began before a session clear register into the new session', async () => {
    let release;
    const key = report('2.25.50', COMPREHENSIVE_3D_SR, 'Sonador-SR.1500');
    mockPendingLoads[key] = { promise: new Promise(resolve => { release = resolve; }) };
    const lateLoad = parse(key);

    clearHydratedReports(); // the measurement session is cleared while A is still loading
    await parse(report('2.25.51', ENHANCED_SR, '1500'));
    expect(saveParent(STUDY)).toMatchObject({ SOPInstanceUID: '2.25.51' });

    release();
    await lateLoad;
    expect(saveParent(STUDY)).toMatchObject({
      SOPInstanceUID: '2.25.51', SOPClassUID: ENHANCED_SR, TemplateIdentifier: '1500', MappingResource: 'DCMR',
    });
  });

  it('imports a report holding a finding once, when its session is not cleared (control)', async () => {
    await parse(withFinding(report('2.25.60', ENHANCED_SR, '1500')));
    expect(mockImport).toHaveBeenCalledTimes(1);
    expect(saveParent(STUDY)).toMatchObject({ SOPInstanceUID: '2.25.60' });
  });

  it('imports nothing from a report whose parse was under way when the session was cleared', async () => {
    const key = withFinding(report('2.25.61', COMPREHENSIVE_3D_SR, 'Sonador-SR.1500'));
    const release = holdLoad(key);
    const lateLoad = parse(key);

    clearHydratedReports();
    await parse(report('2.25.62', ENHANCED_SR, '1500'));
    release();
    await lateLoad;

    expect(mockImport).not.toHaveBeenCalled();
    expect(saveParent(STUDY)).toMatchObject({ SOPInstanceUID: '2.25.62', SOPClassUID: ENHANCED_SR, TemplateIdentifier: '1500' });
  });

  it('drops a report whose server response arrives after the session was cleared', async () => {
    const key = withFinding(report('2.25.70', COMPREHENSIVE_3D_SR, 'Sonador-SR.1500'));
    const release = holdRetrieval(key);
    const lateRetrieval = retrieve(key);

    clearHydratedReports();
    await retrieve(report('2.25.71', ENHANCED_SR, '1500'));
    expect(saveParent(STUDY)).toMatchObject({ SOPInstanceUID: '2.25.71' });

    release();
    expect(await lateRetrieval).toBeUndefined();
    expect(mockImport).not.toHaveBeenCalled();
    expect(saveParent(STUDY)).toMatchObject({ SOPInstanceUID: '2.25.71', SOPClassUID: ENHANCED_SR, TemplateIdentifier: '1500' });
  });

  it('retrieves and hydrates a report end to end when nothing is cleared (control)', async () => {
    await retrieve(withFinding(report('2.25.80', ENHANCED_SR, '1500')));
    expect(mockImport).toHaveBeenCalledTimes(1);
    expect(saveParent(STUDY)).toMatchObject({ SOPInstanceUID: '2.25.80' });
  });

  it('gives no parent when two reports of the study hydrate in one session', async () => {
    await parse(report('2.25.40', ENHANCED_SR, '1500'));
    await parse(report('2.25.41', COMPREHENSIVE_3D_SR, 'Sonador-SR.1500'));
    expect(saveParent(STUDY)).toBeNull();
  });
});
