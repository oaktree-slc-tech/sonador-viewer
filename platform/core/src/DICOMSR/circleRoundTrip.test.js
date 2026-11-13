// Circle DICOM-SR round trip (circleGeometry.js): the Viewer writer (the classic adapter -> TID 300
// -> TID 1500 -> properties under the Area NUM), the Cornerstone3D hydration, the documents written
// by Sonador IO and by the stock Cornerstone3D adapter, and the three Viewer-authored fixtures. The
// library adapters are loaded from their ESM build; only @cornerstonejs/core is replaced, by a
// synthetic study whose image planes are known.
//
// UPDATE_SR_FIXTURES=1 regenerates the Viewer-authored fixtures (sonador-viewer.circle-*.dcm).

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
        CircleROI: load('Cornerstone3D/CircleROI.js'),
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
import { asArray, conceptNameValue, firstItem } from './utils/codedConcept';
import { imageToPatient, patientToImage } from './utils/angleGeometry';
import {
  annotationCircle, circleOfEllipse, circleOutline, circlePlanePoints, circleStatisticItems, circleValues, classicToolName,
  cornerstone3DToolName, ellipseOfCircle, UNKNOWN_QUANTITY,
} from './utils/circleGeometry';
import { encodeDisplayAttributes, parseDisplayAttributes } from './utils/dcmsrDisplayAttributes';
import { encodeExtendedMeta, parseExtendedMeta } from './utils/dcmsrExtendedMeta';
import { propertyParentOf } from './utils/propertyParent';
import { omittedMeasurement, saveResultSummary } from './utils/saveResult';
import { documentSettings } from './utils/srDocument';
import { SonadorCodeValues } from './enums';
import { drawingPlaneOfView, formatDrawingPlane, navigationPlaneOf } from './utils/drawingPlane';
import { heldOutOfPlaneRecord, patientToolData } from './utils/outOfPlane';
import { viewOfNormal } from './utils/measurementView';

const { DicomDict, DicomMessage, DicomMetaDictionary } = dcmjsData;

const FIXTURES = path.join(__dirname, '__fixtures__');
// The Viewer-authored circles, and the circles written by Sonador IO and by the stock adapter
const VIEWER_CIRCLE_IMAGE = path.join(FIXTURES, 'sonador-viewer.circle-image.2026-1111.dcm');
const VIEWER_CIRCLE_OBLIQUE = path.join(FIXTURES, 'sonador-viewer.circle-oblique.2026-1111.dcm');
const VIEWER_CIRCLE_STATISTICS = path.join(FIXTURES, 'sonador-viewer.circle-statistics.2026-1113.dcm');
const fixture = name => readSR(fs.readFileSync(path.join(FIXTURES, name)));

const COMPREHENSIVE_3D_SR = '1.2.840.10008.5.1.4.1.1.88.34';
const CT_IMAGE = '1.2.840.10008.5.1.4.1.1.2';
const ENHANCED_CT_IMAGE = '1.2.840.10008.5.1.4.1.1.2.1';

const CODES = {
  ImagingMeasurements: '126010', MeasurementGroup: '125007', TrackingIdentifier: '112039', TrackingUniqueIdentifier: '112040',
};
const DESCRIPTION = SonadorCodeValues.DCMSR_MEASUREMENT_DESCRIPTION.value;
const VIEW = SonadorCodeValues.DCMSR_MEASUREMENT_VIEW.value;
const DISPLAY = SonadorCodeValues.DCMSR_DISPLAY_ATTRIBUTES.value;

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
const textValues = (items, code) => items.filter(item => conceptNameValue(item) === code).map(item => item.TextValue);


