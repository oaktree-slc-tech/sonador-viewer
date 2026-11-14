// Arrow annotation DICOM-SR round trip (arrowGeometry.js): the Viewer writer (the classic adapter ->
// TID 300 -> TID 1500: a Finding carrying its geometry and properties, no NUM item), the Cornerstone3D
// hydration of the three forms in circulation, the documents written by Sonador IO and by the stock
// adapters when they are present, and the two Viewer-authored fixtures. The library adapters are loaded
// from their ESM build; only @cornerstonejs/core is replaced, by a synthetic study whose image planes
// are known.
//
// UPDATE_SR_FIXTURES=1 regenerates the Viewer-authored fixtures (sonador-viewer.arrow-*.dcm).

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
      Cornerstone: {
        MeasurementReport: load('Cornerstone/MeasurementReport.js'), Length: load('Cornerstone/Length.js'),
        ArrowAnnotate: load('Cornerstone/ArrowAnnotate.js'),
      },
      Cornerstone3D: {
        MeasurementReport: load('Cornerstone3D/MeasurementReport.js'),
        BaseAdapter3D: load('Cornerstone3D/BaseAdapter3D.js'),
        Angle: load('Cornerstone3D/Angle.js'),
        CobbAngle: load('Cornerstone3D/CobbAngle.js'),
        Length: load('Cornerstone3D/Length.js'),
        CircleROI: load('Cornerstone3D/CircleROI.js'),
        Bidirectional: load('Cornerstone3D/Bidirectional.js'),
        ArrowAnnotate: load('Cornerstone3D/ArrowAnnotate.js'),
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
import { readDicomFile } from '../utils/dicomCharacterSet';
import { asArray, conceptNameValue, firstItem } from './utils/codedConcept';
import { imageToPatient, patientToImage } from './utils/angleGeometry';
import { encodeDisplayAttributes, parseDisplayAttributes } from './utils/dcmsrDisplayAttributes';
import { encodeExtendedMeta, parseExtendedMeta } from './utils/dcmsrExtendedMeta';
import { extendedMetaOptions, NUM_PARENT_TOOLS, propertyParentOf, textFieldOf } from './utils/propertyParent';
import { omittedMeasurement, saveResultSummary } from './utils/saveResult';
import { documentSettings } from './utils/srDocument';
import { SonadorCodeValues } from './enums';
import { drawingPlaneOfView, formatDrawingPlane, navigationPlaneOf } from './utils/drawingPlane';
import { heldOutOfPlaneRecord, isOutOfPlaneMeasurement, OUT_OF_PLANE_TOOLS, patientToolData } from './utils/outOfPlane';
import { viewOfNormal } from './utils/measurementView';
import {
  arrowDisplayText, arrowGeometryOf, arrowLabelOf, arrowLength, derivedImageTail, isNonAscii,
} from './utils/arrowGeometry';

const { DicomDict, DicomMessage, DicomMetaDictionary } = dcmjsData;

const FIXTURES = path.join(__dirname, '__fixtures__');
const VIEWER_IMAGE = path.join(FIXTURES, 'sonador-viewer.arrow-image.2026-1114.dcm');
const VIEWER_OBLIQUE = path.join(FIXTURES, 'sonador-viewer.arrow-oblique.2026-1114.dcm');
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
const DRAWING_PLANE = SonadorCodeValues.DCMSR_MEASUREMENT_DRAWING_PLANE.value;
const SOURCE_SERIES = SonadorCodeValues.DCMSR_MEASUREMENT_SOURCE_SERIES.value;

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
  description: 'Arrow description',
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
    jest.spyOn(DicomMetaDictionary, 'date').mockImplementation(() => '20261114'),
    jest.spyOn(DicomMetaDictionary, 'time').mockImplementation(() => '120000'),
    jest.spyOn(DicomMetaDictionary, 'dateTime').mockImplementation(() => '20261114120000'),
  ];
  try {
    return fn();
  } finally {
    spies.forEach(spy => spy.mockRestore());
  }
}

function quiet(fn) {
  const spies = ['log', 'debug', 'info', 'warn'].map(level => jest.spyOn(console, level).mockImplementation(() => {}));
  // The core log module's info, which the adapters report the legacy forms they read through
  spies.push(jest.spyOn(jest.requireActual('../log').default, 'info').mockImplementation(() => {}));
  try {
    return { result: fn(), warnings: spies[3].mock.calls.map(call => call.join(' ')), infos: [...spies[2].mock.calls, ...spies[4].mock.calls].map(call => call.join(' ')) };
  } finally {
    spies.forEach(spy => spy.mockRestore());
  }
}

