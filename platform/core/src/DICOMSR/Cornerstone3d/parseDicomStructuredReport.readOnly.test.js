// Hydration and the read-only pass across the reports of a study. Each report is parsed by its own
// load; the read-only pass of one must not display (and so claim) another report's measurements, or
// that report's hydration skips them as duplicates. Series Tags were lost this way: shown as an
// "(SR) <tracking identifier>" row without their extended meta, and not drawn as tags.
// The production parser and read-only pass run against a measurement API that records what each
// path adds; Cornerstone, the report reader and the classic representation are stubbed.

jest.mock('@cornerstonejs/adapters', () => ({
  adaptersSR: { Cornerstone3D: { CodeScheme: { CodingSchemeDesignator: 'CORNERSTONEJS', codeValues: {} }, MeasurementReport: class {} } },
}), { virtual: true });
jest.mock('@cornerstonejs/core', () => ({ utilities: {}, metaData: { get: () => undefined } }), { virtual: true });
jest.mock('cornerstone-core', () => ({ metaData: { get: () => undefined } }), { virtual: true });
jest.mock('../../log', () => ({ __esModule: true, default: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }));
jest.mock('../../utils', () => ({ __esModule: true, dataProc: {}, default: {} }));
jest.mock('../../measurements/lib/getImagePath', () => ({ __esModule: true, default: () => '' }));
jest.mock('../utils/dcmsrExtendedMeta', () => ({ parseExtendedMeta: () => {} }));
jest.mock('../utils/dcmsrDisplayAttributes', () => ({ parseDisplayAttributes: () => {} }));
// The display reader of a report's own content is the production one
jest.mock('../../classes', () => ({ __esModule: true, default: { ImageSet: class {}, Cornerstone3dMetadataProvider: {} } }));
jest.mock('../../measurements', () => ({
  __esModule: true,
  default: { Enums: { Cornerstone3D: { sr: { measurementReport: { codeValueMatch: () => false } } } }, SREnums: jest.requireActual('../enums').Enums },
}));
jest.mock('../../types', () => ({ __esModule: true, default: {} }));
jest.mock('../../services/DisplaySetService', () => ({ __esModule: true, default: {} }));
jest.mock('./utils/isRehydratable', () => ({ __esModule: true, default: () => true }));
jest.mock('./initDisplaySetMeasurements', () => ({
  linkMeasurementsToDisplaySets: () => {},
  getMeasurements: (...args) => jest.requireActual('./initDisplaySetMeasurements').getMeasurements(...args),
}));
jest.mock('./utils/sopInstanceImageIds', () => ({
  buildSopInstanceImageIds: () => ({
    sopInstanceUIDToImageId: { '2.25.900': 'wadors:image' }, imageIdsForToolState: { '2.25.900': [undefined, 'wadors:image'] },
  }),
}));

// The study: one image series and two SR series
const mockStudy = { imageDisplaySets: [], srDisplaySets: [] };
jest.mock('../utils/initDisplaySetMeasurements', () => ({ __esModule: true, default: () => mockStudy }));

const mockDatasets = {};
const mockSeries = {};
const mockFileToStudy = jest.fn(async key => mockDatasets[key]);
jest.mock('../../store', () => ({ fileLoader: { Local: { fileToStudy: (...args) => mockFileToStudy(...args) } } }));
jest.mock('../../services/DicomMetadataStore', () => ({
  __esModule: true,
  default: {},
  DicomMetadataStore: {
    getInstance: (study, series, sop) => mockDatasets[sop],
    getSeries: (study, series) => mockSeries[series],
  },
}));

