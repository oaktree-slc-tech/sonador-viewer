// The read-only path on the synthetic documents in __fixtures__ (written by the Sonador IO client,
// see __fixtures__/scripts): an application document's
// measurements are drawn in place from the patient coordinates it holds, on the synthetic CT series
// (unequal row and column spacing, slices 3 mm apart), and an exchange document's measurements
// read the same way.

import fs from 'fs';
import path from 'path';
import { data as dcmjsData } from 'dcmjs';

jest.mock('@cornerstonejs/adapters', () => ({
  adaptersSR: { Cornerstone3D: { CodeScheme: { codeValues: { CORNERSTONEFREETEXT: 'CST' } }, MeasurementReport: {} } },
}), { virtual: true });
jest.mock('@cornerstonejs/core', () => ({ metaData: { get: () => undefined } }), { virtual: true });
jest.mock('../../utils', () => ({ __esModule: true, default: { sortStudyInstances: () => {} } }));
jest.mock('../../classes', () => ({ __esModule: true, default: { ImageSet: class {}, Cornerstone3dMetadataProvider: {} } }));
jest.mock('../../measurements', () => {
  const { Enums: SREnums } = jest.requireActual('../enums');
  return {
    __esModule: true,
    default: { Enums: { Cornerstone3D: { sr: { measurementReport: { codeValueMatch: () => false } } } }, SREnums },
  };
});
jest.mock('../../measurements/classes', () => ({ MeasurementApi: { Instance: {} } }));
jest.mock('../../measurements/enums', () => {
  const Enums = { SREnums: jest.requireActual('../enums').Enums, EVENTS: {}, Cornerstone3D: { sr: {} } };
  return { __esModule: true, default: Enums, Enums };
});
jest.mock('../../types', () => ({ __esModule: true, default: {} }));
jest.mock('../../services/DicomMetadataStore', () => ({ __esModule: true, default: {} }));
jest.mock('../../services/DisplaySetService', () => ({ __esModule: true, default: {} }));
jest.mock('../Cornerstone3d/utils/isRehydratable', () => ({ __esModule: true, default: () => true }));

const mockInfo = jest.fn();
jest.mock('../../log', () => ({ __esModule: true, default: { info: (...args) => mockInfo(...args), warn: () => {}, error: () => {}, debug: () => {} } }));

// The Series Tag of an application document is hydrated, so it is not drawn again
const mockHydrated = new Set(['2.25.31617055']);
jest.mock('../../measurements/classes/MeasurementApi', () => ({
  __esModule: true,
  default: { Instance: { getMeasurementByTrackingUid: uid => (mockHydrated.has(uid) ? { uid } : undefined), syncMeasurementsAndToolData: () => {} } },
}));
const mockPlaced = [];
jest.mock('../SCOORD3D/utils/addMeasurement', () => ({
  __esModule: true,
  default: (measurement, imageId, instance, displaySetInstanceUID, options = {}) => mockPlaced.push({
    uid: measurement.TrackingUniqueIdentifier, imageId, instance, listed: options.listed !== false,
  }),
}));
const mockPatientOnly = [];
jest.mock('./srDisplayAnnotations', () => ({
  addSRDisplayAnnotation: ({ measurement }) => {
    mockPatientOnly.push(measurement.TrackingUniqueIdentifier);
    return {};
  },
  renderSRDisplayAnnotations: () => {},
}));

import { getMeasurements } from '../Cornerstone3d/initDisplaySetMeasurements';
import addReadOnlyMeasurements from './addReadOnlyMeasurements';
import { imageToWorld, planeFromInstance, worldToImage } from './planeGeometry';

const FIXTURES = path.join(__dirname, '..', '__fixtures__');
const read = (file) => {
  const buffer = fs.readFileSync(path.join(FIXTURES, file));
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return dcmjsData.DicomMetaDictionary.naturalizeDataset(dcmjsData.DicomMessage.readFile(arrayBuffer).dict);
};

// The synthetic CT series: 64 columns 1.2 mm apart, 48 rows 0.8 mm apart, 12 slices at z = 0 to 33
const slices = Array.from({ length: 12 }, (_unused, index) => read(`synthetic-ct/ct-${String(index + 1).padStart(2, '0')}.dcm`));
const ctDisplaySet = () => ({
  displaySetInstanceUID: 'ds-synthetic-ct', SRLabels: [], images: slices.map(metadata => ({ getData: () => ({ metadata }) })),
});
const imageIds = { sopInstanceUIDToImageId: Object.fromEntries(slices.map((slice, index) => [slice.SOPInstanceUID, `synthetic-ct:${index + 1}`])) };
const SLICE_AT_Z9 = slices[3];

