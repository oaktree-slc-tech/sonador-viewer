// A save writes the session's measurements into one report, against the save parent. A Series Tag
// hydrated from an application document is shown read-only and never written: the save would copy
// it into another document. The application document is never the parent.

// The module uses the lodash global webpack provides
global._ = require('lodash');

jest.mock('@cornerstonejs/core', () => ({ utilities: {} }), { virtual: true });
jest.mock('@cornerstonejs/adapters', () => ({
  adaptersSR: { Cornerstone3D: { CodeScheme: { CodingSchemeDesignator: 'CORNERSTONEJS', codeValues: {} } } },
}), { virtual: true });
jest.mock('cornerstone-core', () => ({
  metaData: {
    get: (type) => ({
      generalSeriesModule: { studyInstanceUID: '2.25.1', seriesInstanceUID: '2.25.2' },
      // An axial image
      imagePlaneModule: { rowCosines: [1, 0, 0], columnCosines: [0, 1, 0] },
    })[type],
  },
}), { virtual: true });
jest.mock('../log', () => ({ __esModule: true, default: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }));
jest.mock('./utils/isToolSupported', () => ({ __esModule: true, default: () => true }));
const mockEncoded = [];
jest.mock('./utils/dcmsrExtendedMeta', () => ({
  encodeExtendedMeta: measurement => mockEncoded.push(JSON.parse(JSON.stringify(measurement.metadata || {}))),
}));
jest.mock('./utils/dcmsrDisplayAttributes', () => ({ encodeDisplayAttributes: () => {} }));
jest.mock('./utils/saveResult', () => ({ measurementVersion: () => ({}), omittedMeasurement: () => ({}) }));

const mockWritten = [];
jest.mock('./SCOORD3D/MeasurementReport', () => ({
  __esModule: true,
  default: {
    generateReport: (toolState, metadata, options) => {
      mockWritten.push({ toolState, document: options.document, patientSeries: options.patientSeries });
      // Each tool is encoded as a measurement group
      Object.values(toolState).forEach(byType => Object.entries(byType).forEach(([toolType, { data }]) => {
        data.forEach(tool => options.onContentItemCreate(toolType, { uid: tool.uid, _id: tool._id }, {}, {}, {}));
      }));
      return { dataset: {} };
    },
  },
}));

const mockAnnotations = {};
const mockRecords = {};
const mockServiceRecords = {};
jest.mock('../services/DicomMetadataStore', () => ({
  __esModule: true,
  default: {
    getSeries: (StudyInstanceUID, SeriesInstanceUID) => (SeriesInstanceUID === '2.25.2001'
      ? { instances: [{ SOPClassUID: '1.2.840.10008.5.1.4.1.1.2', SOPInstanceUID: '2.25.2001.1', Modality: 'CT' }] }
      : undefined),
  },
}));
jest.mock('../measurements', () => {
  const MeasurementApi = {
    _getToolType: measurement => measurement.toolType || measurement.toolName,
    _unpackMeasurementData: measurement => ({
      uid: measurement.uid, _id: measurement._id, measurementData: measurement.data || measurement, measurementMeta: measurement.metadata || {},
    }),
    _getImageIdentifiers: () => ({ imageId: 'wadors:1' }),
    Instance: {
      _serviceManagedTool: () => ({ toolServiceManaged: true, source: { getAnnotation: (toolType, uid) => mockAnnotations[uid] } }),
      measurementService: {
        _broadcastEvent: () => {}, EVENTS: { MEASUREMENTS_DATASYNC: 'datasync' }, getMeasurement: uid => mockServiceRecords[uid],
      },
      getMeasurementByCornerstoneId: _id => mockRecords[_id],
    },
  };
  return {
    __esModule: true,
    default: { MeasurementApi, Enums: { EVENTS: {}, DCM: {} }, getImageIdForImagePath: () => undefined },
  };
});

import parseMeasurementsData from './parseMeasurementsData';
import {
  clearHydratedReports, markApplicationMeasurement, registerHydratedReport,
} from './utils/srDocument';

const tag = (uid, TrackingUniqueIdentifier) => {
  mockAnnotations[uid] = { data: { TrackingUniqueIdentifier, value: uid } };
  return { uid, _id: `${uid}-cs`, toolType: 'DICOMSRSeriesTagTool' };
};
const length = (uid) => {
  mockAnnotations[uid] = { data: { _id: `${uid}-cs`, handles: {} } };
  return { uid, _id: `${uid}-cs`, toolType: 'Length' };
};

beforeEach(() => {
  mockWritten.length = 0;
  mockEncoded.length = 0;
  clearHydratedReports();
});


