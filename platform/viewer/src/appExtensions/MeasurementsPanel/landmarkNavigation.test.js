// Navigation to the landmarks of a set from the panel, against the core store over the Sonador IO
// fixtures: selecting a placed set's row steps through its landmarks (the first, the next, the first
// again after the last), a held set's does not, and choosing a named landmark makes it the current
// one. The viewport goes to the landmark's own coordinates: in the classic viewport through
// `jumpToLandmark` with the set's own series first, in the MPR view through `jumpToMprWorldPoint`
// when the view shows a series of the set's frame. An image-domain set goes to its image and frame,
// and in the MPR view to its patient position when its image has geometry. The selection moves
// whether or not a view shows the landmark, and on a hidden set.

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
const FIXTURES = path.join(__dirname, '../../../../core/src/DICOMSR/__fixtures__');
const { readDicomFile } = require('../../../../core/src/utils/dicomCharacterSet');
const fixture = (topic) => {
  const buffer = fs.readFileSync(path.join(FIXTURES, `sonador-io.${topic}.2026-1114.dcm`));
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return dcmjsData.DicomMetaDictionary.naturalizeDataset(readDicomFile(arrayBuffer).dict);
};
const { chooseLandmark, patientPointOfImagePoint, stepLandmarkRow } = require('./landmarkNavigation');
const { landmarkSetRow } = require('./landmarkSetRows');

const MR = '1.2.840.10008.5.1.4.1.1.4';
const P = { SeriesInstanceUID: '2.25.1002', Modality: 'MR', instances: [{ SOPInstanceUID: '2.25.1003', SOPClassUID: MR, FrameOfReferenceUID: '2.25.45100', Modality: 'MR' }] };
// A second series of frame P
const Q = { SeriesInstanceUID: '2.25.1009', Modality: 'MR', instances: [{ SOPInstanceUID: '2.25.1010', SOPClassUID: MR, FrameOfReferenceUID: '2.25.45100', Modality: 'MR' }] };
const CLASSIC = { activeViewportIndex: 1, layout: { viewports: [{}, {}] }, viewportSpecificData: {} };
const mpr = (StudyInstanceUID, SeriesInstanceUID) => ({
  activeViewportIndex: 0, layout: { viewports: [{ vtk: true }] }, viewportSpecificData: { 0: { StudyInstanceUID, SeriesInstanceUID } },
});

let commands;
const commandsManager = { runCommand: (name, args) => { commands.push([name, args]); return name === 'jumpToMprWorldPoint' ? { panes: 3 } : 'shown'; } };
const rowOf = (index = 0) => landmarkSetRow(OHIF.DICOMSR.landmarks.getLandmarkSets()[index]);
const setOf = (index = 0) => OHIF.DICOMSR.landmarks.getLandmarkSets()[index].set;
const list = (...topics) => topics.forEach(topic => OHIF.DICOMSR.landmarks.addLandmarkSetsOf(fixture(topic), DicomMetadataStore));

beforeEach(() => {
  clearHydratedReports();
  commands = [];
  mockStore.series = [P, Q];
  mockStore.displaySets = [{ SeriesInstanceUID: P.SeriesInstanceUID }, { SeriesInstanceUID: Q.SeriesInstanceUID }];
});


