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
// Image ids of the study: an instance, and a multiframe instance with two frames
const mockImageIds = () => ({
  sopInstanceUIDToImageId: { '2.25.900': 'wadors:image', '2.25.906': 'wadors:multiframe/1' },
  imageIdsForToolState: { '2.25.900': [], '2.25.906': [undefined, 'wadors:multiframe/1', 'wadors:multiframe/2'] },
});
jest.mock('./utils/sopInstanceImageIds', () => ({ buildSopInstanceImageIds: () => mockImageIds() }));

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
// The read-only pass is recorded, not run
const mockReadOnly = jest.fn();
jest.mock('../readOnly/addReadOnlyMeasurements', () => ({
  __esModule: true, default: (...args) => mockReadOnly(...args),
}));
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
  DicomMetadataStore: {
    getInstance: (study, series, sop) => mockDatasets[sop],
    // The loaded image series: one, of Frame of Reference 2.25.7001
    getStudyInstanceUIDs: () => ['2.25.1'],
    getStudy: () => ({ StudyInstanceUID: '2.25.1', series: [{ SeriesInstanceUID: '2.25.2', instances: [{ FrameOfReferenceUID: '2.25.7001' }] }] }),
    getSeries: (study, series) => (series === '2.25.2' ? { SeriesInstanceUID: '2.25.2' } : undefined),
  },
}));

const mockImport = jest.fn(() => 'measurement-uid');
const mockRaw = [];
const mockMeasurementApi = {
  measurementService: {
    _broadcastEvent: () => {}, getMeasurement: () => ({}), EVENTS: {},
    getMeasurements: () => mockRaw.map(({ record }) => record),
    addRawMeasurement: jest.fn((source, toolName, data, toSchema) => {
      mockRaw.push({ source, toolName, record: { ...toSchema(data), uid: data.id } });
      return data.id;
    }),
  },
  _serviceSourceMappings: () => ({ source: {}, mappings: [{}], mappingDefinitions: ['DICOMSRSeriesTagTool', 'Angle', 'Length'] }),
  _serviceManagedTool: () => ({ toolServiceManaged: true, source: { annotationToMeasurement: mockImport } }),
  getMeasurementByTrackingUid: () => undefined,
  _apiSourceServiceMeasurement: () => true,
};

// Tool state the report reader returns for a report holding a finding (other reports are read by
// the production Cornerstone3D reader)
const mockToolStates = {};
const mockReaderOptions = [];
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
        generateToolState: (dataset, ...args) => {
          mockReaderOptions.push(args[3]);
          return mockToolStates[dataset.SOPInstanceUID] || reader.generateToolState(dataset, ...args);
        },
      };
    },
  });
  return { __esModule: true, default: Enums, Enums };
});

import parseDicomStructuredReport from './parseDicomStructuredReport';
import { retrieveMeasurementFromSR } from '../handleStructuredReport';
import { clearHydratedReports, saveParent } from '../utils/srDocument';

const CT_IMAGE = '1.2.840.10008.5.1.4.1.1.2';
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
  mockReadOnly.mockClear();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());


