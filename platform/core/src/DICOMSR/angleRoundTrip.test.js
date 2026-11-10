// Angle and Cobb angle DICOM-SR round trip: the Viewer writer (classic adapters -> TID 300 ->
// TID 1500 -> properties under the NUM item), the Cornerstone3D hydration (the library adapters
// with the Sonador completion), and the documents written by Sonador IO. The library adapters
// are loaded from their ESM build; only @cornerstonejs/core is replaced, by a synthetic study whose
// image planes are known.
//
// UPDATE_SR_FIXTURES=1 regenerates the Viewer-authored fixtures (sonador-viewer.*.dcm).

import fs from 'fs';
import path from 'path';

import _ from 'lodash';
import { data as dcmjsData } from 'dcmjs';

// Image planes of the synthetic study, by image id (Cornerstone3D `imagePlaneModule`), and the
// providers registered with the metadata, asked after them in priority order
const mockImagePlanes = {};
const mockProviders = [];

jest.mock('@cornerstonejs/core', () => {
  const get = (type, imageId) => {
    if (type === 'imagePlaneModule' && mockImagePlanes[imageId]) {
      return mockImagePlanes[imageId];
    }
    const answer = mockProviders.map(({ provider }) => provider(type, imageId)).find(result => result !== undefined);
    return answer;
  };
  const plane = imageId => {
    const module = get('imagePlaneModule', imageId);
    if (!module) {
      throw new Error(`No imagePlaneModule found for imageId: ${imageId}`);
    }
    return module;
  };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return {
    metaData: {
      get,
      addProvider: (provider, priority = 0) => {
        mockProviders.push({ provider, priority });
        mockProviders.sort((a, b) => b.priority - a.priority);
      },
    },
    utilities: {
      // As @cornerstonejs/core: the centre of the first pixel is (0.5, 0.5)
      imageToWorldCoords: (imageId, [x, y]) => {
        const m = plane(imageId);
        return [0, 1, 2].map(i => m.imagePositionPatient[i]
          + m.rowCosines[i] * m.rowPixelSpacing * (x - 0.5) + m.columnCosines[i] * m.columnPixelSpacing * (y - 0.5));
      },
      worldToImageCoords: (imageId, point) => {
        const m = plane(imageId);
        const offset = point.map((value, i) => value - m.imagePositionPatient[i]);
        return [dot(offset, m.rowCosines) / m.rowPixelSpacing + 0.5, dot(offset, m.columnCosines) / m.columnPixelSpacing + 0.5];
      },
      updatePlaneRestriction: () => {},
    },
    Enums: { MetadataModules: {} },
    cache: {},
  };
}, { virtual: true });

jest.mock('@cornerstonejs/adapters', () => {
  const adapters = '../../../../node_modules/@cornerstonejs/adapters/dist/esm/adapters';
  const load = file => jest.requireActual(`${adapters}/${file}`).default;
  return {
    adaptersSR: {
      Cornerstone: { MeasurementReport: load('Cornerstone/MeasurementReport.js') },
      Cornerstone3D: {
        MeasurementReport: load('Cornerstone3D/MeasurementReport.js'),
        BaseAdapter3D: load('Cornerstone3D/BaseAdapter3D.js'),
        Angle: load('Cornerstone3D/Angle.js'),
        CobbAngle: load('Cornerstone3D/CobbAngle.js'),
        CodeScheme: load('Cornerstone3D/CodingScheme.js'),
      },
    },
    helpers: {
      toArray: x => (Array.isArray(x) ? x : x !== undefined ? [x] : []),
      codeMeaningEquals: meaning => contentItem => contentItem.ConceptNameCodeSequence.CodeMeaning === meaning,
    },
  };
}, { virtual: true });
jest.mock('../measurements/enums', () => {
  const Enums = {
    SREnums: jest.requireActual('./enums').Enums,
    SERVICE_EVENTS: { MEASUREMENTS_DATASYNC: 'datasync' },
    EVENTS: {},
    Cornerstone3D: { sr: {} },
  };
  Object.defineProperty(Enums.Cornerstone3D.sr, 'measurementReport', {
    get: () => jest.requireActual('./Cornerstone3d/MeasurementReport').default,
  });
  return { __esModule: true, default: Enums, Enums };
});
jest.mock('../measurements/classes', () => ({
  MeasurementApi: {
    Instance: { measurementService: { _broadcastEvent: () => {} } },
    _unpackMeasurementData: measurement => ({
      measurementMeta: measurement.metadata || measurement,
      measurementData: measurement.data || measurement.measurementData || measurement,
    }),
  },
}));

import { metaData as c3dMetaData } from '@cornerstonejs/core';
import { asArray, codeValueOf, conceptNameValue, firstItem } from './utils/codedConcept';
import {
  angleBetweenLines, annotationAngle, calibrationOf, encodedAngle, encodedPoints, encodingWarnings, handlePointsOf, imageToPatient, patientToImage,
} from './utils/angleGeometry';
import { encodeDisplayAttributes, parseDisplayAttributes } from './utils/dcmsrDisplayAttributes';
import { encodeExtendedMeta, parseExtendedMeta } from './utils/dcmsrExtendedMeta';
import { propertyParentOf } from './utils/propertyParent';
import { measurementVersion, omittedMeasurement, saveResultSummary } from './utils/saveResult';
import { confirmReport, documentSettings, markReportUnconfirmed } from './utils/srDocument';
import { SonadorCodeValues } from './enums';
import { dicomLabToHex } from '../displayAttributes';

const { DicomDict, DicomMessage, DicomMetaDictionary } = dcmjsData;

const FIXTURES = path.join(__dirname, '__fixtures__');
const VIEWER_ANGLE = path.join(FIXTURES, 'sonador-viewer.angle-image.2026-1108.dcm');
const VIEWER_COBB_ANGLE = path.join(FIXTURES, 'sonador-viewer.cobb-angle-image.2026-1108.dcm');
const IO_ANGLE = path.join(FIXTURES, 'sonador-io.angle.2026-1108.dcm');
const IO_COBB_ANGLE = path.join(FIXTURES, 'sonador-io.cobb-angle.2026-1108.dcm');

const ENHANCED_SR = '1.2.840.10008.5.1.4.1.1.88.22';
const COMPREHENSIVE_3D_SR = '1.2.840.10008.5.1.4.1.1.88.34';
const CT_IMAGE = '1.2.840.10008.5.1.4.1.1.2';
const ENHANCED_CT_IMAGE = '1.2.840.10008.5.1.4.1.1.2.1';

const CODES = {
  ImagingMeasurements: '126010', MeasurementGroup: '125007', TrackingIdentifier: '112039', TrackingUniqueIdentifier: '112040',
};
const DESCRIPTION = SonadorCodeValues.DCMSR_MEASUREMENT_DESCRIPTION.value;
const TEXT = SonadorCodeValues.DCMSR_MEASUREMENT_TEXT.value;
const LOCATION = SonadorCodeValues.DCMSR_MEASUREMENT_LOCATION.value;
const VIEW = SonadorCodeValues.DCMSR_MEASUREMENT_VIEW.value;
const DISPLAY = SonadorCodeValues.DCMSR_DISPLAY_ATTRIBUTES.value;
const ROLE_CODES = Object.values(SonadorCodeValues.DCMSR_DISPLAY_COLOR_ROLES).map(code => code.value);

// The synthetic study: no study or imaging identifiers. The first image maps image (x, y) to
// patient (x, y, 0); the second has a column spacing (along x) of twice its row spacing.
const SYNTHETIC = {
  PatientName: 'Anonymous', PatientID: 'ANONYMOUS', StudyID: '1',
  StudyInstanceUID: '2.25.1001', SeriesInstanceUID: '2.25.1002', FrameOfReferenceUID: '2.25.7001',
};
const IMAGE = { SOPInstanceUID: '2.25.1003', imageId: 'synthetic:2.25.1003' };
const ANISOTROPIC_IMAGE = { SOPInstanceUID: '2.25.1004', imageId: 'synthetic:2.25.1004' };
const OTHER_FRAME_IMAGE = { SOPInstanceUID: '2.25.1005', imageId: 'synthetic:2.25.1005' };
// A parallel image of the same Frame of Reference, 20 mm along the normal
const PARALLEL_IMAGE = { SOPInstanceUID: '2.25.1007', imageId: 'synthetic:2.25.1007' };
// Two frames of one multiframe instance, at different positions
const MULTIFRAME = { SOPInstanceUID: '2.25.1006', frames: { 1: 'synthetic:2.25.1006/1', 2: 'synthetic:2.25.1006/2' } };

