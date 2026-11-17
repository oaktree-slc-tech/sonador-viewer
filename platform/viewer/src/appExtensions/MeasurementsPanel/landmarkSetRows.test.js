// The Annotations panel's Landmarks group: one row per set of the loaded documents (the core store
// over the Sonador IO fixtures), after the measurement groups, read-only, with its placement and its
// series read when the rows are built.

import fs from 'fs';
import path from 'path';
import { data as dcmjsData } from 'dcmjs';

jest.mock('../../App', () => ({ commandsManager: {} }));
jest.mock('./jumpToRowItem.js', () => () => {});
jest.mock('cornerstone-core', () => ({}), { virtual: true });
jest.mock('@cornerstonejs/core', () => ({ metaData: { get: () => undefined } }), { virtual: true });
jest.mock('@ohif/ui', () => ({ MeasurementTable: () => null }));
jest.mock('@cornerstonejs/adapters', () => ({
  adaptersSR: { Cornerstone3D: { CodeScheme: { CodingSchemeDesignator: 'CORNERSTONEJS', codeValues: { CORNERSTONEFREETEXT: 'CORNERSTONEFREETEXT' } } } },
}), { virtual: true });
// The core modules the landmark store reads through
jest.mock('../../../../core/src/measurements/classes', () => ({ MeasurementApi: {} }));
jest.mock('../../../../core/src/measurements/enums', () => {
  const Enums = { SREnums: jest.requireActual('../../../../core/src/DICOMSR/enums').Enums, EVENTS: {}, Cornerstone3D: { sr: {} } };
  return { __esModule: true, default: Enums, Enums };
});
jest.mock('../../../../core/src/log', () => ({ __esModule: true, default: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }));

// The synthetic study: series P (frame P) loaded, and the report series
const mockStore = { series: [], displaySets: [] };
jest.mock('@ohif/core', () => {
  const landmarks = jest.requireActual('../../../../core/src/DICOMSR/landmarks').default;
  const MeasurementApi = {
    getConfiguration: () => ({ measurementTools: [{ id: 'allTools', name: 'Measurements', childTools: [] }] }),
    Instance: { _serviceManagedTool: () => ({ toolServiceManaged: false }), measurementService: { getMeasurements: () => [] } },
  };
  const DicomMetadataStore = {
    getStudyInstanceUIDs: () => ['2.25.1001'],
    getStudy: uid => (uid === '2.25.1001' ? { StudyInstanceUID: uid, series: mockStore.series } : undefined),
    getSeries: (uid, seriesUid) => mockStore.series.find(series => series.SeriesInstanceUID === seriesUid),
  };
  return {
    __esModule: true,
    default: {
      redux: { actions: {} },
      measurements: { MeasurementApi },
      display: { DisplaySetApi: { Instance: { displaySetService: { get activeDisplaySets() { return mockStore.displaySets; } } } } },
      DICOMSR: { landmarks, outOfPlane: { isOutOfPlaneMeasurement: () => false } },
    },
    DICOMSR: { isToolSupported: () => true, Enums: { TOOL_NAMES: {} }, SREnums: { TOOL_NAMES: {} } },
    DicomMetadataStore,
    displayAttributes: {},
  };
});

const { default: OHIF, DicomMetadataStore } = require('@ohif/core');
const { clearHydratedReports } = require('../../../../core/src/DICOMSR/utils/srDocument');
const { convertMeasurementsToTableData } = require('./ConnectedMeasurementTable');

const FIXTURES = path.join(__dirname, '../../../../core/src/DICOMSR/__fixtures__');
const { readDicomFile } = require('../../../../core/src/utils/dicomCharacterSet');
const fixture = (topic) => {
  const buffer = fs.readFileSync(path.join(FIXTURES, `sonador-io.${topic}.2026-1114.dcm`));
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return dcmjsData.DicomMetaDictionary.naturalizeDataset(readDicomFile(arrayBuffer).dict);
};

