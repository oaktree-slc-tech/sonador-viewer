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
      Cornerstone: { MeasurementReport: load('Cornerstone/MeasurementReport.js'), Length: load('Cornerstone/Length.js') },
      Cornerstone3D: {
        MeasurementReport: load('Cornerstone3D/MeasurementReport.js'),
        BaseAdapter3D: load('Cornerstone3D/BaseAdapter3D.js'),
        Angle: load('Cornerstone3D/Angle.js'),
        CobbAngle: load('Cornerstone3D/CobbAngle.js'),
        Length: load('Cornerstone3D/Length.js'),
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
import { drawingPlaneOfView, formatDrawingPlane, navigationPlaneOf } from './utils/drawingPlane';
import { carriedEvidenceOf, heldOutOfPlaneRecord, isCarriedForward, patientToolData } from './utils/outOfPlane';
import { viewOfNormal } from './utils/measurementView';
import { dicomLabToHex } from '../displayAttributes';

const { DicomDict, DicomMessage, DicomMetaDictionary } = dcmjsData;

const FIXTURES = path.join(__dirname, '__fixtures__');
const VIEWER_ANGLE = path.join(FIXTURES, 'sonador-viewer.angle-image.2026-1108.dcm');
const VIEWER_COBB_ANGLE = path.join(FIXTURES, 'sonador-viewer.cobb-angle-image.2026-1108.dcm');
// The Viewer-authored Length, its properties under the NUM item
const VIEWER_LENGTH = path.join(FIXTURES, 'sonador-viewer.length-image.2026-1110.dcm');
const IO_ANGLE = path.join(FIXTURES, 'sonador-io.angle.2026-1108.dcm');
const IO_COBB_ANGLE = path.join(FIXTURES, 'sonador-io.cobb-angle.2026-1108.dcm');
const IO_LENGTH = path.join(FIXTURES, 'sonador-io.length.2026-1108.dcm');

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
// The copy of dcmjs the adapters bundle mints the tracking UID of a Length
const { DicomMetaDictionary: AdaptersDicomMetaDictionary } = jest.requireActual(
  '../../../../node_modules/@cornerstonejs/adapters/node_modules/dcmjs').data;

function deterministic(fn) {
  let counter = 900000;
  const spies = [
    jest.spyOn(DicomMetaDictionary, 'uid').mockImplementation(() => `2.25.${counter++}`),
    jest.spyOn(AdaptersDicomMetaDictionary, 'uid').mockImplementation(() => `2.25.${counter++}`),
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


function writeSR(toolsByType, {
  document, imageId = IMAGE.imageId, onMeasurementRefused, imagePlaneModule, instance, onEncoded, toolState: givenToolState, patientSeries,
  headers,
} = {}) {
  // Write the tools through the Viewer writer, as a save does (parseMeasurementsData), and
  // serialise them as the stow does (handleStructuredReport). `imagePlaneModule` and `instance`
  // replace the image's metadata. `toolState` (with `patientSeries`) replaces the tool state of
  // `toolsByType` on `imageId`, for patient-domain measurements and several images.
  const tools = givenToolState
    ? _.flatMap(_.values(givenToolState), byType => _.flatMap(_.values(byType), ({ data }) => data))
    : _.flatten(_.values(toolsByType));
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

  const toolState = givenToolState || { [imageId]: _.mapValues(toolsByType, data => ({ data })) };
  const report = MeasurementReport.generateReport(toolState, metadataProvider, {
    document: document || { ...documentSettings(null), personName: 'Observer^Test' },
    patientSeries,
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
    _.pick(SYNTHETIC, 'PatientName', 'PatientID', 'StudyID', 'StudyInstanceUID'), headers);
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

const HANDLES = { Angle: ['start', 'middle', 'end'], CobbAngle: ['start', 'end', 'start2', 'end2'], Length: ['start', 'end'] };

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
      'TrackingUniqueIdentifier', 'TrackingIdentifier', 'coordinateDomain', 'views', 'text', 'location', 'sourceGeometry',
      'sourceSeries', 'drawingPlane'),
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

  it("writes a new version of an Enhanced SR report as Comprehensive 3D SR, display attributes nested under the NUM item", () => {
    const parent = { SOPClassUID: ENHANCED_SR, TemplateIdentifier: '1500', MappingResource: 'DCMR' };
    const { result: bytes } = write({ CobbAngle: [classicTool('CobbAngle', [[0, 0], [10, 0], [0, 10], [10, 20]])] }, {
      document: { ...documentSettings(parent), personName: 'Observer^Test' },
    });
    const dataset = readSR(bytes);
    const items = numChildren(measurementGroups(dataset)[0]);

    expect(dataset.SOPClassUID).toBe(COMPREHENSIVE_3D_SR);
    expect(firstItem(dataset.ContentTemplateSequence)).toMatchObject({ TemplateIdentifier: '1500', MappingResource: 'DCMR' });
    expect(items.some(item => item.ValueType === 'CONTAINER')).toBe(true);
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
    [VIEWER_LENGTH]: { Length: [classicTool('Length', [[0.5, 0.5], [10.5, 20.5]], { _id: 'length-1' })] },
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

  it('does not hydrate the measurement groups of an application document (Sonador-SR root title)', () => {
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
    { fixture: IO_LENGTH, toolType: 'Length', value: 5, points: [[0, 0, 0], [3, 4, 0]], description: 'length measurement' },
  ];
  const storedValueOf = (toolType, state) => _.values(state.annotation.data.cachedStats)[0]?.[toolType === 'Length' ? 'length' : 'angle'];

  CASES.forEach(({ fixture, toolType, value, points, description }) => {
    const name = path.basename(fixture);
    const dataset = () => readSR(fs.readFileSync(fixture));

    it(`${name} hydrates on the image of its Frame of Reference, with its properties`, () => {
      const source = dataset();
      const [group] = measurementGroups(source);
      const { byType, warnings } = hydrate(source, [OTHER_FRAME_IMAGE, IMAGE]);
      const [state] = byType[toolType];

      expect(warnings.filter(message => /Unable to generate tool state/.test(message))).toEqual([]);
      expect(state.annotation.data.handles.points).toEqual(points);
      expect(storedValueOf(toolType, state)).toBe(value);
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

  it('re-saves an edited Length in the patient domain, from the patient points of its handles', () => {
    const source = readSR(fs.readFileSync(IO_LENGTH));
    const { byType } = hydrate(source);
    const tool = toClassicTool('Length', byType.Length[0]);
    // The end moved from (3, 4, 0) to (6, 8, 0) on the image
    const [x, y] = patientToImage(mockImagePlanes[tool.imageId], [6, 8, 0]);
    tool.handles.end = { x, y };
    const [group] = measurementGroups(readSR(quiet(() => writeSR({ Length: [tool] }, { document: reSaveOf(source) })).result));

    expect(coordinatesOf(group)).toMatchObject({ ValueType: 'SCOORD3D', ReferencedFrameOfReferenceUID: SYNTHETIC.FrameOfReferenceUID });
    expect(pointsOf(group)).toEqual([[0, 0, 0], [6, 8, 0]]);
    expect(valueOf(group)).toBeCloseTo(10, 6);
    expect(trackingUIDOf(group)).toBe(trackingUIDOf(measurementGroups(source)[0]));
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


describe('Length properties under the NUM item', () => {
  const write = (toolsByType, options) => quiet(() => deterministic(() => writeSR(toolsByType, options)));
  const lengthTool = extra => classicTool('Length', [[0.5, 0.5], [10.5, 0.5]], extra);
  const groupItems = group => asArray(group.ContentSequence).map(item => [item.ValueType, conceptNameValue(item)]);
  const propertyItems = items => items.filter(item => item.RelationshipType === 'HAS PROPERTIES')
    .map(item => [item.ValueType, conceptNameValue(item), item.TextValue || item.UID]);

  it('writes description, text, location and the display container as HAS PROPERTIES children of the NUM', () => {
    const [group] = measurementGroups(readSR(write({ Length: [lengthTool()] }).result));

    expect(trackingIdentifierOf(group)).toBe('cornerstoneTools@^4.0.0:Length');
    expect(groupItems(group)).toEqual([['TEXT', '112039'], ['UIDREF', '112040'], ['NUM', '410668003']]);
    expect(propertyItems(numChildren(group))).toEqual([
      ['TEXT', 'Sonador-Measurement.Description', 'Hip abduction'],
      ['TEXT', 'Sonador-Measurement.Text', 'Synthetic'],
      ['TEXT', 'Sonador-Measurement.Location', 'Synthetic location'],
      ['CONTAINER', 'Sonador-DisplayAttributes', undefined],
    ]);
  });

  it('reads them back from under the NUM on the hydration path, locked as read from a stored report', () => {
    const dataset = readSR(write({ Length: [lengthTool()] }).result);
    const [state] = hydrate(dataset).byType.Length;
    expect(state.description).toBe('Hip abduction');
    expect(state.annotation.metadata).toMatchObject({ text: 'Synthetic', location: 'Synthetic location' });
    expect(state.annotation.metadata).toMatchObject({ isReadOnly: true, isLocked: true, coordinateDomain: 'image' });
    expect(state.annotation.data.displayAttributes.Color.Border).toBe('#FF8800');
  });

  it('rewrites a legacy group-level Length under the NUM on a re-save', () => {
    // The legacy layout: the properties as group-level HAS CONCEPT MOD items, no display attributes
    const dataset = readSR(write({ Length: [lengthTool({ displayAttributes: undefined })] }).result);
    const [group] = measurementGroups(dataset);
    const num = numOf(group);
    const properties = asArray(num.ContentSequence).filter(item => item.RelationshipType === 'HAS PROPERTIES');
    num.ContentSequence = asArray(num.ContentSequence).filter(item => !properties.includes(item));
    group.ContentSequence = [...asArray(group.ContentSequence), ...properties.map(item => ({ ...item, RelationshipType: 'HAS CONCEPT MOD' }))];

    const [state] = hydrate(dataset).byType.Length;
    expect(state.description).toBe('Hip abduction');
    const resaved = readSR(write({ Length: [toClassicTool('Length', state)] }, { document: reSaveOf(dataset) }).result);
    const [resavedGroup] = measurementGroups(resaved);

    expect(groupItems(resavedGroup)).toEqual([['TEXT', '112039'], ['UIDREF', '112040'], ['NUM', '410668003']]);
    expect(propertyItems(numChildren(resavedGroup)).map(([, code]) => code)).toEqual([
      'Sonador-Measurement.Description', 'Sonador-Measurement.Text', 'Sonador-Measurement.Location',
    ]);
  });

  it('reads and carries the source series and the drawing plane of a patient-domain measurement through a re-save', () => {
    const dataset = readSR(write({
      Length: [lengthTool({ metadata: { sourceSeries: '2.25.4040', drawingPlane: '0,1,0,0,0,-1' } })],
    }).result);
    expect(propertyItems(numChildren(measurementGroups(dataset)[0])).filter(([type]) => type !== 'CONTAINER').slice(3)).toEqual([
      ['UIDREF', 'Sonador-Measurement.Source-Series', '2.25.4040'],
      ['TEXT', 'Sonador-Measurement.Drawing-Plane', '0,1,0,0,0,-1'],
    ]);

    const [state] = hydrate(dataset).byType.Length;
    expect(state.annotation.metadata).toMatchObject({ sourceSeries: '2.25.4040', drawingPlane: '0,1,0,0,0,-1' });
    const resaved = readSR(write({ Length: [toClassicTool('Length', state)] }, { document: reSaveOf(dataset) }).result);
    expect(propertyItems(numChildren(measurementGroups(resaved)[0])).filter(([type]) => type !== 'CONTAINER').slice(3)).toEqual([
      ['UIDREF', 'Sonador-Measurement.Source-Series', '2.25.4040'],
      ['TEXT', 'Sonador-Measurement.Drawing-Plane', '0,1,0,0,0,-1'],
    ]);
  });
});


describe('synthetic document fixtures (generated by __fixtures__/scripts)', () => {
  const fixture = name => readSR(fs.readFileSync(path.join(FIXTURES, name)));
  // The slice at z = 9 of the synthetic CT series: Pixel Spacing 0.8 mm between rows, 1.2 mm between
  // columns, slices 3 mm apart
  const ct = fixture('synthetic-ct/ct-04.dcm');
  const CT_IMAGE_ID = 'synthetic-ct:04';
  mockImagePlanes[CT_IMAGE_ID] = {
    imagePositionPatient: ct.ImagePositionPatient.map(Number), rowCosines: ct.ImageOrientationPatient.slice(0, 3).map(Number),
    columnCosines: ct.ImageOrientationPatient.slice(3).map(Number), rowPixelSpacing: Number(ct.PixelSpacing[0]),
    columnPixelSpacing: Number(ct.PixelSpacing[1]), frameOfReferenceUID: ct.FrameOfReferenceUID,
  };
  // The slice at z = 18, which the exchange document's measurements lie on
  const ctExchange = fixture('synthetic-ct/ct-07.dcm');
  const CT_EXCHANGE_IMAGE_ID = 'synthetic-ct:07';
  mockImagePlanes[CT_EXCHANGE_IMAGE_ID] = { ...mockImagePlanes[CT_IMAGE_ID], imagePositionPatient: ctExchange.ImagePositionPatient.map(Number) };
  const CT = [
    { SOPInstanceUID: ct.SOPInstanceUID, imageId: CT_IMAGE_ID },
    { SOPInstanceUID: ctExchange.SOPInstanceUID, imageId: CT_EXCHANGE_IMAGE_ID },
  ];

  it('is a CT series with unequal row and column spacing and slices more than 2 mm apart', () => {
    const slices = _.range(1, 13).map(n => fixture(`synthetic-ct/ct-${String(n).padStart(2, '0')}.dcm`));
    expect(ct.PixelSpacing.map(Number)).toEqual([0.8, 1.2]);
    const z = slices.map(slice => Number(slice.ImagePositionPatient[2]));
    expect(_.uniq(_.zip(z.slice(1), z.slice(0, -1)).map(([b, a]) => b - a))).toEqual([3]);
    expect(_.uniq(slices.map(slice => slice.FrameOfReferenceUID))).toEqual([ct.FrameOfReferenceUID]);
    expect(ct.PatientID).toBe('SYNTHETIC-PHANTOM');
  });

  it('hydrates the exchange document locked, with properties from under the NUM', () => {
    const { byType } = hydrate(fixture('sonador-io.exchange-document.dcm'), CT);
    expect(Object.keys(byType)).toEqual(['Length', 'Angle', 'CobbAngle']);

    const [length] = byType.Length;
    expect(length.annotation.metadata).toMatchObject({ isReadOnly: true, isLocked: true });
    expect(byType.Angle[0].annotation.metadata).toMatchObject({ isReadOnly: true, isLocked: true });
    expect(byType.CobbAngle[0].annotation.metadata).toMatchObject({ isReadOnly: true, isLocked: true });

    Object.entries({ Length: 'Length', Angle: 'Angle', CobbAngle: 'Cobb angle' }).forEach(([tool, name]) => {
      const [state] = byType[tool];
      expect(state.description).toBe(`${name} (synthetic)`);
      expect(state.annotation.metadata).toMatchObject({ text: 'Synthetic', location: 'Synthetic location', views: ['axial'] });
      expect(state.annotation.data.displayAttributes.Color.Border).toBe('#FF8800');
    });

    // In the patient domain, placed on the image whose plane holds both ends (the slice at z = 18),
    // with the points as written and the stored value
    expect(length.sopInstanceUid).toBe(ctExchange.SOPInstanceUID);
    expect(length.annotation.metadata).toMatchObject({
      FrameOfReferenceUID: '2.25.316170003', referencedImageId: CT_EXCHANGE_IMAGE_ID, coordinateDomain: 'patient',
      sourceGeometry: { valueType: 'SCOORD3D', graphicData: [-20, -10, 18, 20, 5, 18], FrameOfReferenceUID: '2.25.316170003' },
    });
    expect(length.annotation.data.handles.points).toEqual([[-20, -10, 18], [20, 5, 18]]);
    expect(length.annotation.data.cachedStats[`imageId:${CT_EXCHANGE_IMAGE_ID}`].length).toBeCloseTo(Math.hypot(40, 15), 6);
    expect(byType.Angle[0].sopInstanceUid).toBe(ctExchange.SOPInstanceUID);
    expect(byType.CobbAngle[0].sopInstanceUid).toBe(ctExchange.SOPInstanceUID);
  });

  it('hydrates only the Series Tag of the application document, and names the groups it does not hydrate', () => {
    const { byType, infos } = hydrate(fixture('sonador-io.application-document.dcm'), CT);
    expect(Object.keys(byType)).toEqual(['DICOMSRSeriesTagTool']);
    expect(byType.DICOMSRSeriesTagTool[0].annotation.metadata).toMatchObject({ isReadOnly: true, isLocked: true });
    expect(infos.map(([message]) => message.replace(/.*application document, /, ''))).toEqual([
      'Length group not hydrated trackingUID=2.25.31617051',
      'Angle group not hydrated trackingUID=2.25.31617052',
      'CobbAngle group not hydrated trackingUID=2.25.31617053',
      'Length group not hydrated trackingUID=2.25.31617054',
    ]);
  });

  it('reads the properties of the Python-written Length, Angle and Cobb angle fixtures from under the NUM', () => {
    ['length', 'angle', 'cobb-angle'].forEach((topic) => {
      const dataset = fixture(`sonador-io.${topic}.2026-1108.dcm`);
      const states = _.flatten(_.values(hydrate(dataset, IMAGES).byType));
      const [state] = states.length ? states : [null];
      const [group] = measurementGroups(dataset);
      const expectations = { description: `${topic} measurement`, text: 'Synthetic', location: 'Synthetic location', views: ['coronal'] };
      const measurement = {};
      parseExtendedMeta(group, measurement, { propertyParent: 'num', textPath: 'text', locationPath: 'location', viewsPath: 'views' });
      expect(_.pick(measurement, 'description', 'text', 'location', 'views')).toEqual(expectations);
      if (state) {
        expect(state.description).toBe(expectations.description);
      }
    });
  });
});


describe('out-of-plane measurements, written in the patient domain', () => {
  const SOURCE_SERIES = SonadorCodeValues.DCMSR_MEASUREMENT_SOURCE_SERIES.value;
  const DRAWING_PLANE = SonadorCodeValues.DCMSR_MEASUREMENT_DRAWING_PLANE.value;
  // Two series of the study sharing the Frame of Reference
  const SERIES_A = {
    StudyInstanceUID: SYNTHETIC.StudyInstanceUID, SeriesInstanceUID: '2.25.2001',
    instances: [1, 2, 3].map(n => ({ SOPClassUID: CT_IMAGE, SOPInstanceUID: `2.25.2001.${n}` })),
  };
  const SERIES_B = {
    StudyInstanceUID: SYNTHETIC.StudyInstanceUID, SeriesInstanceUID: '2.25.2002',
    instances: [1, 2].map(n => ({ SOPClassUID: CT_IMAGE, SOPInstanceUID: `2.25.2002.${n}` })),
  };
  const outOfPlane = (uid, toolType, patientPoints, series, extra = {}) => ({
    uid, _id: uid, toolType, patientPoints, FrameOfReferenceUID: SYNTHETIC.FrameOfReferenceUID,
    description: `${toolType} (out of plane)`,
    metadata: { outOfPlane: true, sourceSeries: series.SeriesInstanceUID, drawingPlane: '0,1,0,0,0,-1', views: ['sagittal'] },
    ...extra,
  });
  // A sagittal plane at x = 12: Length, Angle (90 degrees) and Cobb angle (90 degrees)
  const LENGTH = outOfPlane('oop-length', 'Length', [[12, 0, 0], [12, 30, -40]], SERIES_A);
  const ANGLE = outOfPlane('oop-angle', 'Angle', [[12, 10, 0], [12, 0, 0], [12, 0, -10]], SERIES_A);
  const COBB = outOfPlane('oop-cobb', 'CobbAngle', [[12, 0, 0], [12, 10, 0], [12, 0, -10], [12, 0, -20]], SERIES_A);
  const evidenceOf = dataset => asArray(dataset.CurrentRequestedProcedureEvidenceSequence).flatMap(study =>
    asArray(study.ReferencedSeriesSequence).flatMap(series => asArray(series.ReferencedSOPSequence)
      .map(sop => [study.StudyInstanceUID, series.SeriesInstanceUID, sop.ReferencedSOPInstanceUID])));
  const libraryImages = dataset => asArray(child(child(dataset, '111028'), '126200')?.ContentSequence);
  const uidOf = (items, code) => items.filter(item => conceptNameValue(item) === code).map(item => item.UID);
  const write = (toolState, patientSeries) => readSR(quiet(() => deterministic(() => writeSR({}, { toolState, patientSeries }))).result);

  it('writes a report holding only out-of-plane measurements: SCOORD3D, no image, the source series as evidence', () => {
    const dataset = write({ 'patient:2.25.2001': { Length: { data: [LENGTH] }, Angle: { data: [ANGLE] }, CobbAngle: { data: [COBB] } } },
      { 'patient:2.25.2001': SERIES_A });
    const groups = measurementGroups(dataset);

    expect(dataset.SOPClassUID).toBe(COMPREHENSIVE_3D_SR);
    expect(groups.map(trackingIdentifierOf)).toEqual(['Length', 'Angle', 'CobbAngle'].map(tool => `cornerstoneTools@^4.0.0:${tool}`));
    groups.forEach((group) => {
      const coordinates = coordinatesOf(group);
      expect(coordinates).toMatchObject({ ValueType: 'SCOORD3D', GraphicType: 'POLYLINE', RelationshipType: 'INFERRED FROM',
        ReferencedFrameOfReferenceUID: SYNTHETIC.FrameOfReferenceUID });
      expect(asArray(coordinates.ContentSequence)).toEqual([]);
      const items = numChildren(group);
      expect(uidOf(items, SOURCE_SERIES)).toEqual(['2.25.2001']);
      expect(textValues(items, DRAWING_PLANE)).toEqual(['0,1,0,0,0,-1']);
      expect(textValues(items, VIEW)).toEqual(['sagittal']);
    });

    // The points as held, known patient coordinates; the values from them
    expect(pointsOf(groups[0])).toEqual([[12, 0, 0], [12, 30, -40]]);
    expect(valueOf(groups[0])).toBeCloseTo(50, 6);
    expect(pointsOf(groups[1])).toEqual([[12, 10, 0], [12, 0, 0], [12, 0, 0], [12, 0, -10]]);
    expect(valueOf(groups[1])).toBeCloseTo(90, 6);
    expect(pointsOf(groups[2])).toEqual(COBB.patientPoints);
    expect(valueOf(groups[2])).toBeCloseTo(90, 6);

    // No image library entry; the evidence lists every instance of the source series
    expect(libraryImages(dataset)).toEqual([]);
    expect(evidenceOf(dataset)).toEqual(SERIES_A.instances.map(i => [SYNTHETIC.StudyInstanceUID, '2.25.2001', i.SOPInstanceUID]));
  });

  it('writes a mixed report: each measurement with its own series, the evidence listing every series', () => {
    const inPlane = classicTool('Length', [[0.5, 0.5], [10.5, 20.5]], { _id: 'in-plane-length' });
    const onB = outOfPlane('oop-length-b', 'Length', [[0, 5, 5], [0, 25, 5]], SERIES_B,
      { metadata: { outOfPlane: true, sourceSeries: '2.25.2002', drawingPlane: '0,1,0,0,0,-1', views: ['sagittal'] } });
    const dataset = write({
      [IMAGE.imageId]: { Length: { data: [inPlane] } },
      'patient:2.25.2001': { Length: { data: [LENGTH] } },
      'patient:2.25.2002': { Length: { data: [onB] } },
    }, { 'patient:2.25.2001': SERIES_A, 'patient:2.25.2002': SERIES_B });
    const groups = measurementGroups(dataset);

    expect(groups.map(group => coordinatesOf(group).ValueType)).toEqual(['SCOORD', 'SCOORD3D', 'SCOORD3D']);
    expect(groups.map(group => uidOf(numChildren(group), SOURCE_SERIES))).toEqual([[], ['2.25.2001'], ['2.25.2002']]);
    // Drawing-Plane only for the out-of-plane measurements
    expect(groups.map(group => textValues(numChildren(group), DRAWING_PLANE).length)).toEqual([0, 1, 1]);
    expect(_.uniq(evidenceOf(dataset).map(([, series]) => series))).toEqual([SYNTHETIC.SeriesInstanceUID, '2.25.2001', '2.25.2002']);
    expect(libraryImages(dataset).map(item => firstItem(item.ReferencedSOPSequence).ReferencedSOPInstanceUID)).toEqual([IMAGE.SOPInstanceUID]);
  });

  it('keeps the tracking identity of an out-of-plane measurement on a re-save', () => {
    const saved = { ...LENGTH, TrackingUniqueIdentifier: '2.25.880', TrackingIdentifier: 'Cornerstone3DTools@^0.1.0:Length' };
    const [group] = measurementGroups(write({ 'patient:2.25.2001': { Length: { data: [saved] } } }, { 'patient:2.25.2001': SERIES_A }));
    expect(trackingUIDOf(group)).toBe('2.25.880');
    expect(trackingIdentifierOf(group)).toBe('Cornerstone3DTools@^0.1.0:Length');
  });

  it('refuses one without a Frame of Reference or with the wrong number of points, and writes the others', () => {
    const refused = [];
    const noFrame = { ...LENGTH, uid: 'no-frame', _id: 'no-frame', FrameOfReferenceUID: undefined };
    const short = { ...ANGLE, uid: 'short', _id: 'short', patientPoints: ANGLE.patientPoints.slice(0, 2) };
    const { result } = quiet(() => writeSR({}, {
      toolState: { 'patient:2.25.2001': { Length: { data: [noFrame, LENGTH] }, Angle: { data: [short] } } },
      patientSeries: { 'patient:2.25.2001': SERIES_A },
      onMeasurementRefused: (toolType, tool, error) => refused.push([tool._id, error.code]),
    }));
    expect(refused).toEqual([['no-frame', 'frame-of-reference'], ['short', 'incomplete']]);
    expect(measurementGroups(readSR(result))).toHaveLength(1);
  });
});


describe('reloading a patient-domain measurement, by its Drawing-Plane', () => {
  const SERIES = {
    StudyInstanceUID: SYNTHETIC.StudyInstanceUID, SeriesInstanceUID: SYNTHETIC.SeriesInstanceUID,
    instances: [{ SOPClassUID: CT_IMAGE, SOPInstanceUID: IMAGE.SOPInstanceUID }],
  };
  // A Length in the sagittal plane x = 5 whose two ends both lie on the axial image at z = 0
  const onTheImage = (drawingPlane, extra = {}) => ({
    uid: 'reload-1', _id: 'reload-1', toolType: 'Length', patientPoints: [[5, 2, 0], [5, 20, 0]],
    FrameOfReferenceUID: SYNTHETIC.FrameOfReferenceUID,
    metadata: { outOfPlane: true, sourceSeries: SYNTHETIC.SeriesInstanceUID, drawingPlane, views: ['sagittal'] },
    ...extra,
  });
  const saved = tool => readSR(quiet(() => writeSR({}, {
    toolState: { [`patient:${SYNTHETIC.SeriesInstanceUID}`]: { [tool.toolType]: { data: [tool] } } },
    patientSeries: { [`patient:${SYNTHETIC.SeriesInstanceUID}`]: SERIES },
  })).result);

  it('keeps one with a valid Drawing-Plane out-of-plane, although an image holds its points', () => {
    const { byType, warnings } = hydrate(saved(onTheImage('0,1,0,0,0,-1')));
    const [state] = byType.Length;
    expect(state.sopInstanceUid).toBeUndefined();
    expect(state.annotation.metadata).toMatchObject({
      outOfPlane: true, coordinateDomain: 'patient', drawingPlane: '0,1,0,0,0,-1', sourceSeries: SYNTHETIC.SeriesInstanceUID,
      views: ['sagittal'], isLocked: true,
    });
    expect(state.annotation.metadata.referencedImageId).toBeUndefined();
    expect(state.annotation.data.handles.points).toEqual([[5, 2, 0], [5, 20, 0]]);
    expect(warnings.filter(message => /Drawing-Plane/.test(message))).toEqual([]);
  });

  it('logs a malformed Drawing-Plane with the tracking UID, treats it as absent, and keeps its text', () => {
    ['0,1,0,0,0', '0,1.5,0,0,0,-1'].forEach((text) => {
      const { byType, warnings } = hydrate(saved(onTheImage(text, { TrackingUniqueIdentifier: '2.25.7700' })));
      const [state] = byType.Length;
      expect(warnings.filter(message => /malformed Drawing-Plane/.test(message))).toEqual([
        expect.stringMatching(new RegExp(`"${text.replace(/\./g, '\\.')}" .*trackingUID=2\\.25\\.7700$`)),
      ]);
      // Absent: placed on the image that holds both ends, the text carried for a re-save
      expect(state.sopInstanceUid).toBe(IMAGE.SOPInstanceUID);
      expect(state.annotation.metadata.outOfPlane).toBeUndefined();
      expect(state.annotation.metadata.drawingPlane).toBe(text);
    });
  });

  it('places one without a Drawing-Plane on the image that holds it, and holds one that no image holds', () => {
    const placed = hydrate(saved(onTheImage(undefined))).byType.Length[0];
    expect(placed.sopInstanceUid).toBe(IMAGE.SOPInstanceUID);

    const between = onTheImage(undefined, { patientPoints: [[5, 2, 7], [5, 20, 7]] });
    const held = hydrate(saved(between)).byType.Length[0];
    expect(held.sopInstanceUid).toBeUndefined();
    expect(held.annotation.metadata.sourceGeometry).toMatchObject({ valueType: 'SCOORD3D', graphicData: [5, 2, 7, 5, 20, 7] });
  });
});


describe('acceptance: out-of-plane measurements on the synthetic axial series', () => {
  // The synthetic CT: 64 x 48, Pixel Spacing 0.8 mm (rows) and 1.2 mm (columns), slices 3 mm apart at z = 0 to 33
  const read = name => readSR(fs.readFileSync(path.join(FIXTURES, name)));
  const slices = _.range(1, 13).map(n => read(`synthetic-ct/ct-${String(n).padStart(2, '0')}.dcm`));
  const CT = slices.map((slice, index) => ({ SOPInstanceUID: slice.SOPInstanceUID, imageId: `synthetic-ct-axial:${index + 1}` }));
  slices.forEach((slice, index) => {
    mockImagePlanes[CT[index].imageId] = {
      imagePositionPatient: slice.ImagePositionPatient.map(Number), rowCosines: slice.ImageOrientationPatient.slice(0, 3).map(Number),
      columnCosines: slice.ImageOrientationPatient.slice(3).map(Number), rowPixelSpacing: Number(slice.PixelSpacing[0]),
      columnPixelSpacing: Number(slice.PixelSpacing[1]), frameOfReferenceUID: slice.FrameOfReferenceUID,
    };
  });
  IMAGES.push(...CT);
  const [first] = slices;
  const FOR = first.FrameOfReferenceUID;
  const SERIES_KEY = `patient:${first.SeriesInstanceUID}`;
  const SERIES = {
    StudyInstanceUID: first.StudyInstanceUID, SeriesInstanceUID: first.SeriesInstanceUID,
    instances: slices.map(slice => ({ SOPClassUID: slice.SOPClassUID, SOPInstanceUID: slice.SOPInstanceUID })),
  };
  const HEADERS = { PatientName: [{ Alphabetic: 'Synthetic^Phantom' }], PatientID: 'SYNTHETIC-PHANTOM', StudyID: '1', StudyInstanceUID: first.StudyInstanceUID };
  const SOURCE_SERIES = SonadorCodeValues.DCMSR_MEASUREMENT_SOURCE_SERIES.value;
  const DRAWING_PLANE = SonadorCodeValues.DCMSR_MEASUREMENT_DRAWING_PLANE.value;
  const uidOf = (items, code) => items.filter(item => conceptNameValue(item) === code).map(item => item.UID);

  // The Inspector's cameras: sagittal (normal +x, up +z), and turned 45 degrees between sagittal and axial
  const SAGITTAL = { viewPlaneNormal: [1, 0, 0], viewUp: [0, 0, 1] };
  const OBLIQUE = { viewPlaneNormal: [Math.SQRT1_2, 0, Math.SQRT1_2], viewUp: [0, 1, 0] };
  // The record a drawing becomes (cornerstone measurementAnnotationSync), as the writer receives it
  const drawn = (uid, toolType, patientPoints, { viewPlaneNormal, viewUp }, extra = {}) => ({
    uid, _id: uid, toolType, patientPoints, FrameOfReferenceUID: FOR,
    metadata: {
      outOfPlane: true, sourceSeries: SERIES.SeriesInstanceUID,
      drawingPlane: formatDrawingPlane(drawingPlaneOfView(viewPlaneNormal, viewUp)), views: [viewOfNormal(viewPlaneNormal)],
      ...extra,
    },
  });
  const MEASUREMENTS = {
    Length: [
      drawn('acc-length', 'Length', [[6, -10, 4], [6, 8, 25]], SAGITTAL),
      // On the oblique plane x + z = 15
      drawn('acc-oblique', 'Length', [[-10, 0, 25], [10, 5, 5]], OBLIQUE),
    ],
    Angle: [drawn('acc-angle', 'Angle', [[6, 10, 9.5], [6, 0, 9.5], [6, 0, 20]], SAGITTAL)],
    CobbAngle: [drawn('acc-cobb', 'CobbAngle', [[6, -15, 3], [6, -5, 3], [6, -15, 10], [6, -15, 22]], SAGITTAL)],
  };
  const write = (byType, options = {}) => quiet(() => deterministic(() => writeSR({}, {
    toolState: { [SERIES_KEY]: _.mapValues(byType, data => ({ data })) }, patientSeries: { [SERIES_KEY]: SERIES }, headers: HEADERS, ...options,
  }))).result;
  const VIEWER_OUT_OF_PLANE = path.join(FIXTURES, 'sonador-viewer.out-of-plane.2026-1110.dcm');

  it('writes the drawings of a sagittal and an oblique Inspector with View, Source-Series and Drawing-Plane', () => {
    const bytes = write(MEASUREMENTS);
    if (process.env.UPDATE_SR_FIXTURES) {
      fs.writeFileSync(VIEWER_OUT_OF_PLANE, bytes);
    }
    // The Viewer-authored out-of-plane fixture the Sonador IO client reads
    expect(bytes.equals(fs.readFileSync(VIEWER_OUT_OF_PLANE))).toBe(true);

    const dataset = readSR(bytes);
    const groups = measurementGroups(dataset);
    expect(dataset.SOPClassUID).toBe(COMPREHENSIVE_3D_SR);
    expect(groups.map(group => [
      trackingIdentifierOf(group).split(':')[1],
      textValues(numChildren(group), VIEW),
      uidOf(numChildren(group), SOURCE_SERIES),
      textValues(numChildren(group), DRAWING_PLANE),
    ])).toEqual([
      ['Length', ['sagittal'], [SERIES.SeriesInstanceUID], ['0,1,0,0,0,-1']],
      ['Length', ['oblique'], [SERIES.SeriesInstanceUID], ['0.707107,0,-0.707107,0,-1,0']],
      ['Angle', ['sagittal'], [SERIES.SeriesInstanceUID], ['0,1,0,0,0,-1']],
      ['CobbAngle', ['sagittal'], [SERIES.SeriesInstanceUID], ['0,1,0,0,0,-1']],
    ]);

    // The patient coordinates drawn, unchanged, with their values
    expect(groups.map(pointsOf)).toEqual([
      [[6, -10, 4], [6, 8, 25]], [[-10, 0, 25], [10, 5, 5]],
      [[6, 10, 9.5], [6, 0, 9.5], [6, 0, 9.5], [6, 0, 20]], [[6, -15, 3], [6, -5, 3], [6, -15, 10], [6, -15, 22]],
    ]);
    expect(groups.map(valueOf).map(value => _.round(value, 6)))
      .toEqual([_.round(Math.hypot(18, 21), 6), _.round(Math.hypot(20, 5, 20), 6), 90, 90]);
    groups.forEach(group => expect(coordinatesOf(group)).toMatchObject({ ValueType: 'SCOORD3D', ReferencedFrameOfReferenceUID: FOR }));
    expect(_.uniq(asArray(dataset.CurrentRequestedProcedureEvidenceSequence)
      .map(study => firstItem(study.ReferencedSeriesSequence).SeriesInstanceUID))).toEqual([SERIES.SeriesInstanceUID]);
    expect(asArray(dataset.CurrentRequestedProcedureEvidenceSequence)).toHaveLength(12);
  });

  it('reloads each as a locked out-of-plane measurement, found again on the plane it was drawn on', () => {
    const { byType } = hydrate(read('sonador-viewer.out-of-plane.2026-1110.dcm'), CT);
    const states = [...byType.Length, ...byType.Angle, ...byType.CobbAngle];
    expect(states).toHaveLength(4);
    states.forEach((state) => {
      expect(state.sopInstanceUid).toBeUndefined();
      expect(state.annotation.metadata).toMatchObject({ outOfPlane: true, isLocked: true, sourceSeries: SERIES.SeriesInstanceUID });
    });
    expect(states.map(state => state.annotation.metadata.views)).toEqual([['sagittal'], ['oblique'], ['sagittal'], ['sagittal']]);
    // Navigation turns a pane onto the drawing plane: the normal of each view
    const normals = states.map(state => navigationPlaneOf(state.annotation.data.handles.points, state.annotation.metadata.drawingPlane));
    normals.forEach(plane => expect(plane.kind).toBe('drawing-plane'));
    const along = (normal, expected) => expect(Math.abs(normal.reduce((sum, v, i) => sum + v * expected[i], 0))).toBeCloseTo(1, 6);
    along(normals[0].normal, [1, 0, 0]);
    along(normals[1].normal, OBLIQUE.viewPlaneNormal);
  });

  it('writes an in-plane drawing on the image at its known patient coordinates despite the unequal spacing', () => {
    // On the slice at z = 9: image (15.8333, 12) and (49.1667, 30.75) are patient (-20, -10, 9) and (20, 5, 9)
    const [x0, y0] = patientToImage(mockImagePlanes[CT[3].imageId], [-20, -10, 9]);
    const [x1, y1] = patientToImage(mockImagePlanes[CT[3].imageId], [20, 5, 9]);
    [x0, y0, x1, y1].forEach((value, i) => expect(value).toBeCloseTo([15.833333, 12, 49.166667, 30.75][i], 5));
    const tool = classicTool('Length', [[x0, y0], [x1, y1]], { _id: 'in-plane', length: Math.hypot(40, 15) });
    const dataset = readSR(quiet(() => writeSR({ Length: [tool] }, { imageId: CT[3].imageId })).result);
    const [group] = measurementGroups(dataset);
    expect(coordinatesOf(group).ValueType).toBe('SCOORD');

    // Hydrated at the same patient points the read-only display places it at (SCOORD holds 32-bit
    // floats: within 1e-4 mm)
    const [state] = hydrate(dataset, [CT[3]]).byType.Length;
    state.annotation.data.handles.points.forEach((point, i) =>
      point.forEach((value, axis) => expect(value).toBeCloseTo([[-20, -10, 9], [20, 5, 9]][i][axis], 4)));
  });

  it('loads an Angle of 180 degrees and a skew Cobb angle with their stored points, and finds the plane they navigate by', () => {
    const straight = drawn('acc-straight', 'Angle', [[-10, 0, 10.5], [0, 0, 10.5], [10, 0, 10.5]], SAGITTAL, { drawingPlane: undefined });
    const skew = drawn('acc-skew', 'CobbAngle', [[0, 0, 0], [10, 0, 0], [0, 10, 10], [0, 20, 10]], SAGITTAL, { drawingPlane: undefined });
    const dataset = readSR(write({ Angle: [straight], CobbAngle: [skew] }));
    const [angleGroup, cobbGroup] = measurementGroups(dataset);
    expect(valueOf(angleGroup)).toBeCloseTo(180, 6);
    expect(valueOf(cobbGroup)).toBeCloseTo(90, 6);

    const { byType } = hydrate(dataset, CT);
    const [angle] = byType.Angle;
    const [cobb] = byType.CobbAngle;
    expect(angle.sopInstanceUid).toBeUndefined();
    expect(cobb.sopInstanceUid).toBeUndefined();
    expect(cobb.annotation.metadata.sourceGeometry.graphicData).toEqual([0, 0, 0, 10, 0, 0, 0, 10, 10, 0, 20, 10]);
    expect(navigationPlaneOf(angle.annotation.data.handles.points)).toMatchObject({ kind: 'collinear', view: 'axial' });
    expect(navigationPlaneOf(cobb.annotation.data.handles.points)).toMatchObject({ kind: 'none' });
  });

  it('writes a measurement of a Frame of Reference no loaded series shares, and a malformed Drawing-Plane, unchanged', () => {
    const elsewhere = { ...drawn('acc-elsewhere', 'Length', [[6, -10, 4], [6, 8, 25]], SAGITTAL), FrameOfReferenceUID: '2.25.99999' };
    const malformed = drawn('acc-malformed', 'Length', [[6, -10, 4], [6, 8, 25]], SAGITTAL, { drawingPlane: '0,1,0,0,0' });
    const dataset = readSR(write({ Length: [elsewhere, malformed] }));
    const [elsewhereGroup, malformedGroup] = measurementGroups(dataset);
    expect(coordinatesOf(elsewhereGroup).ReferencedFrameOfReferenceUID).toBe('2.25.99999');
    expect(textValues(numChildren(malformedGroup), DRAWING_PLANE)).toEqual(['0,1,0,0,0']);

    const { byType, warnings } = hydrate(dataset, CT);
    expect(byType.Length.map(state => state.sopInstanceUid)).toEqual([undefined, undefined]);
    expect(warnings.filter(message => /malformed Drawing-Plane "0,1,0,0,0"/.test(message))).toHaveLength(1);
    expect(byType.Length[1].annotation.metadata.drawingPlane).toBe('0,1,0,0,0');
  });

  const REQUESTED = 'CurrentRequestedProcedureEvidenceSequence';
  const tagged = ({ StudyInstanceUID, SeriesInstanceUID, instances }, evidenceContainer = REQUESTED) =>
    instances.map(instance => ({ StudyInstanceUID, SeriesInstanceUID, evidenceContainer, ...instance }));
  const evidenceInstancesOf = dataset => _.sortBy(asArray(dataset.CurrentRequestedProcedureEvidenceSequence).flatMap(study =>
    asArray(study.ReferencedSeriesSequence).flatMap(series => asArray(series.ReferencedSOPSequence)
      .map(item => [series.SeriesInstanceUID, item.ReferencedSOPInstanceUID]))), pair => pair[1]);
  const trackingUIDsOf = group => asArray(group.ContentSequence).filter(item => conceptNameValue(item) === '112040').map(item => item.UID);

  it('writes again, on a re-save, a held measurement without a Source-Series whose report lists two unloaded series', () => {
    // Another system's report: no Source-Series, evidence of two series, neither loaded
    const ELSEWHERE = '2.25.99999';
    const OTHER = {
      StudyInstanceUID: SERIES.StudyInstanceUID, SeriesInstanceUID: '2.25.8001',
      instances: [1, 2].map(n => ({ SOPClassUID: SERIES.instances[0].SOPClassUID, SOPInstanceUID: `2.25.8001.${n}` })),
    };
    const BOTH = { ...SERIES, instances: [...tagged(SERIES), ...tagged(OTHER)] };
    const stored = { ...drawn('acc-unsourced', 'Length', [[6, -10, 4], [6, 8, 25]], SAGITTAL), FrameOfReferenceUID: ELSEWHERE };
    stored.metadata = _.omit(stored.metadata, 'sourceSeries');
    const report = readSR(write({ Length: [stored] }, { patientSeries: { [SERIES_KEY]: BOTH } }));
    expect(uidOf(numChildren(measurementGroups(report)[0]), SOURCE_SERIES)).toEqual([]);
    expect(_.uniq(evidenceInstancesOf(report).map(([series]) => series)).sort()).toEqual(['2.25.8001', SERIES.SeriesInstanceUID].sort());

    const { byType } = hydrate(report, CT);
    const [state] = byType.Length;
    const { TrackingUniqueIdentifier } = state.annotation.metadata;
    const held = { ...heldOutOfPlaneRecord('Length', state, report.StudyInstanceUID), uid: 'held-2' };
    held.metadata.carriedEvidence = carriedEvidenceOf(report, held);
    expect(held.metadata.sourceSeries).toBeUndefined();
    expect(isCarriedForward(held)).toBe(true);
    expect(_.sortBy(held.metadata.carriedEvidence.instances, 'SOPInstanceUID')).toEqual(_.sortBy(BOTH.instances, 'SOPInstanceUID'));

    // Keyed by itself, as parseMeasurementsData keys a held measurement without a Source-Series
    const key = 'patient:held-2';
    const resaved = readSR(quiet(() => deterministic(() => writeSR({}, {
      toolState: { [key]: { Length: { data: [patientToolData(held)] } } },
      patientSeries: { [key]: held.metadata.carriedEvidence }, headers: HEADERS,
    }))).result);
    const [group] = measurementGroups(resaved);
    expect(trackingUIDsOf(group)).toEqual([TrackingUniqueIdentifier]);
    expect(pointsOf(group)).toEqual([[6, -10, 4], [6, 8, 25]]);
    expect(_.round(valueOf(group), 6)).toBe(_.round(Math.hypot(18, 21), 6));
    expect(coordinatesOf(group)).toMatchObject({ ValueType: 'SCOORD3D', ReferencedFrameOfReferenceUID: ELSEWHERE });
    expect([
      textValues(numChildren(group), VIEW), uidOf(numChildren(group), SOURCE_SERIES), textValues(numChildren(group), DRAWING_PLANE),
    ]).toEqual([['sagittal'], [], ['0,1,0,0,0,-1']]);
    // Every instance of both series, each under its own series
    expect(evidenceInstancesOf(resaved)).toEqual(evidenceInstancesOf(report));
    expect(evidenceInstancesOf(resaved)).toHaveLength(SERIES.instances.length + 2);
  });

  describe('writes again, as the only measurement of the new report, a held measurement whose report lists its evidence', () => {
    const ELSEWHERE = '2.25.99999';
    const OTHER = 'PertinentOtherEvidenceSequence';
    // References of an evidence container, as [study, series, SOP instance], sorted by SOP instance
    const referencesOf = (dataset, container) => _.sortBy(asArray(dataset[container]).flatMap(study =>
      asArray(study.ReferencedSeriesSequence).flatMap(series => asArray(series.ReferencedSOPSequence)
        .map(item => [study.StudyInstanceUID, series.SeriesInstanceUID, item.ReferencedSOPInstanceUID]))), reference => reference[2]);
    const instancesOf = series => _.sortBy(series.instances.map(instance => [series.StudyInstanceUID, series.SeriesInstanceUID, instance.SOPInstanceUID]), r => r[2]);
    const [FIRST, REST] = [{ ...SERIES, instances: SERIES.instances.slice(0, 4) }, { ...SERIES, instances: SERIES.instances.slice(4) }];

    // The stored report, its evidence moved between the containers as another system wrote it
    const storedReport = (arrange) => {
      const stored = { ...drawn('acc-evidence', 'Length', [[6, -10, 4], [6, 8, 25]], SAGITTAL), FrameOfReferenceUID: ELSEWHERE };
      stored.metadata = _.omit(stored.metadata, 'sourceSeries');
      const report = readSR(write({ Length: [stored] }));
      arrange(report);
      return report;
    };
    const resave = (report) => {
      const [state] = hydrate(report, CT).byType.Length;
      const held = { ...heldOutOfPlaneRecord('Length', state, report.StudyInstanceUID), uid: 'held-evidence' };
      held.metadata.carriedEvidence = carriedEvidenceOf(report, held);
      expect(isCarriedForward(held)).toBe(true);
      const key = `patient:${held.uid}`;
      const resaved = readSR(quiet(() => deterministic(() => writeSR({}, {
        toolState: { [key]: { Length: { data: [patientToolData(held)] } } },
        patientSeries: { [key]: held.metadata.carriedEvidence }, headers: HEADERS,
      }))).result);
      const groups = measurementGroups(resaved);
      expect(groups).toHaveLength(1);
      expect(trackingUIDsOf(groups[0])).toEqual([state.annotation.metadata.TrackingUniqueIdentifier]);
      expect(pointsOf(groups[0])).toEqual([[6, -10, 4], [6, 8, 25]]);
      expect(_.round(valueOf(groups[0]), 6)).toBe(_.round(Math.hypot(18, 21), 6));
      expect(coordinatesOf(groups[0])).toMatchObject({ ValueType: 'SCOORD3D', ReferencedFrameOfReferenceUID: ELSEWHERE });
      expect(uidOf(numChildren(groups[0]), SOURCE_SERIES)).toEqual([]);
      expect(coordinatesOf(groups[0]).ContentSequence).toBeUndefined();
      // Read again, it is held again with the same evidence
      const [again] = hydrate(resaved, CT).byType.Length;
      expect(again.annotation.metadata.TrackingUniqueIdentifier).toBe(state.annotation.metadata.TrackingUniqueIdentifier);
      const heldAgain = heldOutOfPlaneRecord('Length', again, resaved.StudyInstanceUID);
      expect(_.sortBy(carriedEvidenceOf(resaved, heldAgain).instances, 'SOPInstanceUID'))
        .toEqual(_.sortBy(held.metadata.carriedEvidence.instances, 'SOPInstanceUID'));
      return resaved;
    };

    it('in the Current Requested Procedure Evidence Sequence only', () => {
      const resaved = resave(storedReport(() => {}));
      expect(referencesOf(resaved, REQUESTED)).toEqual(instancesOf(SERIES));
      expect(resaved).not.toHaveProperty(OTHER);
    });

    it('in the Pertinent Other Evidence Sequence only', () => {
      const resaved = resave(storedReport((report) => {
        report[OTHER] = report[REQUESTED];
        delete report[REQUESTED];
      }));
      expect(referencesOf(resaved, OTHER)).toEqual(instancesOf(SERIES));
      // A375 is Type 1C: absent, not empty
      expect(resaved).not.toHaveProperty(REQUESTED);
    });

    it('in both, each reference in the container it was read from', () => {
      const resaved = resave(storedReport((report) => {
        const all = asArray(report[REQUESTED]);
        const inFirst = item => FIRST.instances.some(instance => instance.SOPInstanceUID === firstItem(firstItem(item.ReferencedSeriesSequence).ReferencedSOPSequence).ReferencedSOPInstanceUID);
        report[REQUESTED] = all.filter(inFirst);
        report[OTHER] = all.filter(item => !inFirst(item));
      }));
      expect(referencesOf(resaved, REQUESTED)).toEqual(instancesOf(FIRST));
      expect(referencesOf(resaved, OTHER)).toEqual(instancesOf(REST));
    });

    it('in neither: written again with no evidence of its own', () => {
      const resaved = resave(storedReport((report) => {
        delete report[REQUESTED];
      }));
      expect(resaved).not.toHaveProperty(REQUESTED);
      expect(resaved).not.toHaveProperty(OTHER);
    });
  });

  it('writes again two held measurements of one Source-Series with the union of their evidence, in either order', () => {
    const ELSEWHERE = '2.25.99999';
    const [one, two] = [0, 1].map((n) => {
      // Each report lists one instance of the series
      const evidence = { ...SERIES, instances: [SERIES.instances[n]] };
      const stored = { ...drawn(`acc-same-${n}`, 'Length', [[6, -10, 4 + n], [6, 8, 25]], SAGITTAL), FrameOfReferenceUID: ELSEWHERE };
      const report = readSR(write({ Length: [stored] }, { patientSeries: { [SERIES_KEY]: evidence } }));
      const [state] = hydrate(report, CT).byType.Length;
      const held = { ...heldOutOfPlaneRecord('Length', state, report.StudyInstanceUID), uid: `held-same-${n}` };
      held.metadata.carriedEvidence = carriedEvidenceOf(report, held);
      expect(held.metadata.sourceSeries).toBe(SERIES.SeriesInstanceUID);
      return held;
    });
    [[one, two], [two, one]].forEach((order) => {
      // Keyed each by itself, as parseMeasurementsData keys a held measurement
      const resaved = readSR(quiet(() => deterministic(() => writeSR({}, {
        toolState: _.fromPairs(order.map(held => [`patient:${held.uid}`, { Length: { data: [patientToolData(held)] } }])),
        patientSeries: _.fromPairs(order.map(held => [`patient:${held.uid}`, held.metadata.carriedEvidence])), headers: HEADERS,
      }))).result);
      const groups = measurementGroups(resaved);
      expect(groups.map(trackingUIDsOf)).toEqual(order.map(held => [held.metadata.TrackingUniqueIdentifier]));
      expect(groups.map(pointsOf)).toEqual(order.map(held => held.points));
      expect(evidenceInstancesOf(resaved)).toEqual(_.sortBy(SERIES.instances.slice(0, 2).map(instance => [SERIES.SeriesInstanceUID, instance.SOPInstanceUID]), pair => pair[1]));
    });
  });

  it('writes again, on a re-save, a held measurement of a Frame of Reference no loaded series shares', () => {
    // A confirmed report of the Viewer, read in a session where its series is not loaded
    const ELSEWHERE = '2.25.99999';
    const stored = { ...drawn('acc-held', 'Length', [[6, -10, 4], [6, 8, 25]], SAGITTAL), FrameOfReferenceUID: ELSEWHERE };
    const report = readSR(write({ Length: [stored] }));
    const { byType } = hydrate(report, CT);
    const [state] = byType.Length;
    const TrackingUniqueIdentifier = state.annotation.metadata.TrackingUniqueIdentifier;
    expect(TrackingUniqueIdentifier).toBeTruthy();

    const held = heldOutOfPlaneRecord('Length', state, report.StudyInstanceUID);
    held.metadata.carriedEvidence = carriedEvidenceOf(report, held);
    held.uid = 'held-1';
    expect(held.metadata).toMatchObject({ isLocked: true });
    expect(isCarriedForward(held)).toBe(true);
    expect(held.metadata.carriedEvidence).toEqual({ ...SERIES, instances: tagged(SERIES) });

    // The save writes it with the evidence it was read with (parseMeasurementsData: patientSeries)
    const resaved = readSR(write({ Length: [patientToolData(held)] }, { patientSeries: { [SERIES_KEY]: held.metadata.carriedEvidence } }));
    const [group] = measurementGroups(resaved);
    expect(trackingUIDsOf(group)).toEqual([TrackingUniqueIdentifier]);
    expect(pointsOf(group)).toEqual([[6, -10, 4], [6, 8, 25]]);
    expect(_.round(valueOf(group), 6)).toBe(_.round(Math.hypot(18, 21), 6));
    expect(coordinatesOf(group)).toMatchObject({ ValueType: 'SCOORD3D', ReferencedFrameOfReferenceUID: ELSEWHERE });
    expect([
      textValues(numChildren(group), VIEW), uidOf(numChildren(group), SOURCE_SERIES), textValues(numChildren(group), DRAWING_PLANE),
    ]).toEqual([['sagittal'], [SERIES.SeriesInstanceUID], ['0,1,0,0,0,-1']]);
    expect(evidenceInstancesOf(resaved)).toEqual(evidenceInstancesOf(report));
    expect(evidenceInstancesOf(resaved)).toHaveLength(SERIES.instances.length);
  });

  it('writes back the value a measurement was read with while its points are unchanged, and a new one after an edit', () => {
    // Values another system stored, not those of the points: kept, not recomputed
    const STORED = { Length: 49.876, Angle: 89.876, CobbAngle: 89.876 };
    const dataset = readSR(write(_.pick(MEASUREMENTS, ['Angle', 'CobbAngle']), {}));
    const withLength = readSR(write({ Length: [MEASUREMENTS.Length[0]] }));
    [...measurementGroups(dataset), ...measurementGroups(withLength)].forEach((group) => {
      const toolType = trackingIdentifierOf(group).split(':')[1];
      firstItem(numOf(group).MeasuredValueSequence).NumericValue = STORED[toolType];
    });

    const held = [dataset, withLength].flatMap((report) => {
      const { byType } = hydrate(report, CT);
      return _.flatMap(byType, (states, toolType) => states.map(state => heldOutOfPlaneRecord(toolType, state, report.StudyInstanceUID)));
    });
    expect(held.map(record => record.toolName)).toEqual(['Angle', 'CobbAngle', 'Length']);

    const rewrite = tools => measurementGroups(readSR(quiet(() => writeSR({}, {
      toolState: { [SERIES_KEY]: _.mapValues(_.groupBy(tools, 'toolType'), data => ({ data })) },
      patientSeries: { [SERIES_KEY]: SERIES },
    })).result));

    // Unchanged: the stored value and the stored points
    const unchanged = rewrite(held.map((record, i) => patientToolData({ ...record, uid: `held-${i}` })));
    expect(unchanged.map(valueOf)).toEqual([STORED.Angle, STORED.CobbAngle, STORED.Length]);
    expect(pointsOf(unchanged[0])).toEqual([[6, 10, 9.5], [6, 0, 9.5], [6, 0, 9.5], [6, 0, 20]]);

    // Edited (a point moved): computed from the new points
    const edited = rewrite(held.map((record, i) => {
      const tool = patientToolData({ ...record, uid: `edited-${i}` });
      tool.patientPoints = tool.patientPoints.map((point, j) => (j === tool.patientPoints.length - 1 ? [point[0], point[1], point[2] + 10] : point));
      return tool;
    }));
    expect(edited.map(valueOf).map(value => _.round(value, 3))).not.toEqual([STORED.Angle, STORED.CobbAngle, STORED.Length]);
    expect(_.round(valueOf(edited[2]), 6)).toBe(_.round(Math.hypot(18, 31), 6));
  });
});