// What hydration (the parser source) and the read-only pass (the classic representation) add
const mockHeld = new Map();
const mockImport = jest.fn((annotationType, { annotation }) => {
  mockHeld.set(annotation.metadata.TrackingUniqueIdentifier, 'hydrated');
  return 'measurement-uid';
});
const mockApi = {
  measurementService: { _broadcastEvent: () => {}, getMeasurement: () => ({}), EVENTS: {} },
  _serviceSourceMappings: () => ({ source: {}, mappings: [{}], mappingDefinitions: ['DICOMSRSeriesTagTool'] }),
  _serviceManagedTool: () => ({ toolServiceManaged: true, source: { annotationToMeasurement: mockImport } }),
  getMeasurementByTrackingUid: uid => (mockHeld.has(uid) ? { uid } : undefined),
  _apiSourceServiceMeasurement: () => true,
  syncMeasurementsAndToolData: () => {},
};
jest.mock('../../measurements/classes/MeasurementApi', () => ({ __esModule: true, default: { get Instance() { return mockApi; } } }));
const mockDrawn = [];
jest.mock('../SCOORD3D/utils/addMeasurement', () => ({
  __esModule: true,
  default: (measurement) => {
    mockDrawn.push(measurement.TrackingUniqueIdentifier);
    return mockHeld.set(measurement.TrackingUniqueIdentifier, 'read-only');
  },
}));
jest.mock('../readOnly/srDisplayAnnotations', () => ({ addSRDisplayAnnotation: () => null, renderSRDisplayAnnotations: () => {} }));

// The report reader returns the tool state of each report
const mockToolStates = {};
jest.mock('../../measurements/enums', () => {
  const Enums = {
    SREnums: jest.requireActual('../enums').Enums,
    EVENTS: {},
    Cornerstone3D: { sr: { name: 'Cornerstone3DTools-Sonador', version: '0.1' } },
  };
  Object.defineProperty(Enums.Cornerstone3D.sr, 'measurementReport', {
    get: () => ({ generateToolState: dataset => mockToolStates[dataset.SOPInstanceUID] || {} }),
  });
  return { __esModule: true, default: Enums, Enums };
});

import _ from 'lodash';
import parseDicomStructuredReport from './parseDicomStructuredReport';
import { clearHydratedReports } from '../utils/srDocument';

const STUDY = '2.25.1001';
const imageRef = { ReferencedSOPSequence: { ReferencedSOPInstanceUID: '2.25.900' } };

// Report A: a measurement the viewer does not hydrate (here a Bidirectional whose axes the tools
// cannot hold: its adapter returns no state). Report B: a Series Tag.
const reportA = { StudyInstanceUID: STUDY, SeriesInstanceUID: '2.25.10.1', SOPInstanceUID: '2.25.10', SOPClassUID: '1.2.840.10008.5.1.4.1.1.88.22',
  ContentTemplateSequence: [{ TemplateIdentifier: '1500' }] };
const reportB = { ...reportA, SeriesInstanceUID: '2.25.20.1', SOPInstanceUID: '2.25.20' };

const srA = { displaySetInstanceUID: 'sr-a', SeriesInstanceUID: '2.25.10.1', measurements: [{
  TrackingUniqueIdentifier: '2.25.10.100', TrackingIdentifier: 'cornerstoneTools@^4.0.0:Bidirectional',
  coords: [{ ValueType: 'SCOORD', GraphicType: 'POLYLINE', GraphicData: [1, 1, 5, 5], ...imageRef }],
}] };
const srB = { displaySetInstanceUID: 'sr-b', SeriesInstanceUID: '2.25.20.1', measurements: [{
  TrackingUniqueIdentifier: '2.25.20.100', TrackingIdentifier: 'cornerstoneTools@^4.0.0:DICOMSRSeriesTagTool',
  labels: [], coords: [imageRef],
}] };
const ct = { displaySetInstanceUID: 'ct', SRLabels: [], images: [{ getData: () => ({ metadata: { SOPInstanceUID: '2.25.900' } }) }] };