Object.assign(mockImagePlanes, {
  [IMAGE.imageId]: {
    imagePositionPatient: [0.5, 0.5, 0], rowCosines: [1, 0, 0], columnCosines: [0, 1, 0],
    rowPixelSpacing: 1, columnPixelSpacing: 1, frameOfReferenceUID: SYNTHETIC.FrameOfReferenceUID,
  },
  [ANISOTROPIC_IMAGE.imageId]: {
    imagePositionPatient: [0, 0, 0], rowCosines: [1, 0, 0], columnCosines: [0, 1, 0],
    rowPixelSpacing: 1, columnPixelSpacing: 2, frameOfReferenceUID: SYNTHETIC.FrameOfReferenceUID,
  },
  [OTHER_FRAME_IMAGE.imageId]: {
    imagePositionPatient: [0.5, 0.5, 0], rowCosines: [1, 0, 0], columnCosines: [0, 1, 0],
    rowPixelSpacing: 1, columnPixelSpacing: 1, frameOfReferenceUID: '2.25.7999',
  },
  [PARALLEL_IMAGE.imageId]: {
    imagePositionPatient: [0.5, 0.5, 20], rowCosines: [1, 0, 0], columnCosines: [0, 1, 0],
    rowPixelSpacing: 1, columnPixelSpacing: 1, frameOfReferenceUID: SYNTHETIC.FrameOfReferenceUID,
  },
  [MULTIFRAME.frames[1]]: {
    imagePositionPatient: [0.5, 0.5, 0], rowCosines: [1, 0, 0], columnCosines: [0, 1, 0],
    rowPixelSpacing: 1, columnPixelSpacing: 1, frameOfReferenceUID: SYNTHETIC.FrameOfReferenceUID,
  },
  [MULTIFRAME.frames[2]]: {
    imagePositionPatient: [100.5, 0.5, 20], rowCosines: [1, 0, 0], columnCosines: [0, 1, 0],
    rowPixelSpacing: 1, columnPixelSpacing: 1, frameOfReferenceUID: SYNTHETIC.FrameOfReferenceUID,
  },
});
const IMAGES = [IMAGE, ANISOTROPIC_IMAGE, OTHER_FRAME_IMAGE, PARALLEL_IMAGE,
  ...Object.entries(MULTIFRAME.frames).map(([frame, imageId]) => ({ SOPInstanceUID: MULTIFRAME.SOPInstanceUID, imageId, frame: Number(frame) }))];
const imageOf = imageId => IMAGES.find(image => image.imageId === imageId);
const MULTIFRAME_IMAGE_IDS = { [MULTIFRAME.SOPInstanceUID]: [undefined, MULTIFRAME.frames[1], MULTIFRAME.frames[2]] };

const PROPERTIES = {
  description: 'Hip abduction',
  text: 'Synthetic',
  location: 'Synthetic location',
  displayAttributes: { Color: { Border: '#FF8800', Value: '#8AD0A8', Meaning: '#C0C7F8' } },
};

let MeasurementReport;
let MeasurementReport3D;
beforeAll(() => {
  require("./SCOORD3D/adapters");
  MeasurementReport = require('./SCOORD3D/MeasurementReport').default;
  require('./Cornerstone3d/adapters');
  MeasurementReport3D = require('./Cornerstone3d/MeasurementReport').default;
});


// Deterministic UIDs and dates, so a document can be written twice to the same bytes
function deterministic(fn) {
  let counter = 900000;
  const spies = [
    jest.spyOn(DicomMetaDictionary, 'uid').mockImplementation(() => `2.25.${counter++}`),
    jest.spyOn(DicomMetaDictionary, 'date').mockImplementation(() => '20261108'),
    jest.spyOn(DicomMetaDictionary, 'time').mockImplementation(() => '120000'),
    jest.spyOn(DicomMetaDictionary, 'dateTime').mockImplementation(() => '20261108120000'),
  ];
  try {
    return fn();
  } finally {
    spies.forEach(spy => spy.mockRestore());
  }
}

function quiet(fn) {
  const spies = ['log', 'debug', 'info', 'warn'].map(level => jest.spyOn(console, level).mockImplementation(() => {}));
  try {
    return { result: fn(), warnings: spies[3].mock.calls.map(call => call.join(' ')), infos: spies[2].mock.calls };
  } finally {
    spies.forEach(spy => spy.mockRestore());
  }
}


const readSR = buffer => {
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return DicomMetaDictionary.naturalizeDataset(DicomMessage.readFile(arrayBuffer).dict);
};

const child = (item, code) => asArray(item && item.ContentSequence).find(c => conceptNameValue(c) === code);
const measurementGroups = dataset => asArray(child(dataset, CODES.ImagingMeasurements).ContentSequence)
  .filter(item => conceptNameValue(item) === CODES.MeasurementGroup);
const trackingIdentifierOf = group => child(group, CODES.TrackingIdentifier).TextValue;
const trackingUIDOf = group => child(group, CODES.TrackingUniqueIdentifier).UID;
const numOf = group => asArray(group.ContentSequence).find(item => item.ValueType === 'NUM');
const valueOf = group => Number(firstItem(numOf(group).MeasuredValueSequence).NumericValue);
const coordinatesOf = group => asArray(numOf(group).ContentSequence)
  .find(item => item.ValueType === 'SCOORD' || item.ValueType === 'SCOORD3D');
const numChildren = group => asArray(numOf(group).ContentSequence);
const textValues = (items, code) => items.filter(item => conceptNameValue(item) === code).map(item => item.TextValue);


function writeSR(toolsByType, { document, imageId = IMAGE.imageId, onMeasurementRefused, imagePlaneModule, instance, onEncoded } = {}) {
  // Write the tools through the Viewer writer, as a save does (parseMeasurementsData), and
  // serialise them as the stow does (handleStructuredReport). `imagePlaneModule` and `instance`
  // replace the image's metadata.
  const tools = _.flatten(_.values(toolsByType));
  const { SOPInstanceUID, frame } = imageOf(imageId);
  const metadataProvider = {
    get: (type, id) => ({
      generalSeriesModule: { studyInstanceUID: SYNTHETIC.StudyInstanceUID, seriesInstanceUID: SYNTHETIC.SeriesInstanceUID },
      sopCommonModule: { sopClassUID: frame ? ENHANCED_CT_IMAGE : CT_IMAGE, sopInstanceUID: imageOf(id).SOPInstanceUID },
      imagePlaneModule: imagePlaneModule === undefined ? mockImagePlanes[id] : imagePlaneModule,
      frameNumber: imageOf(id).frame,
      instance: instance || {},
    })[type],
  };
  expect(SOPInstanceUID).toBeDefined();

  const toolState = { [imageId]: _.mapValues(toolsByType, data => ({ data })) };
  const report = MeasurementReport.generateReport(toolState, metadataProvider, {
    document: document || { ...documentSettings(null), personName: 'Observer^Test' },
    onMeasurementRefused,
    onContentItemCreate: (toolType, { _id }, tid300Measurement, srItem, encoding) => {
      const tool = tools.find(t => t._id === _id);
      const propertyParent = propertyParentOf(toolType);
      encodeExtendedMeta(tool, srItem, { propertyParent });
      encodeDisplayAttributes(tool, srItem, { ...encoding, propertyParent });
      if (onEncoded) {
        onEncoded(tool, srItem);
      }
    },
  });

  const dataset = _.extend(_.omit(report.dataset, '_meta', '_vrMap'),
    _.pick(SYNTHETIC, 'PatientName', 'PatientID', 'StudyID', 'StudyInstanceUID'));
  const meta = {
    FileMetaInformationVersion: report.dataset._meta.FileMetaInformationVersion.Value,
    MediaStorageSOPClassUID: dataset.SOPClassUID,
    MediaStorageSOPInstanceUID: dataset.SOPInstanceUID,
    TransferSyntaxUID: '1.2.840.10008.1.2.1',
    ImplementationClassUID: DicomMetaDictionary.uid(),
    ImplementationVersionName: 'dcmjs-0.0',
  };
  const dicomDict = new DicomDict(DicomMetaDictionary.denaturalizeDataset(meta));
  dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset);
  return Buffer.from(dicomDict.write());
}

