// Bidirectional DICOM-SR round trip (bidirectionalGeometry.js): the Viewer writer (the classic
// adapter -> TID 300 -> TID 1500 -> properties under the Long Axis NUM), the Cornerstone3D hydration
// and its rule for pairs the tools cannot hold, the documents written by Sonador IO and by the stock
// Cornerstone3D adapter when they are present, and the two Viewer-authored fixtures. The library
// adapters are loaded from their ESM build; only @cornerstonejs/core is replaced, by a synthetic study
// whose image planes are known.
//
// UPDATE_SR_FIXTURES=1 regenerates the Viewer-authored fixtures (sonador-viewer.bidirectional-*.dcm).

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
    return mockProviders.map(({ provider }) => provider(type, imageId)).find(result => result !== undefined);
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
        Bidirectional: load('Cornerstone3D/Bidirectional.js'),
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
  annotationBidirectional, axesProblem, bidirectionalDisplayValues, bidirectionalLabelLines, bidirectionalNumItems, bidirectionalText,
  bidirectionalValues, valuesKeepingAxes,
} from './utils/bidirectionalGeometry';
import { encodeDisplayAttributes, parseDisplayAttributes } from './utils/dcmsrDisplayAttributes';
import { encodeExtendedMeta, parseExtendedMeta } from './utils/dcmsrExtendedMeta';
import { propertyParentOf } from './utils/propertyParent';
import { omittedMeasurement, saveResultSummary } from './utils/saveResult';
import { documentSettings } from './utils/srDocument';
import { SonadorCodeValues } from './enums';
import { drawingPlaneOfView, formatDrawingPlane, navigationPlaneOf } from './utils/drawingPlane';
import { heldOutOfPlaneRecord, isOutOfPlaneMeasurement, OUT_OF_PLANE_TOOLS, patientToolData } from './utils/outOfPlane';
import { viewOfNormal } from './utils/measurementView';
import { bidirectional as bidirectionalTool } from '../measurements/tools/bidirectional';
import measurementDetail from '../measurements/tools/measurementDetail';

const { DicomDict, DicomMessage, DicomMetaDictionary } = dcmjsData;

const FIXTURES = path.join(__dirname, '__fixtures__');
const VIEWER_IMAGE = path.join(FIXTURES, 'sonador-viewer.bidirectional-image.2026-1113.dcm');
const VIEWER_OBLIQUE = path.join(FIXTURES, 'sonador-viewer.bidirectional-oblique.2026-1113.dcm');
const fixture = name => readSR(fs.readFileSync(path.join(FIXTURES, name)));
// The fixtures of the other writers, by name prefix (any date): undefined while not committed
const optionalFixture = (prefix) => {
  const name = fs.readdirSync(FIXTURES).filter(file => file.startsWith(`${prefix}.`) && file.endsWith('.dcm')).sort().pop();
  return name;
};

const COMPREHENSIVE_3D_SR = '1.2.840.10008.5.1.4.1.1.88.34';
const CT_IMAGE = '1.2.840.10008.5.1.4.1.1.2';
const ENHANCED_CT_IMAGE = '1.2.840.10008.5.1.4.1.1.2.1';

const CODES = {
  ImagingMeasurements: '126010', MeasurementGroup: '125007', TrackingIdentifier: '112039', TrackingUniqueIdentifier: '112040',
};
const DESCRIPTION = SonadorCodeValues.DCMSR_MEASUREMENT_DESCRIPTION.value;
const VIEW = SonadorCodeValues.DCMSR_MEASUREMENT_VIEW.value;
const DISPLAY = SonadorCodeValues.DCMSR_DISPLAY_ATTRIBUTES.value;
const DRAWING_PLANE = SonadorCodeValues.DCMSR_MEASUREMENT_DRAWING_PLANE.value;
const SOURCE_SERIES = SonadorCodeValues.DCMSR_MEASUREMENT_SOURCE_SERIES.value;
const NOT_PERPENDICULAR_WARNING = '[DICOM-SR:Bidirectional] axes are not perpendicular or do not intersect';

// The synthetic study: no study or imaging identifiers. The first image maps image (x, y) to
// patient (x, y, 0); the second has a column spacing (along x) of twice its row spacing.
const SYNTHETIC = {
  PatientName: 'Anonymous', PatientID: 'ANONYMOUS', StudyID: '1',
  StudyInstanceUID: '2.25.1001', SeriesInstanceUID: '2.25.1002', FrameOfReferenceUID: '2.25.7001',
};
const IMAGE = { SOPInstanceUID: '2.25.1003', imageId: 'synthetic:2.25.1003' };
const ANISOTROPIC_IMAGE = { SOPInstanceUID: '2.25.1004', imageId: 'synthetic:2.25.1004' };

Object.assign(mockImagePlanes, {
  [IMAGE.imageId]: {
    imagePositionPatient: [0.5, 0.5, 0], rowCosines: [1, 0, 0], columnCosines: [0, 1, 0],
    rowPixelSpacing: 1, columnPixelSpacing: 1, frameOfReferenceUID: SYNTHETIC.FrameOfReferenceUID,
  },
  [ANISOTROPIC_IMAGE.imageId]: {
    imagePositionPatient: [0, 0, 0], rowCosines: [1, 0, 0], columnCosines: [0, 1, 0],
    rowPixelSpacing: 1, columnPixelSpacing: 2, frameOfReferenceUID: SYNTHETIC.FrameOfReferenceUID,
  },
});
const IMAGES = [IMAGE, ANISOTROPIC_IMAGE];
const imageOf = imageId => IMAGES.find(image => image.imageId === imageId);

const PROPERTIES = {
  description: 'Lesion axes',
  text: 'Synthetic',
  location: 'Synthetic location',
  displayAttributes: { Color: { Border: '#FF8800', Value: '#8AD0A8', Meaning: '#C0C7F8' } },
};

let MeasurementReport;
let MeasurementReport3D;
beforeAll(() => {
  require('./SCOORD3D/adapters');
  MeasurementReport = require('./SCOORD3D/MeasurementReport').default;
  require('./Cornerstone3d/adapters');
  MeasurementReport3D = require('./Cornerstone3d/MeasurementReport').default;
});


// Deterministic UIDs and dates, so a document can be written twice to the same bytes
const { DicomMetaDictionary: AdaptersDicomMetaDictionary } = jest.requireActual(
  '../../../../node_modules/@cornerstonejs/adapters/node_modules/dcmjs').data;