describe('selecting a placed set in the classic viewport', () => {
  it("steps through its landmarks and wraps, each to its own coordinates, the set's own series first", () => {
    list('landmarks-mixed');
    const { landmarks } = setOf();
    const steps = Array.from({ length: landmarks.length + 1 }, () => {
      stepLandmarkRow(rowOf(), { viewportsState: CLASSIC, commandsManager });
      return OHIF.DICOMSR.landmarks.getCurrentLandmark().index;
    });
    expect(steps).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0]);
    expect(commands.map(([name]) => name).every(name => name === 'jumpToLandmark')).toBe(true);
    expect(commands[0][1]).toEqual({
      worldPoint: landmarks[0].point, activeViewportIndex: 1,
      series: [{ StudyInstanceUID: '2.25.1001', SeriesInstanceUID: '2.25.1002' }, { StudyInstanceUID: '2.25.1001', SeriesInstanceUID: '2.25.1009' }],
    });
    expect(commands[4][1].worldPoint).toEqual(landmarks[4].point);
  });

  it('still moves the selection when no stack holds the landmark', () => {
    list('landmarks-mixed');
    const none = { runCommand: (name, args) => { commands.push([name, args]); return 'none'; } };
    expect(stepLandmarkRow(rowOf(), { viewportsState: CLASSIC, commandsManager: none })).toBe('none');
    expect(stepLandmarkRow(rowOf(), { viewportsState: CLASSIC, commandsManager: none })).toBe('none');
    expect(OHIF.DICOMSR.landmarks.getCurrentLandmark().index).toBe(1);
  });

  it('still steps a hidden set', () => {
    list('landmarks-mixed');
    OHIF.DICOMSR.landmarks.setLandmarkSetVisible(rowOf().measurementId, false);
    stepLandmarkRow(rowOf(), { viewportsState: CLASSIC, commandsManager });
    stepLandmarkRow(rowOf(), { viewportsState: CLASSIC, commandsManager });
    expect(OHIF.DICOMSR.landmarks.getCurrentLandmark().index).toBe(1);
  });
});


describe('choosing a named landmark', () => {
  it('makes it the current one and goes to its own coordinates: each of two "Tear drop" landmarks its own', () => {
    list('landmarks-mixed');
    const { landmarks } = setOf();
    chooseLandmark(rowOf(), 7, { viewportsState: CLASSIC, commandsManager });
    expect(OHIF.DICOMSR.landmarks.getCurrentLandmark().index).toBe(7);
    chooseLandmark(rowOf(), 8, { viewportsState: CLASSIC, commandsManager });
    expect(OHIF.DICOMSR.landmarks.getCurrentLandmark().index).toBe(8);
    expect(commands.map(([, args]) => args.worldPoint)).toEqual([landmarks[7].point, landmarks[8].point]);
    expect(landmarks[7].point).not.toEqual(landmarks[8].point);
    // The next step goes on from it
    stepLandmarkRow(rowOf(), { viewportsState: CLASSIC, commandsManager });
    expect(OHIF.DICOMSR.landmarks.getCurrentLandmark().index).toBe(9);
  });
});


describe('a held set', () => {
  it('neither steps nor navigates, from its row or its card', () => {
    list('landmarks-mixed');
    mockStore.displaySets = [];
    expect(stepLandmarkRow(rowOf(), { viewportsState: CLASSIC, commandsManager })).toBe('held');
    expect(chooseLandmark(rowOf(), 2, { viewportsState: CLASSIC, commandsManager })).toBe('held');
    expect(OHIF.DICOMSR.landmarks.getCurrentLandmark()).toBeNull();
    expect(commands).toEqual([]);
  });
});


describe('in the MPR view', () => {
  it('moves the panes to the landmark when the view shows a series of its frame', () => {
    list('landmarks-mixed');
    stepLandmarkRow(rowOf(), { viewportsState: mpr('2.25.1001', '2.25.1009'), commandsManager });
    expect(commands).toEqual([['jumpToMprWorldPoint', { worldPoint: setOf().landmarks[0].point }]]);
  });

  it('moves nothing when the view shows another frame, and the selection still moves', () => {
    list('landmarks-mixed');
    mockStore.series = [P, Q, { SeriesInstanceUID: '2.25.2000', instances: [{ SOPClassUID: MR, FrameOfReferenceUID: '2.25.9999' }] }];
    expect(stepLandmarkRow(rowOf(), { viewportsState: mpr('2.25.1001', '2.25.2000'), commandsManager })).toBe('none');
    expect(commands).toEqual([]);
    expect(OHIF.DICOMSR.landmarks.getCurrentLandmark().index).toBe(0);
  });
});