const reSaveOf = dataset => ({
  ...documentSettings({ SOPClassUID: dataset.SOPClassUID, ...firstItem(dataset.ContentTemplateSequence) }),
  personName: 'Observer^Test',
});


function hydrate(dataset, images = [IMAGE], { imageIdsForToolState } = {}) {
  // The production hydration: Sonador Cornerstone3D generateToolState with the library adapters
  // and the property hook parseDicomStructuredReport installs. The image ids are keyed by SOP
  // instance (the first frame's), the per-frame ids passed as the parser passes them.
  const imageIds = _.fromPairs(_.uniqBy(images, 'SOPInstanceUID').map(image => [image.SOPInstanceUID, image.imageId]));
  const { result, warnings, infos } = quiet(() => MeasurementReport3D.generateToolState(
    dataset, imageIds, c3dMetaData, undefined, {
      imageIdsForToolState,
      onContentItemParse: (toolType, annotation, srItem) => {
        const propertyParent = propertyParentOf(toolType);
        parseExtendedMeta(srItem, annotation, { propertyParent });
        parseDisplayAttributes(srItem, annotation, { propertyParent });
      },
    }));
  return { byType: result, warnings, infos };
}

const HANDLES = { Angle: ['start', 'middle', 'end'], CobbAngle: ['start', 'end', 'start2', 'end2'] };

function classicTool(toolType, imagePoints, extra = {}) {
  // A cornerstone-tools Angle / Cobb angle as the classic mapping hands it to the writer
  return {
    _id: extra._id || `${toolType}-${imagePoints.map(p => p.join(',')).join(';')}`,
    handles: _.zipObject(HANDLES[toolType], imagePoints.map(([x, y]) => ({ x, y }))),
    ...PROPERTIES,
    ..._.omit(extra, '_id', 'metadata'),
    metadata: { text: PROPERTIES.text, location: PROPERTIES.location, ...(extra.metadata || {}) },
  };
}

function toClassicTool(toolType, state, index = 0) {
  // The Cornerstone3D -> cornerstone-tools bridge (createRenderVersion): world points to image
  // points of the referenced image, the hydrated identity and properties carried along
  const { annotation } = state;
  const { referencedImageId } = annotation.metadata;
  const imagePoints = annotation.data.handles.points.map(point => patientToImage(mockImagePlanes[referencedImageId], point));
  return {
    imageId: referencedImageId,
    _id: `hydrated-${toolType}-${index}`,
    handles: _.zipObject(HANDLES[toolType], imagePoints.map(([x, y]) => ({ x, y }))),
    description: state.description,
    displayAttributes: annotation.data.displayAttributes,
    metadata: _.pick(annotation.metadata,
      'TrackingUniqueIdentifier', 'TrackingIdentifier', 'coordinateDomain', 'views', 'text', 'location', 'sourceGeometry'),
  };
}

const angleOf = state => _.values(state.annotation.data.cachedStats)[0]?.angle;


describe('angle geometry', () => {
  it('follows the Cornerstone3D formula: v1 = p2 - p1, v2 = p3 - p4, 0 to 180', () => {
    // The worked example: 135 degrees, and the supplement when line 2 is reversed
    expect(angleBetweenLines([[0, 0, 0], [10, 0, 0]], [[0, 10, 0], [10, 20, 0]])).toBeCloseTo(135, 10);
    expect(angleBetweenLines([[0, 0, 0], [10, 0, 0]], [[10, 20, 0], [0, 10, 0]])).toBeCloseTo(45, 10);
    expect(angleBetweenLines([{ x: 0, y: 0 }, { x: 10, y: 0 }], [{ x: 0, y: 10 }, { x: 10, y: 20 }])).toBeCloseTo(135, 10);
  });

  it('gives the interior angle at the vertex for Angle (p1, vertex, vertex, p3)', () => {
    const handles = [[10, 0, 0], [0, 0, 0], [0, 10, 0]];
    expect(encodedPoints('Angle', handles)).toEqual([[10, 0, 0], [0, 0, 0], [0, 0, 0], [0, 10, 0]]);
    expect(encodedAngle(encodedPoints('Angle', handles))).toBeCloseTo(90, 10);
    expect(encodedAngle(encodedPoints('Angle', [[10, 0, 0], [0, 0, 0], [10, 10, 0]]))).toBeCloseTo(45, 10);
    expect(handlePointsOf('Angle', [[1], [2], [3], [4]])).toEqual([[1], [2], [4]]);
    expect(handlePointsOf('CobbAngle', [[1], [2], [3], [4]])).toEqual([[1], [2], [3], [4]]);
  });

  it('gives a Cornerstone3D annotation its record value while unchanged, else the value of its points', () => {
    const points = [[0, 0, 0], [10, 0, 0], [0, 10, 0], [10, 20, 0]];
    expect(annotationAngle('CobbAngle', { handles: { points } })).toBeCloseTo(135, 10);
    expect(annotationAngle('CobbAngle', { handles: { points }, recordValue: { value: 123.456, points: points.map(p => p.slice()) } })).toBe(123.456);
    expect(annotationAngle('CobbAngle', { handles: { points }, recordValue: { value: 123.456, points: [[0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 20, 0]] } }))
      .toBeCloseTo(135, 10);
    expect(annotationAngle('Angle', { handles: { points: [[10, 0, 0], [0, 0, 0], [0, 10, 0]] } })).toBeCloseTo(90, 10);
    expect(annotationAngle('Angle', { handles: { points: [[10, 0, 0], [0, 0, 0]] } })).toBeNaN();
    expect(annotationAngle('CobbAngle', undefined)).toBeNaN();
  });

  it('is NaN for a zero-length line, and names the problems of an encoded polyline', () => {
    expect(encodedAngle([[0, 0], [0, 0], [0, 10], [10, 20]])).toBeNaN();
    expect(encodingWarnings('CobbAngle', [[0, 0], [0, 0], [0, 10], [10, 20]])).toEqual(['a line has zero length']);
    expect(encodingWarnings('Angle', [[10, 0], [0, 0], [1, 1], [0, 10]]))
      .toEqual(['the middle points differ; the angle is read from points 0, 1 and 3']);
    expect(encodingWarnings('CobbAngle', [[0, 0], [10, 0], [10, 0], [10, 10]])).toEqual([]);
    expect(encodingWarnings('Angle', [[0, 0], [1, 1]])).toEqual(['expected four points, found 2']);
  });
});