const srDisplaySet = (file, isApplicationDocument) => {
  const dataset = read(file);
  return { SOPInstanceUID: dataset.SOPInstanceUID, isApplicationDocument, measurements: getMeasurements(dataset.ContentSequence), referencedDisplaySets: [] };
};
const byUid = (measurements, uid) => measurements.find(measurement => measurement.TrackingUniqueIdentifier === uid);
const pointsOf = coord => _chunk(Array.from(coord.GraphicData), 3);
function _chunk(values, size) {
  return Array.from({ length: values.length / size }, (_unused, index) => values.slice(index * size, (index + 1) * size));
}

beforeEach(() => {
  mockPlaced.length = 0;
  mockPatientOnly.length = 0;
  mockInfo.mockClear();
});


describe('the synthetic application document, read-only', () => {
  it('reads every measurement group with its properties from under the NUM item', () => {
    const { measurements } = srDisplaySet('sonador-io.application-document.dcm', true);
    expect(measurements.map(m => [m.TrackingIdentifier, m.TrackingUniqueIdentifier]).slice(1)).toEqual([
      ['cornerstoneTools@^4.0.0:DICOMSRSeriesTagTool', '2.25.31617055'],
      ['cornerstoneTools@^4.0.0:Length', '2.25.31617051'],
      ['cornerstoneTools@^4.0.0:Angle', '2.25.31617052'],
      ['cornerstoneTools@^4.0.0:CobbAngle', '2.25.31617053'],
      ['cornerstoneTools@^4.0.0:CircleROI', '2.25.31617057'],
      ['cornerstoneTools@^4.0.0:Length', '2.25.31617054'],
    ]);
    // The primary group: a scalar measurement under the application's own tracking identifier
    expect(measurements[0]).toMatchObject({ TrackingIdentifier: 'Clinical-Report', coords: [] });

    const length = byUid(measurements, '2.25.31617051');
    expect(length).toMatchObject({
      description: 'Length (synthetic)',
      metadata: { text: 'Synthetic', location: 'Synthetic location', views: ['axial'] },
      displayAttributes: { Color: { Border: '#FF8800' } },
    });

    // The circle: its ELLIPSE in the patient domain, its properties from under the Area NUM
    const circle = byUid(measurements, '2.25.31617057');
    expect(circle).toMatchObject({ description: 'Circle (synthetic)', metadata: { views: ['axial'] } });
    expect(circle.coords.map(coord => [coord.ValueType, coord.GraphicType])).toContainEqual(['SCOORD3D', 'ELLIPSE']);
    expect(pointsOf(circle.coords[0])).toEqual([[4, -8, 9], [16, -8, 9], [10, -14, 9], [10, -2, 9]]);
  });

  it('draws the Cornerstone groups, unlisted, and names the groups it ignores in one log line', () => {
    const document = srDisplaySet('sonador-io.application-document.dcm', true);
    const summary = addReadOnlyMeasurements({ srDisplaySets: [document], imageDisplaySets: [ctDisplaySet()], imageIds });

    // The Length, Angle, Cobb angle and circle lie on the slice at z = 9; the Length at z = 10.5 lies
    // 1.5 mm from the nearest slice and is drawn in the Cornerstone3D viewports only
    expect(mockPlaced.map(({ uid, imageId, listed }) => [uid, imageId, listed])).toEqual([
      ['2.25.31617051', 'synthetic-ct:4', false],
      ['2.25.31617052', 'synthetic-ct:4', false],
      ['2.25.31617053', 'synthetic-ct:4', false],
      ['2.25.31617057', 'synthetic-ct:4', false],
    ]);
    expect(mockPatientOnly).toEqual(['2.25.31617054']);
    expect(summary).toEqual({ placed: 4, patientOnly: 1, skipped: 0 });

    const [line] = mockInfo.mock.calls.filter(([message]) => /application document 2\.25\.316170500/.test(message));
    expect(line[1]).toEqual([
      'cornerstoneTools@^4.0.0:Length 2.25.31617051', 'cornerstoneTools@^4.0.0:Angle 2.25.31617052',
      'cornerstoneTools@^4.0.0:CobbAngle 2.25.31617053', 'cornerstoneTools@^4.0.0:CircleROI 2.25.31617057',
      'cornerstoneTools@^4.0.0:Length 2.25.31617054',
    ]);
    // The Series Tag is shown through its hydrated annotation, not drawn here
    expect(line[3]).toEqual([
      expect.stringMatching(/^Clinical-Report \S+: not a Cornerstone tracking identifier$/),
      'cornerstoneTools@^4.0.0:DICOMSRSeriesTagTool 2.25.31617055: no coordinates',
    ]);
  });

  it('keeps the patient coordinates written, and places them on the image at known pixel positions', () => {
    const document = srDisplaySet('sonador-io.application-document.dcm', true);
    addReadOnlyMeasurements({ srDisplaySets: [document], imageDisplaySets: [ctDisplaySet()], imageIds });
    const plane = planeFromInstance(SLICE_AT_Z9);
    expect([plane.rowPixelSpacing, plane.columnPixelSpacing]).toEqual([0.8, 1.2]);

    const [length] = byUid(document.measurements, '2.25.31617051').coords;
    expect(pointsOf(length)).toEqual([[-20, -10, 9], [20, 5, 9]]);
    expect(length.ReferencedSOPSequence.ReferencedSOPInstanceUID).toBe(SLICE_AT_Z9.SOPInstanceUID);

    // Image origin (first pixel centre) at (-38.4, -19.2, 9): columns step 1.2 mm along x, rows 0.8 mm along y
    const pixels = pointsOf(length).map(point => worldToImage(plane, point));
    pixels.forEach(([x, y], index) => {
      expect(x).toBeCloseTo([15.8333333, 49.1666667][index], 6);
      expect(y).toBeCloseTo([12, 30.75][index], 6);
    });
    pixels.map(pixel => imageToWorld(plane, pixel)).forEach((point, index) => {
      point.forEach((value, axis) => expect(value).toBeCloseTo(pointsOf(length)[index][axis], 9));
    });

    // Never flattened onto an image: the Length between slices keeps z = 10.5
    expect(pointsOf(byUid(document.measurements, '2.25.31617054').coords[0])).toEqual([[-10, -10, 10.5], [10, 10, 10.5]]);
  });
});


