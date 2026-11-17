// Landmark sets answer the global visibility from the start, before the Annotations panel has been
// opened: with the source registered as the panel's extension is initialised, the production
// Measurements API's global hide and show reach every set of the session's documents, and its query
// of whether every annotation is hidden reads them. Building the panel's rows later registers nothing
// more, and each global toggle reaches the sets once.

import fs from 'fs';
import path from 'path';
import { data as dcmjsData } from 'dcmjs';

jest.mock('cornerstone-core', () => ({}), { virtual: true });
jest.mock('cornerstone-tools', () => ({ globalImageIdSpecificToolStateManager: { saveToolState: () => ({}), restoreToolState: () => {} } }), { virtual: true });
jest.mock('@cornerstonejs/core', () => ({ metaData: { get: () => undefined } }), { virtual: true });
jest.mock('@cornerstonejs/adapters', () => ({
  adaptersSR: { Cornerstone3D: { CodeScheme: { CodingSchemeDesignator: 'CORNERSTONEJS', codeValues: { CORNERSTONEFREETEXT: 'CORNERSTONEFREETEXT' } } } },
}), { virtual: true });
// The modules the production Measurements API reads through
jest.mock('../../../../core/src/utils', () => ({
  __esModule: true,
  default: { dataProc: { firstDefinedValue: (...values) => values.find(value => value !== undefined) } },
}));
jest.mock('../../../../core/src/utils/studyMetadataManager', () => ({ __esModule: true, default: { get: () => undefined } }));
jest.mock('../../../../core/src/log', () => ({ __esModule: true, default: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }));
jest.mock('../../../../core/src/measurements/configuration.js', () => ({ measurementApiDefaultConfig: {} }));
jest.mock('../../../../core/src/measurements/enums', () => {
  const Enums = { SREnums: jest.requireActual('../../../../core/src/DICOMSR/enums').Enums, EVENTS: {}, Cornerstone3D: { sr: {} } };
  return { __esModule: true, default: Enums, Enums };
});
jest.mock('../../../../core/src/measurements/lib/refreshCornerstoneViewports', () => ({ __esModule: true, default: () => {} }));
jest.mock('../../../../core/src/measurements/lib/getImageIdForImagePath', () => ({ __esModule: true, default: () => '' }));
jest.mock('../../../../core/src/measurements/classes', () => ({ MeasurementApi: {} }));
jest.mock('../../../../core/src/DICOMSR/readOnly/srDisplayAnnotations', () => ({}));

const mockStore = { series: [], displaySets: [] };
jest.mock('@ohif/core', () => {
  const landmarks = jest.requireActual('../../../../core/src/DICOMSR/landmarks').default;
  const MeasurementApi = jest.requireActual('../../../../core/src/measurements/classes/MeasurementApi').default;
  const DicomMetadataStore = {
    getStudyInstanceUIDs: () => ['2.25.1001'],
    getStudy: uid => (uid === '2.25.1001' ? { StudyInstanceUID: uid, series: mockStore.series } : undefined),
    getSeries: (uid, seriesUid) => mockStore.series.find(series => series.SeriesInstanceUID === seriesUid),
  };
  return {
    __esModule: true,
    default: {
      measurements: { MeasurementApi },
      display: { DisplaySetApi: { Instance: { displaySetService: { get activeDisplaySets() { return mockStore.displaySets; } } } } },
      DICOMSR: { landmarks },
    },
    DicomMetadataStore,
  };
});

const { default: OHIF, DicomMetadataStore } = require('@ohif/core');
const { clearHydratedReports } = require('../../../../core/src/DICOMSR/utils/srDocument');
const { readDicomFile } = require('../../../../core/src/utils/dicomCharacterSet');
const { landmarksGroup, registerLandmarkVisibilitySource } = require('./landmarkSetRows');

const FIXTURES = path.join(__dirname, '../../../../core/src/DICOMSR/__fixtures__');
const fixture = (topic) => {
  const buffer = fs.readFileSync(path.join(FIXTURES, `sonador-io.${topic}.2026-1114.dcm`));
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return dcmjsData.DicomMetaDictionary.naturalizeDataset(readDicomFile(arrayBuffer).dict);
};

// The production Measurements API with no measurement: a session of landmark sets only
const { MeasurementApi } = OHIF.measurements;
const api = Object.assign(Object.create(MeasurementApi.prototype), {
  measurementService: { setMeasurementsVisibility: () => {}, getMeasurements: () => [], getMeasurement: () => undefined },
  tools: {},
  onMeasurementsUpdated: () => {},
});
const { landmarks } = OHIF.DICOMSR;
const visibility = () => landmarks.getLandmarkSets().map(entry => landmarks.isLandmarkSetVisible(entry.key));

beforeAll(() => {
  // As the panel's extension does when it is initialised
  registerLandmarkVisibilitySource();
});
beforeEach(() => {
  clearHydratedReports();
  ['landmarks-patient', 'landmarks-exchange', 'landmarks-application-frame'].forEach(topic => landmarks.addLandmarkSetsOf(fixture(topic), DicomMetadataStore));
});


it('hides and shows every set, held ones included, before the panel is opened', () => {
  expect(visibility()).toEqual([true, true, true, true]);
  api.setAllMeasurementsVisibility(false);
  expect(visibility()).toEqual([false, false, false, false]);
  api.setAllMeasurementsVisibility(true);
  expect(visibility()).toEqual([true, true, true, true]);
});

it('counts the sets when every annotation is asked to be hidden, before the panel is opened', () => {
  expect(api.areAllMeasurementsHidden()).toBe(false);
  landmarks.setLandmarkSetsVisible(false);
  expect(api.areAllMeasurementsHidden()).toBe(true);
  landmarks.setLandmarkSetVisible(landmarks.getLandmarkSets()[0].key, true);
  expect(api.areAllMeasurementsHidden()).toBe(false);
});

it('registers nothing more when the panel builds its rows, and each global toggle reaches the sets once', () => {
  landmarksGroup();
  landmarksGroup();
  const listener = jest.fn();
  const { unsubscribe } = landmarks.subscribe(listener);
  api.setAllMeasurementsVisibility(false);
  expect(listener.mock.calls.filter(([event]) => event.type === landmarks.EVENTS.VISIBILITY_CHANGED)).toHaveLength(1);
  expect(visibility()).toEqual([false, false, false, false]);
  unsubscribe();
});