function writeSR(toolsByType, {
  document, imageId = IMAGE.imageId, onMeasurementRefused, imagePlaneModule, instance, onEncoded, toolState: givenToolState, patientSeries,
  headers, series,
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
      generalSeriesModule: series || { studyInstanceUID: SYNTHETIC.StudyInstanceUID, seriesInstanceUID: SYNTHETIC.SeriesInstanceUID },
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

const HANDLES = { CircleRoi: ['start', 'end'] };

function classicTool(toolType, imagePoints, extra = {}) {
  // A cornerstone-tools circle as the classic mapping hands it to the writer
  return {
    _id: extra._id || `${toolType}-${imagePoints.map(p => p.join(',')).join(';')}`,
    handles: _.zipObject(HANDLES[toolType], imagePoints.map(([x, y]) => ({ x, y }))),
    ...PROPERTIES,
    ..._.omit(extra, '_id', 'metadata'),
    metadata: { text: PROPERTIES.text, location: PROPERTIES.location, ...(extra.metadata || {}) },
  };
}

// The refusals of a write: [toolType, code, error]
function refusalsOf(toolsByType, options) {
  const refused = [];
  quiet(() => {
    try {
      writeSR(toolsByType, { ...options, onMeasurementRefused: (toolType, tool, error) => refused.push([toolType, error.code, error]) });
    } catch (error) {
      // a report of no measurements is not written
    }
  });
  return refused;
}

const smallCircleValues = radius => ({ radius, area: Math.PI * radius ** 2, perimeter: 2 * Math.PI * radius });
const MIN_RADIUS_ACTION = 'move its edge point away from its center so that its radius is at least 0.01 mm';

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

const CIRCLE = 'CircleRoi';
const TRACKING_IDENTIFIER = 'cornerstoneTools@^4.0.0:CircleROI';
const DRAWING_PLANE = SonadorCodeValues.DCMSR_MEASUREMENT_DRAWING_PLANE.value;
const SOURCE_SERIES = SonadorCodeValues.DCMSR_MEASUREMENT_SOURCE_SERIES.value;
const NUM_CODES = [['42798000', 'Area', 'mm2'], ['131191004', 'Perimeter', 'mm'], ['131190003', 'Radius', 'mm']];

const numsOf = group => asArray(group.ContentSequence).filter(item => item.ValueType === 'NUM');
const valuesOf = group => numsOf(group).map(num => Number(firstItem(num.MeasuredValueSequence).NumericValue));
const geometryOf = num => asArray(num.ContentSequence).find(item => item.RelationshipType === 'INFERRED FROM');
const pointsOfItem = item => _.chunk(Array.from(item.GraphicData, Number), item.ValueType === 'SCOORD3D' ? 3 : 2);
const statsOf = state => _.values(state.annotation.data.cachedStats)[0];
const expectValues = (values, radius, digits = 6) => {
  expect(values.radius).toBeCloseTo(radius, digits);
  expect(values.area).toBeCloseTo(Math.PI * radius * radius, digits - 1);
  expect(values.perimeter).toBeCloseTo(2 * Math.PI * radius, digits);
};
const expectPoint = (point, expected, digits = 5) => expected.forEach((value, i) => expect(point[i]).toBeCloseTo(value, digits));
/** A naturalized SR dataset as Part 10 bytes */
function datasetBytes(dataset) {
  const meta = {
    FileMetaInformationVersion: new Uint8Array([0, 1]).buffer,
    MediaStorageSOPClassUID: dataset.SOPClassUID,
    MediaStorageSOPInstanceUID: dataset.SOPInstanceUID,
    TransferSyntaxUID: '1.2.840.10008.1.2.1',
    ImplementationClassUID: '2.25.900001',
    ImplementationVersionName: 'dcmjs-0.0',
  };
  const dicomDict = new DicomDict(DicomMetaDictionary.denaturalizeDataset(meta));
  dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(_.omit(dataset, '_meta', '_vrMap'));
  return Buffer.from(dicomDict.write());
}

const write = (toolsByType, options) => quiet(() => deterministic(() => writeSR(toolsByType, options)));


describe('circle geometry', () => {
  it("writes an ELLIPSE as two diameters through the center: c - r u, c + r u, c - r v, c + r v, v = n x u", () => {
    const points = ellipseOfCircle([10, 20, 30], [15, 20, 30], [0, 0, 1]);
    expect(points).toEqual([[5, 20, 30], [15, 20, 30], [10, 15, 30], [10, 25, 30]]);
    // The edge point is projected onto the plane first
    expect(ellipseOfCircle([10, 20, 30], [15, 20, 33], [0, 0, 1])).toEqual(points);
    expect(ellipseOfCircle([0, 0, 0], [0, 0, 0.001], [0, 0, 1])).toBeUndefined();
    expect(ellipseOfCircle([0, 0, 0], [5, 0, 0], undefined)).toBeUndefined();
  });

  it('reads an ELLIPSE as a circle only when its diameters are equal, perpendicular and share their midpoint', () => {
    expect(circleOfEllipse([[5, 20, 30], [15, 20, 30], [10, 15, 30], [10, 25, 30]]))
      .toEqual({ center: [10, 20, 30], edge: [15, 20, 30], radius: 5, normal: [0, 0, 1] });
    expect(circleOfEllipse([[5, 20, 30], [15, 20, 30], [10, 14, 30], [10, 26, 30]])).toBeUndefined();
    expect(circleOfEllipse([[5, 20, 30], [15, 20, 30], [9, 15, 30], [11, 25, 30]])).toBeUndefined();
    expect(circleOfEllipse([[5, 20, 30], [15, 20, 30], [10, 16, 30], [10, 26, 30]])).toBeUndefined();
  });

  it('gives the values of a radius, the record values while the points are unchanged, and an outline in the plane', () => {
    expect(circleValues(5)).toEqual({ radius: 5, area: 25 * Math.PI, perimeter: 10 * Math.PI });
    const points = [[0, 0, 0], [3, 4, 0]];
    expectValues(annotationCircle({ handles: { points } }), 5);
    const recordValue = { values: { radius: 5.1, area: 81, perimeter: 32 }, points: _.cloneDeep(points) };
    expect(annotationCircle({ handles: { points }, recordValue })).toEqual(recordValue.values);
    expectValues(annotationCircle({ handles: { points: [[0, 0, 0], [6, 8, 0]] }, recordValue }), 10);
    const outline = circleOutline([0, 0, 0], [3, 4, 0], [0, 0, 1], 8);
    expect(outline).toHaveLength(8);
    outline.forEach(point => {
      expect(Math.hypot(...point)).toBeCloseTo(5, 10);
      expect(point[2]).toBeCloseTo(0, 10);
    });
  });

  it("names the circle in each library", () => {
    expect([classicToolName('CircleROI'), classicToolName('Length')]).toEqual(['CircleRoi', 'Length']);
    expect([cornerstone3DToolName('CircleRoi'), cornerstone3DToolName('Angle')]).toEqual(['CircleROI', 'Angle']);
  });
});


describe('Viewer writer: image domain', () => {
  it('writes the Area, Perimeter and Radius NUM items in that order, each over its own copy of the CIRCLE', () => {
    const { result: bytes } = write({ [CIRCLE]: [classicTool(CIRCLE, [[20.5, 20.5], [25.5, 20.5]])] });
    const [group] = measurementGroups(readSR(bytes));

    expect(trackingIdentifierOf(group)).toBe(TRACKING_IDENTIFIER);
    const nums = numsOf(group);
    expect(nums.map(num => {
      const concept = firstItem(num.ConceptNameCodeSequence);
      const unit = firstItem(firstItem(num.MeasuredValueSequence).MeasurementUnitsCodeSequence);
      return [concept.CodeValue, concept.CodeMeaning, unit.CodeValue];
    })).toEqual(NUM_CODES);
    nums.forEach(num => expect(firstItem(num.ConceptNameCodeSequence).CodingSchemeDesignator).toBe('SCT'));
    expectValues(_.zipObject(['area', 'perimeter', 'radius'], valuesOf(group)), 5);

    nums.forEach(num => {
      const geometry = geometryOf(num);
      expect(geometry).toMatchObject({ ValueType: 'SCOORD', GraphicType: 'CIRCLE' });
      expect(pointsOfItem(geometry)).toEqual([[20.5, 20.5], [25.5, 20.5]]);
      const image = firstItem(geometry.ContentSequence);
      expect(image).toMatchObject({ RelationshipType: 'SELECTED FROM', ValueType: 'IMAGE' });
      expect(firstItem(image.ReferencedSOPSequence).ReferencedSOPInstanceUID).toBe(IMAGE.SOPInstanceUID);
    });

    // The properties are children of the Area NUM, the first one; the others hold their geometry only
    const [area, perimeter, radius] = nums;
    const properties = asArray(area.ContentSequence).filter(item => item.RelationshipType === 'HAS PROPERTIES');
    expect(textValues(properties, DESCRIPTION)).toEqual([PROPERTIES.description]);
    expect(properties.some(item => conceptNameValue(item) === DISPLAY)).toBe(true);
    [perimeter, radius].forEach(num => expect(asArray(num.ContentSequence).map(item => item.RelationshipType)).toEqual(['INFERRED FROM']));
  });

  it('measures the radius in millimetres through the image plane, on unequal pixel spacing', () => {
    // Column spacing 2 mm, row spacing 1 mm: 3 columns and 4 rows apart are 6 mm and 4 mm
    const { result: bytes } = write({ [CIRCLE]: [classicTool(CIRCLE, [[10.5, 10.5], [13.5, 14.5]])] }, { imageId: ANISOTROPIC_IMAGE.imageId });
    const [group] = measurementGroups(readSR(bytes));
    expectValues(_.zipObject(['area', 'perimeter', 'radius'], valuesOf(group)), Math.hypot(6, 4));
  });

  it('refuses an uncalibrated, degenerate or incomplete circle with the reason', () => {
    const refusals = (tool, options) => {
      const refused = [];
      quiet(() => {
        try {
          writeSR({ [CIRCLE]: [tool] }, { ...options, onMeasurementRefused: (toolType, refusedTool, error) => refused.push([toolType, error.code]) });
        } catch (error) {
          // a report of no measurements is not written
        }
      });
      return refused;
    };
    expect(refusals(classicTool(CIRCLE, [[10, 10], [15, 10]]), { imagePlaneModule: null })).toEqual([[CIRCLE, 'uncalibrated']]);
    expect(refusals(classicTool(CIRCLE, [[10, 10], [10.001, 10]]))).toEqual([[CIRCLE, 'degenerate']]);
    expect(refusals({ ...classicTool(CIRCLE, [[10, 10], [15, 10]]), handles: { start: { x: 10, y: 10 } } })).toEqual([[CIRCLE, 'incomplete']]);
  });
});


describe('hydration', () => {
  const written = () => readSR(write({ [CIRCLE]: [classicTool(CIRCLE, [[20.5, 20.5], [25.5, 20.5]], { _id: 'circle-1' })] }).result);

  it('hydrates a Viewer-written circle locked, with its center and edge in patient coordinates and its stored values', () => {
    const { byType } = hydrate(written());
    const [state] = byType.CircleROI;
    const { annotation } = state;
    expect(annotation.data.handles.points).toEqual([[20.5, 20.5, 0], [25.5, 20.5, 0]]);
    expectValues(statsOf(state), 5);
    expect(annotation.metadata).toMatchObject({
      isLocked: true, isReadOnly: true, coordinateDomain: 'image', TrackingIdentifier: TRACKING_IDENTIFIER, referencedImageId: IMAGE.imageId,
    });
    expect(annotation.metadata.sourceGeometry).toMatchObject({ valueType: 'SCOORD', graphicType: 'CIRCLE', graphicData: [20.5, 20.5, 25.5, 20.5] });
    expect(state.description).toBe(PROPERTIES.description);
    expect(annotation.data.displayAttributes).toEqual(PROPERTIES.displayAttributes);
  });

  it('reads the stock adapter output: Cornerstone3D prefix, Perimeter first, geometry under the Perimeter only', () => {
    const { byType } = hydrate(fixture('cornerstone-adapters.circle-image.2026-1111.dcm'));
    const [state] = byType.CircleROI;
    expect(state.annotation.metadata.TrackingIdentifier).toBe('Cornerstone3DTools@^0.1.0:CircleROI');
    expectValues(statsOf(state), 5);
  });

  it('reads the undefined CIRCLE SCOORD3D of stock Cornerstone3D with a warning: center and radius, no plane', () => {
    const { byType, warnings } = hydrate(fixture('cornerstone-adapters.circle-patient.2026-1111.dcm'));
    const [state] = byType.CircleROI;
    expect(state.annotation.data.handles.points).toEqual([[10, 20, 30], [15, 20, 30]]);
    // Its Perimeter has no value: the values follow from the radius
    expectValues(state.annotation.data.recordValue.values, 5);
    expect(warnings.some(message => /CIRCLE SCOORD3D \(stock Cornerstone3D\) read with its center and radius, no plane/.test(message))).toBe(true);
  });

  it('finds the NUM items by their SRT codes, and by meaning, in any order', () => {
    const dataset = written();
    const [group] = measurementGroups(dataset);
    const [area, perimeter, radius] = numsOf(group);
    firstItem(area.ConceptNameCodeSequence).CodeValue = 'G-A166';
    firstItem(perimeter.ConceptNameCodeSequence).CodeValue = 'G-A197';
    Object.assign(firstItem(radius.ConceptNameCodeSequence), { CodeValue: '99999', CodingSchemeDesignator: '99LOCAL' });
    firstItem(radius.MeasuredValueSequence).NumericValue = 5.5;
    group.ContentSequence = [...asArray(group.ContentSequence).filter(item => item.ValueType !== 'NUM'), radius, perimeter, area];
    const [state] = hydrate(dataset).byType.CircleROI;
    // The stored radius, found by meaning, is kept; area and perimeter as stored
    expect(statsOf(state).radius).toBe(5.5);
    expect(statsOf(state).area).toBeCloseTo(25 * Math.PI, 4);
  });

  it('does not hydrate an ELLIPSE that is not a circle', () => {
    const dataset = readSR(write({}, {
      toolState: { 'patient:2.25.1002': { CircleROI: { data: [{
        uid: 'oop', _id: 'oop', toolType: 'CircleROI', patientPoints: [[0, 0, 0], [5, 0, 0]], FrameOfReferenceUID: SYNTHETIC.FrameOfReferenceUID,
        metadata: { outOfPlane: true, drawingPlane: '1,0,0,0,1,0' },
      }] } } },
      patientSeries: { 'patient:2.25.1002': { StudyInstanceUID: SYNTHETIC.StudyInstanceUID, SeriesInstanceUID: SYNTHETIC.SeriesInstanceUID, instances: [] } },
    }).result);
    const [group] = measurementGroups(dataset);
    numsOf(group).forEach(num => { geometryOf(num).GraphicData[11] = 9; });
    const { byType, warnings } = hydrate(dataset);
    expect(byType.CircleROI).toBeUndefined();
    expect(warnings.some(message => /Unable to generate tool state/.test(message))).toBe(true);
  });
});


describe('the plane of a held circle', () => {
  // A circle on the coronal plane y = 20, center (10, 20, 30), radius 5: its ELLIPSE is
  // (5, 20, 30), (15, 20, 30), (10, 20, 25), (10, 20, 35); no loaded image holds it
  const coronal = drawingPlane => {
    const dataset = readSR(write({}, {
      toolState: { 'patient:2.25.1002': { CircleROI: { data: [{
        uid: 'coronal', _id: 'coronal', toolType: 'CircleROI', patientPoints: [[10, 20, 30], [15, 20, 30]],
        FrameOfReferenceUID: SYNTHETIC.FrameOfReferenceUID, metadata: { outOfPlane: true, drawingPlane: '1,0,0,0,0,1' },
      }] } } },
      patientSeries: { 'patient:2.25.1002': { StudyInstanceUID: SYNTHETIC.StudyInstanceUID, SeriesInstanceUID: SYNTHETIC.SeriesInstanceUID, instances: [] } },
    }).result);
    const [area] = numsOf(measurementGroups(dataset)[0]);
    const items = asArray(area.ContentSequence);
    const item = items.find(child => conceptNameValue(child) === DRAWING_PLANE);
    if (drawingPlane === undefined) {
      area.ContentSequence = items.filter(child => child !== item);
    } else {
      item.TextValue = drawingPlane;
    }
    return dataset;
  };
  const planeOfRecord = record => navigationPlaneOf(
    circlePlanePoints(record.points, record.metadata.sourceGeometry) || record.points, record.metadata.drawingPlane);

  it.each([['absent', undefined], ['malformed', '1,0,0,0,1']])(
    'keeps the plane of its ELLIPSE with the Drawing-Plane %s, through the held record', (name, drawingPlane) => {
      const [state] = hydrate(coronal(drawingPlane)).byType.CircleROI;
      expect(pointsOfItem(geometryOf(numsOf(measurementGroups(coronal(drawingPlane))[0])[0])))
        .toEqual([[5, 20, 30], [15, 20, 30], [10, 20, 25], [10, 20, 35]]);
      const record = heldOutOfPlaneRecord('CircleROI', state, SYNTHETIC.StudyInstanceUID);
      expect(record.points).toEqual([[10, 20, 30], [15, 20, 30]]);

      const plane = planeOfRecord(record);
      expect(plane.kind).not.toBe('none');
      expectPoint(plane.normal.map(Math.abs), [0, 1, 0], 9);
      expectPoint(plane.centroid, [10, 20, 30], 9);
      // Its center and edge alone are collinear: the standard plane chosen for them is not its own
      expectPoint(navigationPlaneOf(record.points, record.metadata.drawingPlane).normal.map(Math.abs), [0, 0, 1], 9);
    });

  it('finds the plane of the center and edge once the circle is no longer its ELLIPSE', () => {
    const [state] = hydrate(coronal(undefined)).byType.CircleROI;
    const record = heldOutOfPlaneRecord('CircleROI', state, SYNTHETIC.StudyInstanceUID);
    expect(circlePlanePoints([[10, 20, 30], [20, 20, 30]], record.metadata.sourceGeometry)).toEqual([[10, 20, 30], [20, 20, 30]]);
  });

  describe('written again as a held measurement (the carried-forward save)', () => {
    const PATIENT_SERIES = { 'patient:2.25.1002': { StudyInstanceUID: SYNTHETIC.StudyInstanceUID, SeriesInstanceUID: SYNTHETIC.SeriesInstanceUID, instances: [] } };
    const carried = (change = () => {}) => {
      const dataset = coronal('1,0,0,0,0,1');
      const [state] = hydrate(dataset).byType.CircleROI;
      const record = heldOutOfPlaneRecord('CircleROI', state, SYNTHETIC.StudyInstanceUID);
      const tool = { ...patientToolData({ ...record, uid: 'coronal' }), _id: 'coronal' };
      change(tool, tool.sourceGeometry || tool.metadata.sourceGeometry);
      const options = { toolState: { 'patient:2.25.1002': { CircleROI: { data: [tool] } } }, patientSeries: PATIENT_SERIES, document: reSaveOf(dataset) };
      return { dataset, tool, options };
    };

    it('writes an unchanged held circle with its ELLIPSE and stored values', () => {
      const { dataset, options } = carried();
      const [group] = measurementGroups(readSR(write({}, options).result));
      const [original] = measurementGroups(dataset);
      expect(numsOf(group).map(num => pointsOfItem(geometryOf(num)))).toEqual(numsOf(original).map(num => pointsOfItem(geometryOf(num))));
      expect(valuesOf(group)).toEqual(valuesOf(original));
    });

    it.each([
      ['its stored radius', (tool, geometry) => { geometry.values = smallCircleValues(0.005); }],
      ['its ELLIPSE and stored radius', (tool, geometry) => {
        geometry.graphicData = [9.995, 20, 30, 10.005, 20, 30, 10, 20, 29.995, 10, 20, 30.005];
        geometry.values = smallCircleValues(0.005);
        tool.patientPoints = [[10, 20, 30], [10.005, 20, 30]];
      }],
    ])('refuses an unchanged held circle when %s is below 0.01 mm', (name, change) => {
      const { tool, options } = carried(change);
      const refused = refusalsOf({}, options);
      expect(refused.map(([toolType, code]) => [toolType, code])).toEqual([['CircleROI', 'degenerate']]);
      expect(saveResultSummary([omittedMeasurement('CircleROI', tool, refused[0][2])]).message).toContain(MIN_RADIUS_ACTION);
    });
  });

  it('has no known plane when read from a stock CIRCLE SCOORD3D', () => {
    const [state] = hydrate(fixture('cornerstone-adapters.circle-patient.2026-1111.dcm')).byType.CircleROI;
    const record = heldOutOfPlaneRecord('CircleROI', state, SYNTHETIC.StudyInstanceUID);
    expect(circlePlanePoints(record.points, record.metadata.sourceGeometry)).toBeUndefined();
  });
});


describe('Python-written circles (Sonador IO)', () => {
  // radius, center, edge (center + r u) of each fixture
  const SQRT6 = Math.sqrt(6);
  const EXPECTED = {
    'sonador-io.circle-image.2026-1111.dcm': { radius: 5 },
    'sonador-io.circle-axial.2026-1111.dcm': { radius: 5, center: [10, 20, 30], edge: [15, 20, 30], outOfPlane: true },
    'sonador-io.circle-oblique.2026-1111.dcm': {
      radius: 8, center: [10, 20, 30], edge: [10 + 16 / SQRT6, 20 - 8 / SQRT6, 30 - 8 / SQRT6], outOfPlane: true,
    },
    'sonador-io.circle-three-point.2026-1111.dcm': { radius: Math.sqrt(50), center: [5, 5, 0], outOfPlane: true },
    'sonador-io.circle-statistics-ct.2026-1112.dcm': { radius: 5, center: [10, 20, 30], edge: [15, 20, 30], outOfPlane: true },
    'sonador-io.circle-statistics-stock.2026-1112.dcm': { radius: 5 },
  };

  Object.entries(EXPECTED).forEach(([name, expected]) => {
    it(`${name}: stored values, geometry and properties as the client wrote them`, () => {
      const dataset = fixture(name);
      const [state] = hydrate(dataset).byType.CircleROI;
      const values = state.annotation.data.recordValue.values;
      // Agreement with the Python values: 0.01 mm and 0.05 mm2
      expect(Math.abs(values.radius - expected.radius)).toBeLessThan(0.01);
      expect(Math.abs(values.area - Math.PI * expected.radius ** 2)).toBeLessThan(0.05);
      expect(Math.abs(values.perimeter - 2 * Math.PI * expected.radius)).toBeLessThan(0.01);
      if (expected.center) {
        expectPoint(state.annotation.data.handles.points[0], expected.center, 4);
      }
      if (expected.edge) {
        expectPoint(state.annotation.data.handles.points[1], expected.edge, 4);
      }
      expect(Boolean(state.annotation.metadata.outOfPlane)).toBe(Boolean(expected.outOfPlane));
      expect(state.annotation.metadata.text).toBe('Synthetic');
      expect(state.annotation.data.displayAttributes.Color).toEqual({ Line: '#C81E28', Text: '#FAFA0A' });
    });
  });

  it('keeps the construction points of a three-point circle with their NUM, not as the geometry', () => {
    const [group] = measurementGroups(fixture('sonador-io.circle-three-point.2026-1111.dcm'));
    const [area] = numsOf(group);
    expect(asArray(area.ContentSequence).filter(item => item.ValueType === 'SCOORD3D').map(item => item.RelationshipType))
      .toEqual(['INFERRED FROM', 'HAS PROPERTIES']);
    const [state] = hydrate(fixture('sonador-io.circle-three-point.2026-1111.dcm')).byType.CircleROI;
    expect(state.annotation.metadata.sourceGeometry.graphicType).toBe('ELLIPSE');
  });
});


describe('stored and recomputed values on a re-save', () => {
  const source = () => readSR(write({ [CIRCLE]: [classicTool(CIRCLE, [[20.5, 20.5], [25.5, 20.5]], { _id: 'circle-1' })] }).result);

  it('writes an unchanged hydrated circle with the geometry and values it was read with', () => {
    const dataset = source();
    const [state] = hydrate(dataset).byType.CircleROI;
    const tool = toClassicTool(CIRCLE, state);
    // A stored radius that differs from the geometry shows it is the stored one
    tool.metadata.sourceGeometry.values = { radius: 5.25, area: 86.6, perimeter: 33 };
    const [group] = measurementGroups(readSR(write({ [CIRCLE]: [tool] }, { document: reSaveOf(dataset) }).result));
    expect(valuesOf(group)).toEqual([86.6, 33, 5.25]);
    expect(trackingUIDOf(group)).toBe(trackingUIDOf(measurementGroups(dataset)[0]));
  });

  it('refuses an unchanged hydrated circle whose stored radius is below 0.01 mm, naming the fix', () => {
    const dataset = source();
    const [state] = hydrate(dataset).byType.CircleROI;
    const tool = toClassicTool(CIRCLE, state);
    tool.metadata.sourceGeometry.values = smallCircleValues(0.005);
    const refused = refusalsOf({ [CIRCLE]: [tool] }, { document: reSaveOf(dataset) });
    expect(refused.map(([toolType, code]) => [toolType, code])).toEqual([[CIRCLE, 'degenerate']]);

    // The sole measurement refused: nothing is stored, and the message says what radius is needed
    const summary = saveResultSummary([omittedMeasurement(CIRCLE, tool, refused[0][2])]);
    expect(summary.message).toContain(`Circle "${PROPERTIES.description}": ${MIN_RADIUS_ACTION}.`);
  });

  it('recomputes all three values after a handle moved', () => {
    const dataset = source();
    const [state] = hydrate(dataset).byType.CircleROI;
    const tool = toClassicTool(CIRCLE, state);
    tool.handles.end = { x: 28.5, y: 20.5 };
    const [group] = measurementGroups(readSR(write({ [CIRCLE]: [tool] }, { document: reSaveOf(dataset) }).result));
    expectValues(_.zipObject(['area', 'perimeter', 'radius'], valuesOf(group)), 8);
  });
});


describe('pixel statistics (Mean, Standard Deviation, Maximum)', () => {
  const CT_SERIES = { studyInstanceUID: SYNTHETIC.StudyInstanceUID, seriesInstanceUID: SYNTHETIC.SeriesInstanceUID, modality: 'CT' };
  const MR_SERIES = { ...CT_SERIES, modality: 'MR' };
  const CT_STATS = { mean: 41.25, stdDev: 7.5, max: 120, modalityUnit: 'HU' };
  const circleWith = (cachedStats, extra = {}) => classicTool(CIRCLE, [[20.5, 20.5], [25.5, 20.5]], { _id: 'circle-1', cachedStats, ...extra });

  // A statistic NUM: [quantity code, quantity scheme, unit, modifier concept, derivation code, value]
  const statisticsOf = group => numsOf(group).slice(3).map((num) => {
    const concept = firstItem(num.ConceptNameCodeSequence);
    const measured = firstItem(num.MeasuredValueSequence);
    const modifier = asArray(num.ContentSequence).find(item => item.RelationshipType === 'HAS CONCEPT MOD');
    return [concept.CodeValue, concept.CodingSchemeDesignator, firstItem(measured.MeasurementUnitsCodeSequence).CodeValue,
      firstItem(modifier.ConceptNameCodeSequence).CodeValue, firstItem(modifier.ConceptCodeSequence).CodeValue, Number(measured.NumericValue)];
  });

  it('writes them after the Radius on a CT image: Attenuation Coefficient in HU, a Derivation modifier, over the geometry', () => {
    const [group] = measurementGroups(readSR(write({ [CIRCLE]: [circleWith(CT_STATS)] }, { series: CT_SERIES }).result));
    expect(numsOf(group).slice(0, 3).map(num => firstItem(num.ConceptNameCodeSequence).CodeMeaning)).toEqual(['Area', 'Perimeter', 'Radius']);
    expect(statisticsOf(group)).toEqual([
      ['112031', 'DCM', "[hnsf'U]", '121401', '373098007', 41.25],
      ['112031', 'DCM', "[hnsf'U]", '121401', '386136009', 7.5],
      ['112031', 'DCM', "[hnsf'U]", '121401', '56851009', 120],
    ]);
    numsOf(group).slice(3).forEach((num) => {
      expect(geometryOf(num)).toMatchObject({ ValueType: 'SCOORD', GraphicType: 'CIRCLE' });
      expect(pointsOfItem(geometryOf(num))).toEqual([[20.5, 20.5], [25.5, 20.5]]);
    });
  });

  it('names MR pixels MR signal intensity, with no units', () => {
    const [group] = measurementGroups(readSR(write({ [CIRCLE]: [circleWith({ mean: 812.5, modalityUnit: '' })] }, { series: MR_SERIES }).result));
    expect(statisticsOf(group)).toEqual([['110852', 'DCM', '1', '121401', '373098007', 812.5]]);
  });

  it('writes no statistic it does not have, none that is not a number, and none of an unknown quantity', () => {
    const only = (stats, series) => statisticsOf(measurementGroups(readSR(write({ [CIRCLE]: [circleWith(stats)] }, { series }).result))[0]);
    expect(only({ mean: 41.25, stdDev: NaN, max: undefined, modalityUnit: 'HU' }, CT_SERIES).map(line => line[4])).toEqual(['373098007']);
    expect(only(undefined, CT_SERIES)).toEqual([]);
    expect(only({ mean: Infinity, stdDev: null, modalityUnit: 'HU' }, CT_SERIES)).toEqual([]);
    // An ultrasound image, and PET pixels not scaled to SUV, have no quantity the circle writes
    expect(only({ mean: 12, modalityUnit: '' }, { ...CT_SERIES, modality: 'US' })).toEqual([]);
    expect(only({ mean: 12, modalityUnit: 'raw' }, { ...CT_SERIES, modality: 'PT' })).toEqual([]);
  });

  it('hydrates them with their unit, and keeps them through an unchanged re-save', () => {
    const dataset = readSR(write({ [CIRCLE]: [circleWith(CT_STATS)] }, { series: CT_SERIES }).result);
    const [state] = hydrate(dataset).byType.CircleROI;
    expect(statsOf(state)).toMatchObject({ mean: 41.25, stdDev: 7.5, max: 120, modalityUnit: 'HU' });

    // The tool holds no statistics of its own: those read are written back, as read
    const tool = toClassicTool(CIRCLE, state);
    const [group] = measurementGroups(readSR(write({ [CIRCLE]: [tool] }, { document: reSaveOf(dataset), series: CT_SERIES }).result));
    expect(statisticsOf(group)).toEqual(statisticsOf(measurementGroups(dataset)[0]));
  });

  it('writes the statistics the tool holds after a handle moved', () => {
    const dataset = readSR(write({ [CIRCLE]: [circleWith(CT_STATS)] }, { series: CT_SERIES }).result);
    const [state] = hydrate(dataset).byType.CircleROI;
    const tool = { ...toClassicTool(CIRCLE, state), cachedStats: { mean: 52, stdDev: 9, max: 140, modalityUnit: 'HU' } };
    tool.handles.end = { x: 28.5, y: 20.5 };
    const [group] = measurementGroups(readSR(write({ [CIRCLE]: [tool] }, { document: reSaveOf(dataset), series: CT_SERIES }).result));
    expect(statisticsOf(group).map(line => line[5])).toEqual([52, 9, 140]);
  });

  // The statistics of the client's fixtures, and what an unchanged re-save writes for them: the
  // quantity form, whatever form was read
  const CLIENT_STATISTICS = { mean: 40.5, stdDev: 12.25, max: 97, modalityUnit: 'HU', statisticsModality: 'CT' };
  const CLIENT_WRITTEN = [
    ['112031', 'DCM', "[hnsf'U]", '121401', '373098007', 40.5],
    ['112031', 'DCM', "[hnsf'U]", '121401', '386136009', 12.25],
    ['112031', 'DCM', "[hnsf'U]", '121401', '56851009', 97],
  ];

  it('reads the quantity-form statistics of sonador-io.circle-statistics-ct and holds them on the out-of-plane record', () => {
    const [state] = hydrate(fixture('sonador-io.circle-statistics-ct.2026-1112.dcm')).byType.CircleROI;
    expect(state.annotation.metadata.outOfPlane).toBe(true);
    expect(_.pick(state.annotation.data.recordValue.values, _.keys(CLIENT_STATISTICS))).toEqual(CLIENT_STATISTICS);
    const record = heldOutOfPlaneRecord('CircleROI', state, SYNTHETIC.StudyInstanceUID);
    expect(record.data.cachedStats).toMatchObject(CLIENT_STATISTICS);
  });

  it('reads the stock-form statistics of sonador-io.circle-statistics-stock and writes them back in the quantity form', () => {
    const dataset = fixture('sonador-io.circle-statistics-stock.2026-1112.dcm');
    const [state] = hydrate(dataset).byType.CircleROI;
    expect(_.pick(statsOf(state), _.keys(CLIENT_STATISTICS))).toEqual(CLIENT_STATISTICS);
    const [group] = measurementGroups(readSR(write({ [CIRCLE]: [toClassicTool(CIRCLE, state)] }, {
      series: CT_SERIES, document: reSaveOf(dataset),
    }).result));
    expect(valuesOf(group).slice(0, 3)).toEqual(valuesOf(measurementGroups(dataset)[0]).slice(0, 3));
    expect(statisticsOf(group)).toEqual(CLIENT_WRITTEN);
    expect(trackingUIDOf(group)).toBe(trackingUIDOf(measurementGroups(dataset)[0]));
  });

  it('reads the stock Cornerstone3D form: a NUM named by the statistic itself', () => {
    const dataset = readSR(write({ [CIRCLE]: [circleWith(undefined)] }, { series: CT_SERIES }).result);
    const [group] = measurementGroups(dataset);
    const [area] = numsOf(group);
    group.ContentSequence = [...asArray(group.ContentSequence), {
      RelationshipType: 'CONTAINS', ValueType: 'NUM',
      ConceptNameCodeSequence: [{ CodeValue: '373098007', CodingSchemeDesignator: 'SCT', CodeMeaning: 'Mean' }],
      MeasuredValueSequence: [{ NumericValue: 33.5, MeasurementUnitsCodeSequence: [{ CodeValue: "[hnsf'U]", CodingSchemeDesignator: 'UCUM' }] }],
      ContentSequence: [geometryOf(area)],
    }];
    const [state] = hydrate(dataset).byType.CircleROI;
    expect(statsOf(state)).toMatchObject({ mean: 33.5, modalityUnit: 'HU' });
    expect(statsOf(state).stdDev).toBeUndefined();
  });

  // A circle written without statistics, with these NUMs added to its group
  const withNums = (...nums) => {
    const dataset = readSR(write({ [CIRCLE]: [circleWith(undefined)] }, { series: CT_SERIES }).result);
    const [group] = measurementGroups(dataset);
    const [area] = numsOf(group);
    group.ContentSequence = [...asArray(group.ContentSequence), ...nums.map(num => ({ ...num, ContentSequence: [...num.ContentSequence, geometryOf(area)] }))];
    return dataset;
  };
  const code = (CodeValue, CodingSchemeDesignator, CodeMeaning = CodeValue) => [{ CodeValue, CodingSchemeDesignator, CodeMeaning }];
  const derived = (quantity, unit, statistic, value, statisticScheme = 'SCT') => ({
    RelationshipType: 'CONTAINS', ValueType: 'NUM', ConceptNameCodeSequence: code(...quantity),
    MeasuredValueSequence: [{ NumericValue: value, MeasurementUnitsCodeSequence: code(unit, 'UCUM') }],
    ContentSequence: [{ RelationshipType: 'HAS CONCEPT MOD', ValueType: 'CODE', ConceptNameCodeSequence: code('121401', 'DCM', 'Derivation'),
      ConceptCodeSequence: code(statistic, statisticScheme) }],
  });
  const stock = (statistic, meaning, unit, value, scheme = 'SCT', unitScheme = 'UCUM') => ({
    RelationshipType: 'CONTAINS', ValueType: 'NUM', ConceptNameCodeSequence: code(statistic, scheme, meaning),
    MeasuredValueSequence: [{ NumericValue: value, MeasurementUnitsCodeSequence: code(unit, unitScheme) }],
    ContentSequence: [],
  });
  const ATTENUATION = ['112031', 'DCM', 'Attenuation Coefficient'];
  const MR_SIGNAL = ['110852', 'DCM', 'MR signal intensity'];
  // The statistics a dataset hydrates with, and those an unchanged re-save of it on a CT image writes
  const readAndReSave = (dataset) => {
    const [state] = hydrate(dataset).byType.CircleROI;
    const tool = toClassicTool(CIRCLE, state);
    const [group] = measurementGroups(readSR(write({ [CIRCLE]: [tool] }, { document: reSaveOf(dataset), series: CT_SERIES }).result));
    return { read: _.pick(statsOf(state), ['mean', 'stdDev', 'max', 'modalityUnit', 'statisticsModality']), written: statisticsOf(group) };
  };

  it('reads none of statistics of different quantities, and so writes none back as another quantity', () => {
    const mixed = withNums(derived(ATTENUATION, "[hnsf'U]", '373098007', 40), derived(MR_SIGNAL, '1', '56851009', 800));
    expect(readAndReSave(mixed)).toEqual({ read: {}, written: [] });

    // A stock Mean in HU beside a derived MR maximum is also two quantities
    const stockMixed = withNums(stock('373098007', 'Mean', "[hnsf'U]", 40), derived(MR_SIGNAL, '1', '56851009', 800));
    expect(readAndReSave(stockMixed)).toEqual({ read: {}, written: [] });

    // One quantity throughout reads, and writes back as that quantity
    const consistent = withNums(derived(MR_SIGNAL, '1', '373098007', 700), derived(MR_SIGNAL, '1', '56851009', 800));
    expect(readAndReSave(consistent)).toEqual({
      read: { mean: 700, max: 800, modalityUnit: '', statisticsModality: 'MR' },
      written: [['110852', 'DCM', '1', '121401', '373098007', 700], ['110852', 'DCM', '1', '121401', '56851009', 800]],
    });
  });

  it('matches the statistic codes with their coding scheme', () => {
    // The SNOMED code values under a private scheme are not the statistics
    expect(readAndReSave(withNums(derived(ATTENUATION, "[hnsf'U]", '373098007', 40, '99OTHER')))).toEqual({ read: {}, written: [] });
    expect(readAndReSave(withNums(stock('373098007', 'Mean', "[hnsf'U]", 40, '99OTHER')))).toEqual({ read: {}, written: [] });
    // Nor is a quantity code under another scheme, or a unit that is not UCUM
    expect(readAndReSave(withNums(derived(['112031', '99OTHER', 'Attenuation Coefficient'], "[hnsf'U]", '373098007', 40))))
      .toEqual({ read: {}, written: [] });
    expect(readAndReSave(withNums(stock('373098007', 'Mean', 'HU', 40, 'SCT', '99OTHER')))).toEqual({ read: {}, written: [] });
    // SRT has its own codes (Mean R-00317, Standard Deviation R-10047, Maximum G-A437); the SCT
    // values under SRT are not them
    expect(readAndReSave(withNums(derived(ATTENUATION, "[hnsf'U]", '373098007', 40, 'SRT')))).toEqual({ read: {}, written: [] });
    expect(readAndReSave(withNums(derived(ATTENUATION, "[hnsf'U]", 'R-00317', 40, 'SRT'),
      stock('R-10047', 'Standard Deviation', "[hnsf'U]", 4, 'SRT'), stock('G-A437', 'Maximum', 'HU', 90, 'SRT')))).toEqual({
      read: { mean: 40, stdDev: 4, max: 90, modalityUnit: 'HU', statisticsModality: 'CT' },
      written: [
        ['112031', 'DCM', "[hnsf'U]", '121401', '373098007', 40],
        ['112031', 'DCM', "[hnsf'U]", '121401', '386136009', 4],
        ['112031', 'DCM', "[hnsf'U]", '121401', '56851009', 90],
      ],
    });
  });

  it('shows stock statistics without units, or in a unit of no known quantity, and never writes them as the image\'s quantity', () => {
    // A stock Mean of 40 with no units ('1') on a CT image: read for display, not written back as HU
    const unitless = withNums(stock('373098007', 'Mean', '1', 40));
    expect(readAndReSave(unitless)).toEqual({ read: { mean: 40, modalityUnit: '', statisticsModality: UNKNOWN_QUANTITY }, written: [] });
    expect(readAndReSave(withNums(stock('373098007', 'Mean', 'raw', 40))))
      .toEqual({ read: { mean: 40, modalityUnit: 'raw', statisticsModality: UNKNOWN_QUANTITY }, written: [] });

    // The binary round trip: the imported report as bytes, read, hydrated and written again as bytes
    const imported = readSR(datasetBytes(unitless));
    const [importedState] = hydrate(imported).byType.CircleROI;
    expect(statsOf(importedState)).toMatchObject({ mean: 40, modalityUnit: '' });
    const bytes = write({ [CIRCLE]: [toClassicTool(CIRCLE, importedState)] }, { document: reSaveOf(imported), series: CT_SERIES }).result;
    expect(statisticsOf(measurementGroups(readSR(bytes))[0])).toEqual([]);

    // Explicit MR signal intensity is written as MR signal intensity on any image, and newly computed
    // CT statistics as CT
    const mr = withNums(derived(MR_SIGNAL, '1', '373098007', 700));
    expect(readAndReSave(mr).written).toEqual([['110852', 'DCM', '1', '121401', '373098007', 700]]);
    const computed = statisticsOf(measurementGroups(readSR(write({ [CIRCLE]: [circleWith(CT_STATS)] }, { series: CT_SERIES }).result))[0]);
    expect(computed.map(line => line[0])).toEqual(['112031', '112031', '112031']);
  });

  it('writes SUV as SUVbw only when it is body weight SUV, and reads no other SUV normalization', () => {
    const PT_SERIES = { ...CT_SERIES, modality: 'PT' };
    const only = (stats, series) => statisticsOf(measurementGroups(readSR(write({ [CIRCLE]: [circleWith(stats)] }, { series }).result))[0]);
    expect(only({ mean: 3.5, modalityUnit: 'SUV' }, PT_SERIES)).toEqual([['126401', 'DCM', 'g/ml{SUVbw}', '121401', '373098007', 3.5]]);
    expect(only({ mean: 3.5, modalityUnit: 'SUVbw' }, PT_SERIES).map(line => line[0])).toEqual(['126401']);
    ['SUVlbm', 'SUVbsa', 'SUVibw'].forEach((modalityUnit) => {
      expect(only({ mean: 3.5, modalityUnit }, PT_SERIES)).toEqual([]);
    });
    // An HU or SUV statistic on an image of another modality names no quantity
    expect(only({ mean: 3.5, modalityUnit: 'SUV' }, MR_SERIES)).toEqual([]);
    expect(only({ mean: 41, modalityUnit: 'HU' }, MR_SERIES)).toEqual([]);

    // Read: a stock lean-body-mass SUV is not read (so not re-written as SUVbw); a body weight one is
    expect(readAndReSave(withNums(stock('373098007', 'Mean', 'g/ml{SUVlbm}', 2.5)))).toEqual({ read: {}, written: [] });
    expect(readAndReSave(withNums(stock('373098007', 'Mean', 'g/ml{SUVbw}', 2.5)))).toEqual({
      read: { mean: 2.5, modalityUnit: 'SUV', statisticsModality: 'PT' },
      written: [['126401', 'DCM', 'g/ml{SUVbw}', '121401', '373098007', 2.5]],
    });
  });

  it('keeps the quantity a statistic was read with when no image names it (an out-of-plane MR circle)', () => {
    const geometry = () => ({ RelationshipType: 'INFERRED FROM' });
    const [item] = circleStatisticItems({ mean: 812.5, modalityUnit: '', statisticsModality: 'MR' }, undefined, geometry);
    expect(firstItem(item.ConceptNameCodeSequence).CodeValue).toBe('110852');
    expect(circleStatisticItems({ mean: 812.5, modalityUnit: '' }, undefined, geometry)).toEqual([]);
  });
});


describe('Viewer-authored fixtures on the synthetic axial series', () => {
  // The synthetic CT: 64 x 48, Pixel Spacing 0.8 mm (rows) and 1.2 mm (columns), slices 3 mm apart at z = 0 to 33
  const slices = _.range(1, 13).map(n => fixture(`synthetic-ct/ct-${String(n).padStart(2, '0')}.dcm`));
  const CT = slices.map((slice, index) => ({ SOPInstanceUID: slice.SOPInstanceUID, imageId: `synthetic-ct-circle:${index + 1}` }));
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
  const CT_SERIES = { studyInstanceUID: first.StudyInstanceUID, seriesInstanceUID: first.SeriesInstanceUID };

  // The image-domain circle on the slice at z = 9: center (-10, -5, 9), edge 12 mm along +x
  const slice = CT[3];
  const center = patientToImage(mockImagePlanes[slice.imageId], [-10, -5, 9]);
  const edge = patientToImage(mockImagePlanes[slice.imageId], [2, -5, 9]);
  const IMAGE_TOOLS = { [CIRCLE]: [classicTool(CIRCLE, [center, edge], { _id: 'circle-image', description: 'Circle (image)' })] };

  // The Inspector turned 45 degrees between sagittal and axial (normal (1, 0, 1)/sqrt 2, up +y): a
  // circle of radius 10 around (0, 0, 15), its edge point along (1, 0, -1)/sqrt 2
  const OBLIQUE = { viewPlaneNormal: [Math.SQRT1_2, 0, Math.SQRT1_2], viewUp: [0, 1, 0] };
  const obliqueCenter = [0, 0, 15];
  const obliqueEdge = [10 * Math.SQRT1_2, 0, 15 - 10 * Math.SQRT1_2];
  const OBLIQUE_TOOLS = { CircleROI: [{
    uid: 'circle-oblique', _id: 'circle-oblique', toolType: 'CircleROI', patientPoints: [obliqueCenter, obliqueEdge], FrameOfReferenceUID: FOR,
    description: 'Circle (oblique)',
    metadata: {
      outOfPlane: true, sourceSeries: SERIES.SeriesInstanceUID,
      drawingPlane: formatDrawingPlane(drawingPlaneOfView(OBLIQUE.viewPlaneNormal, OBLIQUE.viewUp)), views: [viewOfNormal(OBLIQUE.viewPlaneNormal)],
    },
  }] };

  const writeImage = options => write(IMAGE_TOOLS, { imageId: slice.imageId, series: CT_SERIES, headers: HEADERS, ...options }).result;
  const writeOblique = () => write({}, {
    toolState: { [SERIES_KEY]: _.mapValues(OBLIQUE_TOOLS, data => ({ data })) }, patientSeries: { [SERIES_KEY]: SERIES }, headers: HEADERS,
  }).result;

  it('sonador-viewer.circle-image is the Viewer writer output, byte for byte: a SCOORD CIRCLE of radius 12 mm', () => {
    const bytes = writeImage();
    if (process.env.UPDATE_SR_FIXTURES) {
      fs.writeFileSync(VIEWER_CIRCLE_IMAGE, bytes);
    }
    expect(bytes.equals(fs.readFileSync(VIEWER_CIRCLE_IMAGE))).toBe(true);

    const dataset = readSR(bytes);
    expect(dataset.SOPClassUID).toBe(COMPREHENSIVE_3D_SR);
    const [group] = measurementGroups(dataset);
    expect(trackingIdentifierOf(group)).toBe(TRACKING_IDENTIFIER);
    numsOf(group).forEach(num => expect(geometryOf(num)).toMatchObject({ ValueType: 'SCOORD', GraphicType: 'CIRCLE' }));
    expectValues(_.zipObject(['area', 'perimeter', 'radius'], valuesOf(group)), 12, 4);
    const image = firstItem(geometryOf(numsOf(group)[0]).ContentSequence);
    expect(firstItem(image.ReferencedSOPSequence).ReferencedSOPInstanceUID).toBe(slice.SOPInstanceUID);
  });

  it('sonador-viewer.circle-image writes -> parses -> writes to the same bytes', () => {
    const dataset = readSR(fs.readFileSync(VIEWER_CIRCLE_IMAGE));
    const [state] = hydrate(dataset, CT).byType.CircleROI;
    const rewritten = { [CIRCLE]: [{ ...toClassicTool(CIRCLE, state), _id: 'circle-image' }] };
    const bytes = write(rewritten, { imageId: slice.imageId, series: CT_SERIES, headers: HEADERS, document: reSaveOf(dataset) }).result;
    expect(bytes.equals(fs.readFileSync(VIEWER_CIRCLE_IMAGE))).toBe(true);
  });

  // The statistics circle on the same slice: center (0, 0, 9), edge 5 columns (6 mm) along +x,
  // inside the phantom's 400 HU cylinder (radius 15 mm around the z axis), so every pixel it holds
  // is 400 HU. Image points that SCOORD (float32) holds exactly, and values whose DS text reads
  // back as written.
  const STATISTICS_RADIUS = 6;
  const statisticsCenter = [32.5, 24.5];
  const statisticsEdge = [37.5, 24.5];
  const patientPointOf = point => imageToPatient(mockImagePlanes[slice.imageId], point);
  const STATISTICS = { mean: 400, stdDev: 0, max: 400, modalityUnit: 'HU' };
  const STATISTICS_TOOLS = { [CIRCLE]: [classicTool(CIRCLE, [statisticsCenter, statisticsEdge], {
    _id: 'circle-statistics', description: 'Circle (statistics)', cachedStats: STATISTICS,
  })] };
  const writeStatistics = (tools, options) => write(tools, {
    imageId: slice.imageId, series: { ...CT_SERIES, modality: 'CT' }, headers: HEADERS, ...options,
  }).result;

  it('sonador-viewer.circle-statistics is the Viewer writer output, byte for byte: Mean, Std dev and Max in the quantity form', () => {
    const bytes = writeStatistics(STATISTICS_TOOLS);
    if (process.env.UPDATE_SR_FIXTURES) {
      fs.writeFileSync(VIEWER_CIRCLE_STATISTICS, bytes);
    }
    expect(bytes.equals(fs.readFileSync(VIEWER_CIRCLE_STATISTICS))).toBe(true);

    const [group] = measurementGroups(readSR(bytes));
    expect(trackingIdentifierOf(group)).toBe(TRACKING_IDENTIFIER);
    const nums = numsOf(group);
    expect(nums.map(num => firstItem(num.ConceptNameCodeSequence).CodeValue))
      .toEqual(['42798000', '131191004', '131190003', '112031', '112031', '112031']);
    expectPoint(patientPointOf(statisticsCenter), [0, 0, 9], 9);
    expectPoint(patientPointOf(statisticsEdge), [STATISTICS_RADIUS, 0, 9], 9);
    expectValues(_.zipObject(['area', 'perimeter', 'radius'], valuesOf(group)), STATISTICS_RADIUS, 6);
    nums.slice(3).forEach((num, i) => {
      const measured = firstItem(num.MeasuredValueSequence);
      expect(firstItem(measured.MeasurementUnitsCodeSequence)).toMatchObject({ CodeValue: "[hnsf'U]", CodingSchemeDesignator: 'UCUM' });
      const modifier = asArray(num.ContentSequence).find(item => item.RelationshipType === 'HAS CONCEPT MOD');
      expect(firstItem(modifier.ConceptNameCodeSequence)).toMatchObject({ CodeValue: '121401', CodingSchemeDesignator: 'DCM' });
      expect(firstItem(modifier.ConceptCodeSequence).CodeValue).toBe(['373098007', '386136009', '56851009'][i]);
      expect(Number(measured.NumericValue)).toBe([400, 0, 400][i]);
    });
    // Each NUM is inferred from its own copy of the SCOORD CIRCLE on the slice
    nums.forEach(num => expect(geometryOf(num)).toMatchObject({ ValueType: 'SCOORD', GraphicType: 'CIRCLE' }));
    expect(new Set(nums.map(geometryOf)).size).toBe(nums.length);
    nums.forEach(num => expect(pointsOfItem(geometryOf(num))).toEqual([statisticsCenter, statisticsEdge]));
  });

  it("sonador-viewer.circle-statistics holds the statistics of the slice's pixels inside the circle", () => {
    // Pixel (i, j) lies at x = x0 + i * column spacing, y = y0 + j * row spacing
    const ct = slices[3];
    const hu = Array.from(new Int16Array(ct.PixelData[0]), value => value * Number(ct.RescaleSlope) + Number(ct.RescaleIntercept));
    const [x0, y0] = ct.ImagePositionPatient.map(Number);
    const [rowSpacing, columnSpacing] = ct.PixelSpacing.map(Number);
    const inside = [];
    _.range(ct.Rows).forEach(j => _.range(ct.Columns).forEach((i) => {
      if (Math.hypot(x0 + i * columnSpacing, y0 + j * rowSpacing) <= STATISTICS_RADIUS) {
        inside.push(hu[j * ct.Columns + i]);
      }
    }));
    expect(inside.length).toBeGreaterThan(100);
    expect(_.uniq(inside)).toEqual([STATISTICS.mean]);
  });

  it('sonador-viewer.circle-statistics writes -> parses -> writes to the same bytes', () => {
    const dataset = readSR(fs.readFileSync(VIEWER_CIRCLE_STATISTICS));
    const [state] = hydrate(dataset, CT).byType.CircleROI;
    expect(_.pick(statsOf(state), ['mean', 'stdDev', 'max', 'modalityUnit', 'statisticsModality']))
      .toEqual({ ...STATISTICS, statisticsModality: 'CT' });
    const rewritten = { [CIRCLE]: [{ ...toClassicTool(CIRCLE, state), _id: 'circle-statistics' }] };
    const bytes = writeStatistics(rewritten, { document: reSaveOf(dataset) });
    expect(bytes.equals(fs.readFileSync(VIEWER_CIRCLE_STATISTICS))).toBe(true);
  });

  it('sonador-viewer.circle-oblique is the Viewer writer output, byte for byte: an ELLIPSE on the 45-degree plane', () => {
    const bytes = writeOblique();
    if (process.env.UPDATE_SR_FIXTURES) {
      fs.writeFileSync(VIEWER_CIRCLE_OBLIQUE, bytes);
    }
    expect(bytes.equals(fs.readFileSync(VIEWER_CIRCLE_OBLIQUE))).toBe(true);

    const [group] = measurementGroups(readSR(bytes));
    const nums = numsOf(group);
    nums.forEach(num => expect(geometryOf(num)).toMatchObject({
      ValueType: 'SCOORD3D', GraphicType: 'ELLIPSE', ReferencedFrameOfReferenceUID: FOR,
    }));
    // u from the center to the edge point, v = n x u for the Drawing-Plane normal n = width x height
    // (here -(1, 0, 1)/sqrt 2, the view's normal reversed): v = (0, -1, 0)
    const points = pointsOfItem(geometryOf(nums[0]));
    const u = [Math.SQRT1_2, 0, -Math.SQRT1_2];
    const v = [0, -1, 0];
    [[-10, u], [10, u], [-10, v], [10, v]].forEach(([r, axis], i) =>
      expectPoint(points[i], obliqueCenter.map((value, k) => value + r * axis[k]), 4));
    expectValues(_.zipObject(['area', 'perimeter', 'radius'], valuesOf(group)), 10, 4);
    const items = asArray(nums[0].ContentSequence);
    expect(textValues(items, DRAWING_PLANE)).toEqual([OBLIQUE_TOOLS.CircleROI[0].metadata.drawingPlane]);
    expect(items.filter(item => conceptNameValue(item) === SOURCE_SERIES).map(item => item.UID)).toEqual([SERIES.SeriesInstanceUID]);
    expect(textValues(items, VIEW)).toEqual(['oblique']);
  });

  it('sonador-viewer.circle-oblique reloads as a locked out-of-plane circle that writes back unchanged', () => {
    const dataset = readSR(fs.readFileSync(VIEWER_CIRCLE_OBLIQUE));
    const [state] = hydrate(dataset, CT).byType.CircleROI;
    expect(state.annotation.metadata).toMatchObject({ outOfPlane: true, isLocked: true, sourceSeries: SERIES.SeriesInstanceUID });
    expectPoint(state.annotation.data.handles.points[0], obliqueCenter, 4);
    expectPoint(state.annotation.data.handles.points[1], obliqueEdge, 4);
    expect(navigationPlaneOf(state.annotation.data.handles.points, state.annotation.metadata.drawingPlane).kind).toBe('drawing-plane');

    // The record a reload holds, written again as the save writes held measurements
    const record = heldOutOfPlaneRecord('CircleROI', state, first.StudyInstanceUID);
    expectValues(record.data.cachedStats, 10, 4);
    const tool = { ...patientToolData({ ...record, uid: 'circle-oblique' }), _id: 'circle-oblique' };
    const [rewritten] = measurementGroups(readSR(write({}, {
      toolState: { [SERIES_KEY]: { CircleROI: { data: [tool] } } }, patientSeries: { [SERIES_KEY]: SERIES }, headers: HEADERS,
      document: reSaveOf(dataset),
    }).result));
    const [original] = measurementGroups(dataset);
    expect(numsOf(rewritten).map(num => pointsOfItem(geometryOf(num)))).toEqual(numsOf(original).map(num => pointsOfItem(geometryOf(num))));
    expect(valuesOf(rewritten)).toEqual(valuesOf(original));
  });

  it('writes the MR statistics of an out-of-plane circle record (as the sync keeps them), and hydrates them with their quantity', () => {
    // The record of a circle drawn in an MPR view of an MR series, its statistics kept by the sync
    const stats = { mean: 812.5, stdDev: 40.25, max: 990, modalityUnit: '', statisticsModality: 'MR' };
    const record = {
      ...OBLIQUE_TOOLS.CircleROI[0], toolName: 'CircleROI', points: OBLIQUE_TOOLS.CircleROI[0].patientPoints,
      data: { cachedStats: { ...circleValues(10), ...stats } },
    };
    const tool = { ...patientToolData(record), _id: 'circle-oblique' };
    const writeTool = (given, document) => readSR(write({}, {
      toolState: { [SERIES_KEY]: { CircleROI: { data: [given] } } }, patientSeries: { [SERIES_KEY]: SERIES }, headers: HEADERS, document,
    }).result);
    const dataset = writeTool(tool);
    const statisticNums = numsOf(measurementGroups(dataset)[0]).slice(3);
    expect(statisticNums.map(num => [firstItem(num.ConceptNameCodeSequence).CodeValue, Number(firstItem(num.MeasuredValueSequence).NumericValue)]))
      .toEqual([['110852', 812.5], ['110852', 40.25], ['110852', 990]]);
    statisticNums.forEach(num => expect(geometryOf(num)).toMatchObject({ ValueType: 'SCOORD3D', GraphicType: 'ELLIPSE' }));

    // Hydrated: the statistics, unit and quantity survive, and a re-save of the held record writes them again
    const [state] = hydrate(dataset, CT).byType.CircleROI;
    expect(state.annotation.data.recordValue.values).toMatchObject(stats);
    const held = heldOutOfPlaneRecord('CircleROI', state, first.StudyInstanceUID);
    expect(held.data.cachedStats).toMatchObject(stats);
    const [rewritten] = measurementGroups(writeTool({ ...patientToolData({ ...held, uid: 'circle-oblique' }), _id: 'circle-oblique' }, reSaveOf(dataset)));
    expect(numsOf(rewritten).slice(3).map(num => Number(firstItem(num.MeasuredValueSequence).NumericValue))).toEqual([812.5, 40.25, 990]);
    expect(firstItem(numsOf(rewritten)[3].ConceptNameCodeSequence).CodeValue).toBe('110852');
  });

  it('refuses an out-of-plane circle without a valid Drawing-Plane', () => {
    const refused = [];
    const tool = { ...OBLIQUE_TOOLS.CircleROI[0], metadata: { ...OBLIQUE_TOOLS.CircleROI[0].metadata, drawingPlane: undefined } };
    quiet(() => {
      try {
        writeSR({}, {
          toolState: { [SERIES_KEY]: { CircleROI: { data: [tool] } } }, patientSeries: { [SERIES_KEY]: SERIES },
          onMeasurementRefused: (toolType, refusedTool, error) => refused.push([toolType, error.code]),
        });
      } catch (error) {
        // a report of no measurements is not written
      }
    });
    expect(refused).toEqual([['CircleROI', 'plane']]);
  });
});