describe('Viewer writer', () => {
  const write = (toolsByType, options) => quiet(() => deterministic(() => writeSR(toolsByType, options)));

  it('writes an ordinary Angle: Cobb angle NUM in degrees, four points with the vertex twice', () => {
    const { result: bytes } = write({ Angle: [classicTool('Angle', [[10, 0], [0, 0], [0, 10]])] });
    const [group] = measurementGroups(readSR(bytes));

    expect(trackingIdentifierOf(group)).toBe('cornerstoneTools@^4.0.0:Angle');
    const num = numOf(group);
    expect(firstItem(num.ConceptNameCodeSequence)).toMatchObject({ CodeValue: '285285000', CodingSchemeDesignator: 'SCT', CodeMeaning: 'Cobb angle' });
    expect(firstItem(firstItem(num.MeasuredValueSequence).MeasurementUnitsCodeSequence)).toMatchObject({ CodeValue: 'deg', CodingSchemeDesignator: 'UCUM' });
    expect(valueOf(group)).toBeCloseTo(90, 5);

    const coordinates = coordinatesOf(group);
    expect(coordinates).toMatchObject({ ValueType: 'SCOORD', GraphicType: 'POLYLINE', RelationshipType: 'INFERRED FROM' });
    expect(Array.from(coordinates.GraphicData)).toEqual([10, 0, 0, 0, 0, 0, 0, 10]);
    const image = firstItem(coordinates.ContentSequence);
    expect(image).toMatchObject({ ValueType: 'IMAGE', RelationshipType: 'SELECTED FROM' });
    expect(firstItem(image.ReferencedSOPSequence).ReferencedSOPInstanceUID).toBe(IMAGE.SOPInstanceUID);
  });

  it('writes a Cobb angle with four independent points and the worked-example values', () => {
    const forward = classicTool('CobbAngle', [[0.5, 0.5], [10.5, 0.5], [0.5, 10.5], [10.5, 20.5]]);
    const reversed = classicTool('CobbAngle', [[0.5, 0.5], [10.5, 0.5], [10.5, 20.5], [0.5, 10.5]]);
    const { result: bytes } = write({ CobbAngle: [forward, reversed] });
    const groups = measurementGroups(readSR(bytes));

    expect(groups.map(trackingIdentifierOf)).toEqual(['cornerstoneTools@^4.0.0:CobbAngle', 'cornerstoneTools@^4.0.0:CobbAngle']);
    expect(Array.from(coordinatesOf(groups[0]).GraphicData)).toEqual([0.5, 0.5, 10.5, 0.5, 0.5, 10.5, 10.5, 20.5]);
    expect(valueOf(groups[0])).toBeCloseTo(135, 5);
    expect(valueOf(groups[1])).toBeCloseTo(45, 5);
  });

  it('computes the value in patient coordinates, so anisotropic pixels do not distort it', () => {
    // On this image x is scaled by 2 (PixelSpacing [1, 2]): in pixels the angle would be 116.57 degrees
    const tool = classicTool('CobbAngle', [[0.5, 0.5], [5.5, 0.5], [0.5, 10.5], [5.5, 20.5]]);
    const { result: bytes } = write({ CobbAngle: [tool] }, { imageId: ANISOTROPIC_IMAGE.imageId });
    expect(valueOf(measurementGroups(readSR(bytes))[0])).toBeCloseTo(135, 5);
  });

  it('refuses a measurement with a zero-length line and writes the others', () => {
    const refused = [];
    const degenerate = classicTool('CobbAngle', [[0, 0], [0, 0], [0, 10], [10, 20]]);
    const ordinary = classicTool('Angle', [[10, 0], [0, 0], [0, 10]]);
    const { result: bytes } = write({ Angle: [ordinary], CobbAngle: [degenerate] }, {
      onMeasurementRefused: (toolType, tool, error) => refused.push([toolType, tool._id, error.message]),
    });

    expect(refused).toEqual([['CobbAngle', degenerate._id, 'CobbAngle has a zero-length line']]);
    expect(measurementGroups(readSR(bytes)).map(trackingIdentifierOf)).toEqual(['cornerstoneTools@^4.0.0:Angle']);
  });

  it('writes the properties under the NUM item, nested display attributes in Comprehensive 3D SR', () => {
    const tool = classicTool('Angle', [[10, 0], [0, 0], [0, 10]], { metadata: { views: ['coronal', 'Oblique'] } });
    const { result: bytes } = write({ Angle: [tool] });
    const dataset = readSR(bytes);
    const [group] = measurementGroups(dataset);
    const items = numChildren(group);

    expect(dataset.SOPClassUID).toBe(COMPREHENSIVE_3D_SR);
    expect(textValues(items, DESCRIPTION)).toEqual([PROPERTIES.description]);
    expect(textValues(items, TEXT)).toEqual([PROPERTIES.text]);
    expect(textValues(items, LOCATION)).toEqual([PROPERTIES.location]);
    expect(textValues(items, VIEW)).toEqual(['coronal', 'Oblique']);
    items.filter(item => item.ValueType === 'TEXT').forEach(item => expect(item.RelationshipType).toBe('HAS PROPERTIES'));

    const display = child(numOf(group), DISPLAY);
    expect(display).toMatchObject({ ValueType: 'CONTAINER', RelationshipType: 'HAS PROPERTIES' });
    expect(asArray(child(display, SonadorCodeValues.DCMSR_DISPLAY_COLOR.value).ContentSequence)
      .map(item => dicomLabToHex(item.TextValue))).toEqual(['#FF8800', '#8AD0A8', '#C0C7F8']);

    // Nothing at group level but the tracking items and the NUM
    expect(asArray(group.ContentSequence).map(item => conceptNameValue(item) || item.ValueType))
      .toEqual(['112039', '112040', '285285000']);
  });

  it('writes flat display attributes under the NUM item for an Enhanced SR parent, and stays Enhanced SR', () => {
    const parent = { SOPClassUID: ENHANCED_SR, TemplateIdentifier: '1500', MappingResource: 'DCMR' };
    const { result: bytes } = write({ CobbAngle: [classicTool('CobbAngle', [[0, 0], [10, 0], [0, 10], [10, 20]])] }, {
      document: { ...documentSettings(parent), personName: 'Observer^Test' },
    });
    const dataset = readSR(bytes);
    const items = numChildren(measurementGroups(dataset)[0]);

    expect(dataset.SOPClassUID).toBe(ENHANCED_SR);
    expect(firstItem(dataset.ContentTemplateSequence)).toMatchObject({ TemplateIdentifier: '1500', MappingResource: 'DCMR' });
    expect(items.some(item => item.ValueType === 'CONTAINER')).toBe(false);
    expect(items.filter(item => ROLE_CODES.includes(conceptNameValue(item))).map(item => item.RelationshipType))
      .toEqual(['HAS PROPERTIES', 'HAS PROPERTIES', 'HAS PROPERTIES']);
  });

  it('mints a new SOP instance on every save', () => {
    const tools = { Angle: [classicTool('Angle', [[10, 0], [0, 0], [0, 10]])] };
    const first = readSR(quiet(() => writeSR(tools)).result);
    const second = readSR(quiet(() => writeSR(tools)).result);
    expect(first.SOPInstanceUID).not.toBe(second.SOPInstanceUID);
  });
});


describe('Viewer-authored fixtures', () => {
  const FIXTURE_TOOLS = {
    [VIEWER_ANGLE]: { Angle: [classicTool('Angle', [[20.5, 10.5], [10.5, 10.5], [10.5, 20.5]], { _id: 'angle-1' })] },
    [VIEWER_COBB_ANGLE]: {
      CobbAngle: [classicTool('CobbAngle', [[0.5, 0.5], [10.5, 0.5], [0.5, 10.5], [10.5, 20.5]], { _id: 'cobb-angle-1' })],
    },
  };

  Object.entries(FIXTURE_TOOLS).forEach(([fixture, tools]) => {
    const name = path.basename(fixture);

    it(`${name} is the Viewer writer's output, byte for byte`, () => {
      const { result: bytes } = quiet(() => deterministic(() => writeSR(tools)));
      if (process.env.UPDATE_SR_FIXTURES) {
        fs.writeFileSync(fixture, bytes);
      }
      expect(bytes.equals(fs.readFileSync(fixture))).toBe(true);

      const dataset = readSR(bytes);
      expect(dataset.SOPClassUID).toBe(COMPREHENSIVE_3D_SR);
      expect(firstItem(dataset.ContentTemplateSequence))
        .toMatchObject({ TemplateIdentifier: 'Sonador-SR.1500', MappingResource: 'Sonador-SR' });
      expect(firstItem(dataset.ConceptNameCodeSequence).CodeValue).toBe('126000');
      expect(_.pick(dataset, 'PatientName', 'PatientID', 'StudyInstanceUID'))
        .toEqual({ PatientName: [{ Alphabetic: 'Anonymous' }], PatientID: 'ANONYMOUS', StudyInstanceUID: '2.25.1001' });
    });

    it(`${name} writes -> parses -> writes to the same bytes`, () => {
      const dataset = readSR(fs.readFileSync(fixture));
      const toolType = _.keys(tools)[0];
      const { byType } = hydrate(dataset);
      const rewritten = { [toolType]: byType[toolType].map((state, idx) => ({
        ...toClassicTool(toolType, state, idx), _id: tools[toolType][idx]._id,
      })) };
      const { result: bytes } = quiet(() => deterministic(() => writeSR(rewritten, { document: reSaveOf(dataset) })));
      expect(bytes.equals(fs.readFileSync(fixture))).toBe(true);
    });
  });
});