function deterministic(fn) {
  let counter = 900000;
  const spies = [
    jest.spyOn(DicomMetaDictionary, 'uid').mockImplementation(() => `2.25.${counter++}`),
    jest.spyOn(AdaptersDicomMetaDictionary, 'uid').mockImplementation(() => `2.25.${counter++}`),
    jest.spyOn(DicomMetaDictionary, 'date').mockImplementation(() => '20261113'),
    jest.spyOn(DicomMetaDictionary, 'time').mockImplementation(() => '120000'),
    jest.spyOn(DicomMetaDictionary, 'dateTime').mockImplementation(() => '20261113120000'),
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
    return { result: fn(), warnings: spies[3].mock.calls.map(call => call.join(' ')) };
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
  document, imageId = IMAGE.imageId, onMeasurementRefused, imagePlaneModule, toolState: givenToolState, patientSeries, headers, series,
} = {}) {
  // Write the tools through the Viewer writer, as a save does (parseMeasurementsData), and
  // serialise them as the stow does (handleStructuredReport). `imagePlaneModule` replaces the
  // image's plane. `toolState` (with `patientSeries`) replaces the tool state of `toolsByType` on
  // `imageId`, for patient-domain measurements.
  const tools = givenToolState
    ? _.flatMap(_.values(givenToolState), byType => _.flatMap(_.values(byType), ({ data }) => data))
    : _.flatten(_.values(toolsByType));
  const metadataProvider = {
    get: (type, id) => ({
      generalSeriesModule: series || { studyInstanceUID: SYNTHETIC.StudyInstanceUID, seriesInstanceUID: SYNTHETIC.SeriesInstanceUID },
      sopCommonModule: { sopClassUID: imageOf(id).frame ? ENHANCED_CT_IMAGE : CT_IMAGE, sopInstanceUID: imageOf(id).SOPInstanceUID },
      imagePlaneModule: imagePlaneModule === undefined ? mockImagePlanes[id] : imagePlaneModule,
      frameNumber: imageOf(id).frame,
      instance: {},
    })[type],
  };

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

const write = (toolsByType, options) => quiet(() => deterministic(() => writeSR(toolsByType, options)));

const reSaveOf = dataset => ({
  ...documentSettings({ SOPClassUID: dataset.SOPClassUID, ...firstItem(dataset.ContentTemplateSequence) }),
  personName: 'Observer^Test',
});

function hydrate(dataset, images = [IMAGE]) {
  // The production hydration: Sonador Cornerstone3D generateToolState with the library adapters
  // and the property hook parseDicomStructuredReport installs
  const imageIds = _.fromPairs(_.uniqBy(images, 'SOPInstanceUID').map(image => [image.SOPInstanceUID, image.imageId]));
  const { result, warnings } = quiet(() => MeasurementReport3D.generateToolState(dataset, imageIds, c3dMetaData, undefined, {
    onContentItemParse: (toolType, annotation, srItem) => {
      const propertyParent = propertyParentOf(toolType);
      parseExtendedMeta(srItem, annotation, { propertyParent });
      parseDisplayAttributes(srItem, annotation, { propertyParent });
    },
  }));
  return { byType: result, warnings };
}

const HANDLES = ['start', 'end', 'perpendicularStart', 'perpendicularEnd'];
const BIDIRECTIONAL = 'Bidirectional';
const TRACKING_IDENTIFIER = 'cornerstoneTools@^4.0.0:Bidirectional';
const LONG_AXIS = ['103339001', 'SCT', 'Long Axis'];
const SHORT_AXIS = ['103340004', 'SCT', 'Short Axis'];

function classicTool(imagePoints, extra = {}) {
  // A cornerstone-tools Bidirectional as the classic mapping hands it to the writer
  return {
    _id: extra._id || `bidirectional-${imagePoints.map(p => p.join(',')).join(';')}`,
    handles: _.zipObject(HANDLES, imagePoints.map(([x, y]) => ({ x, y }))),
    ...PROPERTIES,
    ..._.omit(extra, '_id', 'metadata'),
    metadata: { text: PROPERTIES.text, location: PROPERTIES.location, ...(extra.metadata || {}) },
  };
}

function toClassicTool(state, imageId, _id = 'hydrated-bidirectional') {
  // The Cornerstone3D -> cornerstone-tools bridge (createRenderVersion): world points to image
  // points of the referenced image, the hydrated identity and properties carried along
  const { annotation } = state;
  const module = mockImagePlanes[imageId || annotation.metadata.referencedImageId];
  const imagePoints = annotation.data.handles.points.map(point => patientToImage(module, point));
  return {
    _id,
    handles: _.zipObject(HANDLES, imagePoints.map(([x, y]) => ({ x, y }))),
    description: state.description,
    displayAttributes: annotation.data.displayAttributes,
    metadata: _.pick(annotation.metadata,
      'TrackingUniqueIdentifier', 'TrackingIdentifier', 'coordinateDomain', 'views', 'text', 'location', 'sourceGeometry',
      'sourceSeries', 'drawingPlane'),
  };
}

function refusalsOf(toolsByType, options) {
  // The refusals of a write: [toolType, code, error]
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

const numsOf = group => asArray(group.ContentSequence).filter(item => item.ValueType === 'NUM');
const valuesOf = group => numsOf(group).map(num => Number(firstItem(num.MeasuredValueSequence).NumericValue));
const geometryOf = num => asArray(num.ContentSequence).find(item => item.RelationshipType === 'INFERRED FROM');
const pointsOfItem = item => _.chunk(Array.from(item.GraphicData, Number), item.ValueType === 'SCOORD3D' ? 3 : 2);
const statsOf = state => _.values(state.annotation.data.cachedStats)[0];
const conceptOfNum = num => {
  const concept = firstItem(num.ConceptNameCodeSequence);
  return [concept.CodeValue, concept.CodingSchemeDesignator, concept.CodeMeaning];
};
const expectPoint = (point, expected, digits = 5) => expected.forEach((value, i) => expect(point[i]).toBeCloseTo(value, digits));

// A Bidirectional on the synthetic image: long axis (10.5, 20.5) -> (30.5, 20.5), 20 mm; short axis
// (20.5, 14.5) -> (20.5, 26.5), 12 mm, through the middle of the long axis
const POINTS = [[10.5, 20.5], [30.5, 20.5], [20.5, 14.5], [20.5, 26.5]];
const written = (extra) => readSR(write({ [BIDIRECTIONAL]: [classicTool(POINTS, { _id: 'bidirectional-1', ...extra })] }).result);


describe('Bidirectional geometry', () => {
  it('measures both axes as labelled, never swapped', () => {
    expect(bidirectionalValues([[0, 0], [3, 4], [1, 1], [1, 2]])).toEqual({ length: 5, width: 1 });
    // A short axis longer than the long axis stays the short axis
    expect(bidirectionalValues([[0, 0], [1, 0], [0, -5], [0, 5]])).toEqual({ length: 1, width: 10 });
  });

  it('keeps the recorded length of an axis whose points did not move, and recomputes the other', () => {
    const points = [[0, 0, 0], [20, 0, 0], [10, -6, 0], [10, 6, 0]];
    const recordValue = { values: { length: 20.04, width: 11.98 }, points: _.cloneDeep(points) };
    const mm = { unit: 'mm', widthUnit: 'mm' };
    expect(valuesKeepingAxes(points, recordValue)).toEqual({ length: 20.04, width: 11.98, ...mm });
    const longMoved = [[0, 0, 0], [30, 0, 0], [10, -6, 0], [10, 6, 0]];
    expect(valuesKeepingAxes(longMoved, recordValue)).toEqual({ length: 30, width: 11.98, ...mm });
    const shortMoved = [[0, 0, 0], [20, 0, 0], [10, -8, 0], [10, 6, 0]];
    expect(valuesKeepingAxes(shortMoved, recordValue)).toEqual({ length: 20.04, width: 14, ...mm });
    expect(annotationBidirectional({ handles: { points: longMoved }, recordValue })).toEqual({ length: 30, width: 11.98, ...mm });

    // An axis keeps the unit it was recorded in; a recomputed axis is in millimetres
    const inCentimetres = { values: { length: 2.004, width: 1.198, unit: 'cm', widthUnit: 'cm' }, points: _.cloneDeep(points) };
    expect(valuesKeepingAxes(longMoved, inCentimetres)).toEqual({ length: 30, width: 1.198, unit: 'mm', widthUnit: 'cm' });
  });

  it.each([
    ['perpendicular through the middle', [[0, 0], [20, 0], [10, -6], [10, 6]], undefined],
    ['perpendicular off the middle', [[0, 0], [20, 0], [3, -2], [3, 9]], undefined],
    ['perpendicular, the short axis touching the long one with an end', [[0, 0], [20, 0], [10, 0], [10, 6]], undefined],
    ['0.9 degrees from perpendicular', [[0, 0], [20, 0], [10 - 6 * Math.sin(0.9 * Math.PI / 180), -6], [10 + 6 * Math.sin(0.9 * Math.PI / 180), 6]], undefined],
    ['1.5 degrees from perpendicular', [[0, 0], [20, 0], [10 - 6 * Math.sin(1.5 * Math.PI / 180), -6], [10 + 6 * Math.sin(1.5 * Math.PI / 180), 6]],
      'not perpendicular'],
    ['perpendicular, apart', [[0, 0], [20, 0], [30, -6], [30, 6]], 'no intersection'],
    ['perpendicular, short of the long axis', [[0, 0], [20, 0], [10, 1], [10, 6]], 'no intersection'],
    ['perpendicular and skew in 3D', [[0, 0, 0], [20, 0, 0], [10, -6, 2], [10, 6, 2]], 'no intersection'],
    ['crossing in 3D, out of the axial plane', [[0, 0, 0], [20, 0, 20], [10, -6, 10], [10, 6, 10]], undefined],
  ])('places a pair %s in the tools only when it crosses and is perpendicular', (name, points, problem) => {
    expect(axesProblem(points)).toBe(problem);
  });

  it('finds the NUM items by SCT or SRT code, else by meaning, in any order', () => {
    const num = (CodeValue, CodingSchemeDesignator, CodeMeaning, NumericValue) => ({
      ValueType: 'NUM', ConceptNameCodeSequence: { CodeValue, CodingSchemeDesignator, CodeMeaning },
      MeasuredValueSequence: { NumericValue, MeasurementUnitsCodeSequence: { CodeValue: 'mm', CodingSchemeDesignator: 'UCUM' } },
    });
    const bySRT = bidirectionalNumItems([num('G-A186', 'SRT', 'Short Axis', 4), num('G-A185', 'SRT', 'Long Axis', 9)]);
    expect([bySRT.long.value, bySRT.long.scheme, bySRT.short.value, bySRT.short.scheme]).toEqual([9, 'SRT', 4, 'SRT']);
    const byMeaning = bidirectionalNumItems([num('1', '99LOCAL', 'short axis', 4), num('2', '99LOCAL', 'LONG AXIS', 9)]);
    expect([byMeaning.long.value, byMeaning.short.value]).toEqual([9, 4]);
    // A coded NUM is not taken by the other axis' meaning
    const mixed = bidirectionalNumItems([num('103339001', 'SCT', 'Short Axis', 9), num('3', '99LOCAL', 'Short Axis', 4)]);
    expect([mixed.long.value, mixed.short.value]).toEqual([9, 4]);
    expect(bidirectionalNumItems([num('103339001', 'SCT', 'Long Axis', 9)]).short).toBeUndefined();
  });

  it('labels the drawing L: and W:, and the panel row L x W mm', () => {
    expect(bidirectionalLabelLines({ length: 20, width: 11.996, unit: 'mm' })).toEqual(['L: 20.00 mm', 'W: 12.00 mm']);
    expect(bidirectionalText({ length: 20, width: 11.996 })).toBe('20.00 x 12.00 mm');
    const display = bidirectionalTool.options.measurementTable.displayFunction;
    expect(display({ longestDiameter: 27.756, shortestDiameter: '14.2', unit: 'mm' })).toBe('27.76 x 14.20 mm');
    expect(display({ data: { longestDiameter: 27.756, shortestDiameter: 14.2 } })).toBe('27.76 x 14.20 mm');
    // A Cornerstone3D record's statistics by target
    expect(display({ data: { 'imageId:a': { length: 20, width: 12, unit: 'mm' } } })).toBe('20.00 x 12.00 mm');
    expect(bidirectionalDisplayValues({ data: {} })).toBeUndefined();
    expect(display({})).toBe('');
  });

  it('is a NUM-parent and an out-of-plane tool', () => {
    expect(propertyParentOf(BIDIRECTIONAL)).toBe('num');
    expect(OUT_OF_PLANE_TOOLS).toContain(BIDIRECTIONAL);
  });
});


describe('Viewer writer: image domain', () => {
  it('writes the Long Axis then the Short Axis NUM, each in mm over its own POLYLINE from the same image', () => {
    const [group] = measurementGroups(written());
    expect(trackingIdentifierOf(group)).toBe(TRACKING_IDENTIFIER);
    const nums = numsOf(group);
    expect(nums.map(conceptOfNum)).toEqual([LONG_AXIS, SHORT_AXIS]);
    nums.forEach(num => expect(firstItem(firstItem(num.MeasuredValueSequence).MeasurementUnitsCodeSequence))
      .toMatchObject({ CodeValue: 'mm', CodingSchemeDesignator: 'UCUM' }));
    const [length, width] = valuesOf(group);
    expect(length).toBeCloseTo(20, 9);
    expect(width).toBeCloseTo(12, 9);

    const [long, short] = nums.map(geometryOf);
    expect(long).toMatchObject({ ValueType: 'SCOORD', GraphicType: 'POLYLINE' });
    expect(short).toMatchObject({ ValueType: 'SCOORD', GraphicType: 'POLYLINE' });
    expect(long).not.toBe(short);
    expect(pointsOfItem(long)).toEqual(POINTS.slice(0, 2));
    expect(pointsOfItem(short)).toEqual(POINTS.slice(2, 4));
    [long, short].forEach(geometry => {
      const image = firstItem(geometry.ContentSequence);
      expect(image).toMatchObject({ RelationshipType: 'SELECTED FROM', ValueType: 'IMAGE' });
      expect(firstItem(image.ReferencedSOPSequence).ReferencedSOPInstanceUID).toBe(IMAGE.SOPInstanceUID);
    });

    // The properties are children of the Long Axis NUM; the Short Axis holds its geometry only
    const properties = asArray(nums[0].ContentSequence).filter(item => item.RelationshipType === 'HAS PROPERTIES');
    expect(textValues(properties, DESCRIPTION)).toEqual([PROPERTIES.description]);
    expect(properties.some(item => conceptNameValue(item) === DISPLAY)).toBe(true);
    expect(asArray(nums[1].ContentSequence).map(item => item.RelationshipType)).toEqual(['INFERRED FROM']);
  });

  it('measures each axis in millimetres through the image plane, on unequal pixel spacing', () => {
    // Column spacing 2 mm, row spacing 1 mm: 10 columns are 20 mm, 6 rows 6 mm
    const tool = classicTool([[0.5, 5.5], [10.5, 5.5], [5.5, 2.5], [5.5, 8.5]]);
    const [group] = measurementGroups(readSR(write({ [BIDIRECTIONAL]: [tool] }, { imageId: ANISOTROPIC_IMAGE.imageId }).result));
    const [length, width] = valuesOf(group);
    expect(length).toBeCloseTo(20, 9);
    expect(width).toBeCloseTo(6, 9);
  });

  it('writes the axes as they are held: a longer short axis is not swapped', () => {
    const tool = classicTool([[10.5, 20.5], [14.5, 20.5], [12.5, 10.5], [12.5, 30.5]]);
    const [group] = measurementGroups(readSR(write({ [BIDIRECTIONAL]: [tool] }).result));
    expect(numsOf(group).map(conceptOfNum)).toEqual([LONG_AXIS, SHORT_AXIS]);
    expect(valuesOf(group).map(value => Math.round(value * 1e6) / 1e6)).toEqual([4, 20]);
  });

  it('refuses an uncalibrated, degenerate or incomplete Bidirectional with the reason and what to do', () => {
    expect(refusalsOf({ [BIDIRECTIONAL]: [classicTool(POINTS)] }, { imagePlaneModule: null }).map(([t, c]) => [t, c]))
      .toEqual([[BIDIRECTIONAL, 'uncalibrated']]);
    const degenerate = classicTool([[10.5, 20.5], [30.5, 20.5], [20.5, 20.5], [20.5, 20.505]]);
    const refused = refusalsOf({ [BIDIRECTIONAL]: [degenerate] });
    expect(refused.map(([t, c]) => [t, c])).toEqual([[BIDIRECTIONAL, 'degenerate']]);
    expect(saveResultSummary([omittedMeasurement(BIDIRECTIONAL, degenerate, refused[0][2])]).message)
      .toContain(`Bidirectional "${PROPERTIES.description}": move the endpoints of each axis apart so that both axes are at least 0.01 mm long.`);
    const incomplete = { ...classicTool(POINTS), handles: _.omit(classicTool(POINTS).handles, 'perpendicularEnd') };
    expect(refusalsOf({ [BIDIRECTIONAL]: [incomplete] }).map(([t, c]) => [t, c])).toEqual([[BIDIRECTIONAL, 'incomplete']]);
  });
});


describe('hydration', () => {
  it('hydrates a Viewer-written Bidirectional locked, its axes in patient coordinates with the stored lengths', () => {
    const { byType } = hydrate(written());
    const [state] = byType.Bidirectional;
    const { annotation } = state;
    expect(annotation.data.handles.points).toEqual(POINTS.map(([x, y]) => [x, y, 0]));
    expect(statsOf(state).length).toBeCloseTo(20, 9);
    expect(statsOf(state).width).toBeCloseTo(12, 9);
    expect(statsOf(state)).toMatchObject({ unit: 'mm', widthUnit: 'mm' });
    expect(annotation.data.recordValue.points).toEqual(annotation.data.handles.points);
    expect(annotation.metadata).toMatchObject({
      isLocked: true, isReadOnly: true, coordinateDomain: 'image', TrackingIdentifier: TRACKING_IDENTIFIER, referencedImageId: IMAGE.imageId,
    });
    expect(annotation.metadata.sourceGeometry).toMatchObject({
      valueType: 'SCOORD', graphicType: 'POLYLINE', graphicData: POINTS.flat(),
      axes: { long: { scheme: 'SCT' }, short: { scheme: 'SCT' } },
    });
    expect(state.description).toBe(PROPERTIES.description);
    expect(annotation.metadata.text).toBe(PROPERTIES.text);
    expect(annotation.data.displayAttributes).toEqual(PROPERTIES.displayAttributes);
  });

  it('reads the Cornerstone3D tracking identifier prefix as well, and keeps the identifier read on re-save', () => {
    const dataset = written();
    const [group] = measurementGroups(dataset);
    child(group, CODES.TrackingIdentifier).TextValue = 'Cornerstone3DTools@^0.1.0:Bidirectional';
    const [state] = hydrate(dataset).byType.Bidirectional;
    expect(state.annotation.metadata.TrackingIdentifier).toBe('Cornerstone3DTools@^0.1.0:Bidirectional');
    expect(statsOf(state).length).toBeCloseTo(20, 9);

    const [rewritten] = measurementGroups(readSR(write({ [BIDIRECTIONAL]: [toClassicTool(state, IMAGE.imageId)] },
      { document: reSaveOf(dataset) }).result));
    expect(trackingIdentifierOf(rewritten)).toBe('Cornerstone3DTools@^0.1.0:Bidirectional');
    // Any other identifier is not kept: the cornerstoneTools form is written
    const foreign = toClassicTool(state, IMAGE.imageId);
    foreign.metadata.TrackingIdentifier = 'Planner:Bidirectional';
    const [renamed] = measurementGroups(readSR(write({ [BIDIRECTIONAL]: [foreign] }, { document: reSaveOf(dataset) }).result));
    expect(trackingIdentifierOf(renamed)).toBe(TRACKING_IDENTIFIER);
  });

  it('reads the SRT codes and NUMs found by meaning in either order, and keeps SRT on re-save', () => {
    const dataset = written();
    const [group] = measurementGroups(dataset);
    const [long, short] = numsOf(group);
    Object.assign(firstItem(long.ConceptNameCodeSequence), { CodeValue: 'G-A185', CodingSchemeDesignator: 'SRT' });
    Object.assign(firstItem(short.ConceptNameCodeSequence), { CodeValue: '99', CodingSchemeDesignator: '99LOCAL' });
    group.ContentSequence = [...asArray(group.ContentSequence).filter(item => item.ValueType !== 'NUM'), short, long];
    const [state] = hydrate(dataset).byType.Bidirectional;
    expect(state.annotation.data.handles.points).toEqual(POINTS.map(([x, y]) => [x, y, 0]));
    expect(state.annotation.metadata.sourceGeometry.axes).toMatchObject({ long: { scheme: 'SRT' }, short: { scheme: 'SCT' } });
    // The properties are read from the first NUM in document order that carries any: the Long Axis
    expect(state.description).toBe(PROPERTIES.description);

    const [rewritten] = measurementGroups(readSR(write({ [BIDIRECTIONAL]: [toClassicTool(state, IMAGE.imageId)] },
      { document: reSaveOf(dataset) }).result));
    expect(numsOf(rewritten).map(conceptOfNum)).toEqual([['G-A185', 'SRT', 'Long Axis'], SHORT_AXIS]);
  });

  it('shows a short axis longer than the long axis as labelled: not swapped on read nor on re-save', () => {
    const dataset = readSR(write({ [BIDIRECTIONAL]: [classicTool([[10.5, 20.5], [14.5, 20.5], [12.5, 10.5], [12.5, 30.5]])] }).result);
    const [state] = hydrate(dataset).byType.Bidirectional;
    expect(statsOf(state).length).toBeCloseTo(4, 9);
    expect(statsOf(state).width).toBeCloseTo(20, 9);
    expect(state.annotation.data.handles.points[0]).toEqual([10.5, 20.5, 0]);
    const [rewritten] = measurementGroups(readSR(write({ [BIDIRECTIONAL]: [toClassicTool(state, IMAGE.imageId)] },
      { document: reSaveOf(dataset) }).result));
    expect(valuesOf(rewritten)).toEqual(valuesOf(measurementGroups(dataset)[0]));
    expect(pointsOfItem(geometryOf(numsOf(rewritten)[0]))).toEqual([[10.5, 20.5], [14.5, 20.5]]);
  });

  it.each([
    ['not perpendicular', [[10.5, 20.5], [30.5, 20.5], [18.5, 14.5], [22.5, 26.5]]],
    ['not crossing', [[10.5, 20.5], [30.5, 20.5], [40.5, 14.5], [40.5, 26.5]]],
  ])('leaves a pair %s to the read-only display, with the warning', (name, points) => {
    const dataset = written();
    const [group] = measurementGroups(dataset);
    const short = geometryOf(numsOf(group)[1]);
    short.GraphicData = points.slice(2).flat();
    const long = geometryOf(numsOf(group)[0]);
    long.GraphicData = points.slice(0, 2).flat();
    const { byType, warnings } = hydrate(dataset);
    expect(byType.Bidirectional).toBeUndefined();
    expect(warnings.some(message => message.startsWith(NOT_PERPENDICULAR_WARNING))).toBe(true);
  });

  it('hydrates a degenerate axis with a warning, and refuses it on a re-save', () => {
    const dataset = written();
    const [group] = measurementGroups(dataset);
    const short = numsOf(group)[1];
    geometryOf(short).GraphicData = [20.5, 20.5, 20.5, 20.505];
    firstItem(short.MeasuredValueSequence).NumericValue = 0.005;
    const { byType, warnings } = hydrate(dataset);
    const [state] = byType.Bidirectional;
    expect(statsOf(state).width).toBe(0.005);
    expect(warnings.some(message => /\[DICOM-SR:Bidirectional\] degenerate axis/.test(message))).toBe(true);
    const refused = refusalsOf({ [BIDIRECTIONAL]: [toClassicTool(state, IMAGE.imageId)] }, { document: reSaveOf(dataset) });
    expect(refused.map(([t, c]) => [t, c])).toEqual([[BIDIRECTIONAL, 'degenerate']]);
  });

  it('does not hydrate a group whose axes share one geometry item, or that lacks an axis', () => {
    const shared = written();
    const [group] = measurementGroups(shared);
    const [long, short] = numsOf(group);
    short.ContentSequence = long.ContentSequence;
    expect(hydrate(shared).byType.Bidirectional).toBeUndefined();

    const single = written();
    const [one] = measurementGroups(single);
    one.ContentSequence = asArray(one.ContentSequence).filter(item => item !== numsOf(one)[1]);
    expect(hydrate(single).byType.Bidirectional).toBeUndefined();
  });
});


describe('the unit of each axis', () => {
  const CENTIMETRE = { CodeValue: 'cm', CodingSchemeDesignator: 'UCUM', CodingSchemeVersion: '1.4', CodeMeaning: 'centimeter' };
  // The stored value and unit of a NUM changed, its geometry kept
  const restate = (num, value) => {
    const measured = firstItem(num.MeasuredValueSequence);
    measured.NumericValue = value;
    measured.MeasurementUnitsCodeSequence = { ...CENTIMETRE };
  };
  const display = bidirectionalTool.options.measurementTable.displayFunction;

  it('shows a Long Axis of 20 mm and a Short Axis of 1.2 cm each in its own unit, everywhere, and re-saves both as read', () => {
    const dataset = written();
    restate(numsOf(measurementGroups(dataset)[0])[1], 1.2);
    const [state] = hydrate(dataset).byType.Bidirectional;
    const stats = statsOf(state);
    expect(stats).toMatchObject({ unit: 'mm', widthUnit: 'cm', width: 1.2 });
    expect(stats.length).toBeCloseTo(20, 9);
    // The Cornerstone3D label, the panel row and the 3D view
    expect(bidirectionalLabelLines(stats)).toEqual(['L: 20.00 mm', 'W: 1.20 cm']);
    expect(display({ data: { 'imageId:a': stats } })).toBe('20.00 mm x 1.20 cm');
    expect(bidirectionalText(annotationBidirectional(state.annotation.data))).toBe('20.00 mm x 1.20 cm');

    // An unchanged re-save writes the value and the unit read
    const [rewritten] = measurementGroups(readSR(write({ [BIDIRECTIONAL]: [toClassicTool(state, IMAGE.imageId)] },
      { document: reSaveOf(dataset) }).result));
    const short = firstItem(numsOf(rewritten)[1].MeasuredValueSequence);
    expect(Number(short.NumericValue)).toBe(1.2);
    expect(firstItem(short.MeasurementUnitsCodeSequence).CodeValue).toBe('cm');

    // A moved short axis is measured again, in millimetres
    const moved = toClassicTool(state, IMAGE.imageId);
    moved.handles.perpendicularEnd = { x: 20.5, y: 28.5 };
    const [edited] = measurementGroups(readSR(write({ [BIDIRECTIONAL]: [moved] }, { document: reSaveOf(dataset) }).result));
    const editedShort = firstItem(numsOf(edited)[1].MeasuredValueSequence);
    expect(Number(editedShort.NumericValue)).toBeCloseTo(14, 9);
    expect(firstItem(editedShort.MeasurementUnitsCodeSequence).CodeValue).toBe('mm');
  });

  it('keeps both axes in centimetres through a held out-of-plane record, its row, detail card and 3D text', () => {
    const coronal = [[0, 20, 30], [20, 20, 30], [10, 20, 24], [10, 20, 36]];
    const dataset = readSR(write({}, {
      toolState: { 'patient:2.25.1002': { [BIDIRECTIONAL]: { data: [{
        uid: 'held', _id: 'held', toolType: BIDIRECTIONAL, patientPoints: coronal, FrameOfReferenceUID: SYNTHETIC.FrameOfReferenceUID,
        metadata: { outOfPlane: true, drawingPlane: formatDrawingPlane(drawingPlaneOfView([0, 1, 0], [0, 0, 1])) },
      }] } } },
      patientSeries: { 'patient:2.25.1002': { StudyInstanceUID: SYNTHETIC.StudyInstanceUID, SeriesInstanceUID: SYNTHETIC.SeriesInstanceUID, instances: [] } },
    }).result);
    const [long, short] = numsOf(measurementGroups(dataset)[0]);
    restate(long, 2);
    restate(short, 1.2);
    const [state] = hydrate(dataset).byType.Bidirectional;
    const record = heldOutOfPlaneRecord(BIDIRECTIONAL, state, SYNTHETIC.StudyInstanceUID);
    expect(record).toMatchObject({ unit: 'cm', data: { longestDiameter: 2, shortestDiameter: 1.2, unit: 'cm', widthUnit: 'cm' } });
    expect(display(record)).toBe('2.00 x 1.20 cm');
    expect(measurementDetail(BIDIRECTIONAL, record).primary.text).toBe('2.00 × 1.20 cm');
    expect(measurementDetail(BIDIRECTIONAL, record).sections[0].items.map(entry => entry.value)).toEqual(['2.00 cm', '1.20 cm']);
    expect(bidirectionalText(annotationBidirectional(state.annotation.data))).toBe('2.00 x 1.20 cm');

    // Mixed: each axis in its unit on the card
    const mixed = { ...record, unit: 'mm', data: { ...record.data, longestDiameter: 20, unit: 'mm' } };
    expect(measurementDetail(BIDIRECTIONAL, mixed).primary.text).toBe('20.00 mm × 1.20 cm');
    expect(display(mixed)).toBe('20.00 mm x 1.20 cm');
  });

  it('refuses a stored value below 0.01 mm in its own unit', () => {
    const dataset = written();
    restate(numsOf(measurementGroups(dataset)[0])[1], 0.0005);
    const [state] = hydrate(dataset).byType.Bidirectional;
    const refused = refusalsOf({ [BIDIRECTIONAL]: [toClassicTool(state, IMAGE.imageId)] }, { document: reSaveOf(dataset) });
    expect(refused.map(([t, c]) => [t, c])).toEqual([[BIDIRECTIONAL, 'degenerate']]);
  });
});


describe('degenerate geometry under a stored value', () => {
  it('refuses an unchanged image-domain axis shorter than 0.01 mm whose stored NUM is 12 mm, in the partial-save result', () => {
    const dataset = written();
    geometryOf(numsOf(measurementGroups(dataset)[0])[1]).GraphicData = [20.5, 20.5, 20.5, 20.505];
    const { byType, warnings } = hydrate(dataset);
    const [state] = byType.Bidirectional;
    expect(statsOf(state).width).toBeCloseTo(12, 9);
    expect(warnings.some(message => /degenerate axis/.test(message))).toBe(true);
    const tool = toClassicTool(state, IMAGE.imageId);
    const refused = refusalsOf({ [BIDIRECTIONAL]: [tool] }, { document: reSaveOf(dataset) });
    expect(refused.map(([t, c]) => [t, c])).toEqual([[BIDIRECTIONAL, 'degenerate']]);
    expect(saveResultSummary([omittedMeasurement(BIDIRECTIONAL, tool, refused[0][2])]).message)
      .toContain('move the endpoints of each axis apart so that both axes are at least 0.01 mm long');
  });

  it('refuses an unchanged patient-domain axis shorter than 0.01 mm whose stored NUM is 12 mm', () => {
    const coronal = [[0, 20, 30], [20, 20, 30], [10, 20, 24], [10, 20, 36]];
    const PATIENT_SERIES = { 'patient:2.25.1002': { StudyInstanceUID: SYNTHETIC.StudyInstanceUID, SeriesInstanceUID: SYNTHETIC.SeriesInstanceUID, instances: [] } };
    const dataset = readSR(write({}, {
      toolState: { 'patient:2.25.1002': { [BIDIRECTIONAL]: { data: [{
        uid: 'held', _id: 'held', toolType: BIDIRECTIONAL, patientPoints: coronal, FrameOfReferenceUID: SYNTHETIC.FrameOfReferenceUID,
        metadata: { outOfPlane: true, drawingPlane: formatDrawingPlane(drawingPlaneOfView([0, 1, 0], [0, 0, 1])) },
      }] } } },
      patientSeries: PATIENT_SERIES,
    }).result);
    geometryOf(numsOf(measurementGroups(dataset)[0])[1]).GraphicData = [10, 20, 30, 10, 20, 30.005];
    const [state] = hydrate(dataset).byType.Bidirectional;
    const held = heldOutOfPlaneRecord(BIDIRECTIONAL, state, SYNTHETIC.StudyInstanceUID);
    const tool = { ...patientToolData({ ...held, uid: 'held' }), _id: 'held' };
    const refused = refusalsOf({}, {
      toolState: { 'patient:2.25.1002': { [BIDIRECTIONAL]: { data: [tool] } } }, patientSeries: PATIENT_SERIES, document: reSaveOf(dataset),
    });
    expect(refused.map(([t, c]) => [t, c])).toEqual([[BIDIRECTIONAL, 'degenerate']]);
  });
});


describe('one NUM carries every typed property', () => {
  // The Long Axis NUM written with all the properties; `split` moves those named onto the Short Axis NUM
  const split = (moved, { shortFirst = false } = {}) => {
    const dataset = written();
    const [group] = measurementGroups(dataset);
    const [long, short] = numsOf(group);
    const isMoved = item => item.RelationshipType === 'HAS PROPERTIES' && moved.includes(conceptNameValue(item));
    short.ContentSequence = [...asArray(short.ContentSequence), ...asArray(long.ContentSequence).filter(isMoved)];
    long.ContentSequence = asArray(long.ContentSequence).filter(item => !isMoved(item));
    if (shortFirst) {
      group.ContentSequence = [...asArray(group.ContentSequence).filter(item => item.ValueType !== 'NUM'), short, long];
    }
    const [state] = hydrate(dataset).byType.Bidirectional;
    return state;
  };
  const TEXTS = [DESCRIPTION, SonadorCodeValues.DCMSR_MEASUREMENT_TEXT.value, SonadorCodeValues.DCMSR_MEASUREMENT_LOCATION.value];

  it('reads the colours of a display-only first NUM, and not the text of a later NUM', () => {
    const state = split(TEXTS);
    expect(state.annotation.data.displayAttributes).toEqual(PROPERTIES.displayAttributes);
    expect(state.description).toBeUndefined();
    expect(state.annotation.metadata.text).toBeUndefined();
  });

  it('reads the text of a text-only first NUM, and not the colours of a later NUM', () => {
    const state = split([DISPLAY]);
    expect(state.description).toBe(PROPERTIES.description);
    expect(state.annotation.data.displayAttributes).toBeUndefined();
  });

  it('follows document order whichever axis comes first', () => {
    const shortFirst = split(TEXTS, { shortFirst: true });
    expect(shortFirst.description).toBe(PROPERTIES.description);
    expect(shortFirst.annotation.data.displayAttributes).toBeUndefined();
    const displayShortFirst = split([DISPLAY], { shortFirst: true });
    expect(displayShortFirst.annotation.data.displayAttributes).toEqual(PROPERTIES.displayAttributes);
    expect(displayShortFirst.description).toBeUndefined();
  });

  it('keeps every property of a single carrier', () => {
    const state = split([]);
    expect(state.description).toBe(PROPERTIES.description);
    expect(state.annotation.metadata).toMatchObject({ text: PROPERTIES.text, location: PROPERTIES.location });
    expect(state.annotation.data.displayAttributes).toEqual(PROPERTIES.displayAttributes);
  });
});


describe('stored and recomputed lengths on a re-save', () => {
  const hydrated = () => {
    const dataset = written();
    const [state] = hydrate(dataset).byType.Bidirectional;
    const tool = toClassicTool(state, IMAGE.imageId);
    // Stored lengths that differ from the geometry show they are the stored ones
    tool.metadata.sourceGeometry.values = { length: 20.04, width: 11.98 };
    return { dataset, tool };
  };

  it('writes an unchanged hydrated Bidirectional with the points, lengths and tracking UID it was read with', () => {
    const { dataset, tool } = hydrated();
    const [group] = measurementGroups(readSR(write({ [BIDIRECTIONAL]: [tool] }, { document: reSaveOf(dataset) }).result));
    expect(valuesOf(group)).toEqual([20.04, 11.98]);
    expect(trackingUIDOf(group)).toBe(trackingUIDOf(measurementGroups(dataset)[0]));
    expect(numsOf(group).map(num => pointsOfItem(geometryOf(num)))).toEqual([POINTS.slice(0, 2), POINTS.slice(2, 4)]);
  });

  it('recomputes the length of a moved long axis and keeps the stored width', () => {
    const { dataset, tool } = hydrated();
    tool.handles.end = { x: 35.5, y: 20.5 };
    const [group] = measurementGroups(readSR(write({ [BIDIRECTIONAL]: [tool] }, { document: reSaveOf(dataset) }).result));
    const [length, width] = valuesOf(group);
    expect(length).toBeCloseTo(25, 9);
    expect(width).toBe(11.98);
  });

  it('recomputes the width of a moved short axis and keeps the stored length', () => {
    const { dataset, tool } = hydrated();
    tool.handles.perpendicularEnd = { x: 20.5, y: 28.5 };
    const [group] = measurementGroups(readSR(write({ [BIDIRECTIONAL]: [tool] }, { document: reSaveOf(dataset) }).result));
    const [length, width] = valuesOf(group);
    expect(length).toBe(20.04);
    expect(width).toBeCloseTo(14, 9);
  });

  it('measures both axes again on another image', () => {
    const { dataset, tool } = hydrated();
    const [group] = measurementGroups(readSR(write({ [BIDIRECTIONAL]: [tool] }, {
      document: reSaveOf(dataset), imageId: ANISOTROPIC_IMAGE.imageId,
    }).result));
    const [length, width] = valuesOf(group);
    expect(length).toBeCloseTo(40, 9);
    expect(width).toBeCloseTo(12, 9);
  });
});


describe('out-of-plane: patient domain with a Drawing-Plane', () => {
  const PATIENT_SERIES = { 'patient:2.25.1002': { StudyInstanceUID: SYNTHETIC.StudyInstanceUID, SeriesInstanceUID: SYNTHETIC.SeriesInstanceUID, instances: [] } };
  // A coronal Bidirectional (y = 20), drawn off the axial images: long axis along x, short along z
  const CORONAL = [[0, 20, 30], [20, 20, 30], [10, 20, 24], [10, 20, 36]];
  const record = (metadata = {}) => ({
    uid: 'coronal', _id: 'coronal', toolType: BIDIRECTIONAL, patientPoints: CORONAL, FrameOfReferenceUID: SYNTHETIC.FrameOfReferenceUID,
    description: PROPERTIES.description,
    metadata: {
      outOfPlane: true, sourceSeries: SYNTHETIC.SeriesInstanceUID, drawingPlane: formatDrawingPlane(drawingPlaneOfView([0, 1, 0], [0, 0, 1])),
      views: ['coronal'], ...metadata,
    },
  });
  const writePatient = (tool, options = {}) => write({}, {
    toolState: { 'patient:2.25.1002': { [BIDIRECTIONAL]: { data: [tool] } } }, patientSeries: PATIENT_SERIES, ...options,
  }).result;

  it('writes two SCOORD3D POLYLINEs with the Frame of Reference, and the Drawing-Plane, Source-Series and View on the Long Axis NUM', () => {
    const [group] = measurementGroups(readSR(writePatient(record())));
    const nums = numsOf(group);
    expect(nums.map(conceptOfNum)).toEqual([LONG_AXIS, SHORT_AXIS]);
    nums.forEach(num => expect(geometryOf(num)).toMatchObject({
      ValueType: 'SCOORD3D', GraphicType: 'POLYLINE', ReferencedFrameOfReferenceUID: SYNTHETIC.FrameOfReferenceUID,
    }));
    expect(nums.map(num => pointsOfItem(geometryOf(num)))).toEqual([CORONAL.slice(0, 2), CORONAL.slice(2, 4)]);
    expect(valuesOf(group)).toEqual([20, 12]);
    const items = asArray(nums[0].ContentSequence);
    expect(textValues(items, DRAWING_PLANE)).toEqual([record().metadata.drawingPlane]);
    expect(items.filter(item => conceptNameValue(item) === SOURCE_SERIES).map(item => item.UID)).toEqual([SYNTHETIC.SeriesInstanceUID]);
    expect(textValues(items, VIEW)).toEqual(['coronal']);
    expect(asArray(nums[1].ContentSequence).map(item => item.RelationshipType)).toEqual(['INFERRED FROM']);
  });

  it('reloads as a locked out-of-plane measurement, navigated by its Drawing-Plane, written back unchanged', () => {
    const dataset = readSR(writePatient(record()));
    const [state] = hydrate(dataset).byType.Bidirectional;
    expect(state.annotation.metadata).toMatchObject({ outOfPlane: true, isLocked: true, coordinateDomain: 'patient' });
    expect(state.annotation.data.handles.points).toEqual(CORONAL);
    const held = heldOutOfPlaneRecord(BIDIRECTIONAL, state, SYNTHETIC.StudyInstanceUID);
    expect(isOutOfPlaneMeasurement(held)).toBe(true);
    expect(held.data).toMatchObject({ longestDiameter: 20, shortestDiameter: 12 });
    expect(navigationPlaneOf(held.points, held.metadata.drawingPlane).kind).toBe('drawing-plane');

    const tool = { ...patientToolData({ ...held, uid: 'coronal' }), _id: 'coronal' };
    tool.metadata.sourceGeometry.values = { length: 20.04, width: 11.98 };
    const [rewritten] = measurementGroups(readSR(writePatient(tool, { document: reSaveOf(dataset) })));
    expect(valuesOf(rewritten)).toEqual([20.04, 11.98]);
    tool.patientPoints = [[0, 20, 30], [30, 20, 30], ...CORONAL.slice(2)];
    const [edited] = measurementGroups(readSR(writePatient(tool, { document: reSaveOf(dataset) })));
    expect(valuesOf(edited)).toEqual([30, 11.98]);
  });

  it('places a patient-domain pair without a Drawing-Plane on the image that holds it', () => {
    const tool = record({ drawingPlane: undefined, outOfPlane: undefined });
    tool.patientPoints = POINTS.map(([x, y]) => [x, y, 0]);
    const [state] = hydrate(readSR(writePatient(tool))).byType.Bidirectional;
    expect(state.annotation.metadata.outOfPlane).toBeUndefined();
    expect(state.annotation.metadata.referencedImageId).toBe(IMAGE.imageId);
    expect(state.annotation.metadata.sourceGeometry.placement).toEqual({ SOPInstanceUID: IMAGE.SOPInstanceUID, frameNumber: 1 });
  });

  it('treats a Drawing-Plane that does not hold all four points as absent, with a warning', () => {
    const dataset = readSR(writePatient(record({ drawingPlane: '1,0,0,0,1,0' })));
    const { byType, warnings } = hydrate(dataset);
    const [state] = byType.Bidirectional;
    expect(state.annotation.metadata.outOfPlane).toBeUndefined();
    expect(warnings.some(message => /malformed Drawing-Plane/.test(message))).toBe(true);
  });

  it('refuses an out-of-plane Bidirectional without a Frame of Reference or with an incomplete axis', () => {
    const refused = (tool) => {
      const codes = [];
      quiet(() => {
        try {
          writeSR({}, {
            toolState: { 'patient:2.25.1002': { [BIDIRECTIONAL]: { data: [tool] } } }, patientSeries: PATIENT_SERIES,
            onMeasurementRefused: (toolType, refusedTool, error) => codes.push(error.code),
          });
        } catch (error) {
          // a report of no measurements is not written
        }
      });
      return codes;
    };
    expect(refused({ ...record(), FrameOfReferenceUID: undefined })).toEqual(['frame-of-reference']);
    expect(refused({ ...record(), patientPoints: CORONAL.slice(0, 3) })).toEqual(['incomplete']);
  });
});


describe('documents of the other writers, when present', () => {
  // Sonador IO (oak-tree/medical-imaging/sonador-client) and the stock @cornerstonejs/adapters
  // 4.22.13 writer: each fixture, by name prefix, is checked when it is committed
  const OTHER_WRITERS = [
    'sonador-io.bidirectional-image', 'sonador-io.bidirectional-axial', 'sonador-io.bidirectional-oblique',
    'cornerstone-adapters.bidirectional-image', 'cornerstone-adapters.bidirectional-patient',
  ];

  OTHER_WRITERS.forEach(prefix => {
    const name = optionalFixture(prefix);
    (name ? it : it.skip)(`${name || prefix}: hydrates with its stored lengths and its axes point for point`, () => {
      const dataset = fixture(name);
      const groups = measurementGroups(dataset).filter(group => /:Bidirectional$/.test(trackingIdentifierOf(group)));
      expect(groups.length).toBeGreaterThan(0);
      const { byType } = hydrate(dataset);
      const states = byType.Bidirectional || [];
      expect(states).toHaveLength(groups.length);
      states.forEach((state, index) => {
        const nums = bidirectionalNumItems(numsOf(groups[index]));
        const values = state.annotation.data.recordValue.values;
        // Agreement with the writer's values: 0.01 mm per axis
        expect(Math.abs(values.length - nums.long.value)).toBeLessThan(0.01);
        expect(Math.abs(values.width - nums.short.value)).toBeLessThan(0.01);
        const graphic = [nums.long, nums.short].flatMap(({ item }) => pointsOfItem(geometryOf(item)));
        expect(state.annotation.metadata.sourceGeometry.graphicData).toEqual(graphic.flat());
        if (prefix.startsWith('cornerstone-adapters')) {
          expect(state.annotation.metadata.TrackingIdentifier).toBe('Cornerstone3DTools@^0.1.0:Bidirectional');
        }
      });
    });
  });
});


describe('Viewer-authored fixtures on the synthetic axial series', () => {
  // The synthetic CT: 64 x 48, Pixel Spacing 0.8 mm (rows) and 1.2 mm (columns), slices 3 mm apart at
  // z = 0 to 33, Image Position (-38.4, -19.2, z), axial orientation
  const slices = _.range(1, 13).map(n => fixture(`synthetic-ct/ct-${String(n).padStart(2, '0')}.dcm`));
  const CT = slices.map((slice, index) => ({ SOPInstanceUID: slice.SOPInstanceUID, imageId: `synthetic-ct-bidirectional:${index + 1}` }));
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

  // The image-domain Bidirectional on the slice at z = 9 (ct-04), both axes through patient (0, 0, 9):
  // long axis image (27.5, 17) -> (37.5, 32), patient (-6, -6, 9) -> (6, 6, 9), 12 sqrt 2 mm; short
  // axis image (34.5, 21.5) -> (30.5, 27.5), patient (2.4, -2.4, 9) -> (-2.4, 2.4, 9), 4.8 sqrt 2 mm.
  // Perpendicular in millimetres on the anisotropic pixels; lengths with no short decimal form, which
  // a DS value cut to 16 characters would not write back the same.
  const slice = CT[3];
  const IMAGE_POINTS = [[27.5, 17], [37.5, 32], [34.5, 21.5], [30.5, 27.5]];
  const [IMAGE_LENGTH, IMAGE_WIDTH] = [12 * Math.SQRT2, 4.8 * Math.SQRT2];
  const IMAGE_TOOLS = { [BIDIRECTIONAL]: [classicTool(IMAGE_POINTS, { _id: 'bidirectional-image', description: 'Bidirectional (image)' })] };

  // The Inspector turned 45 degrees between sagittal and axial (normal (1, 0, 1)/sqrt 2, up +y),
  // centred on (0, 0, 15): long axis 10 mm either side along (1, 0, -1)/sqrt 2 (20 mm), short axis
  // 6 mm either side along y (12 mm)
  const OBLIQUE = { viewPlaneNormal: [Math.SQRT1_2, 0, Math.SQRT1_2], viewUp: [0, 1, 0] };
  const along = 10 * Math.SQRT1_2;
  const OBLIQUE_POINTS = [[-along, 0, 15 + along], [along, 0, 15 - along], [0, -6, 15], [0, 6, 15]];
  const OBLIQUE_TOOLS = { [BIDIRECTIONAL]: [{
    uid: 'bidirectional-oblique', _id: 'bidirectional-oblique', toolType: BIDIRECTIONAL, patientPoints: OBLIQUE_POINTS, FrameOfReferenceUID: FOR,
    description: 'Bidirectional (oblique)',
    metadata: {
      outOfPlane: true, sourceSeries: SERIES.SeriesInstanceUID,
      drawingPlane: formatDrawingPlane(drawingPlaneOfView(OBLIQUE.viewPlaneNormal, OBLIQUE.viewUp)), views: [viewOfNormal(OBLIQUE.viewPlaneNormal)],
    },
  }] };

  const writeImage = options => write(IMAGE_TOOLS, { imageId: slice.imageId, series: CT_SERIES, headers: HEADERS, ...options }).result;
  const writeOblique = options => write({}, {
    toolState: { [SERIES_KEY]: _.mapValues(OBLIQUE_TOOLS, data => ({ data })) }, patientSeries: { [SERIES_KEY]: SERIES }, headers: HEADERS,
    ...options,
  }).result;

  it('maps the handle points through the slice plane as the fixture note states', () => {
    const module = mockImagePlanes[slice.imageId];
    [[-6, -6, 9], [6, 6, 9], [2.4, -2.4, 9], [-2.4, 2.4, 9]].forEach((expected, i) => expectPoint(imageToPatient(module, IMAGE_POINTS[i]), expected, 9));
    expect(axesProblem(IMAGE_POINTS.map(point => imageToPatient(module, point)))).toBeUndefined();
  });

  it('sonador-viewer.bidirectional-image is the Viewer writer output, byte for byte: two SCOORD POLYLINEs, 16.97 x 6.79 mm', () => {
    const bytes = writeImage();
    if (process.env.UPDATE_SR_FIXTURES) {
      fs.writeFileSync(VIEWER_IMAGE, bytes);
    }
    expect(bytes.equals(fs.readFileSync(VIEWER_IMAGE))).toBe(true);

    const dataset = readSR(bytes);
    expect(dataset.SOPClassUID).toBe(COMPREHENSIVE_3D_SR);
    const [group] = measurementGroups(dataset);
    expect(trackingIdentifierOf(group)).toBe(TRACKING_IDENTIFIER);
    const nums = numsOf(group);
    expect(nums.map(conceptOfNum)).toEqual([LONG_AXIS, SHORT_AXIS]);
    nums.forEach(num => expect(geometryOf(num)).toMatchObject({ ValueType: 'SCOORD', GraphicType: 'POLYLINE' }));
    expect(nums.map(num => pointsOfItem(geometryOf(num)))).toEqual([IMAGE_POINTS.slice(0, 2), IMAGE_POINTS.slice(2)]);
    const [length, width] = valuesOf(group);
    expect(length).toBeCloseTo(IMAGE_LENGTH, 9);
    expect(width).toBeCloseTo(IMAGE_WIDTH, 9);
    nums.forEach(num => expect(firstItem(firstItem(geometryOf(num).ContentSequence).ReferencedSOPSequence).ReferencedSOPInstanceUID)
      .toBe(slice.SOPInstanceUID));
  });

  it('sonador-viewer.bidirectional-image writes -> parses -> writes to the same bytes', () => {
    const dataset = readSR(fs.readFileSync(VIEWER_IMAGE));
    const [state] = hydrate(dataset, CT).byType.Bidirectional;
    expect(state.annotation.metadata.referencedImageId).toBe(slice.imageId);
    const rewritten = { [BIDIRECTIONAL]: [{ ...toClassicTool(state, slice.imageId), _id: 'bidirectional-image' }] };
    const bytes = write(rewritten, { imageId: slice.imageId, series: CT_SERIES, headers: HEADERS, document: reSaveOf(dataset) }).result;
    expect(bytes.equals(fs.readFileSync(VIEWER_IMAGE))).toBe(true);
  });

  it('sonador-viewer.bidirectional-oblique is the Viewer writer output, byte for byte: two SCOORD3D POLYLINEs on the 45-degree plane', () => {
    const bytes = writeOblique();
    if (process.env.UPDATE_SR_FIXTURES) {
      fs.writeFileSync(VIEWER_OBLIQUE, bytes);
    }
    expect(bytes.equals(fs.readFileSync(VIEWER_OBLIQUE))).toBe(true);

    const [group] = measurementGroups(readSR(bytes));
    const nums = numsOf(group);
    expect(nums.map(conceptOfNum)).toEqual([LONG_AXIS, SHORT_AXIS]);
    nums.forEach(num => expect(geometryOf(num)).toMatchObject({
      ValueType: 'SCOORD3D', GraphicType: 'POLYLINE', ReferencedFrameOfReferenceUID: FOR,
    }));
    // SCOORD3D coordinates are single precision
    nums.forEach((num, i) => pointsOfItem(geometryOf(num)).forEach((point, j) => expectPoint(point, OBLIQUE_POINTS[2 * i + j], 5)));
    const [length, width] = valuesOf(group);
    expect(length).toBeCloseTo(20, 9);
    expect(width).toBeCloseTo(12, 9);
    const items = asArray(nums[0].ContentSequence);
    expect(textValues(items, DRAWING_PLANE)).toEqual([OBLIQUE_TOOLS[BIDIRECTIONAL][0].metadata.drawingPlane]);
    expect(items.filter(item => conceptNameValue(item) === SOURCE_SERIES).map(item => item.UID)).toEqual([SERIES.SeriesInstanceUID]);
    expect(textValues(items, VIEW)).toEqual(['oblique']);
  });

  it('sonador-viewer.bidirectional-oblique reloads as a locked out-of-plane Bidirectional that writes back to the same bytes', () => {
    const dataset = readSR(fs.readFileSync(VIEWER_OBLIQUE));
    const [state] = hydrate(dataset, CT).byType.Bidirectional;
    expect(state.annotation.metadata).toMatchObject({ outOfPlane: true, isLocked: true, sourceSeries: SERIES.SeriesInstanceUID });
    state.annotation.data.handles.points.forEach((point, i) => expectPoint(point, OBLIQUE_POINTS[i], 5));
    expect(navigationPlaneOf(state.annotation.data.handles.points, state.annotation.metadata.drawingPlane).kind).toBe('drawing-plane');

    const record = heldOutOfPlaneRecord(BIDIRECTIONAL, state, first.StudyInstanceUID);
    const tool = { ...patientToolData({ ...record, uid: 'bidirectional-oblique' }), _id: 'bidirectional-oblique', description: 'Bidirectional (oblique)' };
    const bytes = writeOblique({
      toolState: { [SERIES_KEY]: { [BIDIRECTIONAL]: { data: [tool] } } }, document: reSaveOf(dataset),
    });
    expect(bytes.equals(fs.readFileSync(VIEWER_OBLIQUE))).toBe(true);
  });
});