describe('an image-domain set', () => {
  it('goes to its image and frame in the classic viewport', () => {
    list('landmarks-image');
    stepLandmarkRow(rowOf(), { viewportsState: CLASSIC, commandsManager });
    expect(commands).toEqual([['jumpToImage', { StudyInstanceUID: '2.25.1001', SOPInstanceUID: '2.25.1003', frameNumber: 1, activeViewportIndex: 1 }]]);
  });

  it("in the MPR view, moves the panes to the point's patient position when its image has geometry; with none, nothing moves", () => {
    list('landmarks-image');
    const view = mpr('2.25.1001', '2.25.1002');
    expect(stepLandmarkRow(rowOf(), { viewportsState: view, commandsManager })).toBe('none');
    expect(commands).toEqual([]);
    expect(OHIF.DICOMSR.landmarks.getCurrentLandmark().index).toBe(0);

    Object.assign(P.instances[0], { ImagePositionPatient: [-100, -50, 20], ImageOrientationPatient: [1, 0, 0, 0, 1, 0], PixelSpacing: [0.5, 0.25] });
    stepLandmarkRow(rowOf(), { viewportsState: view, commandsManager });
    const [column, row] = setOf().landmarks[1].point;
    expect(commands).toEqual([['jumpToMprWorldPoint', { worldPoint: [-100 + (column - 0.5) * 0.25, -50 + (row - 0.5) * 0.5, 20] }]]);
    ['ImagePositionPatient', 'ImageOrientationPatient', 'PixelSpacing'].forEach(key => delete P.instances[0][key]);
  });

  it('never moves an MPR view of another frame, whatever the image geometry; the selection still moves', () => {
    list('landmarks-image');
    Object.assign(P.instances[0], { ImagePositionPatient: [-100, -50, 20], ImageOrientationPatient: [1, 0, 0, 0, 1, 0], PixelSpacing: [0.5, 0.25] });
    mockStore.series = [P, Q, { SeriesInstanceUID: '2.25.2000', instances: [{ SOPClassUID: MR, FrameOfReferenceUID: '2.25.9999' }] }];
    expect(stepLandmarkRow(rowOf(), { viewportsState: mpr('2.25.1001', '2.25.2000'), commandsManager })).toBe('none');
    expect(commands).toEqual([]);
    expect(OHIF.DICOMSR.landmarks.getCurrentLandmark().index).toBe(0);
    // A series of the image's own frame (control)
    stepLandmarkRow(rowOf(), { viewportsState: mpr('2.25.1001', '2.25.1009'), commandsManager });
    expect(commands.map(([name]) => name)).toEqual(['jumpToMprWorldPoint']);
    ['ImagePositionPatient', 'ImageOrientationPatient', 'PixelSpacing'].forEach(key => delete P.instances[0][key]);
  });

  it('takes no patient position from incomplete geometry; a numeric zero is a value', () => {
    const geometry = { ImageOrientationPatient: [1, 0, 0, 0, 1, 0], PixelSpacing: [1, 1] };
    expect(patientPointOfImagePoint({ ...geometry, ImagePositionPatient: ['', '0', '12'] }, [0.5, 0.5])).toBeUndefined();
    expect(patientPointOfImagePoint({ ...geometry, ImagePositionPatient: '\\0\\12' }, [0.5, 0.5])).toBeUndefined();
    expect(patientPointOfImagePoint({ ...geometry, ImagePositionPatient: [null, 0, 12] }, [0.5, 0.5])).toBeUndefined();
    expect(patientPointOfImagePoint({ ...geometry, ImagePositionPatient: [0, 0, 12] }, [0.5, 0.5])).toEqual([0, 0, 12]);
    expect(patientPointOfImagePoint({ ...geometry, ImagePositionPatient: '0\\0\\12' }, [0.5, 0.5])).toEqual([0, 0, 12]);
  });

  it('places the top left corner of the top left pixel at 0, 0', () => {
    const instance = { ImagePositionPatient: [10, 20, 30], ImageOrientationPatient: [0, 1, 0, 0, 0, -1], PixelSpacing: [2, 3] };
    expect(patientPointOfImagePoint(instance, [0.5, 0.5])).toEqual([10, 20, 30]);
    expect(patientPointOfImagePoint(instance, [1.5, 2.5])).toEqual([10, 23, 26]);
    expect(patientPointOfImagePoint({}, [1, 1])).toBeUndefined();
  });
});