describe('save parent registration', () => {
  it('registers a report once its hydration succeeds', async () => {
    await parse(report('2.25.10', ENHANCED_SR, '1500'));
    expect(saveParent(STUDY)).toMatchObject({ SOPInstanceUID: '2.25.10', SOPClassUID: ENHANCED_SR, TemplateIdentifier: '1500' });
  });

  it('never registers an application document (Sonador-SR root title), which a save would regenerate', async () => {
    const key = report('2.25.15', COMPREHENSIVE_3D_SR, 'Sonador-SR.1500');
    mockDatasets[key].ConceptNameCodeSequence = [{ CodeValue: 'Clinical-Report', CodingSchemeDesignator: 'Sonador-SR' }];
    await parse(key);
    expect(saveParent(STUDY)).toBeNull();
  });

  it("keeps a hydrated measurement's NUM items with their own children, unknown content included", async () => {
    await parse(report('2.25.16', COMPREHENSIVE_3D_SR, '1500'));
    const { onContentItemParse } = mockReaderOptions[mockReaderOptions.length - 1];
    const unknown = { ValueType: 'TEXT', RelationshipType: 'HAS PROPERTIES', ConceptNameCodeSequence: [{ CodeValue: '99-x', CodingSchemeDesignator: '99PLAN' }], TextValue: 'kept' };
    const num = { ValueType: 'NUM', ConceptNameCodeSequence: [{ CodeValue: '410668003', CodingSchemeDesignator: 'SCT' }], ContentSequence: [unknown] };
    const state = { annotation: { metadata: {}, data: {} } };

    onContentItemParse('Length', state, { ContentSequence: [num] });
    expect(state.annotation.metadata.numItems).toEqual([num]);
    expect(state.annotation.metadata.numItems[0].ContentSequence).toEqual([unknown]);
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


describe('read-only display', () => {
  it('displays the measurements it did not hydrate after hydration, from the registered SR display sets', async () => {
    await parse(withFinding(report('2.25.90', ENHANCED_SR, '1500')));

    expect(mockImport).toHaveBeenCalledTimes(1);
    expect(mockReadOnly).toHaveBeenCalledTimes(1);
    expect(mockReadOnly.mock.invocationCallOrder[0]).toBeGreaterThan(mockImport.mock.invocationCallOrder[0]);
    expect(mockReadOnly.mock.calls[0][0]).toMatchObject({
      srDisplaySets: [], imageDisplaySets: [], imageIds: { sopInstanceUIDToImageId: { '2.25.900': 'wadors:image' } },
    });
  });

  it('displays nothing from a load whose session was cleared', async () => {
    const key = withFinding(report('2.25.91', COMPREHENSIVE_3D_SR, 'Sonador-SR.1500'));
    const release = holdLoad(key);
    const lateLoad = parse(key);

    clearHydratedReports();
    release();
    await lateLoad;

    expect(mockReadOnly).not.toHaveBeenCalled();
  });
});


describe('multiframe references', () => {
  it('hands the reader the image id of every frame and imports an angle on the frame it references', async () => {
    const key = report('2.25.60', COMPREHENSIVE_3D_SR, 'Sonador-SR.1500');
    mockToolStates[key] = {
      Angle: [{
        sopInstanceUid: '2.25.906', TrackingUniqueIdentifier: `${key}.tracking`,
        annotation: {
          data: { frameNumber: 2, handles: { points: [[120.5, 10.5, 20], [110.5, 10.5, 20], [110.5, 20.5, 20]] } },
          metadata: { referencedImageId: 'wadors:multiframe/2' },
        },
      }],
    };
    mockReaderOptions.length = 0;
    await parse(key);

    expect(mockReaderOptions[0].imageIdsForToolState).toEqual(mockImageIds().imageIdsForToolState);
    const [[toolName, { annotation }]] = mockImport.mock.calls;
    expect(toolName).toBe('Angle');
    expect(annotation.data.imageId).toBe('wadors:multiframe/2');
    expect(annotation.metadata.referencedImageId).toBe('wadors:multiframe/2');
    expect(annotation.data.handles.points[0]).toEqual([120.5, 10.5, 20]);
  });
});


describe('a patient-domain measurement on no loaded image', () => {
  // As the reader returns a patient-domain Length with a valid Drawing-Plane, or one no loaded image holds
  const withPatientLength = (key, metadata = {}) => {
    mockToolStates[key] = {
      Length: [{
        description: 'Femoral neck',
        annotation: {
          data: { handles: { points: [[5, 2, 0], [5, 20, 0]] }, displayAttributes: { Color: { Border: '#FF8800' } } },
          metadata: {
            TrackingUniqueIdentifier: `${key}.tracking`, TrackingIdentifier: 'cornerstoneTools@^4.0.0:Length',
            coordinateDomain: 'patient', outOfPlane: true, sourceSeries: '2.25.2', drawingPlane: '0,1,0,0,0,-1', views: ['sagittal'],
            isLocked: true, isReadOnly: true,
            sourceGeometry: { valueType: 'SCOORD3D', graphicData: [5, 2, 0, 5, 20, 0], FrameOfReferenceUID: '2.25.7001', value: 18 },
            ...metadata,
          },
        },
      }],
    };
    return key;
  };
  beforeEach(() => {
    mockRaw.length = 0;
    mockMeasurementApi.measurementService.addRawMeasurement.mockClear();
  });

  it('is held as a locked, listed out-of-plane measurement with its points, value and properties', async () => {
    await parse(withPatientLength(report('2.25.70', COMPREHENSIVE_3D_SR, '1500')));
    expect(mockImport).not.toHaveBeenCalled();
    expect(mockRaw).toHaveLength(1);
    const [{ toolName, record }] = mockRaw;
    expect(toolName).toBe('Length');
    expect(record).toMatchObject({
      toolName: 'Length', points: [[5, 2, 0], [5, 20, 0]], FrameOfReferenceUID: '2.25.7001', length: 18,
      referenceStudyUID: STUDY, referenceSeriesUID: '2.25.2', description: 'Femoral neck', isLocked: true,
      data: { length: 18, displayAttributes: { Color: { Border: '#FF8800' } } },
      metadata: {
        outOfPlane: true, TrackingUniqueIdentifier: '2.25.70.tracking', drawingPlane: '0,1,0,0,0,-1', views: ['sagittal'],
        sourceSeries: '2.25.2', isLocked: true, isReadOnly: true,
      },
    });
    expect(record.metadata.isListed).toBeUndefined();
    // Kept from the read-only display, as every hydrated measurement is
    expect(mockReadOnly.mock.calls[0][0].excludeTrackingUIDs.has('2.25.70.tracking')).toBe(true);
  });

  it('is held whatever its Frame of Reference, and once', async () => {
    const key = withPatientLength(report('2.25.71', COMPREHENSIVE_3D_SR, '1500'), {
      outOfPlane: undefined, drawingPlane: undefined,
      sourceGeometry: { valueType: 'SCOORD3D', graphicData: [5, 2, 7, 5, 20, 7], FrameOfReferenceUID: '2.25.9999', value: 18 },
    });
    await parse(key);
    await parse(key);
    expect(mockRaw.map(({ record }) => record.FrameOfReferenceUID)).toEqual(['2.25.9999']);
  });

  describe('whose Frame of Reference no loaded series shares', () => {
    const EVIDENCE = [{
      StudyInstanceUID: STUDY,
      ReferencedSeriesSequence: [
        { SeriesInstanceUID: '2.25.2', ReferencedSOPSequence: [{ ReferencedSOPClassUID: CT_IMAGE, ReferencedSOPInstanceUID: '2.25.2.1' }] },
        { SeriesInstanceUID: '2.25.5001', ReferencedSOPSequence: [
          { ReferencedSOPClassUID: CT_IMAGE, ReferencedSOPInstanceUID: '2.25.5001.1' },
          { ReferencedSOPClassUID: CT_IMAGE, ReferencedSOPInstanceUID: '2.25.5001.2' },
        ] },
      ],
    }];
    const ELSEWHERE = { valueType: 'SCOORD3D', graphicData: [5, 2, 7, 5, 20, 7], FrameOfReferenceUID: '2.25.9999', value: 18 };
    const heldReport = (SOPInstanceUID, metadata) => {
      const key = withPatientLength(report(SOPInstanceUID, COMPREHENSIVE_3D_SR, '1500'), { sourceGeometry: ELSEWHERE, ...metadata });
      mockDatasets[key].CurrentRequestedProcedureEvidenceSequence = EVIDENCE;
      return key;
    };
    const SERIES_EVIDENCE = {
      StudyInstanceUID: STUDY, SeriesInstanceUID: '2.25.5001',
      instances: [{ SOPClassUID: CT_IMAGE, SOPInstanceUID: '2.25.5001.1' }, { SOPClassUID: CT_IMAGE, SOPInstanceUID: '2.25.5001.2' }],
    };

    it("keeps the report's evidence for its source series, so that a save writes it again", async () => {
      await parse(heldReport('2.25.72', { sourceSeries: '2.25.5001' }));
      expect(mockRaw[0].record.metadata.carriedEvidence).toEqual({ ...SERIES_EVIDENCE, instances: tagged(SERIES_EVIDENCE) });
    });

    const REQUESTED = 'CurrentRequestedProcedureEvidenceSequence';
    const OTHER = 'PertinentOtherEvidenceSequence';
    const tagged = ({ StudyInstanceUID, SeriesInstanceUID, instances }, evidenceContainer = REQUESTED) =>
      instances.map(instance => ({ StudyInstanceUID, SeriesInstanceUID, evidenceContainer, ...instance }));

    const LOADED_EVIDENCE = tagged({ StudyInstanceUID: STUDY, SeriesInstanceUID: '2.25.2', instances: [{ SOPClassUID: CT_IMAGE, SOPInstanceUID: '2.25.2.1' }] });

    it('without a Source-Series, keeps every instance its report lists, each under its series, loaded or not', async () => {
      const second = {
        SeriesInstanceUID: '2.25.5002', ReferencedSOPSequence: [{ ReferencedSOPClassUID: CT_IMAGE, ReferencedSOPInstanceUID: '2.25.5002.1' }],
      };
      const key = heldReport('2.25.73', { sourceSeries: undefined });
      mockDatasets[key].CurrentRequestedProcedureEvidenceSequence = [
        ...EVIDENCE, { StudyInstanceUID: STUDY, ReferencedSeriesSequence: second },
      ];
      await parse(key);
      const { carriedEvidence, sourceSeries } = mockRaw[0].record.metadata;
      expect(sourceSeries).toBeUndefined();
      expect(carriedEvidence).toEqual({
        StudyInstanceUID: STUDY, SeriesInstanceUID: '2.25.2',
        instances: [
          ...LOADED_EVIDENCE,
          ...tagged(SERIES_EVIDENCE),
          { StudyInstanceUID: STUDY, SeriesInstanceUID: '2.25.5002', evidenceContainer: REQUESTED, SOPClassUID: CT_IMAGE, SOPInstanceUID: '2.25.5002.1' },
        ],
      });
    });

    it('with a Source-Series the report lists no evidence for, keeps every instance its report lists', async () => {
      await parse(heldReport('2.25.74', { sourceSeries: '2.25.6001' }));
      expect(mockRaw[0].record.metadata).toMatchObject({
        sourceSeries: '2.25.6001', carriedEvidence: { instances: [...LOADED_EVIDENCE, ...tagged(SERIES_EVIDENCE)] },
      });
    });

    it('without a Source-Series, keeps evidence whose only series is loaded under another Frame of Reference', async () => {
      const key = heldReport('2.25.76', { sourceSeries: undefined });
      mockDatasets[key].CurrentRequestedProcedureEvidenceSequence = [{ StudyInstanceUID: STUDY, ReferencedSeriesSequence: [EVIDENCE[0].ReferencedSeriesSequence[0]] }];
      await parse(key);
      expect(mockRaw[0].record.metadata.carriedEvidence).toEqual({ StudyInstanceUID: STUDY, SeriesInstanceUID: '2.25.2', instances: LOADED_EVIDENCE });
    });

    it('keeps the references of the Pertinent Other Evidence Sequence, under that container, alone or with the other', async () => {
      const only = heldReport('2.25.78', { sourceSeries: '2.25.5001' });
      mockDatasets[only].PertinentOtherEvidenceSequence = mockDatasets[only].CurrentRequestedProcedureEvidenceSequence;
      delete mockDatasets[only].CurrentRequestedProcedureEvidenceSequence;
      await parse(only);
      expect(mockRaw[0].record.metadata.carriedEvidence.instances).toEqual(tagged(SERIES_EVIDENCE, OTHER));

      const both = heldReport('2.25.79', { sourceSeries: undefined });
      mockDatasets[both].CurrentRequestedProcedureEvidenceSequence = [{ StudyInstanceUID: STUDY, ReferencedSeriesSequence: [EVIDENCE[0].ReferencedSeriesSequence[1]] }];
      mockDatasets[both].PertinentOtherEvidenceSequence = [{ StudyInstanceUID: STUDY, ReferencedSeriesSequence: [EVIDENCE[0].ReferencedSeriesSequence[0]] }];
      await parse(both);
      expect(mockRaw[1].record.metadata.carriedEvidence.instances).toEqual([...tagged(SERIES_EVIDENCE), ...tagged({ ...SERIES_EVIDENCE, SeriesInstanceUID: '2.25.2', instances: [{ SOPClassUID: CT_IMAGE, SOPInstanceUID: '2.25.2.1' }] }, OTHER)]);
    });

    it('is carried forward with no evidence when its report lists none, and not at all when a loaded series shares its frame', async () => {
      const key = heldReport('2.25.77', { sourceSeries: undefined });
      delete mockDatasets[key].CurrentRequestedProcedureEvidenceSequence;
      await parse(key);
      await parse(withPatientLength(report('2.25.75', COMPREHENSIVE_3D_SR, '1500')));
      expect(mockRaw.map(({ record }) => record.metadata.carriedEvidence)).toEqual([
        { StudyInstanceUID: STUDY, SeriesInstanceUID: undefined, instances: [] }, undefined,
      ]);
    });
  });
});