describe('Cornerstone3D hydration', () => {
  const writeAndRead = toolsByType => readSR(quiet(() => writeSR(toolsByType)).result);

  it('hydrates an Angle with three handles from encoded points 0, 1 and 3, value kept', () => {
    const dataset = writeAndRead({ Angle: [classicTool('Angle', [[20.5, 10.5], [10.5, 10.5], [10.5, 20.5]])] });
    const { byType, warnings } = hydrate(dataset);
    const [state] = byType.Angle;

    expect(state.annotation.data.handles.points).toEqual([[20.5, 10.5, 0], [10.5, 10.5, 0], [10.5, 20.5, 0]]);
    expect(angleOf(state)).toBeCloseTo(90, 5);
    expect(state.sopInstanceUid).toBe(IMAGE.SOPInstanceUID);
    expect(state.annotation.metadata).toMatchObject({
      referencedImageId: IMAGE.imageId, coordinateDomain: 'image', TrackingIdentifier: 'cornerstoneTools@^4.0.0:Angle',
      // Read from a report: listed with the saved measurements, locked, not written again
      isReadOnly: true, isLocked: true,
    });
    expect(state.annotation.metadata.TrackingUniqueIdentifier).toBe(trackingUIDOf(measurementGroups(dataset)[0]));
    expect(warnings.filter(message => /Unable to generate tool state/.test(message))).toEqual([]);
  });

  it('reads the properties from under the NUM item', () => {
    const dataset = writeAndRead({
      Angle: [classicTool('Angle', [[10, 0], [0, 0], [0, 10]], { metadata: { views: ['axial'] } })],
    });
    const [state] = hydrate(dataset).byType.Angle;

    expect(state.description).toBe(PROPERTIES.description);
    expect(state.annotation.metadata).toMatchObject({ text: PROPERTIES.text, location: PROPERTIES.location, views: ['axial'] });
    expect(state.annotation.data.displayAttributes).toEqual(PROPERTIES.displayAttributes);
  });

  it('keeps a shared-endpoint Cobb angle a Cobb angle with four handles', () => {
    const dataset = writeAndRead({ CobbAngle: [classicTool('CobbAngle', [[0.5, 0.5], [10.5, 0.5], [10.5, 0.5], [10.5, 10.5]])] });
    const { byType } = hydrate(dataset);

    expect(byType.Angle).toBeUndefined();
    expect(byType.CobbAngle).toHaveLength(1);
    expect(byType.CobbAngle[0].annotation.data.handles.points).toEqual([[0.5, 0.5, 0], [10.5, 0.5, 0], [10.5, 0.5, 0], [10.5, 10.5, 0]]);
    expect(angleOf(byType.CobbAngle[0])).toBeCloseTo(90, 5);
  });

  it('keeps reversed endpoints, and with them the supplement', () => {
    const dataset = writeAndRead({ CobbAngle: [classicTool('CobbAngle', [[0.5, 0.5], [10.5, 0.5], [10.5, 20.5], [0.5, 10.5]])] });
    const [state] = hydrate(dataset).byType.CobbAngle;
    expect(angleOf(state)).toBeCloseTo(45, 5);
    expect(state.annotation.data.handles.points[2]).toEqual([10.5, 20.5, 0]);
  });

  it('decides the tool by the tracking identifier, in either prefix, never by the geometry', () => {
    const dataset = writeAndRead({ Angle: [classicTool('Angle', [[10, 0], [0, 0], [0, 10]])] });
    const [group] = measurementGroups(dataset);

    child(group, CODES.TrackingIdentifier).TextValue = 'Cornerstone3DTools@^0.1.0:CobbAngle';
    let { byType } = hydrate(dataset);
    expect(_.keys(byType)).toEqual(['CobbAngle']);
    expect(byType.CobbAngle[0].annotation.data.handles.points).toHaveLength(4);

    child(group, CODES.TrackingIdentifier).TextValue = 'Cornerstone3DTools@^0.1.0:Angle';
    ({ byType } = hydrate(dataset));
    expect(_.keys(byType)).toEqual(['Angle']);
    expect(byType.Angle[0].annotation.metadata.TrackingIdentifier).toBe('Cornerstone3DTools@^0.1.0:Angle');
  });

  it('reads an Angle whose middle points differ from points 0, 1 and 3, with a warning', () => {
    const dataset = writeAndRead({ CobbAngle: [classicTool('CobbAngle', [[10.5, 0.5], [0.5, 0.5], [1.5, 1.5], [0.5, 10.5]])] });
    child(measurementGroups(dataset)[0], CODES.TrackingIdentifier).TextValue = 'cornerstoneTools@^4.0.0:Angle';
    const { byType, warnings } = hydrate(dataset);

    expect(byType.Angle[0].annotation.data.handles.points).toEqual([[10.5, 0.5, 0], [0.5, 0.5, 0], [0.5, 10.5, 0]]);
    expect(warnings.some(message => /middle points differ/.test(message))).toBe(true);
  });

  it('hydrates a degenerate group as read, with a warning, and never alters the stored value', () => {
    const dataset = writeAndRead({ CobbAngle: [classicTool('CobbAngle', [[0.5, 0.5], [10.5, 0.5], [0.5, 10.5], [10.5, 20.5]])] });
    const [group] = measurementGroups(dataset);
    const coordinates = coordinatesOf(group);
    coordinates.GraphicData = [0.5, 0.5, 0.5, 0.5, 0.5, 10.5, 10.5, 20.5];
    firstItem(numOf(group).MeasuredValueSequence).NumericValue = 12.34;
    const { byType, warnings } = hydrate(dataset);

    expect(angleOf(byType.CobbAngle[0])).toBe(12.34);
    expect(warnings.some(message => /zero length/.test(message))).toBe(true);
  });

  it('does not hydrate the angle groups of a document with a Sonador-SR root title', () => {
    const dataset = writeAndRead({
      Angle: [classicTool('Angle', [[10, 0], [0, 0], [0, 10]])],
      CobbAngle: [classicTool('CobbAngle', [[0, 0], [10, 0], [0, 10], [10, 20]])],
    });
    dataset.ConceptNameCodeSequence = [{ CodeValue: 'Clinical-Report', CodingSchemeDesignator: 'Sonador-SR', CodeMeaning: 'Clinical Report' }];
    const { byType, infos } = hydrate(dataset);

    expect(byType).toEqual({});
    expect(infos).toHaveLength(2);
  });
});


describe('re-saving a hydrated measurement', () => {
  const resave = (dataset, edit = tools => tools) => {
    const { byType } = hydrate(dataset);
    const toolsByType = _.mapValues(byType, (states, toolType) => states.map((state, idx) => toClassicTool(toolType, state, idx)));
    return readSR(quiet(() => writeSR(edit(toolsByType), { document: reSaveOf(dataset) })).result);
  };

  it('keeps the tracking UID and identifier, writes a new SOP instance, and follows an edit', () => {
    const dataset = readSR(quiet(() => writeSR({
      Angle: [classicTool('Angle', [[10, 0], [0, 0], [0, 10]])],
      CobbAngle: [classicTool('CobbAngle', [[0.5, 0.5], [10.5, 0.5], [0.5, 10.5], [10.5, 20.5]])],
    })).result);
    const edited = resave(dataset, tools => {
      tools.Angle[0].handles.end = { x: 10, y: 10 };
      return tools;
    });

    expect(edited.SOPInstanceUID).not.toBe(dataset.SOPInstanceUID);
    expect(measurementGroups(edited).map(trackingUIDOf)).toEqual(measurementGroups(dataset).map(trackingUIDOf));
    expect(measurementGroups(edited).map(trackingIdentifierOf)).toEqual(measurementGroups(dataset).map(trackingIdentifierOf));
    expect(measurementGroups(edited).map(valueOf).map(v => _.round(v, 6))).toEqual([45, 135]);
  });

  it('keeps a Cornerstone3DTools identifier as read', () => {
    const dataset = readSR(quiet(() => writeSR({ Angle: [classicTool('Angle', [[10, 0], [0, 0], [0, 10]])] })).result);
    child(measurementGroups(dataset)[0], CODES.TrackingIdentifier).TextValue = 'Cornerstone3DTools@^0.1.0:Angle';
    expect(trackingIdentifierOf(measurementGroups(resave(dataset))[0])).toBe('Cornerstone3DTools@^0.1.0:Angle');
  });

  it('drops the group of a deleted measurement and keeps the others', () => {
    const dataset = readSR(quiet(() => writeSR({
      Angle: [classicTool('Angle', [[10, 0], [0, 0], [0, 10]])],
      CobbAngle: [classicTool('CobbAngle', [[0.5, 0.5], [10.5, 0.5], [0.5, 10.5], [10.5, 20.5]])],
    })).result);
    const saved = resave(dataset, tools => _.omit(tools, 'Angle'));

    expect(measurementGroups(saved).map(trackingIdentifierOf)).toEqual(['cornerstoneTools@^4.0.0:CobbAngle']);
    expect(trackingUIDOf(measurementGroups(saved)[0])).toBe(trackingUIDOf(measurementGroups(dataset)[1]));
  });

  it('rewrites legacy group-level properties under the NUM item', () => {
    const dataset = readSR(quiet(() => writeSR({ Angle: [classicTool('Angle', [[10, 0], [0, 0], [0, 10]])] })).result);
    const [group] = measurementGroups(dataset);
    const num = numOf(group);
    const properties = numChildren(group).filter(item => item.ValueType !== 'SCOORD');
    num.ContentSequence = numChildren(group).filter(item => item.ValueType === 'SCOORD');
    group.ContentSequence = [...asArray(group.ContentSequence), ...properties.map(item => ({
      ...item, RelationshipType: item.ValueType === 'TEXT' ? 'HAS CONCEPT MOD' : 'CONTAINS',
    }))];

    const [state] = hydrate(dataset).byType.Angle;
    expect(state.description).toBe(PROPERTIES.description);
    expect(state.annotation.data.displayAttributes).toEqual(PROPERTIES.displayAttributes);

    const [saved] = measurementGroups(resave(dataset));
    expect(textValues(numChildren(saved), DESCRIPTION)).toEqual([PROPERTIES.description]);
    expect(child(numOf(saved), DISPLAY)).toBeDefined();
    expect(asArray(saved.ContentSequence).map(item => conceptNameValue(item))).toEqual(['112039', '112040', '285285000']);
  });
});