it("leaves out an application document's Series Tag, and writes the other measurements", () => {
  markApplicationMeasurement('2.25.700');
  const { saved } = parseMeasurementsData({
    DICOMSRSeriesTagTool: [tag('tag-app', '2.25.700'), tag('tag-own', '2.25.701')],
    Length: [length('len-1')],
  });

  const [{ toolState }] = mockWritten;
  expect(toolState['wadors:1'].DICOMSRSeriesTagTool.data.map(data => data.TrackingUniqueIdentifier)).toEqual(['2.25.701']);
  expect(toolState['wadors:1'].Length.data).toHaveLength(1);
  expect(saved).toBe(2);
});

it('writes a new document, not against an application document, when that is the only report of the study', () => {
  registerHydratedReport({
    StudyInstanceUID: '2.25.1', SeriesInstanceUID: '2.25.3', SOPInstanceUID: '2.25.30',
    SOPClassUID: '1.2.840.10008.5.1.4.1.1.88.34',
    ConceptNameCodeSequence: [{ CodeValue: 'Clinical-Report', CodingSchemeDesignator: 'Sonador-SR' }],
    ContentTemplateSequence: [{ TemplateIdentifier: 'Sonador-SR.1500', MappingResource: 'Sonador-SR' }],
  });
  parseMeasurementsData({ Length: [length('len-2')] });

  const [{ document }] = mockWritten;
  expect(document).toMatchObject({ documentClass: 'Comprehensive3DSR', template: { TemplateIdentifier: 'Sonador-SR.1500' } });
});

it('writes nothing for a save holding only application-document measurements', () => {
  markApplicationMeasurement('2.25.702');
  const { saved } = parseMeasurementsData({ DICOMSRSeriesTagTool: [tag('tag-only', '2.25.702')] });
  expect(mockWritten[0].toolState).toEqual({});
  expect(saved).toBe(0);
});


describe('Sonador-Measurement.View of a measurement drawn in this session', () => {
  const drawn = (uid, toolType, metadata = {}) => {
    mockAnnotations[uid] = { data: { _id: `${uid}-cs`, handles: {} } };
    mockRecords[`${uid}-cs`] = { uid, toolName: toolType, metadata: { ...metadata } };
    return { uid, _id: `${uid}-cs`, toolType };
  };
  const viewsWritten = () => mockEncoded.map(metadata => metadata.views);

  it('is written on its first save, from the view it was drawn in, else its image', () => {
    parseMeasurementsData({
      Length: [drawn('a', 'Length'), drawn('b', 'Length', { viewPlaneNormal: [1, 0, 0] })],
      CobbAngle: [drawn('c', 'CobbAngle', { viewPlaneNormal: [Math.sin(Math.PI / 6), 0, Math.cos(Math.PI / 6)] })],
    });
    expect(viewsWritten()).toEqual([['axial'], ['sagittal'], ['oblique']]);
    // Kept on the measurement, so later saves write it again
    expect(mockRecords['a-cs'].metadata.views).toEqual(['axial']);
  });

  it('is never added to a measurement read from a report, nor replaces a View another system wrote', () => {
    parseMeasurementsData({
      Length: [
        drawn('d', 'Length', { TrackingUniqueIdentifier: '2.25.800' }),
        drawn('e', 'Length', { views: ['coronal-ish'] }),
      ],
    });
    expect(viewsWritten()).toEqual([undefined, ['coronal-ish']]);
  });

  it('is not written for another tool', () => {
    parseMeasurementsData({ ArrowAnnotate: [drawn('f', 'ArrowAnnotate')] });
    expect(viewsWritten()).toEqual([undefined]);
  });
});