const P = { SeriesInstanceUID: '2.25.1002', Modality: 'MR', instances: [{ SOPInstanceUID: '2.25.1003', SOPClassUID: '1.2.840.10008.5.1.4.1.1.4', FrameOfReferenceUID: '2.25.45100', Modality: 'MR' }] };
const list = (...topics) => topics.forEach(topic => OHIF.DICOMSR.landmarks.addLandmarkSetsOf(fixture(topic), DicomMetadataStore));
const landmarkGroup = () => convertMeasurementsToTableData({}, [{ timepointId: 'tp-1' }]).find(group => group.groupId === 'landmarks');

beforeEach(() => {
  clearHydratedReports();
  mockStore.series = [P];
  mockStore.displaySets = [{ displaySetInstanceUID: 'ds-p', SeriesInstanceUID: P.SeriesInstanceUID }];
});


it('lists the set of the mixed document as one row of a Landmarks group, never as a measurement', () => {
  list('landmarks-mixed');
  const groups = convertMeasurementsToTableData({}, [{ timepointId: 'tp-1' }]);
  expect(groups.map(group => group.groupName)).toEqual(['Landmarks']);
  const [row] = groups[0].measurements;
  expect(row).toMatchObject({
    toolType: 'SonadorLandmarkSet',
    itemNumber: 1,
    data: [{ displayText: 'Pelvic landmarks' }],
    // The label beside the concept, then the description
    label: 'Pelvis (planning) / Points picked on the planning model',
    isReadOnly: true,
    isLocked: true,
    isPending: false,
    refStudyInstanceUID: '2.25.1001',
    refSeriesInstanceUID: '2.25.1002',
    landmarkSet: { count: 10, domain: 'patient', documentKind: 'exchange', placed: true, sourceSeries: '2.25.1002' },
  });
});

it('one row per set and per document: the same tracking UID in two documents gives two rows, numbered in the group', () => {
  list('landmarks-patient', 'landmarks-exchange', 'landmarks-patient');
  const rows = landmarkGroup().measurements;
  expect(rows.map(row => [row.itemNumber, row.landmarkSet.documentKind])).toEqual([[1, 'application'], [2, 'exchange']]);
  expect(new Set(rows.map(row => row.measurementId)).size).toBe(2);
});

it('a held set keeps its row, with the note of its state, and follows its series as it is loaded', () => {
  list('landmarks-patient', 'landmarks-image', 'landmarks-application-frame');
  const held = () => landmarkGroup().measurements.map(row => [row.data[0].displayText, row.landmarkSet.placed, row.landmarkSet.note]);
  expect(held()).toEqual([
    ['Pelvic landmarks', true, undefined],
    ['Image landmarks', true, undefined],
    ['Second image set', false, 'The image this landmark set was placed on is not loaded.'],
    ['Anatomic frame set', false, "No loaded series shares this measurement's frame of reference."],
    ['Implant frame set', false, "No loaded series shares this measurement's frame of reference."],
  ]);
  // The display set of its series removed: held, although the metadata stays cached
  mockStore.displaySets = [];
  expect(held()[0]).toEqual(['Pelvic landmarks', false, "No loaded series shares this measurement's frame of reference."]);
  expect(mockStore.series).toEqual([P]);
  expect(landmarkGroup().measurements).toHaveLength(5);
});

it('a set attributed to its document\'s series has no series, so it is listed under Series Unavailable', () => {
  list('landmarks-application-frame', 'point-collection-legacy');
  expect(landmarkGroup().measurements.map(row => [row.data[0].displayText, row.refSeriesInstanceUID])).toEqual([
    ['Anatomic frame set', undefined], ['Implant frame set', undefined],
    // No Source-Series: the one referenced series of its frame
    ['Femoral head points', '2.25.1002'], ['Axis line', '2.25.1002'],
  ]);
});

it('an unnamed set reads "Landmark set"', () => {
  const dataset = fixture('landmarks-image');
  const group = dataset.ContentSequence.find(item => item.ConceptNameCodeSequence[0].CodeValue === '126010').ContentSequence[0];
  group.ContentSequence = group.ContentSequence.filter(item => item.ConceptNameCodeSequence[0].CodeValue !== '121071');
  OHIF.DICOMSR.landmarks.addLandmarkSetsOf(dataset, DicomMetadataStore);
  expect(landmarkGroup().measurements[0].data[0].displayText).toBe('Landmark set');
});

it('lists no Landmarks group without a set', () => {
  expect(landmarkGroup()).toBeUndefined();
});