const displaySets = { 'sr-a': srA, 'sr-b': srB };
// The display sets of an SR series, as the retrieval leaves them (an instance, cached report bytes)
const mockSeriesDisplaySets = {};
const external = { servicesManager: { services: {
  displaySetService: { getDisplaySetByUID: uid => displaySets[uid], getDisplaySetsForSeries: uid => mockSeriesDisplaySets[uid] || [] },
  LoggerService: { error: () => {} },
} } };

beforeEach(() => {
  clearHydratedReports();
  mockHeld.clear();
  mockImport.mockClear();
  Object.assign(mockStudy, { imageDisplaySets: [ct], srDisplaySets: [srA, srB] });
  Object.assign(mockDatasets, { '2.25.10': reportA, '2.25.20': reportB });
  mockToolStates['2.25.20'] = { DICOMSRSeriesTagTool: [{
    sopInstanceUid: '2.25.900', TrackingUniqueIdentifier: '2.25.20.100', annotation: { data: {}, metadata: {} },
  }] };
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'debug').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());


describe('hydration and read-only display across the reports of a study', () => {
  it('hydrates the Series Tags of a report parsed after another report of the study', async () => {
    await parseDicomStructuredReport('2.25.10', [], external);
    await parseDicomStructuredReport('2.25.20', [], external);

    expect(mockImport).toHaveBeenCalledTimes(1);
    expect(mockHeld.get('2.25.20.100')).toBe('hydrated');
    expect(mockHeld.get('2.25.10.100')).toBe('read-only');
  });

  it('hydrates them in either order', async () => {
    await parseDicomStructuredReport('2.25.20', [], external);
    await parseDicomStructuredReport('2.25.10', [], external);

    expect(mockHeld.get('2.25.20.100')).toBe('hydrated');
    expect(mockHeld.get('2.25.10.100')).toBe('read-only');
  });

  it('never displays a supported-tool measurement read-only, even when hydration places nothing', async () => {
    mockToolStates['2.25.20'].DICOMSRSeriesTagTool[0].sopInstanceUid = '2.25.999'; // no image loaded for it
    await parseDicomStructuredReport('2.25.20', [], external);

    expect(mockImport).not.toHaveBeenCalled();
    expect(mockHeld.has('2.25.20.100')).toBe(false);
  });
});