describe('an out-of-plane measurement', () => {
  const record = (uid, extra = {}) => {
    mockServiceRecords[uid] = {
      uid, toolName: 'Length', points: [[12, 0, 0], [12, 30, -40]], FrameOfReferenceUID: '2.25.7001',
      referenceStudyUID: '2.25.1', referenceSeriesUID: '2.25.2001',
      metadata: { outOfPlane: true, sourceSeries: '2.25.2001', drawingPlane: '0,1,0,0,0,-1', views: ['sagittal'], ...extra },
    };
    return mockServiceRecords[uid];
  };

  it('is written under its series, with its patient points and the series instances as evidence', () => {
    const { saved } = parseMeasurementsData({ Length: [record('oop-1'), length('len-3')] });
    const [{ toolState, patientSeries }] = mockWritten;

    expect(Object.keys(toolState)).toEqual(['patient:2.25.2001', 'wadors:1']);
    expect(toolState['patient:2.25.2001'].Length.data).toEqual([expect.objectContaining({
      uid: 'oop-1', _id: 'oop-1', toolType: 'Length', patientPoints: [[12, 0, 0], [12, 30, -40]], FrameOfReferenceUID: '2.25.7001',
    })]);
    expect(patientSeries['patient:2.25.2001']).toEqual({
      StudyInstanceUID: '2.25.1', SeriesInstanceUID: '2.25.2001',
      instances: [{ SOPClassUID: '1.2.840.10008.5.1.4.1.1.2', SOPInstanceUID: '2.25.2001.1' }],
    });
    // Its own record is the one encoded: its properties, not a classic record's
    expect(mockEncoded[0]).toMatchObject({ outOfPlane: true, sourceSeries: '2.25.2001', drawingPlane: '0,1,0,0,0,-1' });
    expect(saved).toBe(2);
  });

  it("keeps the views it was drawn with, and is not written when it belongs to an application document", () => {
    markApplicationMeasurement('2.25.900');
    parseMeasurementsData({ Length: [record('oop-2', { TrackingUniqueIdentifier: '2.25.900' }), record('oop-3')] });
    const [{ toolState }] = mockWritten;
    expect(toolState['patient:2.25.2001'].Length.data.map(tool => tool.uid)).toEqual(['oop-3']);
    expect(mockEncoded.map(metadata => metadata.views)).toEqual([['sagittal']]);
  });

  it('held with the evidence of the report it was read from, is written with that evidence under its series', () => {
    const carriedEvidence = {
      StudyInstanceUID: '2.25.1', SeriesInstanceUID: '2.25.5001',
      instances: [{ SOPClassUID: '1.2.840.10008.5.1.4.1.1.2', SOPInstanceUID: '2.25.5001.1' }],
    };
    const held = record('oop-held', { sourceSeries: '2.25.5001', carriedEvidence, isLocked: true, isReadOnly: true });
    held.referenceSeriesUID = '2.25.5001';
    const noSourceSeries = record('oop-held-2', { sourceSeries: undefined, carriedEvidence, isLocked: true });
    noSourceSeries.referenceSeriesUID = undefined;
    parseMeasurementsData({ Length: [held, noSourceSeries] });
    const [{ toolState, patientSeries }] = mockWritten;
    // Each is keyed by itself, with its own evidence
    expect(Object.keys(toolState)).toEqual(['patient:oop-held', 'patient:oop-held-2']);
    expect(toolState['patient:oop-held'].Length.data.map(tool => tool.uid)).toEqual(['oop-held']);
    expect(toolState['patient:oop-held-2'].Length.data.map(tool => tool.uid)).toEqual(['oop-held-2']);
    expect(patientSeries['patient:oop-held']).toEqual(carriedEvidence);
    expect(patientSeries['patient:oop-held-2']).toEqual(carriedEvidence);
  });

  it('two held measurements of one Source-Series keep their own evidence, in either order', () => {
    const evidenceOf = n => ({
      StudyInstanceUID: '2.25.1', SeriesInstanceUID: '2.25.5001',
      instances: [{ StudyInstanceUID: '2.25.1', SeriesInstanceUID: '2.25.5001', SOPClassUID: '1.2.840.10008.5.1.4.1.1.2', SOPInstanceUID: `2.25.5001.${n}` }],
    });
    const first = record('oop-s1', { sourceSeries: '2.25.5001', carriedEvidence: evidenceOf(1), isLocked: true });
    const second = record('oop-s2', { sourceSeries: '2.25.5001', carriedEvidence: evidenceOf(2), isLocked: true });
    [[first, second], [second, first]].forEach((order) => {
      mockWritten.length = 0;
      parseMeasurementsData({ Length: order });
      const [{ patientSeries }] = mockWritten;
      expect(patientSeries['patient:oop-s1']).toEqual(evidenceOf(1));
      expect(patientSeries['patient:oop-s2']).toEqual(evidenceOf(2));
    });
  });

  it('takes the save parent from its study when it is the first measurement', () => {
    registerHydratedReport({
      StudyInstanceUID: '2.25.1', SeriesInstanceUID: '2.25.3', SOPInstanceUID: '2.25.31',
      SOPClassUID: '1.2.840.10008.5.1.4.1.1.88.34',
      ConceptNameCodeSequence: [{ CodeValue: '126000', CodingSchemeDesignator: 'DCM' }],
      ContentTemplateSequence: [{ TemplateIdentifier: '1500', MappingResource: 'DCMR' }],
    });
    parseMeasurementsData({ Length: [record('oop-4')] });
    expect(mockWritten[0].document).toMatchObject({ template: { TemplateIdentifier: '1500', MappingResource: 'DCMR' } });
  });
});