describe('the synthetic exchange document, read-only', () => {
  it('reads the same measurements on the slice at z = 18, and lists them', () => {
    const exchange = srDisplaySet('sonador-io.exchange-document.dcm', false);
    const application = srDisplaySet('sonador-io.application-document.dcm', true);
    const geometry = (measurements, uids) => uids.map(uid => byUid(measurements, uid).coords.map(pointsOf));
    const uids = ['2.25.31617061', '2.25.31617062', '2.25.31617063', '2.25.31617067'];
    expect(geometry(exchange.measurements, uids)).toEqual(
      geometry(application.measurements, ['2.25.31617051', '2.25.31617052', '2.25.31617053', '2.25.31617057'])
        .map(coords => coords.map(points => points.map(([x, y]) => [x, y, 18]))));

    addReadOnlyMeasurements({ srDisplaySets: [exchange], imageDisplaySets: [ctDisplaySet()], imageIds });
    expect(mockPlaced.map(({ uid, imageId, listed }) => [uid, imageId, listed])).toEqual([
      ['2.25.31617061', 'synthetic-ct:7', true], ['2.25.31617062', 'synthetic-ct:7', true], ['2.25.31617063', 'synthetic-ct:7', true],
      ['2.25.31617067', 'synthetic-ct:7', true],
    ]);
  });
});


describe('the Bidirectional documents of Sonador IO and the stock adapter, read-only', () => {
  // The synthetic frame 2.25.1003 they reference (origin, axial, 2 mm rows, 0.5 mm columns), Frame of
  // Reference 2.25.7001
  const frame = {
    SOPInstanceUID: '2.25.1003', SOPClassUID: '1.2.840.10008.5.1.4.1.1.4', FrameOfReferenceUID: '2.25.7001',
    ImagePositionPatient: [0, 0, 0], ImageOrientationPatient: [1, 0, 0, 0, 1, 0], PixelSpacing: [2, 0.5],
  };
  const frameDisplaySet = () => ({ displaySetInstanceUID: 'ds-synthetic-frame', SRLabels: [], images: [{ getData: () => ({ metadata: frame }) }] });
  const frameIds = { sopInstanceUIDToImageId: { '2.25.1003': 'synthetic-frame:1' } };

  [
    ['sonador-io.bidirectional-image.2026-1113.dcm', 'SCOORD', 'placed'],
    ['sonador-io.bidirectional-axial.2026-1113.dcm', 'SCOORD3D', 'patientOnly'],
    ['sonador-io.bidirectional-oblique.2026-1113.dcm', 'SCOORD3D', 'patientOnly'],
    ['cornerstone-adapters.bidirectional-image.2026-1113.dcm', 'SCOORD', 'placed'],
    ['cornerstone-adapters.bidirectional-patient.2026-1113.dcm', 'SCOORD3D', 'patientOnly'],
  ].forEach(([file, valueType, drawn]) => {
    it(`${file}: draws both axes, labelled Long Axis first`, () => {
      const document = srDisplaySet(file, true);
      const [measurement] = document.measurements;
      expect(measurement.TrackingIdentifier).toMatch(/:Bidirectional$/);
      expect(measurement.coords.map(coord => [coord.ValueType, coord.GraphicType])).toEqual([[valueType, 'POLYLINE'], [valueType, 'POLYLINE']]);

      const summary = addReadOnlyMeasurements({ srDisplaySets: [document], imageDisplaySets: [frameDisplaySet()], imageIds: frameIds });
      expect(summary[drawn]).toBe(1);
      expect(summary.skipped).toBe(0);
      // Without a description, the NUM labels in document order, the Long Axis first
      if (!measurement.description) {
        expect(measurement.labels.map(label => label.label)).toEqual(['Long Axis', 'Short Axis']);
      }
    });
  });
});