describe('landmark sets of a report', () => {
  const { getLandmarkSets } = jest.requireActual('../landmarks/landmarkSetStore');
  const code = (CodeValue, CodingSchemeDesignator = 'DCM') => [{ CodeValue, CodingSchemeDesignator }];
  const withSet = report => ({
    ...report,
    ConceptNameCodeSequence: code('126000'),
    ContentSequence: [{ ValueType: 'CONTAINER', ConceptNameCodeSequence: code('126010'), ContentSequence: [{
      ValueType: 'CONTAINER', ConceptNameCodeSequence: code('125007'),
      ContentSequence: [
        { ValueType: 'TEXT', ConceptNameCodeSequence: code('112039'), TextValue: 'cornerstoneTools@^4.0.0:SonadorLandmarkSet' },
        { ValueType: 'UIDREF', ConceptNameCodeSequence: code('112040'), UID: '2.25.10.200' },
        { ValueType: 'CODE', ConceptNameCodeSequence: code('121071'), ConceptCodeSequence: [{ CodeValue: 'CORNERSTONEFREETEXT', CodingSchemeDesignator: 'CST4', CodeMeaning: 'Set' }] },
        { ValueType: 'CODE', ConceptNameCodeSequence: code('Sonador-Landmark', 'Sonador-SR'), ConceptCodeSequence: code('Sonador-Landmark.Point', 'Sonador-SR'),
          ContentSequence: [{ RelationshipType: 'INFERRED FROM', ValueType: 'SCOORD3D', GraphicType: 'POINT', GraphicData: [1, 2, 3], ReferencedFrameOfReferenceUID: '2.25.7' }] },
      ],
    }] }],
  });

  it('lists the sets of the parsed report once, and leaves the document out of the save parents', async () => {
    mockDatasets['2.25.10'] = withSet(reportA);
    await parseDicomStructuredReport('2.25.10', [], external);
    await parseDicomStructuredReport('2.25.10', [], external);
    expect(getLandmarkSets().map(entry => entry.key)).toEqual(['2.25.10::2.25.10.200']);
    const { saveParent } = jest.requireActual('../utils/srDocument');
    expect(saveParent(STUDY)).toBeNull();
  });

  it('lists the sets of every report instance of the series whose content is cached, and again none on a second load', async () => {
    // Two report instances in one series, sharing a tracking UID; the series is parsed from the first
    const first = withSet(reportA);
    const second = { ...withSet(reportA), SOPInstanceUID: '2.25.11' };
    mockDatasets['2.25.10'] = first;
    mockSeries[reportA.SeriesInstanceUID] = { SeriesInstanceUID: reportA.SeriesInstanceUID, instances: [first, second] };
    mockFileToStudy.mockClear();

    await parseDicomStructuredReport('2.25.10', [], external);
    expect(getLandmarkSets().map(entry => entry.key)).toEqual(['2.25.10::2.25.10.200', '2.25.11::2.25.10.200']);
    await parseDicomStructuredReport('2.25.10', [], external);
    expect(getLandmarkSets()).toHaveLength(2);
    // Only the report each load was given is read: the second instance's content is the cached one
    expect(mockFileToStudy.mock.calls.map(([key]) => key)).toEqual(['2.25.10', '2.25.10']);
    delete mockSeries[reportA.SeriesInstanceUID];
  });

  describe('a sibling report whose full content is cached as Part 10 bytes on its display set', () => {
    const { data: dcmjsData } = jest.requireActual('dcmjs');
    const part10 = (dataset) => {
      const { DicomDict, DicomMetaDictionary } = dcmjsData;
      const meta = {
        FileMetaInformationVersion: new Uint8Array([0, 1]).buffer, MediaStorageSOPClassUID: dataset.SOPClassUID,
        MediaStorageSOPInstanceUID: dataset.SOPInstanceUID, TransferSyntaxUID: '1.2.840.10008.1.2.1',
      };
      const dict = new DicomDict(DicomMetaDictionary.denaturalizeDataset(meta));
      dict.dict = DicomMetaDictionary.denaturalizeDataset(_.omit(dataset, 'ContentTemplateSequence'));
      return dict.write();
    };
    // Each report holds a landmark set and a Series Tag of its own
    const reportOf = (SOPInstanceUID) => {
      const dataset = { ...withSet(reportA), SOPInstanceUID, SOPClassUID: reportA.SOPClassUID };
      mockToolStates[SOPInstanceUID] = { DICOMSRSeriesTagTool: [{
        sopInstanceUid: '2.25.900', TrackingUniqueIdentifier: `${SOPInstanceUID}.tag`, annotation: { data: {}, metadata: {} },
      }] };
      return dataset;
    };
    const header = dataset => _.pick(dataset, 'StudyInstanceUID', 'SeriesInstanceUID', 'SOPInstanceUID', 'SOPClassUID');

    [['2.25.10', '2.25.11'], ['2.25.11', '2.25.10']].forEach(([retrieved, sibling]) => {
      it(`reads the sibling from its bytes: its row and its measurement, retrieving ${retrieved} first, and nothing again on a repeat load`, async () => {
        const retrievedReport = reportOf(retrieved);
        const siblingReport = reportOf(sibling);
        mockDatasets[retrieved] = retrievedReport;
        // The store knows the sibling by its header only; the display set keeps its bytes
        mockSeries[reportA.SeriesInstanceUID] = { SeriesInstanceUID: reportA.SeriesInstanceUID, instances: [header(retrievedReport), header(siblingReport)] };
        mockSeriesDisplaySets[reportA.SeriesInstanceUID] = [{ instance: header(siblingReport), cachePart10SRArrayBuffer: part10(siblingReport) }];
        mockFileToStudy.mockClear();

        await parseDicomStructuredReport(retrieved, [], external);
        expect(getLandmarkSets().map(entry => entry.document.SOPInstanceUID).sort()).toEqual(['2.25.10', '2.25.11']);
        expect(mockImport.mock.calls.map(([, { annotation }]) => annotation.metadata.TrackingUniqueIdentifier).sort())
          .toEqual(['2.25.10.tag', '2.25.11.tag']);

        await parseDicomStructuredReport(retrieved, [], external);
        expect(getLandmarkSets()).toHaveLength(2);
        expect(mockImport).toHaveBeenCalledTimes(2);
        // Only the bytes each load was given are read through the loader: no request for the sibling
        expect(mockFileToStudy.mock.calls.map(([key]) => key)).toEqual([retrieved, retrieved]);

        delete mockSeries[reportA.SeriesInstanceUID];
        delete mockSeriesDisplaySets[reportA.SeriesInstanceUID];
        delete mockToolStates[retrieved];
        delete mockToolStates[sibling];
      });
    });

    // Both SR display sets registered, each with its report's Series Tag in its display-set data
    const srDisplaySetOf = SOPInstanceUID => ({
      displaySetInstanceUID: `sr-${SOPInstanceUID}`, SeriesInstanceUID: reportA.SeriesInstanceUID, SOPInstanceUID,
      measurements: [{
        TrackingUniqueIdentifier: `${SOPInstanceUID}.tag`, TrackingIdentifier: 'cornerstoneTools@^4.0.0:DICOMSRSeriesTagTool',
        labels: [], coords: [imageRef],
      }],
    });
    [['2.25.10', '2.25.11'], ['2.25.11', '2.25.10']].forEach(([retrieved, sibling]) => {
      it(`hydrates the sibling's own measurement, not displayed read-only by the first report, retrieving ${retrieved} first`, async () => {
        const retrievedReport = reportOf(retrieved);
        const siblingReport = reportOf(sibling);
        mockDatasets[retrieved] = retrievedReport;
        mockSeries[reportA.SeriesInstanceUID] = { SeriesInstanceUID: reportA.SeriesInstanceUID, instances: [header(retrievedReport), header(siblingReport)] };
        const registered = [srDisplaySetOf(retrieved), { ...srDisplaySetOf(sibling), instance: header(siblingReport), cachePart10SRArrayBuffer: part10(siblingReport) }];
        registered.forEach((displaySet) => { displaySets[displaySet.displaySetInstanceUID] = displaySet; });
        mockStudy.srDisplaySets = registered;
        mockSeriesDisplaySets[reportA.SeriesInstanceUID] = registered;

        await parseDicomStructuredReport(retrieved, [], external);
        await parseDicomStructuredReport(retrieved, [], external);
        expect(mockHeld.get(`${retrieved}.tag`)).toBe('hydrated');
        expect(mockHeld.get(`${sibling}.tag`)).toBe('hydrated');
        expect(mockImport).toHaveBeenCalledTimes(2);

        registered.forEach((displaySet) => { delete displaySets[displaySet.displaySetInstanceUID]; });
        delete mockSeries[reportA.SeriesInstanceUID];
        delete mockSeriesDisplaySets[reportA.SeriesInstanceUID];
        delete mockToolStates[retrieved];
        delete mockToolStates[sibling];
      });
    });
  });

  describe('a group of an unregistered tool in a cached sibling', () => {
    // An older report of the series, cached in the metadata store, with a drawable group of a tool the
    // Viewer does not register: displayed read-only. The series' display set shows the newer report.
    const unregisteredGroup = (UID) => ({
      ValueType: 'CONTAINER', ConceptNameCodeSequence: code('125007'),
      ContentSequence: [
        { ValueType: 'TEXT', ConceptNameCodeSequence: code('112039'), TextValue: 'cornerstoneTools@^4.0.0:SonadorUnregisteredTool' },
        { ValueType: 'UIDREF', ConceptNameCodeSequence: code('112040'), UID },
        { RelationshipType: 'CONTAINS', ValueType: 'SCOORD', ConceptNameCodeSequence: code('111030'), GraphicType: 'POLYLINE', GraphicData: [1, 1, 5, 5],
          ContentSequence: [{ RelationshipType: 'SELECTED FROM', ValueType: 'IMAGE', ReferencedSOPSequence: [{ ReferencedSOPClassUID: '1.2.840.10008.5.1.4.1.1.2', ReferencedSOPInstanceUID: '2.25.900' }] }] },
      ],
    });
    const withGroup = (report, UID) => {
      const dataset = withSet(report);
      dataset.ContentSequence[0].ContentSequence = [unregisteredGroup(UID)];
      return dataset;
    };
    const older = () => withGroup({ ...reportA, SOPInstanceUID: '2.25.12' }, '2.25.12.300');
    const newer = () => withGroup(reportA, '2.25.10.300');
    const newerDisplaySet = { displaySetInstanceUID: 'sr-newer', SeriesInstanceUID: reportA.SeriesInstanceUID, SOPInstanceUID: '2.25.10', measurements: [] };

    afterEach(() => {
      delete mockSeries[reportA.SeriesInstanceUID];
      delete mockSeriesDisplaySets[reportA.SeriesInstanceUID];
      delete displaySets['sr-newer'];
    });

    it('is displayed once, from the content cached, with one display set for the series', async () => {
      mockDatasets['2.25.10'] = newer();
      mockSeries[reportA.SeriesInstanceUID] = { SeriesInstanceUID: reportA.SeriesInstanceUID, instances: [mockDatasets['2.25.10'], older()] };
      displaySets['sr-newer'] = newerDisplaySet;
      mockStudy.srDisplaySets = [newerDisplaySet];
      mockSeriesDisplaySets[reportA.SeriesInstanceUID] = [newerDisplaySet];
      mockFileToStudy.mockClear();

      mockDrawn.length = 0;
      await parseDicomStructuredReport('2.25.10', [], external);
      await parseDicomStructuredReport('2.25.10', [], external);
      expect(mockHeld.get('2.25.12.300')).toBe('read-only');
      expect(mockDrawn.filter(uid => uid === '2.25.12.300')).toHaveLength(1);
      expect(mockFileToStudy.mock.calls.map(([key]) => key)).toEqual(['2.25.10', '2.25.10']);
    });

    it('is displayed from its own display set when it has one (control)', async () => {
      const dataset = older();
      mockDatasets['2.25.12'] = dataset;
      const ownDisplaySet = { displaySetInstanceUID: 'sr-older', SeriesInstanceUID: reportA.SeriesInstanceUID, SOPInstanceUID: '2.25.12',
        measurements: [{ TrackingUniqueIdentifier: '2.25.12.300', TrackingIdentifier: 'cornerstoneTools@^4.0.0:SonadorUnregisteredTool',
          coords: [{ ValueType: 'SCOORD', GraphicType: 'POLYLINE', GraphicData: [1, 1, 5, 5], ...imageRef }] }] };
      displaySets['sr-older'] = ownDisplaySet;
      mockStudy.srDisplaySets = [ownDisplaySet];
      await parseDicomStructuredReport('2.25.12', [], external);
      expect(mockHeld.get('2.25.12.300')).toBe('read-only');
      delete displaySets['sr-older'];
    });
  });

  it('lists nothing for a load whose measurement session was cleared', async () => {
    mockDatasets['2.25.10'] = withSet(reportA);
    await parseDicomStructuredReport('2.25.10', [], external, { loadSession: -1 });
    expect(getLandmarkSets()).toEqual([]);
  });
});