// As the Viewer reads a report (utils/dicomCharacterSet.js): the text of a UTF-8 document's sequence
// items decoded as UTF-8
const readSR = buffer => {
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return DicomMetaDictionary.naturalizeDataset(readDicomFile(arrayBuffer).dict);
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
      const { propertyParent, textField } = extendedMetaOptions(toolType);
      encodeExtendedMeta(tool, srItem, { propertyParent, textField });
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
  const { result, warnings, infos } = quiet(() => MeasurementReport3D.generateToolState(dataset, imageIds, c3dMetaData, undefined, {
    onContentItemParse: (toolType, annotation, srItem) => {
      const { propertyParent, textField } = extendedMetaOptions(toolType);
      parseExtendedMeta(srItem, annotation, { propertyParent, textField });
      parseDisplayAttributes(srItem, annotation, { propertyParent });
    },
  }));
  return { byType: result, warnings, infos };
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
const geometryOf = num => asArray(num.ContentSequence).find(item => item.RelationshipType === 'INFERRED FROM');
const pointsOfItem = item => _.chunk(Array.from(item.GraphicData, Number), item.ValueType === 'SCOORD3D' ? 3 : 2);
const expectPoint = (point, expected, digits = 5) => expected.forEach((value, i) => expect(point[i]).toBeCloseTo(value, digits));


const TEXT = SonadorCodeValues.DCMSR_MEASUREMENT_TEXT.value;
const LOCATION = SonadorCodeValues.DCMSR_MEASUREMENT_LOCATION.value;
const FINDING = '121071';

const ARROW = 'ArrowAnnotate';
const TRACKING_IDENTIFIER = 'cornerstoneTools@^4.0.0:ArrowAnnotate';

// The arrow's text, its Sonador-Measurement.Description, .Text and .Location: four values, independent
const LABEL = 'Lesion margin';
const FIELDS = { description: 'Arrow description', measurementText: 'Arrow measurement text', location: 'Arrow location' };
const LINE_TEXT = { Color: { Line: '#C81E28', Text: '#FAFA0A' } };

function classicTool([tip, tail], extra = {}) {
  // A cornerstone-tools arrow as the classic mapping hands it to the writer: the text in `text`
  // (its label), Sonador-Measurement.Text in `metadata.measurementText`
  const { metadata, ...rest } = extra;
  return {
    _id: extra._id || `arrow-${[tip, tail].map(p => p.join(',')).join(';')}`,
    handles: { start: { x: tip[0], y: tip[1] }, end: { x: tail[0], y: tail[1] }, textBox: {} },
    text: LABEL,
    description: FIELDS.description,
    displayAttributes: LINE_TEXT,
    ...rest,
    metadata: { measurementText: FIELDS.measurementText, location: FIELDS.location, ...(metadata || {}) },
  };
}

function toClassicTool(state, imageId, _id = 'hydrated-arrow') {
  // The Cornerstone3D -> cornerstone-tools bridge (createRenderVersion, the classic ArrowAnnotate
  // mapping): world points to image points of the referenced image, the text shown, the hydrated
  // identity and properties carried along
  const { annotation } = state;
  const module = mockImagePlanes[imageId || annotation.metadata.referencedImageId];
  const [tip, tail] = annotation.data.handles.points.map(point => patientToImage(module, point));
  return {
    _id,
    handles: { start: { x: tip[0], y: tip[1] }, end: { x: tail[0], y: tail[1] }, textBox: {} },
    text: annotation.data.text,
    description: state.description,
    displayAttributes: annotation.data.displayAttributes,
    metadata: _.pick(annotation.metadata,
      'TrackingUniqueIdentifier', 'TrackingIdentifier', 'coordinateDomain', 'views', 'measurementText', 'location', 'sourceGeometry',
      'sourceSeries', 'drawingPlane', 'finding', 'codedFinding'),
  };
}

const findingOf = group => asArray(group.ContentSequence).find(item => conceptNameValue(item) === FINDING);
const findingCodeOf = group => firstItem(findingOf(group).ConceptCodeSequence);
const arrowGeometryItemOf = group => asArray(findingOf(group).ContentSequence).find(item => item.RelationshipType === 'INFERRED FROM');
const propertiesOf = group => asArray(findingOf(group).ContentSequence).filter(item => item.RelationshipType === 'HAS PROPERTIES');

// An arrow on the synthetic image: tip (10.5, 20.5), tail (30.5, 40.5)
const TIP_TAIL = [[10.5, 20.5], [30.5, 40.5]];
const written = (extra, options) => readSR(write({ [ARROW]: [classicTool(TIP_TAIL, { _id: 'arrow-1', ...extra })] }, options).result);

// The stock arrow marker: a NUM (111010, DCM) of value 0, unit 1, around the geometry
const carrierNum = (geometry, meaning = 'label', value = 0) => ({
  RelationshipType: 'CONTAINS', ValueType: 'NUM',
  ConceptNameCodeSequence: [{ CodeValue: '111010', CodingSchemeDesignator: 'DCM', CodeMeaning: meaning }],
  MeasuredValueSequence: [{ NumericValue: value, MeasurementUnitsCodeSequence: [{ CodeValue: '1', CodingSchemeDesignator: 'UCUM', CodeMeaning: 'no units' }] }],
  ContentSequence: [geometry],
});

// The two legacy forms, made from a Viewer-written arrow: the geometry moved under a NUM
function legacy(dataset, form) {
  const [group] = measurementGroups(dataset);
  const finding = findingOf(group);
  const geometry = arrowGeometryItemOf(group);
  finding.ContentSequence = asArray(finding.ContentSequence).filter(item => item !== geometry);
  const [tip] = pointsOfItem(geometry);
  const carried = form === 'point'
    ? { ...geometry, GraphicType: 'POINT', GraphicData: tip }
    : geometry;
  group.ContentSequence = [...asArray(group.ContentSequence), carrierNum(carried, form === 'point' ? 'Center' : 'label')];
  return dataset;
}


describe('arrow geometry', () => {
  it('reads the geometry under the Finding, else under a legacy NUM, and the text of a free-text Finding', () => {
    const [group] = measurementGroups(written());
    expect(arrowGeometryOf(group.ContentSequence)).toMatchObject({ carrier: 'finding', item: { GraphicType: 'POLYLINE' } });
    expect(arrowLabelOf(group.ContentSequence)).toMatchObject({ label: LABEL, coded: false, source: 'finding' });
    const [old] = measurementGroups(legacy(written(), 'point'));
    expect(arrowGeometryOf(old.ContentSequence)).toMatchObject({ carrier: 'num', item: { GraphicType: 'POINT' } });
  });

  it('keeps a coded finding apart from the text, and reads a free-text Finding Site', () => {
    const coded = { CodeValue: '52988006', CodingSchemeDesignator: 'SCT', CodeMeaning: 'Lesion' };
    expect(arrowLabelOf([{ ValueType: 'CODE', ConceptNameCodeSequence: { CodeValue: FINDING, CodingSchemeDesignator: 'DCM' }, ConceptCodeSequence: coded }]))
      .toEqual({ label: '', finding: coded, coded: true, source: 'finding' });
    const site = { ValueType: 'CODE', ConceptNameCodeSequence: { CodeValue: '363698007', CodingSchemeDesignator: 'SCT' },
      ConceptCodeSequence: { CodeValue: 'CORNERSTONEFREETEXT', CodingSchemeDesignator: 'CST4', CodeMeaning: 'From the site' } };
    expect(arrowLabelOf([site])).toMatchObject({ label: 'From the site', source: 'finding-site' });
    expect(arrowDisplayText('', coded)).toBe('Lesion');
    expect(arrowDisplayText(LABEL, coded)).toBe(LABEL);
  });

  it('derives the tail of a tip-only arrow a tenth of the image away, and measures tip to tail', () => {
    expect(derivedImageTail([10, 20], { columns: 64, rows: 48 })).toEqual([16.4, 24.8]);
    expect(derivedImageTail([10, 20])).toEqual([20, 30]);
    expect(arrowLength([0, 0, 0], [3, 4, 0])).toBe(5);
    expect(isNonAscii('Läsion')).toBe(true);
    expect(isNonAscii('Lesion')).toBe(false);
  });

  it('is a Finding-parent tool with its own text field, and an out-of-plane tool', () => {
    expect(propertyParentOf(ARROW)).toBe('finding');
    expect(NUM_PARENT_TOOLS).not.toContain(ARROW);
    expect(textFieldOf(ARROW)).toBe('measurementText');
    expect(textFieldOf('Length')).toBe('text');
    expect(OUT_OF_PLANE_TOOLS).toContain(ARROW);
  });
});


describe('the text of a saved arrow is read back (it was lost on the stock save path)', () => {
  // The arrow as the save path hands it to the writer once its text prompt is done: the text in
  // `text`, never `label` (the stock classic adapter writes the Finding from `label`)
  const promptDone = { _id: 'arrow-prompt', handles: { start: { x: 10.5, y: 20.5 }, end: { x: 30.5, y: 40.5 }, textBox: {} }, text: LABEL };

  it('the stock classic adapter writes the Finding from `label`: an arrow whose text is in `text` has none', () => {
    const StockArrow = jest.requireActual('../../../../node_modules/@cornerstonejs/adapters/dist/esm/adapters/Cornerstone/ArrowAnnotate.js').default;
    const args = StockArrow.getTID300RepresentationArguments(promptDone);
    expect(args.finding).toEqual({ CodeValue: 'CORNERSTONEFREETEXT', CodingSchemeDesignator: 'CST4', CodeMeaning: undefined });
    expect(args.points).toHaveLength(2);
  });

  it('writes and reads back the text, the description, the text property and the location, after an edit as well', () => {
    const tool = { ...promptDone, description: FIELDS.description, metadata: { measurementText: FIELDS.measurementText, location: FIELDS.location } };
    const dataset = readSR(write({ [ARROW]: [tool] }).result);
    const [group] = measurementGroups(dataset);
    expect(findingCodeOf(group)).toMatchObject({ LongCodeValue: 'CORNERSTONEFREETEXT', CodingSchemeDesignator: 'CST4', CodeMeaning: LABEL });

    // Save, reload: four independent values
    const [state] = hydrate(dataset).byType.ArrowAnnotate;
    expect(state.annotation.data.text).toBe(LABEL);
    expect(state.description).toBe(FIELDS.description);
    expect(state.annotation.metadata).toMatchObject({ measurementText: FIELDS.measurementText, location: FIELDS.location });
    expect(state.annotation.metadata.text).toBeUndefined();

    // A further edit of the text, a second save and reload
    const edited = { ...toClassicTool(state, IMAGE.imageId), text: 'Lesion margin, revised' };
    const reloaded = readSR(write({ [ARROW]: [edited] }, { document: reSaveOf(dataset) }).result);
    const [again] = hydrate(reloaded).byType.ArrowAnnotate;
    expect(again.annotation.data.text).toBe('Lesion margin, revised');
    expect(again.description).toBe(FIELDS.description);
    expect(again.annotation.metadata).toMatchObject({ measurementText: FIELDS.measurementText, location: FIELDS.location });
    expect(trackingUIDOf(measurementGroups(reloaded)[0])).toBe(trackingUIDOf(group));
  });
});


describe('Viewer writer: image domain', () => {
  it('writes one Finding carrying the free text, the POLYLINE tip then tail from the image, and the properties; no NUM', () => {
    const [group] = measurementGroups(written());
    expect(trackingIdentifierOf(group)).toBe(TRACKING_IDENTIFIER);
    expect(numsOf(group)).toEqual([]);
    expect(asArray(group.ContentSequence).filter(item => conceptNameValue(item) === FINDING)).toHaveLength(1);
    expect(findingCodeOf(group)).toMatchObject({ LongCodeValue: 'CORNERSTONEFREETEXT', CodingSchemeDesignator: 'CST4', CodeMeaning: LABEL });

    const geometry = arrowGeometryItemOf(group);
    expect(geometry).toMatchObject({ ValueType: 'SCOORD', GraphicType: 'POLYLINE' });
    expect(pointsOfItem(geometry)).toEqual(TIP_TAIL);
    const image = firstItem(geometry.ContentSequence);
    expect(image).toMatchObject({ RelationshipType: 'SELECTED FROM', ValueType: 'IMAGE' });
    expect(firstItem(image.ReferencedSOPSequence).ReferencedSOPInstanceUID).toBe(IMAGE.SOPInstanceUID);

    // The properties and colours under the Finding; the text property is not a copy of the label
    const properties = propertiesOf(group);
    expect(textValues(properties, DESCRIPTION)).toEqual([FIELDS.description]);
    expect(textValues(properties, TEXT)).toEqual([FIELDS.measurementText]);
    expect(textValues(properties, LOCATION)).toEqual([FIELDS.location]);
    expect(properties.some(item => conceptNameValue(item) === DISPLAY)).toBe(true);
    expect(asArray(group.ContentSequence).filter(item => item.RelationshipType === 'HAS PROPERTIES')).toEqual([]);
  });

  it('writes no text property when the arrow has none: the label is never copied into it', () => {
    const [group] = measurementGroups(written({ metadata: { measurementText: undefined } }));
    expect(textValues(propertiesOf(group), TEXT)).toEqual([]);
    expect(findingCodeOf(group).CodeMeaning).toBe(LABEL);
  });

  it('writes the text verbatim, above 64 characters and outside ASCII, under ISO_IR 192; an ASCII document has no character set', () => {
    const long = 'Spiculated margin extending toward the pleura, with a satellite nodule — Läsion, 肺';
    expect(long.length).toBeGreaterThan(64);
    const dataset = written({ text: long });
    expect(findingCodeOf(measurementGroups(dataset)[0]).CodeMeaning).toBe(long);
    expect(dataset.SpecificCharacterSet).toBe('ISO_IR 192');
    const [state] = hydrate(dataset).byType.ArrowAnnotate;
    expect(state.annotation.data.text).toBe(long);

    expect(written().SpecificCharacterSet).toBeUndefined();
    // A description outside ASCII sets it as well, for the whole document
    expect(written({ description: 'Beschreibung über' }).SpecificCharacterSet).toBe('ISO_IR 192');
  });

  it('writes an arrow on an image without pixel spacing in the image domain, measured in pixels', () => {
    const [group] = measurementGroups(written(undefined, { imagePlaneModule: null }));
    expect(pointsOfItem(arrowGeometryItemOf(group))).toEqual(TIP_TAIL);
  });

  it('refuses an arrow without a text, with tip and tail together, or incomplete, with the reason and what to do', () => {
    const refusals = tool => refusalsOf({ [ARROW]: [tool] }).map(([t, c]) => [t, c]);
    const empty = classicTool(TIP_TAIL, { text: '' });
    expect(refusals(empty)).toEqual([[ARROW, 'text']]);
    const degenerate = classicTool([[10.5, 20.5], [10.5, 20.505]]);
    const refused = refusalsOf({ [ARROW]: [degenerate] });
    expect(refused.map(([t, c]) => [t, c])).toEqual([[ARROW, 'degenerate']]);
    // The guidance names no unit: 0.005 mm apart on a calibrated image, 0.005 pixels on one without spacing
    const uncalibrated = refusalsOf({ [ARROW]: [degenerate] }, { imagePlaneModule: null });
    expect(uncalibrated.map(([t, c]) => [t, c])).toEqual([[ARROW, 'degenerate']]);
    expect(refused[0][2].message).toMatch(/0\.01 mm$/);
    expect(uncalibrated[0][2].message).toMatch(/0\.01 pixels$/);
    [refused, uncalibrated].forEach(([[, , error]]) => expect(saveResultSummary([omittedMeasurement(ARROW, degenerate, error)]).message)
      .toBe(`Data persisted. One measurement was not saved. Arrow "${LABEL}": move its tip and tail farther apart.`));
    // An arrow without a label: the label is named, not the Text property
    expect(saveResultSummary([omittedMeasurement(ARROW, empty, refusalsOf({ [ARROW]: [empty] })[0][2])]).message)
      .toBe(`Data persisted. One measurement was not saved. Arrow "${FIELDS.description}": type its label, the text shown at the arrow (not its Text property).`);
    const incomplete = { ...classicTool(TIP_TAIL), handles: { start: { x: 1, y: 2 } } };
    expect(refusals(incomplete)).toEqual([[ARROW, 'incomplete']]);
  });
});


describe('hydration', () => {
  it('hydrates a Viewer-written arrow locked, tip then tail in patient coordinates, with its text and properties', () => {
    const { byType, warnings } = hydrate(written());
    expect(warnings).toEqual([]);
    const [state] = byType.ArrowAnnotate;
    const { annotation } = state;
    // The synthetic image maps image (x, y) to patient (x, y, 0)
    expect(annotation.data.handles).toMatchObject({ arrowFirst: true, points: TIP_TAIL.map(([x, y]) => [x, y, 0]) });
    expect(annotation.data.text).toBe(LABEL);
    expect(annotation.metadata).toMatchObject({
      isLocked: true, isReadOnly: true, coordinateDomain: 'image', TrackingIdentifier: TRACKING_IDENTIFIER, referencedImageId: IMAGE.imageId,
      measurementText: FIELDS.measurementText, location: FIELDS.location,
    });
    expect(annotation.metadata.sourceGeometry).toMatchObject({
      valueType: 'SCOORD', graphicType: 'POLYLINE', graphicData: TIP_TAIL.flat(), carrier: 'finding', ReferencedSOPInstanceUID: IMAGE.SOPInstanceUID,
    });
    expect(annotation.metadata.codedFinding).toBeUndefined();
    // The description is the arrow's, never the Finding's meaning
    expect(state.description).toBe(FIELDS.description);
    expect(annotation.data.displayAttributes).toEqual(LINE_TEXT);
  });

  it('reads the Cornerstone3D tracking identifier prefix as well, and keeps the identifier read on re-save', () => {
    const dataset = written();
    const [group] = measurementGroups(dataset);
    child(group, CODES.TrackingIdentifier).TextValue = 'Cornerstone3DTools@^0.1.0:ArrowAnnotate';
    const [state] = hydrate(dataset).byType.ArrowAnnotate;
    expect(state.annotation.metadata.TrackingIdentifier).toBe('Cornerstone3DTools@^0.1.0:ArrowAnnotate');
    const [rewritten] = measurementGroups(readSR(write({ [ARROW]: [toClassicTool(state, IMAGE.imageId)] }, { document: reSaveOf(dataset) }).result));
    expect(trackingIdentifierOf(rewritten)).toBe('Cornerstone3DTools@^0.1.0:ArrowAnnotate');
    expect(trackingUIDOf(rewritten)).toBe(trackingUIDOf(group));
  });

  it('reads an empty text with a warning and writes it back as read', () => {
    const dataset = written();
    delete findingCodeOf(measurementGroups(dataset)[0]).CodeMeaning;
    const { byType, warnings } = hydrate(dataset);
    const [state] = byType.ArrowAnnotate;
    expect(state.annotation.data.text).toBe('');
    expect(warnings.some(message => /\[DICOM-SR:ArrowAnnotate\] arrow without a text/.test(message))).toBe(true);
    const [rewritten] = measurementGroups(readSR(write({ [ARROW]: [toClassicTool(state, IMAGE.imageId)] }, { document: reSaveOf(dataset) }).result));
    expect(findingCodeOf(rewritten)).toMatchObject({ LongCodeValue: 'CORNERSTONEFREETEXT' });
    expect(findingCodeOf(rewritten).CodeMeaning).toBeUndefined();
  });

  it('keeps a coded finding apart from the text and writes it back verbatim', () => {
    const dataset = written();
    const coded = { CodeValue: '52988006', CodingSchemeDesignator: 'SCT', CodingSchemeVersion: '2024-09', CodeMeaning: 'Lesion' };
    findingOf(measurementGroups(dataset)[0]).ConceptCodeSequence = [coded];
    const [state] = hydrate(dataset).byType.ArrowAnnotate;
    // The annotation shows the finding's meaning; the record marks the coded finding
    expect(state.annotation.data.text).toBe('Lesion');
    expect(state.annotation.metadata.codedFinding).toMatchObject(_.omit(coded, []));
    expect(state.description).toBe(FIELDS.description);
    const [rewritten] = measurementGroups(readSR(write({ [ARROW]: [toClassicTool(state, IMAGE.imageId)] }, { document: reSaveOf(dataset) }).result));
    expect(_.pick(findingCodeOf(rewritten), 'CodeValue', 'CodingSchemeDesignator', 'CodingSchemeVersion', 'CodeMeaning')).toEqual(coded);
    // An arrow given a text of its own becomes a free-text finding
    const retexted = { ...toClassicTool(state, IMAGE.imageId), text: 'My note' };
    const [free] = measurementGroups(readSR(write({ [ARROW]: [retexted] }, { document: reSaveOf(dataset) }).result));
    expect(findingCodeOf(free)).toMatchObject({ LongCodeValue: 'CORNERSTONEFREETEXT', CodeMeaning: 'My note' });
  });

  it('reads the text from a free-text Finding Site, with a warning', () => {
    const dataset = written();
    const [group] = measurementGroups(dataset);
    const finding = findingOf(group);
    group.ContentSequence = [
      ...asArray(group.ContentSequence).filter(item => item !== finding),
      { ...finding, ConceptNameCodeSequence: [{ CodeValue: '363698007', CodingSchemeDesignator: 'SCT', CodeMeaning: 'Finding Site' }] },
    ];
    // The geometry under the stock marker once its Finding is gone
    group.ContentSequence.push(carrierNum(arrowGeometryOf([finding]).item));
    const { byType, warnings } = hydrate(dataset);
    expect(byType.ArrowAnnotate[0].annotation.data.text).toBe(LABEL);
    expect(warnings.some(message => /text read from a free-text Finding Site/.test(message))).toBe(true);
  });

  it('hydrates degenerate geometry with a warning, and refuses it on a re-save', () => {
    const dataset = written();
    arrowGeometryItemOf(measurementGroups(dataset)[0]).GraphicData = [10.5, 20.5, 10.5, 20.505];
    const { byType, warnings } = hydrate(dataset);
    expect(warnings.some(message => /degenerate arrow/.test(message))).toBe(true);
    const [state] = byType.ArrowAnnotate;
    // Unchanged, the stored geometry is still refused: tip and tail are 0.005 mm apart
    const moved = toClassicTool(state, IMAGE.imageId);
    moved.handles.end = { x: 10.5, y: 20.506 };
    expect(refusalsOf({ [ARROW]: [moved] }, { document: reSaveOf(dataset) }).map(([t, c]) => [t, c])).toEqual([[ARROW, 'degenerate']]);
  });

  it('does not hydrate a group without a two-point POLYLINE or a one-point POINT', () => {
    const dataset = written();
    arrowGeometryItemOf(measurementGroups(dataset)[0]).GraphicData = [1, 2, 3, 4, 5, 6];
    expect(hydrate(dataset).byType.ArrowAnnotate).toBeUndefined();
  });
});


describe('legacy forms', () => {
  it('hydrates the Viewer form (NUM "Center" around a POINT): the tip as read, a derived tail, written back as a POINT under the Finding', () => {
    const dataset = legacy(written(), 'point');
    const { byType, infos } = hydrate(dataset);
    const [state] = byType.ArrowAnnotate;
    const { points } = state.annotation.data.handles;
    expect(points[0]).toEqual([10.5, 20.5, 0]);
    expect(points[1]).toEqual([20.5, 30.5, 0]);
    expect(state.annotation.data.text).toBe(LABEL);
    expect(state.annotation.metadata.sourceGeometry).toMatchObject({ graphicType: 'POINT', carrier: 'num', derivedTail: [20.5, 30.5] });
    expect(infos.some(message => /legacy geometry \(under a NUM item\)/.test(message))).toBe(true);

    // Unchanged: no NUM, a POINT under the Finding, the identifier and label as read
    const [rewritten] = measurementGroups(readSR(write({ [ARROW]: [toClassicTool(state, IMAGE.imageId)] }, { document: reSaveOf(dataset) }).result));
    expect(numsOf(rewritten)).toEqual([]);
    expect(arrowGeometryItemOf(rewritten)).toMatchObject({ ValueType: 'SCOORD', GraphicType: 'POINT', GraphicData: [10.5, 20.5] });
    expect(findingCodeOf(rewritten).CodeMeaning).toBe(LABEL);
    expect(trackingUIDOf(rewritten)).toBe(trackingUIDOf(measurementGroups(dataset)[0]));

    // A handle moved: both points, as a POLYLINE
    const moved = toClassicTool(state, IMAGE.imageId);
    moved.handles.end = { x: 25.5, y: 35.5 };
    const [edited] = measurementGroups(readSR(write({ [ARROW]: [moved] }, { document: reSaveOf(dataset) }).result));
    expect(arrowGeometryItemOf(edited)).toMatchObject({ GraphicType: 'POLYLINE' });
    expect(pointsOfItem(arrowGeometryItemOf(edited))).toEqual([[10.5, 20.5], [25.5, 35.5]]);
  });

  it('hydrates the stock Cornerstone3D form (NUM "label" around a POLYLINE) and re-saves it under the Finding with its points verbatim', () => {
    const dataset = legacy(written(), 'polyline');
    const [group] = measurementGroups(dataset);
    child(group, CODES.TrackingIdentifier).TextValue = 'Cornerstone3DTools@^0.1.0:ArrowAnnotate';
    const [state] = hydrate(dataset).byType.ArrowAnnotate;
    expect(state.annotation.metadata.sourceGeometry).toMatchObject({ graphicType: 'POLYLINE', carrier: 'num' });
    const [rewritten] = measurementGroups(readSR(write({ [ARROW]: [toClassicTool(state, IMAGE.imageId)] }, { document: reSaveOf(dataset) }).result));
    expect(numsOf(rewritten)).toEqual([]);
    expect(trackingIdentifierOf(rewritten)).toBe('Cornerstone3DTools@^0.1.0:ArrowAnnotate');
    expect(pointsOfItem(arrowGeometryItemOf(rewritten))).toEqual(TIP_TAIL);
    expect(findingCodeOf(rewritten).CodeMeaning).toBe(LABEL);
  });
});


describe('patient domain and out-of-plane', () => {
  const PATIENT_SERIES = { 'patient:2.25.1002': { StudyInstanceUID: SYNTHETIC.StudyInstanceUID, SeriesInstanceUID: SYNTHETIC.SeriesInstanceUID, instances: [] } };
  // An arrow on the coronal plane y = 20: tip (10, 20, 30), tail (20, 20, 40)
  const CORONAL = [[10, 20, 30], [20, 20, 40]];
  const record = (metadata = {}) => ({
    uid: 'coronal', _id: 'coronal', toolType: ARROW, patientPoints: CORONAL, FrameOfReferenceUID: SYNTHETIC.FrameOfReferenceUID,
    text: LABEL, description: FIELDS.description,
    metadata: {
      outOfPlane: true, sourceSeries: SYNTHETIC.SeriesInstanceUID, drawingPlane: formatDrawingPlane(drawingPlaneOfView([0, 1, 0], [0, 0, 1])),
      views: ['coronal'], measurementText: FIELDS.measurementText, location: FIELDS.location, ...metadata,
    },
  });
  const writePatient = (tool, options = {}) => write({}, {
    toolState: { 'patient:2.25.1002': { [ARROW]: { data: [tool] } } }, patientSeries: PATIENT_SERIES, ...options,
  }).result;

  it('writes a SCOORD3D POLYLINE under the Finding with the Frame of Reference, the Drawing-Plane, Source-Series and View', () => {
    const [group] = measurementGroups(readSR(writePatient(record())));
    expect(numsOf(group)).toEqual([]);
    expect(arrowGeometryItemOf(group)).toMatchObject({
      ValueType: 'SCOORD3D', GraphicType: 'POLYLINE', ReferencedFrameOfReferenceUID: SYNTHETIC.FrameOfReferenceUID,
    });
    expect(pointsOfItem(arrowGeometryItemOf(group))).toEqual(CORONAL);
    const properties = propertiesOf(group);
    expect(textValues(properties, DRAWING_PLANE)).toEqual([record().metadata.drawingPlane]);
    expect(properties.filter(item => conceptNameValue(item) === SOURCE_SERIES).map(item => item.UID)).toEqual([SYNTHETIC.SeriesInstanceUID]);
    expect(textValues(properties, VIEW)).toEqual(['coronal']);
    expect(textValues(properties, TEXT)).toEqual([FIELDS.measurementText]);
    expect(findingCodeOf(group).CodeMeaning).toBe(LABEL);
  });

  it('reloads as a locked out-of-plane arrow with its text and no value, navigated by its Drawing-Plane, written back unchanged', () => {
    const dataset = readSR(writePatient(record()));
    const [state] = hydrate(dataset).byType.ArrowAnnotate;
    expect(state.annotation.metadata).toMatchObject({ outOfPlane: true, isLocked: true, coordinateDomain: 'patient' });
    expect(state.annotation.data.handles.points).toEqual(CORONAL);
    const held = heldOutOfPlaneRecord(ARROW, state, SYNTHETIC.StudyInstanceUID);
    expect(isOutOfPlaneMeasurement(held)).toBe(true);
    expect(held).toMatchObject({ label: LABEL, metadata: { measurementText: FIELDS.measurementText, location: FIELDS.location } });
    expect(held.value).toBeUndefined();
    expect(held.length).toBeUndefined();
    expect(navigationPlaneOf(held.points, held.metadata.drawingPlane).kind).toBe('drawing-plane');

    const tool = { ...patientToolData({ ...held, uid: 'coronal' }), _id: 'coronal', description: state.description };
    expect(tool.text).toBe(LABEL);
    const [rewritten] = measurementGroups(readSR(writePatient(tool, { document: reSaveOf(dataset) })));
    expect(pointsOfItem(arrowGeometryItemOf(rewritten))).toEqual(CORONAL);
    expect(findingCodeOf(rewritten).CodeMeaning).toBe(LABEL);
    expect(trackingUIDOf(rewritten)).toBe(trackingUIDOf(measurementGroups(dataset)[0]));
  });

  it('places a patient-domain arrow without a Drawing-Plane on the image that holds it, and writes it back unchanged', () => {
    const tool = record({ drawingPlane: undefined, outOfPlane: undefined });
    tool.patientPoints = [[10, 20, 0], [30, 40, 0]];
    const dataset = readSR(writePatient(tool));
    const [state] = hydrate(dataset).byType.ArrowAnnotate;
    expect(state.annotation.metadata.outOfPlane).toBeUndefined();
    expect(state.annotation.metadata.referencedImageId).toBe(IMAGE.imageId);
    expect(state.annotation.metadata.sourceGeometry.placement).toEqual({ SOPInstanceUID: IMAGE.SOPInstanceUID, frameNumber: 1 });
    const [rewritten] = measurementGroups(readSR(write({ [ARROW]: [toClassicTool(state, IMAGE.imageId)] }, { document: reSaveOf(dataset) }).result));
    expect(arrowGeometryItemOf(rewritten)).toMatchObject({ ValueType: 'SCOORD3D', GraphicType: 'POLYLINE' });
    expect(pointsOfItem(arrowGeometryItemOf(rewritten))).toEqual([[10, 20, 0], [30, 40, 0]]);
  });

  it('treats a Drawing-Plane that does not hold both points as absent, with a warning', () => {
    const { byType, warnings } = hydrate(readSR(writePatient(record({ drawingPlane: '1,0,0,0,1,0' }))));
    expect(byType.ArrowAnnotate[0].annotation.metadata.outOfPlane).toBeUndefined();
    expect(warnings.some(message => /malformed Drawing-Plane/.test(message))).toBe(true);
  });

  it('refuses an out-of-plane arrow without a Frame of Reference, with one point, or without a text', () => {
    const codes = tool => refusalsOf({}, { toolState: { 'patient:2.25.1002': { [ARROW]: { data: [tool] } } }, patientSeries: PATIENT_SERIES })
      .map(([, code]) => code);
    expect(codes({ ...record(), FrameOfReferenceUID: undefined })).toEqual(['frame-of-reference']);
    expect(codes({ ...record(), patientPoints: CORONAL.slice(0, 1) })).toEqual(['incomplete']);
    expect(codes({ ...record(), text: '' })).toEqual(['text']);
  });
});


describe('document kinds', () => {
  it('hydrates an exchange document\'s arrow; leaves an application document\'s to the read-only display', () => {
    const exchange = written();
    expect(firstItem(exchange.ConceptNameCodeSequence)).toMatchObject({ CodeValue: '126000', CodingSchemeDesignator: 'DCM' });
    expect(hydrate(exchange).byType.ArrowAnnotate).toHaveLength(1);

    const application = written();
    application.ConceptNameCodeSequence = [{ CodeValue: 'Sonador-SR.Report', CodingSchemeDesignator: 'Sonador-SR', CodeMeaning: 'Sonador report' }];
    const { byType, infos } = hydrate(application);
    expect(byType.ArrowAnnotate).toBeUndefined();
    expect(infos.some(message => /application document, ArrowAnnotate group not hydrated/.test(message))).toBe(true);
  });
});


describe('a mixed document', () => {
  it('writes an arrow beside a Length, each with its own properties under its own parent, and reads both back', () => {
    const length = {
      _id: 'length-1', handles: { start: { x: 1.5, y: 1.5 }, end: { x: 11.5, y: 1.5 } }, length: 10,
      description: 'Length description', metadata: { text: 'Length text' },
    };
    const dataset = readSR(write({ [ARROW]: [classicTool(TIP_TAIL, { _id: 'arrow-1' })], Length: [length] }).result);
    const groups = measurementGroups(dataset);
    expect(groups.map(trackingIdentifierOf).sort()).toEqual([TRACKING_IDENTIFIER, 'cornerstoneTools@^4.0.0:Length']);
    const { byType } = hydrate(dataset);
    expect(byType.ArrowAnnotate[0].annotation.metadata.measurementText).toBe(FIELDS.measurementText);
    expect(byType.Length[0].annotation.metadata.text).toBe('Length text');
  });
});


describe('re-save and reading checks', () => {
  const codesOf = refused => refused.map(([, code]) => code);
  const PATIENT_SERIES = { 'patient:2.25.1002': { StudyInstanceUID: SYNTHETIC.StudyInstanceUID, SeriesInstanceUID: SYNTHETIC.SeriesInstanceUID, instances: [] } };
  const patientState = tool => ({ 'patient:2.25.1002': { [ARROW]: { data: [tool] } } });
  const patientRecord = (patientPoints, metadata = {}) => ({
    uid: 'patient-arrow', _id: 'patient-arrow', toolType: ARROW, patientPoints, FrameOfReferenceUID: SYNTHETIC.FrameOfReferenceUID,
    text: LABEL, description: FIELDS.description, metadata: { sourceSeries: SYNTHETIC.SeriesInstanceUID, ...metadata },
  });
  const writePatient = (tool, options = {}) => readSR(write({}, { toolState: patientState(tool), patientSeries: PATIENT_SERIES, ...options }).result);
  const reSave = (dataset, state, options) => readSR(write({ [ARROW]: [toClassicTool(state, IMAGE.imageId)] }, { document: reSaveOf(dataset), ...options }).result);

  it('refuses unchanged degenerate geometry: image domain in mm and in pixels, patient domain on its image and held off-plane', () => {
    const image = written();
    arrowGeometryItemOf(measurementGroups(image)[0]).GraphicData = [10.5, 20.5, 10.5, 20.505];
    const [state] = hydrate(image).byType.ArrowAnnotate;
    const unchanged = toClassicTool(state, IMAGE.imageId);
    const calibrated = refusalsOf({ [ARROW]: [unchanged] }, { document: reSaveOf(image) });
    expect(codesOf(calibrated)).toEqual(['degenerate']);
    expect(calibrated[0][2].message).toMatch(/0\.01 mm$/);
    const pixels = refusalsOf({ [ARROW]: [unchanged] }, { document: reSaveOf(image), imagePlaneModule: null });
    expect(codesOf(pixels)).toEqual(['degenerate']);
    expect(pixels[0][2].message).toMatch(/0\.01 pixels$/);

    // Patient domain, placed on the image that holds it
    const placed = writePatient(patientRecord([[10, 20, 0], [30, 40, 0]]));
    arrowGeometryItemOf(measurementGroups(placed)[0]).GraphicData = [10, 20, 0, 10, 20.005, 0];
    const [onImage] = hydrate(placed).byType.ArrowAnnotate;
    expect(onImage.annotation.metadata.sourceGeometry.placement).toEqual({ SOPInstanceUID: IMAGE.SOPInstanceUID, frameNumber: 1 });
    expect(codesOf(refusalsOf({ [ARROW]: [toClassicTool(onImage, IMAGE.imageId)] }, { document: reSaveOf(placed) }))).toEqual(['degenerate']);

    // Held off-plane, saved from its record
    const coronal = writePatient(patientRecord([[10, 20, 30], [20, 20, 40]], {
      outOfPlane: true, drawingPlane: formatDrawingPlane(drawingPlaneOfView([0, 1, 0], [0, 0, 1])), views: ['coronal'],
    }));
    arrowGeometryItemOf(measurementGroups(coronal)[0]).GraphicData = [10, 20, 30, 10, 20, 30.005];
    const [offPlane] = hydrate(coronal).byType.ArrowAnnotate;
    const held = heldOutOfPlaneRecord(ARROW, offPlane, SYNTHETIC.StudyInstanceUID);
    const tool = { ...patientToolData({ ...held, uid: 'patient-arrow' }), _id: 'patient-arrow' };
    expect(codesOf(refusalsOf({}, { toolState: patientState(tool), patientSeries: PATIENT_SERIES, document: reSaveOf(coronal) })))
      .toEqual(['degenerate']);
  });

  it('still writes back an unchanged tip-only POINT', () => {
    const dataset = legacy(written(), 'point');
    const [state] = hydrate(dataset).byType.ArrowAnnotate;
    const [rewritten] = measurementGroups(reSave(dataset, state));
    expect(arrowGeometryItemOf(rewritten)).toMatchObject({ GraphicType: 'POINT', GraphicData: [10.5, 20.5] });
  });

  it('takes the geometry from the stock marker only: never a measurement before it, nor a NUM that is not the marker', () => {
    const lengthNum = {
      RelationshipType: 'CONTAINS', ValueType: 'NUM',
      ConceptNameCodeSequence: [{ CodeValue: '410668003', CodingSchemeDesignator: 'SCT', CodeMeaning: 'Length' }],
      MeasuredValueSequence: [{ NumericValue: 17, MeasurementUnitsCodeSequence: [{ CodeValue: 'mm', CodingSchemeDesignator: 'UCUM', CodeMeaning: 'millimeter' }] }],
      ContentSequence: [{ ...arrowGeometryItemOf(measurementGroups(written())[0]), GraphicData: [1, 2, 3, 4] }],
    };
    const ordered = legacy(written(), 'polyline');
    const [group] = measurementGroups(ordered);
    group.ContentSequence = [lengthNum, ...asArray(group.ContentSequence)];
    expect(arrowGeometryOf(group.ContentSequence)).toMatchObject({ carrier: 'num' });
    const [state] = hydrate(ordered).byType.ArrowAnnotate;
    expect(state.annotation.metadata.sourceGeometry.graphicData).toEqual([10.5, 20.5, 30.5, 40.5]);

    // No genuine marker: a Length alone, or the marker with a value or another unit
    const lengthOnly = legacy(written(), 'polyline');
    const [lone] = measurementGroups(lengthOnly);
    lone.ContentSequence = [...asArray(lone.ContentSequence).filter(item => item.ValueType !== 'NUM'), lengthNum];
    expect(arrowGeometryOf(lone.ContentSequence)).toBeUndefined();
    expect(hydrate(lengthOnly).byType.ArrowAnnotate).toBeUndefined();
    [num => { num.MeasuredValueSequence[0].NumericValue = 17; },
      num => { num.MeasuredValueSequence[0].MeasurementUnitsCodeSequence[0].CodeValue = 'mm'; }].forEach((change) => {
      const dataset = legacy(written(), 'polyline');
      const [marked] = measurementGroups(dataset);
      change(numsOf(marked)[0]);
      expect(hydrate(dataset).byType.ArrowAnnotate).toBeUndefined();
    });
  });

  it('never takes a qualified or blank-valued marker for the stock marker, before the genuine one or alone', () => {
    const decoys = {
      qualified: num => { num.MeasuredValueSequence[0].NumericValueQualifierCodeSequence = [{ CodeValue: '114006', CodingSchemeDesignator: 'DCM', CodeMeaning: 'Measurement failure' }]; },
      'qualified at the NUM': num => { num.NumericValueQualifierCodeSequence = [{ CodeValue: '114006', CodingSchemeDesignator: 'DCM', CodeMeaning: 'Measurement failure' }]; },
      blank: num => { num.MeasuredValueSequence[0].NumericValue = ''; },
      absent: num => { delete num.MeasuredValueSequence[0].NumericValue; },
    };
    Object.entries(decoys).forEach(([kind, change]) => {
      // Before the genuine marker: the genuine marker's points
      const ahead = legacy(written(), 'polyline');
      const [group] = measurementGroups(ahead);
      const [genuine] = numsOf(group);
      const decoy = _.cloneDeep(genuine);
      decoy.ContentSequence[0].GraphicData = [1, 2, 3, 4];
      change(decoy);
      group.ContentSequence = [decoy, ...asArray(group.ContentSequence)];
      const [state] = hydrate(ahead).byType.ArrowAnnotate;
      expect([kind, state.annotation.metadata.sourceGeometry.graphicData]).toEqual([kind, [10.5, 20.5, 30.5, 40.5]]);

      // Alone: no arrow
      const alone = legacy(written(), 'polyline');
      change(numsOf(measurementGroups(alone)[0])[0]);
      expect([kind, hydrate(alone).byType.ArrowAnnotate]).toEqual([kind, undefined]);
    });
  });

  it('writes the free-text code in LongCodeValue, new or re-saved, and reads it in either attribute', () => {
    const dataset = written();
    expect(findingCodeOf(measurementGroups(dataset)[0])).toEqual(expect.objectContaining({ LongCodeValue: 'CORNERSTONEFREETEXT', CodeMeaning: LABEL }));
    expect(findingCodeOf(measurementGroups(dataset)[0]).CodeValue).toBeUndefined();

    // Read in CodeValue (the stock writers): the label as read, written back in LongCodeValue
    const stock = written();
    const code = findingCodeOf(measurementGroups(stock)[0]);
    code.CodeValue = code.LongCodeValue;
    delete code.LongCodeValue;
    const [state] = hydrate(stock).byType.ArrowAnnotate;
    expect(state.annotation.data.text).toBe(LABEL);
    const rewritten = findingCodeOf(measurementGroups(reSave(stock, state))[0]);
    expect(rewritten).toEqual(expect.objectContaining({ LongCodeValue: 'CORNERSTONEFREETEXT', CodingSchemeDesignator: 'CST4', CodeMeaning: LABEL }));
    expect(rewritten.CodeValue).toBeUndefined();
  });

  it('reads the label of a stock arrow without a Finding from its Comment, and re-saves it as the Finding', () => {
    const COMMENT = { CodeValue: '121106', CodingSchemeDesignator: 'DCM', CodeMeaning: 'Comment' };
    const dataset = legacy(written(), 'polyline');
    const [group] = measurementGroups(dataset);
    const finding = findingOf(group);
    group.ContentSequence = [
      ...asArray(group.ContentSequence).filter(item => item !== finding),
      { RelationshipType: 'CONTAINS', ValueType: 'TEXT', ConceptNameCodeSequence: [COMMENT], TextValue: 'Stock label' },
    ];
    expect(arrowLabelOf(group.ContentSequence)).toMatchObject({ label: 'Stock label', source: 'comment' });
    const { byType, infos } = hydrate(dataset);
    const [state] = byType.ArrowAnnotate;
    expect(state.annotation.data.text).toBe('Stock label');
    expect(state.annotation.metadata.labelSource).toBe('comment');
    expect(infos.some(message => /text read from the group's Comment/.test(message))).toBe(true);

    // Re-saved with a Sonador text of its own: the label as the Finding, the text as its property
    const tool = toClassicTool(state, IMAGE.imageId);
    tool.metadata.measurementText = 'Distinct text';
    const [rewritten] = measurementGroups(readSR(write({ [ARROW]: [tool] }, { document: reSaveOf(dataset) }).result));
    expect(findingCodeOf(rewritten)).toEqual(expect.objectContaining({ LongCodeValue: 'CORNERSTONEFREETEXT', CodeMeaning: 'Stock label' }));
    expect(textValues(propertiesOf(rewritten), TEXT)).toEqual(['Distinct text']);
    expect(numsOf(rewritten)).toEqual([]);
    const [reloaded] = hydrate(readSR(write({ [ARROW]: [tool] }, { document: reSaveOf(dataset) }).result)).byType.ArrowAnnotate;
    expect(reloaded.annotation.data.text).toBe('Stock label');
    expect(reloaded.annotation.metadata.measurementText).toBe('Distinct text');

    // A coded Finding is kept, the Comment beside it is not its label
    const coded = { CodeValue: '52988006', CodingSchemeDesignator: 'SCT', CodeMeaning: 'Lesion' };
    const codedDataset = written();
    const [codedGroup] = measurementGroups(codedDataset);
    findingOf(codedGroup).ConceptCodeSequence = [coded];
    codedGroup.ContentSequence = [...asArray(codedGroup.ContentSequence),
      { RelationshipType: 'CONTAINS', ValueType: 'TEXT', ConceptNameCodeSequence: [COMMENT], TextValue: 'Stock label' }];
    const [codedState] = hydrate(codedDataset).byType.ArrowAnnotate;
    // Shown by its meaning, not the Comment
    expect(codedState.annotation.data.text).toBe('Lesion');
    expect(codedState.annotation.metadata.codedFinding).toEqual(expect.objectContaining(coded));
    expect(codedState.annotation.metadata.labelSource).toBeUndefined();
    expect(findingCodeOf(measurementGroups(reSave(codedDataset, codedState))[0])).toEqual(expect.objectContaining(coded));
  });

  it('reads a free-text Finding Site before a Comment, as Sonador IO does, and re-saves it as the Finding', () => {
    const COMMENT = { CodeValue: '121106', CodingSchemeDesignator: 'DCM', CodeMeaning: 'Comment' };
    const dataset = legacy(written(), 'polyline');
    const [group] = measurementGroups(dataset);
    const finding = findingOf(group);
    group.ContentSequence = [
      ...asArray(group.ContentSequence).filter(item => item !== finding),
      { RelationshipType: 'CONTAINS', ValueType: 'TEXT', ConceptNameCodeSequence: [COMMENT], TextValue: 'Stock comment' },
      { RelationshipType: 'HAS CONCEPT MOD', ValueType: 'CODE',
        ConceptNameCodeSequence: [{ CodeValue: '363698007', CodingSchemeDesignator: 'SCT', CodeMeaning: 'Finding Site' }],
        ConceptCodeSequence: [{ CodeValue: 'CORNERSTONEFREETEXT', CodingSchemeDesignator: 'CST4', CodeMeaning: 'Site label' }] },
    ];
    expect(arrowLabelOf(group.ContentSequence)).toMatchObject({ label: 'Site label', source: 'finding-site' });
    const [state] = hydrate(dataset).byType.ArrowAnnotate;
    expect(state.annotation.data.text).toBe('Site label');
    expect(state.annotation.metadata.labelSource).toBe('finding-site');
    expect(findingCodeOf(measurementGroups(reSave(dataset, state))[0]))
      .toEqual(expect.objectContaining({ LongCodeValue: 'CORNERSTONEFREETEXT', CodingSchemeDesignator: 'CST4', CodeMeaning: 'Site label' }));
  });

  it('keeps a Finding of the free-text token in another scheme as a coded finding, written back verbatim', () => {
    const foreign = { CodeValue: 'CORNERSTONEFREETEXT', CodingSchemeDesignator: 'CORNERSTONEJS', CodeMeaning: 'Foreign meaning' };
    const dataset = written();
    findingOf(measurementGroups(dataset)[0]).ConceptCodeSequence = [foreign];
    expect(arrowLabelOf(measurementGroups(dataset)[0].ContentSequence)).toMatchObject({ label: '', coded: true });
    const [state] = hydrate(dataset).byType.ArrowAnnotate;
    expect(state.annotation.metadata.codedFinding).toEqual(expect.objectContaining(foreign));
    // Shown by its meaning
    expect(state.annotation.data.text).toBe('Foreign meaning');
    const rewritten = findingCodeOf(measurementGroups(reSave(dataset, state))[0]);
    expect(_.pick(rewritten, 'CodeValue', 'LongCodeValue', 'CodingSchemeDesignator', 'CodeMeaning')).toEqual(foreign);
    // A label typed for it is a free-text Finding of its own
    const retexted = { ...toClassicTool(state, IMAGE.imageId), text: 'Typed label' };
    expect(findingCodeOf(measurementGroups(readSR(write({ [ARROW]: [retexted] }, { document: reSaveOf(dataset) }).result))[0]))
      .toEqual(expect.objectContaining({ LongCodeValue: 'CORNERSTONEFREETEXT', CodingSchemeDesignator: 'CST4', CodeMeaning: 'Typed label' }));
  });

  it('refuses a patient-domain arrow it cannot write in patient coordinates; an image-domain arrow without a plane is written', () => {
    const patient = classicTool(TIP_TAIL, { coordinateDomain: 'patient' });
    expect(codesOf(refusalsOf({ [ARROW]: [patient] }, { imagePlaneModule: null }))).toEqual(['uncalibrated']);
    const noFrame = _.omit(mockImagePlanes[IMAGE.imageId], 'frameOfReferenceUID');
    expect(codesOf(refusalsOf({ [ARROW]: [patient] }, { imagePlaneModule: noFrame }))).toEqual(['frame-of-reference']);
    const [written3d] = measurementGroups(readSR(write({ [ARROW]: [patient] }).result));
    expect(arrowGeometryItemOf(written3d)).toMatchObject({ ValueType: 'SCOORD3D' });

    // An imported SCOORD3D arrow, edited, on an image without a plane or a Frame of Reference
    const placed = writePatient(patientRecord([[10, 20, 0], [30, 40, 0]]));
    const [state] = hydrate(placed).byType.ArrowAnnotate;
    const edited = toClassicTool(state, IMAGE.imageId);
    edited.handles.end = { x: 25.5, y: 35.5 };
    expect(codesOf(refusalsOf({ [ARROW]: [edited] }, { document: reSaveOf(placed), imagePlaneModule: null }))).toEqual(['uncalibrated']);
    expect(codesOf(refusalsOf({ [ARROW]: [edited] }, { document: reSaveOf(placed), imagePlaneModule: noFrame }))).toEqual(['frame-of-reference']);
    expect(saveResultSummary([omittedMeasurement(ARROW, edited, refusalsOf({ [ARROW]: [edited] },
      { document: reSaveOf(placed), imagePlaneModule: null })[0][2])]).message).toMatch(/read in patient coordinates/);

    expect(codesOf(refusalsOf({ [ARROW]: [classicTool(TIP_TAIL)] }, { imagePlaneModule: null }))).toEqual([]);
  });

  it('places an image-domain arrow on the image its coordinates are SELECTED FROM, never another IMAGE', () => {
    const imageItem = (relationship, SOPInstanceUID) => ({
      RelationshipType: relationship, ValueType: 'IMAGE',
      ReferencedSOPSequence: [{ ReferencedSOPClassUID: CT_IMAGE, ReferencedSOPInstanceUID: SOPInstanceUID }],
    });
    const wrongOnly = written();
    const geometry = arrowGeometryItemOf(measurementGroups(wrongOnly)[0]);
    geometry.ContentSequence = [imageItem('INFERRED FROM', IMAGE.SOPInstanceUID)];
    const states = hydrate(wrongOnly).byType.ArrowAnnotate || [];
    expect(states.filter(state => state.annotation.metadata.referencedImageId)).toEqual([]);

    const wrongFirst = written();
    const both = arrowGeometryItemOf(measurementGroups(wrongFirst)[0]);
    both.ContentSequence = [imageItem('INFERRED FROM', ANISOTROPIC_IMAGE.SOPInstanceUID), imageItem('SELECTED FROM', IMAGE.SOPInstanceUID)];
    const [state] = hydrate(wrongFirst, IMAGES).byType.ArrowAnnotate;
    expect(state.annotation.metadata.referencedImageId).toBe(IMAGE.imageId);
    expect(state.annotation.metadata.sourceGeometry).toMatchObject({ ReferencedSOPInstanceUID: IMAGE.SOPInstanceUID });
  });
});


describe('documents of the other writers', () => {
  // Sonador IO (oak-tree/medical-imaging/sonador-client) and the stock @cornerstonejs/adapters writer,
  // copied byte for byte; each case is skipped while its fixture is absent. Sonador IO writes the
  // free-text code in LongCodeValue, the stock writers in CodeValue and the geometry under their marker.
  const IMAGE_LINE = { valueType: 'SCOORD', graphicType: 'POLYLINE', graphicData: [30, 20, 10, 40] };
  const AXIAL_LINE = { valueType: 'SCOORD3D', graphicType: 'POLYLINE', graphicData: [10, 20, 30, 25, 35, 30] };
  const CASES = [
    ['sonador-io.arrow-image', 'cornerstoneTools@^4.0.0', 'Flèche → lésion étendue', 'LongCodeValue', 'finding', IMAGE_LINE],
    ['sonador-io.arrow-axial', 'cornerstoneTools@^4.0.0', 'Axial arrow', 'LongCodeValue', 'finding', AXIAL_LINE],
    ['sonador-io.arrow-oblique', 'cornerstoneTools@^4.0.0', 'Oblique arrow', 'LongCodeValue', 'finding',
      { valueType: 'SCOORD3D', graphicType: 'POINT', graphicData: [10, 20, 30] }],
    ['cornerstone-adapters.arrow-image', 'Cornerstone3DTools@^0.1.0', 'Synthetic arrow', 'CodeValue', 'num', IMAGE_LINE],
    ['cornerstone-adapters.arrow-patient', 'Cornerstone3DTools@^0.1.0', 'Synthetic arrow', 'CodeValue', 'num', AXIAL_LINE],
    ['cornerstone-adapters.arrow-point', 'cornerstoneTools@^4.0.0', 'Synthetic arrow', 'CodeValue', 'num',
      { valueType: 'SCOORD', graphicType: 'POINT', graphicData: [30, 20] }],
  ];
  const present = fs.readdirSync(FIXTURES);
  CASES.forEach(([stem, prefix, label, codeAttribute, carrier, geometry]) => {
    const name = present.find(file => file.startsWith(`${stem}.`) && file.endsWith('.dcm'));
    (name ? it : it.skip)(`${name || stem}: hydrates "${label}" (code in ${codeAttribute}) with its tracking identity and geometry`, () => {
      const dataset = fixture(name);
      const [group] = measurementGroups(dataset);
      expect(trackingIdentifierOf(group)).toBe(`${prefix}:ArrowAnnotate`);
      expect(firstItem(asArray(group.ContentSequence).find(item => conceptNameValue(item) === FINDING).ConceptCodeSequence))
        .toMatchObject({ [codeAttribute]: 'CORNERSTONEFREETEXT', CodingSchemeDesignator: 'CST4', CodeMeaning: label });
      expect(arrowLabelOf(group.ContentSequence)).toMatchObject({ label, source: 'finding', coded: false });
      expect(arrowGeometryOf(group.ContentSequence)).toMatchObject({ carrier });

      const [state] = hydrate(dataset, IMAGES).byType.ArrowAnnotate;
      expect(state.annotation.data.text).toBe(label);
      expect(state.annotation.data.handles.points).toHaveLength(2);
      expect(state.annotation.metadata).toMatchObject({
        TrackingIdentifier: `${prefix}:ArrowAnnotate`, TrackingUniqueIdentifier: trackingUIDOf(group),
        coordinateDomain: geometry.valueType === 'SCOORD3D' ? 'patient' : 'image',
      });
      expect(state.annotation.metadata.sourceGeometry).toMatchObject({ ...geometry, carrier });
      if (geometry.valueType === 'SCOORD') {
        expect(state.annotation.metadata.referencedImageId).toBe(IMAGE.imageId);
        // Re-saved unchanged: the identity and geometry as read, the label under the Finding in LongCodeValue
        const [rewritten] = measurementGroups(readSR(write({ [ARROW]: [toClassicTool(state, IMAGE.imageId)] },
          { document: reSaveOf(dataset) }).result));
        expect(trackingUIDOf(rewritten)).toBe(trackingUIDOf(group));
        expect(trackingIdentifierOf(rewritten)).toBe(`${prefix}:ArrowAnnotate`);
        expect(numsOf(rewritten)).toEqual([]);
        expect(arrowGeometryItemOf(rewritten)).toMatchObject({ GraphicType: geometry.graphicType, GraphicData: geometry.graphicData });
        const code = findingCodeOf(rewritten);
        expect(code).toEqual(expect.objectContaining({ LongCodeValue: 'CORNERSTONEFREETEXT', CodingSchemeDesignator: 'CST4', CodeMeaning: label }));
        expect(code.CodeValue).toBeUndefined();
      }
    });
  });
});


describe('Viewer-authored fixtures on the synthetic axial series', () => {
  // The synthetic CT: 64 x 48, Pixel Spacing 0.8 mm (rows) and 1.2 mm (columns), slices 3 mm apart at
  // z = 0 to 33, Image Position (-38.4, -19.2, z), axial orientation
  const slices = _.range(1, 13).map(n => fixture(`synthetic-ct/ct-${String(n).padStart(2, '0')}.dcm`));
  const CT = slices.map((slice, index) => ({ SOPInstanceUID: slice.SOPInstanceUID, imageId: `synthetic-ct-arrow:${index + 1}` }));
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

  // The image-domain arrow on the slice at z = 9 (ct-04): tip image (27.5, 17), patient (-6, -6, 9);
  // tail image (37.5, 32), patient (6, 6, 9). Its label and description are outside ASCII.
  const slice = CT[3];
  const IMAGE_POINTS = [[27.5, 17], [37.5, 32]];
  const IMAGE_LABEL = 'Läsionsrand — 肺結節';
  const IMAGE_DESCRIPTION = 'Pfeil über dem Pleuraspalt';
  const IMAGE_TOOLS = { [ARROW]: [classicTool(IMAGE_POINTS, {
    _id: 'arrow-image', text: IMAGE_LABEL, description: IMAGE_DESCRIPTION, displayAttributes: LINE_TEXT,
    metadata: { measurementText: 'Synthetic', location: 'Synthetic location', views: ['axial'] },
  })] };

  // The Inspector turned 45 degrees between sagittal and axial (normal (1, 0, 1)/sqrt 2, up +y): tip
  // (-a, 0, 15 + a), tail (a, 0, 15 - a), a = 10/sqrt 2, 20 mm apart
  const OBLIQUE = { viewPlaneNormal: [Math.SQRT1_2, 0, Math.SQRT1_2], viewUp: [0, 1, 0] };
  const along = 10 * Math.SQRT1_2;
  const OBLIQUE_POINTS = [[-along, 0, 15 + along], [along, 0, 15 - along]];
  const OBLIQUE_TOOLS = { [ARROW]: [{
    uid: 'arrow-oblique', _id: 'arrow-oblique', toolType: ARROW, patientPoints: OBLIQUE_POINTS, FrameOfReferenceUID: FOR,
    text: 'Oblique arrow', description: 'Arrow (oblique)',
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
    [[-6, -6, 9], [6, 6, 9]].forEach((expected, i) => expectPoint(imageToPatient(module, IMAGE_POINTS[i]), expected, 9));
  });

  it('sonador-viewer.arrow-image is the Viewer writer output, byte for byte: a SCOORD POLYLINE tip then tail, UTF-8 text', () => {
    const bytes = writeImage();
    if (process.env.UPDATE_SR_FIXTURES) {
      fs.writeFileSync(VIEWER_IMAGE, bytes);
    }
    expect(bytes.equals(fs.readFileSync(VIEWER_IMAGE))).toBe(true);

    const dataset = readSR(bytes);
    expect(dataset.SOPClassUID).toBe(COMPREHENSIVE_3D_SR);
    expect(dataset.SpecificCharacterSet).toBe('ISO_IR 192');
    const [group] = measurementGroups(dataset);
    expect(trackingIdentifierOf(group)).toBe(TRACKING_IDENTIFIER);
    expect(numsOf(group)).toEqual([]);
    expect(findingCodeOf(group)).toMatchObject({ LongCodeValue: 'CORNERSTONEFREETEXT', CodingSchemeDesignator: 'CST4', CodeMeaning: IMAGE_LABEL });
    const geometry = arrowGeometryItemOf(group);
    expect(geometry).toMatchObject({ ValueType: 'SCOORD', GraphicType: 'POLYLINE' });
    expect(pointsOfItem(geometry)).toEqual(IMAGE_POINTS);
    expect(firstItem(firstItem(geometry.ContentSequence).ReferencedSOPSequence).ReferencedSOPInstanceUID).toBe(slice.SOPInstanceUID);
    const properties = propertiesOf(group);
    expect(textValues(properties, DESCRIPTION)).toEqual([IMAGE_DESCRIPTION]);
    expect(textValues(properties, TEXT)).toEqual(['Synthetic']);
    expect(textValues(properties, VIEW)).toEqual(['axial']);
    // The label and description read back as the strings written
    const [state] = hydrate(dataset, CT).byType.ArrowAnnotate;
    expect(state.annotation.data.text).toBe(IMAGE_LABEL);
    expect(state.description).toBe(IMAGE_DESCRIPTION);
    expect(state.annotation.data.displayAttributes).toEqual(LINE_TEXT);
  });

  it('sonador-viewer.arrow-image writes -> parses -> writes to the same bytes', () => {
    const dataset = readSR(fs.readFileSync(VIEWER_IMAGE));
    const [state] = hydrate(dataset, CT).byType.ArrowAnnotate;
    expect(state.annotation.metadata.referencedImageId).toBe(slice.imageId);
    const rewritten = { [ARROW]: [{ ...toClassicTool(state, slice.imageId), _id: 'arrow-image' }] };
    const bytes = write(rewritten, { imageId: slice.imageId, series: CT_SERIES, headers: HEADERS, document: reSaveOf(dataset) }).result;
    expect(bytes.equals(fs.readFileSync(VIEWER_IMAGE))).toBe(true);
  });

  it('sonador-viewer.arrow-oblique is the Viewer writer output, byte for byte: a SCOORD3D POLYLINE on the 45-degree plane', () => {
    const bytes = writeOblique();
    if (process.env.UPDATE_SR_FIXTURES) {
      fs.writeFileSync(VIEWER_OBLIQUE, bytes);
    }
    expect(bytes.equals(fs.readFileSync(VIEWER_OBLIQUE))).toBe(true);

    const dataset = readSR(bytes);
    expect(dataset.SpecificCharacterSet).toBeUndefined();
    const [group] = measurementGroups(dataset);
    expect(numsOf(group)).toEqual([]);
    const geometry = arrowGeometryItemOf(group);
    expect(geometry).toMatchObject({ ValueType: 'SCOORD3D', GraphicType: 'POLYLINE', ReferencedFrameOfReferenceUID: FOR });
    // SCOORD3D coordinates are single precision
    pointsOfItem(geometry).forEach((point, i) => expectPoint(point, OBLIQUE_POINTS[i], 5));
    expect(findingCodeOf(group).CodeMeaning).toBe('Oblique arrow');
    const properties = propertiesOf(group);
    expect(textValues(properties, DRAWING_PLANE)).toEqual([OBLIQUE_TOOLS[ARROW][0].metadata.drawingPlane]);
    expect(properties.filter(item => conceptNameValue(item) === SOURCE_SERIES).map(item => item.UID)).toEqual([SERIES.SeriesInstanceUID]);
    expect(textValues(properties, VIEW)).toEqual(['oblique']);
  });

  it('sonador-viewer.arrow-oblique reloads as a locked out-of-plane arrow that writes back to the same bytes', () => {
    const dataset = readSR(fs.readFileSync(VIEWER_OBLIQUE));
    const [state] = hydrate(dataset, CT).byType.ArrowAnnotate;
    expect(state.annotation.metadata).toMatchObject({ outOfPlane: true, isLocked: true, sourceSeries: SERIES.SeriesInstanceUID });
    state.annotation.data.handles.points.forEach((point, i) => expectPoint(point, OBLIQUE_POINTS[i], 5));
    expect(navigationPlaneOf(state.annotation.data.handles.points, state.annotation.metadata.drawingPlane).kind).toBe('drawing-plane');

    const record = heldOutOfPlaneRecord(ARROW, state, first.StudyInstanceUID);
    expect(record.label).toBe('Oblique arrow');
    const tool = { ...patientToolData({ ...record, uid: 'arrow-oblique' }), _id: 'arrow-oblique', description: 'Arrow (oblique)' };
    const bytes = writeOblique({ toolState: { [SERIES_KEY]: { [ARROW]: { data: [tool] } } }, document: reSaveOf(dataset) });
    expect(bytes.equals(fs.readFileSync(VIEWER_OBLIQUE))).toBe(true);
  });
});