describe('Sonador IO documents', () => {
  const CASES = [
    { fixture: IO_ANGLE, toolType: 'Angle', value: 90, points: [[10, 0, 0], [0, 0, 0], [0, 10, 0]], description: 'angle measurement' },
    {
      fixture: IO_COBB_ANGLE, toolType: 'CobbAngle', value: 135,
      points: [[0, 0, 0], [10, 0, 0], [0, 10, 0], [10, 20, 0]], description: 'cobb-angle measurement',
    },
  ];

  CASES.forEach(({ fixture, toolType, value, points, description }) => {
    const name = path.basename(fixture);
    const dataset = () => readSR(fs.readFileSync(fixture));

    it(`${name} hydrates editable on the image of its Frame of Reference, with its properties`, () => {
      const source = dataset();
      const [group] = measurementGroups(source);
      const { byType, warnings } = hydrate(source, [OTHER_FRAME_IMAGE, IMAGE]);
      const [state] = byType[toolType];

      expect(warnings.filter(message => /Unable to generate tool state/.test(message))).toEqual([]);
      expect(state.annotation.data.handles.points).toEqual(points);
      expect(angleOf(state)).toBe(value);
      expect(state.sopInstanceUid).toBe(IMAGE.SOPInstanceUID);
      expect(state.annotation.metadata).toMatchObject({
        referencedImageId: IMAGE.imageId,
        coordinateDomain: 'patient',
        TrackingIdentifier: trackingIdentifierOf(group),
        TrackingUniqueIdentifier: trackingUIDOf(group),
        text: 'Synthetic',
        location: 'Synthetic location',
        views: ['coronal'],
      });
      expect(state.description).toBe(description);
      const colours = asArray(child(child(numOf(group), DISPLAY), SonadorCodeValues.DCMSR_DISPLAY_COLOR.value).ContentSequence);
      expect(state.annotation.data.displayAttributes.Color).toEqual(_.fromPairs(
        colours.map(item => [codeValueOf(firstItem(item.ConceptNameCodeSequence)).split('.').pop(), dicomLabToHex(item.TextValue)])));
    });

    it(`${name} is not hydrated without a loaded image of its Frame of Reference`, () => {
      const { byType, warnings } = hydrate(dataset(), [OTHER_FRAME_IMAGE]);
      expect(byType[toolType][0].sopInstanceUid).toBeUndefined();
      expect(warnings.some(message => /no loaded image of Frame of Reference/.test(message))).toBe(true);
    });

    it(`${name} re-saves in the patient domain with its identity and properties`, () => {
      const source = dataset();
      const [sourceGroup] = measurementGroups(source);
      const { byType } = hydrate(source);
      const tools = { [toolType]: [toClassicTool(toolType, byType[toolType][0])] };
      const saved = readSR(quiet(() => writeSR(tools, { document: reSaveOf(source) })).result);
      const [group] = measurementGroups(saved);

      expect(saved.SOPClassUID).toBe(COMPREHENSIVE_3D_SR);
      expect(trackingIdentifierOf(group)).toBe(trackingIdentifierOf(sourceGroup));
      expect(trackingUIDOf(group)).toBe(trackingUIDOf(sourceGroup));
      expect(coordinatesOf(group)).toMatchObject({ ValueType: 'SCOORD3D', ReferencedFrameOfReferenceUID: SYNTHETIC.FrameOfReferenceUID });
      expect(Array.from(coordinatesOf(group).GraphicData)).toEqual(Array.from(coordinatesOf(sourceGroup).GraphicData));
      expect(valueOf(group)).toBeCloseTo(value, 6);
      ['Sonador-Measurement.Description', TEXT, LOCATION, VIEW].forEach(code => {
        expect(textValues(numChildren(group), code)).toEqual(textValues(numChildren(sourceGroup), code));
      });
    });
  });
});


const pointsOf = group => {
  const coordinates = coordinatesOf(group);
  return _.chunk(Array.from(coordinates.GraphicData, Number), coordinates.ValueType === 'SCOORD3D' ? 3 : 2);
};
const COBB_IMAGE_POINTS = [[0.5, 0.5], [10.5, 0.5], [0.5, 10.5], [10.5, 20.5]];
const ANISOTROPIC_COBB_POINTS = [[0.5, 0.5], [5.5, 0.5], [0.5, 10.5], [5.5, 20.5]];

function resaveOn(dataset, imageId, { images, imageIdsForToolState, edit = tools => tools, writeOptions = {} } = {}) {
  // Hydrate, bridge to the classic tools, optionally edit, and save again against `imageId`
  const { byType } = hydrate(dataset, images || [imageOf(imageId)], { imageIdsForToolState });
  const toolsByType = _.mapValues(byType, (states, toolType) => states.map((state, idx) => toClassicTool(toolType, state, idx)));
  return readSR(quiet(() => writeSR(edit(toolsByType), { document: reSaveOf(dataset), imageId, ...writeOptions })).result);
}

const withStoredValue = (dataset, value) => {
  firstItem(numOf(measurementGroups(dataset)[0]).MeasuredValueSequence).NumericValue = value;
  return dataset;
};


describe('the saved value agrees with the saved geometry', () => {
  const patientTool = points => classicTool('CobbAngle', points, { metadata: { coordinateDomain: 'patient' } });

  it('maps image points to patient points as DICOM does: x by the column spacing, y by the row spacing', () => {
    const module = mockImagePlanes[ANISOTROPIC_IMAGE.imageId];
    expect(imageToPatient(module, [5.5, 10.5])).toEqual([10, 10, 0]);
    expect(patientToImage(module, [10, 10, 0])).toEqual([5.5, 10.5]);
  });

  it('writes a new patient-domain angle on an anisotropic image with the value of its written points', () => {
    const dataset = readSR(quiet(() => writeSR({ CobbAngle: [patientTool(ANISOTROPIC_COBB_POINTS)] },
      { imageId: ANISOTROPIC_IMAGE.imageId })).result);
    const [group] = measurementGroups(dataset);

    expect(coordinatesOf(group).ValueType).toBe('SCOORD3D');
    expect(pointsOf(group)).toEqual([[0, 0, 0], [10, 0, 0], [0, 10, 0], [10, 20, 0]]);
    expect(valueOf(group)).toBeCloseTo(encodedAngle(pointsOf(group)), 6);
    expect(valueOf(group)).toBeCloseTo(135, 6);
  });

  it('re-saves an edited patient-domain angle on an anisotropic image with the value of its written points', () => {
    const source = readSR(quiet(() => writeSR({ CobbAngle: [patientTool(ANISOTROPIC_COBB_POINTS)] },
      { imageId: ANISOTROPIC_IMAGE.imageId })).result);
    const edited = resaveOn(source, ANISOTROPIC_IMAGE.imageId, {
      edit: tools => {
        tools.CobbAngle[0].handles.end2 = { x: 3, y: 20.5 };
        return tools;
      },
    });
    const [group] = measurementGroups(edited);

    expect(coordinatesOf(group).ValueType).toBe('SCOORD3D');
    expect(pointsOf(group)[3]).toEqual([5, 20, 0]);
    expect(valueOf(group)).toBeCloseTo(encodedAngle(pointsOf(group)), 6);
    expect(valueOf(group)).not.toBeCloseTo(135, 1);
  });
});


