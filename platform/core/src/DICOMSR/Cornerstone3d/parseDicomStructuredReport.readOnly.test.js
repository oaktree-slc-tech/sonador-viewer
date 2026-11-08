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
jest.mock('./initDisplaySetMeasurements', () => ({ linkMeasurementsToDisplaySets: () => {} }));
jest.mock('./utils/sopInstanceImageIds', () => ({
  buildSopInstanceImageIds: () => ({
    sopInstanceUIDToImageId: { '2.25.900': 'wadors:image' }, imageIdsForToolState: { '2.25.900': [undefined, 'wadors:image'] },
  }),
}));

// The study: one image series and two SR series
const mockStudy = { imageDisplaySets: [], srDisplaySets: [] };
jest.mock('../utils/initDisplaySetMeasurements', () => ({ __esModule: true, default: () => mockStudy }));

const mockDatasets = {};
jest.mock('../../store', () => ({ fileLoader: { Local: { fileToStudy: async key => mockDatasets[key] } } }));
jest.mock('../../services/DicomMetadataStore', () => ({
  __esModule: true, default: {}, DicomMetadataStore: { getInstance: (study, series, sop) => mockDatasets[sop] },
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
jest.mock('../SCOORD3D/utils/addMeasurement', () => ({
  __esModule: true, default: measurement => mockHeld.set(measurement.TrackingUniqueIdentifier, 'read-only'),
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

import parseDicomStructuredReport from './parseDicomStructuredReport';
import { clearHydratedReports } from '../utils/srDocument';

const STUDY = '2.25.1001';
const imageRef = { ReferencedSOPSequence: { ReferencedSOPInstanceUID: '2.25.900' } };

// Report A: a measurement the viewer cannot edit. Report B: a Series Tag.
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
const external = { servicesManager: { services: {
  displaySetService: { getDisplaySetByUID: uid => displaySets[uid] }, LoggerService: { error: () => {} },
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