describe('the stored value of an unchanged measurement', () => {
  const imageDomainDocument = () => readSR(quiet(() => writeSR({ CobbAngle: [classicTool('CobbAngle', COBB_IMAGE_POINTS)] })).result);

  it('is written back as read, with the points it was read with', () => {
    const source = withStoredValue(imageDomainDocument(), 123.456);
    const [group] = measurementGroups(resaveOn(source, IMAGE.imageId));

    expect(valueOf(group)).toBe(123.456);
    expect(pointsOf(group)).toEqual(pointsOf(measurementGroups(source)[0]));
  });

  it('is recomputed when a handle moves', () => {
    const source = withStoredValue(imageDomainDocument(), 123.456);
    const [group] = measurementGroups(resaveOn(source, IMAGE.imageId, {
      edit: tools => {
        tools.CobbAngle[0].handles.end2 = { x: 0.5, y: 20.5 };
        return tools;
      },
    }));
    expect(valueOf(group)).toBeCloseTo(90, 6);
  });

  it('is recomputed when the measurement is saved against another image', () => {
    const source = withStoredValue(imageDomainDocument(), 123.456);
    const { byType } = hydrate(source);
    const tools = { CobbAngle: [toClassicTool('CobbAngle', byType.CobbAngle[0])] };
    const saved = readSR(quiet(() => writeSR(tools, { document: reSaveOf(source), imageId: OTHER_FRAME_IMAGE.imageId })).result);
    expect(valueOf(measurementGroups(saved)[0])).toBeCloseTo(135, 6);
  });

  it('is recomputed, and the points written on the new plane, when a patient-domain measurement is saved on a parallel image', () => {
    // Hydrated on the image at z = 0, saved with the same image handles against the image at z = 20,
    // whose projected x / y are the same
    const source = withStoredValue(readSR(fs.readFileSync(IO_COBB_ANGLE)), 123.456);
    const { byType } = hydrate(source);
    const tools = { CobbAngle: [toClassicTool('CobbAngle', byType.CobbAngle[0])] };
    const saved = readSR(quiet(() => writeSR(tools, { document: reSaveOf(source), imageId: PARALLEL_IMAGE.imageId })).result);
    const [group] = measurementGroups(saved);

    expect(coordinatesOf(group).ValueType).toBe('SCOORD3D');
    expect(pointsOf(group)).toEqual([[0, 0, 20], [10, 0, 20], [0, 10, 20], [10, 20, 20]]);
    expect(valueOf(group)).toBeCloseTo(encodedAngle(pointsOf(group)), 6);
    expect(valueOf(group)).not.toBe(123.456);
  });

  it('is kept for an unchanged patient-domain measurement, with its points verbatim', () => {
    const source = withStoredValue(readSR(fs.readFileSync(IO_COBB_ANGLE)), 123.456);
    const [group] = measurementGroups(resaveOn(source, IMAGE.imageId));

    expect(valueOf(group)).toBe(123.456);
    expect(coordinatesOf(group).ValueType).toBe('SCOORD3D');
    expect(Array.from(coordinatesOf(group).GraphicData)).toEqual(Array.from(coordinatesOf(measurementGroups(source)[0]).GraphicData));
  });
});


describe('calibration of a new or edited angle', () => {
  const plane = _.pick(mockImagePlanes[IMAGE.imageId], 'imagePositionPatient', 'rowCosines', 'columnCosines', 'frameOfReferenceUID');
  const writeOn = (imagePlaneModule, instance) => {
    const refused = [];
    const { result: bytes } = quiet(() => writeSR({ CobbAngle: [classicTool('CobbAngle', COBB_IMAGE_POINTS)] }, {
      imagePlaneModule, instance, onMeasurementRefused: (toolType, tool, error) => refused.push(error.code),
    }));
    return { refused, groups: measurementGroups(readSR(bytes)) };
  };

  it.each([
    ['absent', {}],
    ['partial', { rowPixelSpacing: 1 }],
    ['non-finite', { rowPixelSpacing: NaN, columnPixelSpacing: 1 }],
    ['zero', { rowPixelSpacing: 0, columnPixelSpacing: 1 }],
    ['negative', { rowPixelSpacing: 1, columnPixelSpacing: -1 }],
  ])('refuses a value when the pixel spacing is %s', (label, spacing) => {
    const { refused, groups } = writeOn({ ...plane, ...spacing });
    expect(refused).toEqual(['uncalibrated']);
    expect(groups).toHaveLength(0);
  });

  it('refuses a value when the image has no plane module at all', () => {
    expect(writeOn(null).refused).toEqual(['uncalibrated']);
  });

  it.each([
    ['absent spacing', { ...plane }],
    ['invalid spacing', { ...plane, rowPixelSpacing: 0, columnPixelSpacing: 1 }],
    ['an invalid plane', { ...plane, rowCosines: [NaN, 0, 0], rowPixelSpacing: 1, columnPixelSpacing: 1 }],
    ['a missing plane', { rowPixelSpacing: 1, columnPixelSpacing: 1 }],
  ])('tells the user the calibration is missing or invalid for %s', (label, imagePlaneModule) => {
    const omitted = [];
    quiet(() => writeSR({ CobbAngle: [classicTool('CobbAngle', COBB_IMAGE_POINTS)] }, {
      imagePlaneModule, onMeasurementRefused: (toolType, tool, error) => omitted.push(omittedMeasurement(toolType, tool, error)),
    }));
    expect(saveResultSummary({ omitted, saved: 0 }).message)
      .toContain('its image calibration is missing or invalid, so the angle cannot be measured in degrees; draw it on a calibrated image.');
  });

  it('measures in pixels an image without spacing that declares square pixels', () => {
    const { refused, groups } = writeOn({ ...plane }, { PixelAspectRatio: [1, 1] });
    expect(refused).toEqual([]);
    expect(valueOf(groups[0])).toBeCloseTo(135, 6);
    expect(calibrationOf({ ...plane }, [1, 2])).toBeNull();
    expect(calibrationOf({ ...plane, rowPixelSpacing: 1 }, [1, 1])).toBeNull();
  });

  it('keeps an unchanged parsed value on an image without spacing, inventing no calibration', () => {
    const source = withStoredValue(readSR(quiet(() => writeSR({ CobbAngle: [classicTool('CobbAngle', COBB_IMAGE_POINTS)] })).result), 123.456);
    const saved = resaveOn(source, IMAGE.imageId, { writeOptions: { imagePlaneModule: { ...plane } } });
    expect(valueOf(measurementGroups(saved)[0])).toBe(123.456);
  });
});


describe('multiframe references', () => {
  const FRAME_2 = MULTIFRAME.frames[2];
  const frameImages = [imageOf(MULTIFRAME.frames[1]), imageOf(FRAME_2)];
  const angleOnFrame2 = () => readSR(quiet(() => writeSR(
    { Angle: [classicTool('Angle', [[20.5, 10.5], [10.5, 10.5], [10.5, 20.5]])] }, { imageId: FRAME_2 })).result);

  it('writes the referenced frame', () => {
    const image = firstItem(coordinatesOf(measurementGroups(angleOnFrame2())[0]).ContentSequence);
    expect(firstItem(image.ReferencedSOPSequence)).toMatchObject({
      ReferencedSOPInstanceUID: MULTIFRAME.SOPInstanceUID, ReferencedFrameNumber: 2,
    });
  });

  it('hydrates on the referenced frame, not the first one', () => {
    const { byType } = hydrate(angleOnFrame2(), frameImages, { imageIdsForToolState: MULTIFRAME_IMAGE_IDS });
    const [state] = byType.Angle;

    expect(state.annotation.metadata.referencedImageId).toBe(FRAME_2);
    expect(state.annotation.data.frameNumber).toBe(2);
    expect(state.annotation.data.handles.points).toEqual([[120.5, 10.5, 20], [110.5, 10.5, 20], [110.5, 20.5, 20]]);
  });

  it('does not substitute the first frame when the referenced frame has no image id', () => {
    const { byType, warnings } = hydrate(angleOnFrame2(), frameImages, {
      imageIdsForToolState: { [MULTIFRAME.SOPInstanceUID]: [undefined, MULTIFRAME.frames[1]] },
    });
    expect(byType.Angle).toBeUndefined();
    expect(warnings.some(message => /Unable to generate tool state/.test(message))).toBe(true);
  });

  it('re-saves on the same frame with the same points and value', () => {
    const source = angleOnFrame2();
    const saved = resaveOn(source, FRAME_2, { images: frameImages, imageIdsForToolState: MULTIFRAME_IMAGE_IDS });
    const [group] = measurementGroups(saved);

    expect(firstItem(firstItem(coordinatesOf(group).ContentSequence).ReferencedSOPSequence).ReferencedFrameNumber).toBe(2);
    expect(pointsOf(group)).toEqual(pointsOf(measurementGroups(source)[0]));
    expect(valueOf(group)).toBe(valueOf(measurementGroups(source)[0]));
  });

  it('places a patient-domain angle on the frame whose plane holds it', () => {
    const source = readSR(quiet(() => writeSR({
      CobbAngle: [classicTool('CobbAngle', COBB_IMAGE_POINTS, { metadata: { coordinateDomain: 'patient' } })],
    }, { imageId: FRAME_2 })).result);
    expect(pointsOf(measurementGroups(source)[0]).map(point => point[2])).toEqual([20, 20, 20, 20]);

    const { byType } = hydrate(source, frameImages, { imageIdsForToolState: MULTIFRAME_IMAGE_IDS });
    expect(byType.CobbAngle[0].annotation.metadata.referencedImageId).toBe(FRAME_2);
    expect(byType.CobbAngle[0].annotation.data.frameNumber).toBe(2);
  });
});


describe('hydration on an image the Cornerstone3D metadata does not know', () => {
  // The viewer's providers answer from the DicomMetadataStore; an image held only by its display
  // set has its plane from the display set's instance metadata (sopInstanceImageIds.js)
  const { buildSopInstanceImageIds } = jest.requireActual('./Cornerstone3d/utils/sopInstanceImageIds');
  const UNKNOWN_IMAGE = { SOPInstanceUID: IMAGE.SOPInstanceUID, imageId: 'display-set-only:2.25.1003' };
  const displaySetOf = imageId => [{ images: [{ getData: () => ({ metadata: {
    StudyInstanceUID: SYNTHETIC.StudyInstanceUID, SeriesInstanceUID: SYNTHETIC.SeriesInstanceUID, SOPInstanceUID: IMAGE.SOPInstanceUID,
    ImagePositionPatient: [0.5, 0.5, 0], ImageOrientationPatient: [1, 0, 0, 0, 1, 0], PixelSpacing: [1, 1],
    FrameOfReferenceUID: SYNTHETIC.FrameOfReferenceUID, Rows: 64, Columns: 64,
  } }) }] }];
  const cobbAngleDocument = () => readSR(quiet(() => writeSR({
    CobbAngle: [classicTool('CobbAngle', [[0.5, 0.5], [10.5, 0.5], [0.5, 10.5], [10.5, 20.5]])],
  })).result);

  it('is not hydrated without the fallback: the reader cannot place the Cobb angle', () => {
    const { byType, warnings } = hydrate(cobbAngleDocument(), [UNKNOWN_IMAGE]);
    expect(byType.CobbAngle).toBeUndefined();
    expect(warnings.some(message => /Unable to generate tool state/.test(message))).toBe(true);
  });

  it('hydrates a Cobb angle as a Cobb angle, with four handles and its stored value, once the display set registers the plane', () => {
    buildSopInstanceImageIds(displaySetOf(UNKNOWN_IMAGE.imageId), { getImageId: () => UNKNOWN_IMAGE.imageId });
    const { byType } = hydrate(cobbAngleDocument(), [UNKNOWN_IMAGE]);

    expect(byType.Angle).toBeUndefined();
    const [state] = byType.CobbAngle;
    expect(state.annotation.metadata).toMatchObject({ toolName: 'CobbAngle', referencedImageId: UNKNOWN_IMAGE.imageId });
    expect(state.annotation.data.handles.points).toEqual([[0.5, 0.5, 0], [10.5, 0.5, 0], [0.5, 10.5, 0], [10.5, 20.5, 0]]);
    expect(angleOf(state)).toBeCloseTo(135, 5);
  });
});


describe('the version a save writes', () => {
  it('names the tracking UID the report holds for each measurement, a new one included', () => {
    const encoded = [];
    const tools = [
      classicTool('CobbAngle', [[0.5, 0.5], [10.5, 0.5], [0.5, 10.5], [10.5, 20.5]]),
      classicTool('Angle', [[20.5, 10.5], [10.5, 10.5], [10.5, 20.5]]),
    ];
    tools.forEach(tool => { delete tool.TrackingUniqueIdentifier; });
    const dataset = readSR(quiet(() => writeSR({ CobbAngle: [tools[0]], Angle: [tools[1]] }, {
      onEncoded: (tool, srItem) => encoded.push(measurementVersion({ ...tool, points: [] }, srItem).TrackingUniqueIdentifier),
    })).result);

    expect(encoded).toHaveLength(2);
    expect(encoded.sort()).toEqual(measurementGroups(dataset).map(trackingUIDOf).sort());
  });

});


describe('a report the upload has not confirmed', () => {
  it('hydrates its angles unlocked; once confirmed, locked', () => {
    const dataset = readSR(quiet(() => writeSR({ Angle: [classicTool('Angle', [[20.5, 10.5], [10.5, 10.5], [10.5, 20.5]])] })).result);
    markReportUnconfirmed(dataset.SOPInstanceUID);
    const [unconfirmed] = hydrate(dataset).byType.Angle;
    expect(unconfirmed.annotation.metadata.isReadOnly).toBeUndefined();
    expect(unconfirmed.annotation.metadata.isLocked).toBeUndefined();

    confirmReport(dataset.SOPInstanceUID);
    const [confirmed] = hydrate(dataset).byType.Angle;
    expect(confirmed.annotation.metadata).toMatchObject({ isReadOnly: true, isLocked: true });
  });
});


describe('a Cobb angle whose second line was not drawn', () => {
  it('is left out of the report as incomplete: its second-line handles are placeholders', () => {
    // As cornerstone-tools creates it on the first click: start2 at the click, end2 one pixel along
    const drawing = { ...classicTool('CobbAngle', [[215.5, 129.5], [219.5, 130.5], [215.5, 129.5], [216.5, 129.5]]), complete: false };
    const finished = classicTool('CobbAngle', [[0.5, 0.5], [10.5, 0.5], [0.5, 10.5], [10.5, 20.5]]);
    const refused = [];
    const dataset = readSR(quiet(() => writeSR({ CobbAngle: [drawing, finished] }, {
      onMeasurementRefused: (toolType, tool, error) => refused.push([toolType, tool._id, error.code]),
    })).result);

    expect(refused).toEqual([['CobbAngle', drawing._id, 'incomplete']]);
    expect(measurementGroups(dataset)).toHaveLength(1);
    expect(valueOf(measurementGroups(dataset)[0])).toBeCloseTo(135, 6);
  });

  it('is written once its second line is drawn, whatever a stale nested copy says', () => {
    const finished = {
      ...classicTool('CobbAngle', [[0.5, 0.5], [10.5, 0.5], [0.5, 10.5], [10.5, 20.5]]),
      complete: true, measurementData: { complete: false },
    };
    const refused = [];
    const dataset = readSR(quiet(() => writeSR({ CobbAngle: [finished] }, {
      onMeasurementRefused: (toolType, tool, error) => refused.push(error.code),
    })).result);
    expect(refused).toEqual([]);
    expect(measurementGroups(dataset)).toHaveLength(1);
  });
});
