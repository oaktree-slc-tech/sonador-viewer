/**
 * @jest-environment ../../platform/viewer/src/__tests__/jsdomEnvironment.js
 */
// The classic arrow and its measurement: the tool's text, the description, Sonador-Measurement.Text and
// the location are four fields; the record takes the text once the tool's prompt is done
// (MEASUREMENT_COMPLETED); a Cornerstone3D arrow hydrated from a report reaches the
// classic tool with its tip, tail, text and identity; a coded finding is shown by its meaning and has
// no text of its own.

jest.mock('cornerstone-core', () => ({}), { virtual: true });
jest.mock('cornerstone-tools', () => ({
  EVENTS: {
    MEASUREMENT_ADDED: 'cornerstonetoolsmeasurementadded',
    MEASUREMENT_MODIFIED: 'cornerstonetoolsmeasurementmodified',
    MEASUREMENT_COMPLETED: 'cornerstonetoolsmeasurementcompleted',
  },
}), { virtual: true });
// The image maps patient (x, y, 0) to image (x + 0.5, y + 0.5)
jest.mock('@cornerstonejs/core', () => ({
  utilities: { worldToImageCoords: (imageId, [x, y]) => [x + 0.5, y + 0.5] },
  metaData: {
    get: (type, imageId) => imageId === 'synthetic:2.25.1003' && {
      imagePositionPatient: [0, 0, 0], rowCosines: [1, 0, 0], columnCosines: [0, 1, 0], rowPixelSpacing: 1, columnPixelSpacing: 1,
    },
  },
}), { virtual: true });
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: {
    measurements: {
      Enums: {
        CORNERSTONE_TOOLS_SOURCE_NAME: 'CornerstoneTools', CORNERSTONE_TOOLS_SOURCE_VERSION: '4',
        CORNERSTONE_3D_TOOLS_SOURCE_NAME: 'Cornerstone3DTools-Sonador', CORNERSTONE_3D_TOOLS_SOURCE_VERSION: '0.1',
      },
      getImagePath: () => 'image-path',
    },
    utils: { dataProc: { firstDefinedValue: (...values) => values.find(value => value !== undefined) }, guid: () => 'guid' },
    log: { warn: () => {}, info: () => {}, debug: () => {} },
    DICOMSR: {
      angleGeometry: jest.requireActual('../../../../../../platform/core/src/DICOMSR/utils/angleGeometry'),
      arrowGeometry: jest.requireActual('../../../../../../platform/core/src/DICOMSR/utils/arrowGeometry'),
      bidirectionalGeometry: jest.requireActual('../../../../../../platform/core/src/DICOMSR/utils/bidirectionalGeometry'),
      circleGeometry: jest.requireActual('../../../../../../platform/core/src/DICOMSR/utils/circleGeometry'),
      SREnums: { TOOL_NAMES: { DICOM_SR_SERIES_TAG: 'DICOMSRSeriesTagTool' } },
    },
  },
}), { virtual: true });

import _ from 'lodash';

import { ArrowAnnotate } from './ArrowAnnotate';
import measurementServiceMappingsFactory from './measurementServiceMappingsFactory';

const measurementService = {
  VALUE_TYPES: { POINT: 'value_type::point', POLYLINE: 'value_type::polyline', ANGLE: 'value_type::angle',
    CIRCLE: 'value_type::circle', BIDIRECTIONAL: 'value_type::shortAxisLongAxis', CODED_CONCEPT: 'value_type::codedConcept' },
  EVENTS: { MEASUREMENT_ADDED: 'added', MEASUREMENT_UPDATED: 'updated', RAW_MEASUREMENT_ADDED: 'raw-added' },
};
const classicSource = { name: 'CornerstoneTools', version: '4' };
const c3dSource = { name: 'Cornerstone3DTools-Sonador', version: '0.1' };

// The cornerstone-tools arrow as the tool raises it: the text in `text`, the handles start (tip), end (tail)
const toolData = (extra = {}) => ({
  toolName: 'ArrowAnnotate',
  measurementData: {
    _id: 'arrow-1', handles: { start: { x: 10.5, y: 20.5 }, end: { x: 30.5, y: 40.5 }, textBox: {} },
    text: 'Lesion margin', description: 'Arrow description', location: 'Arrow location',
    metadata: { measurementText: 'Arrow measurement text', SOPInstanceUID: '2.25.1003', StudyInstanceUID: '2.25.1001', SeriesInstanceUID: '2.25.1002' },
    ...extra,
  },
});

describe('the classic arrow mapping', () => {
  it('makes a measurement with tip then tail, the text as its label, and the other three fields apart', () => {
    const measurement = ArrowAnnotate.toMeasurement(measurementService, toolData());
    expect(measurement.points).toEqual([{ x: 10.5, y: 20.5 }, { x: 30.5, y: 40.5 }]);
    expect(measurement).toMatchObject({ toolName: 'ArrowAnnotate', label: 'Lesion margin', description: 'Arrow description' });
    expect(measurement.metadata).toMatchObject({ text: 'Lesion margin', measurementText: 'Arrow measurement text', location: 'Arrow location' });
    expect(measurement.type).toBe(measurementService.VALUE_TYPES.POINT);
  });

  it('gives the tool its text, and the writer the measurement text, description and location as they are', () => {
    const measurement = {
      uid: 'm-1', toolName: 'ArrowAnnotate', label: 'Lesion margin', description: 'Arrow description',
      points: [{ x: 10.5, y: 20.5 }, { x: 30.5, y: 40.5 }],
      data: { _id: 'arrow-1' },
      metadata: { _id: 'arrow-1', text: 'Lesion margin', measurementText: 'Arrow measurement text', location: 'Arrow location' },
    };
    const annotation = ArrowAnnotate.toAnnotation(measurementService, measurement, 'ArrowAnnotate');
    const data = annotation.measurementData;
    expect(data.handles).toMatchObject({ start: { x: 10.5, y: 20.5 }, end: { x: 30.5, y: 40.5 } });
    expect(data).toMatchObject({ text: 'Lesion margin', label: 'Lesion margin', description: 'Arrow description', measurementText: 'Arrow measurement text' });
    expect(annotation.metadata).toMatchObject({ location: 'Arrow location', measurementText: 'Arrow measurement text' });
    // An edit of the description or location leaves the text as it is
    const relabelled = ArrowAnnotate.toAnnotation(measurementService,
      { ...measurement, description: 'New description', metadata: { ...measurement.metadata, location: 'New location' } }, 'ArrowAnnotate');
    expect(relabelled.measurementData.text).toBe('Lesion margin');
  });

  it('converts a hydrated Cornerstone3D arrow to the classic handles, with its text and identity', () => {
    const hydrated = {
      uid: 'h-1', toolName: 'ArrowAnnotate', label: 'Lesion margin', points: [[10, 20, 0], [30, 40, 0]],
      referencedImageId: 'synthetic:2.25.1003', SOPInstanceUID: '2.25.1003', referenceSeriesUID: '2.25.1002', referenceStudyUID: '2.25.1001',
      metadata: {
        toolName: 'ArrowAnnotate', description: 'Arrow description', measurementText: 'Arrow measurement text', location: 'Arrow location',
        TrackingUniqueIdentifier: '2.25.8400', TrackingIdentifier: 'cornerstoneTools@^4.0.0:ArrowAnnotate', coordinateDomain: 'image',
        sourceGeometry: { valueType: 'SCOORD', graphicType: 'POLYLINE', graphicData: [10.5, 20.5, 30.5, 40.5] },
      },
      data: {},
    };
    const converted = ArrowAnnotate.toAltSourceMeasurementSchema(measurementService, classicSource, hydrated, c3dSource);
    expect(converted.points).toEqual([[10.5, 20.5], [30.5, 40.5]]);
    expect(converted.data.handles).toMatchObject({ start: { x: 10.5, y: 20.5 }, end: { x: 30.5, y: 40.5 } });
    expect(converted.data.text).toBe('Lesion margin');
    expect(converted.label).toBe('Lesion margin');
    expect(converted.description).toBe('Arrow description');
    expect(converted.metadata).toMatchObject({
      TrackingUniqueIdentifier: '2.25.8400', TrackingIdentifier: 'cornerstoneTools@^4.0.0:ArrowAnnotate',
      measurementText: 'Arrow measurement text', sourceGeometry: hydrated.metadata.sourceGeometry,
    });
  });

  it('shows a coded finding by its meaning and gives it no text of its own', () => {
    const codedFinding = { CodeValue: '52988006', CodingSchemeDesignator: 'SCT', CodeMeaning: 'Lesion' };
    const hydrated = {
      uid: 'h-2', toolName: 'ArrowAnnotate', label: '', points: [[10, 20, 0], [30, 40, 0]], referencedImageId: 'synthetic:2.25.1003',
      metadata: { toolName: 'ArrowAnnotate', codedFinding, finding: codedFinding }, data: {},
    };
    const converted = ArrowAnnotate.toAltSourceMeasurementSchema(measurementService, classicSource, hydrated, c3dSource);
    expect(converted.data.text).toBe('Lesion');
    expect(converted.label).toBe('');
    // The tool draws the meaning; the measurement made from it has no text
    const measurement = ArrowAnnotate.toMeasurement(measurementService, toolData({ text: 'Lesion', metadata: { codedFinding } }));
    expect(measurement.label).toBe('');
    expect(measurement.metadata).toMatchObject({ text: '', codedFinding });
  });
});

describe('the record of a classic arrow', () => {
  it('takes the text when the tool\'s prompt is done (MEASUREMENT_COMPLETED), not only when the arrow is added', () => {
    const listeners = {};
    const element = { addEventListener: (name, fn) => { listeners[name] = fn; } };
    const records = [];
    const source = {
      uid: 'classic',
      annotationToMeasurement: jest.fn((toolName, annotation, isUpdate) => {
        records.push({ toolName, text: annotation.measurementData.text, isUpdate });
        return 'm-1';
      }),
    };
    const factories = measurementServiceMappingsFactory(measurementService, source);
    factories.onElementEnabled({ detail: { element } });

    // cornerstone-tools adds the arrow before its prompt: no text yet
    const data = toolData({ text: undefined });
    listeners.cornerstonetoolsmeasurementadded({ detail: data });
    // The prompt is done: the tool sets the text and raises MEASUREMENT_COMPLETED
    data.measurementData.text = 'Lesion margin';
    listeners.cornerstonetoolsmeasurementcompleted({ detail: data });
    expect(records.map(record => record.text)).toEqual([undefined, undefined, 'Lesion margin']);
    expect(records[records.length - 1].isUpdate).toBe(true);

    // The completion of another tool is not an arrow's text
    source.annotationToMeasurement.mockClear();
    listeners.cornerstonetoolsmeasurementcompleted({ detail: { toolName: 'Length', measurementData: { _id: 'l-1' } } });
    expect(source.annotationToMeasurement).not.toHaveBeenCalled();
  });
});

describe('a location set from the Measurements panel (through the measurement service)', () => {
  const MeasurementService = jest.requireActual('../../../../../../platform/core/src/services/MeasurementService/MeasurementService').default;

  function serviceWithArrowMapping() {
    const service = new MeasurementService();
    const source = service.createSource('CornerstoneTools', '4');
    service.addMapping(source, 'ArrowAnnotate', {},
      (measurement, definition) => ArrowAnnotate.toAnnotation(service, measurement, definition),
      detail => ArrowAnnotate.toMeasurement(service, detail));
    return { service, source };
  }

  // The arrow as cornerstone-tools raises it: added before its label is typed, completed with it
  const drawn = text => ({ uid: 'arrow-uid', ...toolData({ text, uid: 'arrow-uid' }) });

  it('keeps the label when the record is rebuilt from a copy taken before the label was typed', () => {
    const { service, source } = serviceWithArrowMapping();
    const added = drawn(undefined);
    // The Measurements API's copy of the arrow, as MEASUREMENT_ADDED made it: no text
    const staleCopy = _.cloneDeep(added);
    service.annotationToMeasurement(source, 'ArrowAnnotate', added);
    service.annotationToMeasurement(source, 'ArrowAnnotate', drawn('Lesion margin'), true);
    expect(service.getMeasurement('arrow-uid')).toMatchObject({ label: 'Lesion margin', metadata: { text: 'Lesion margin' } });

    // The panel's location edit: the copy with the location, rebuilt and stored over the record
    staleCopy.measurementData.location = 'Femoral neck';
    staleCopy.location = 'Femoral neck';
    service.update('arrow-uid', ArrowAnnotate.toMeasurement(service, staleCopy), true);

    const record = service.getMeasurement('arrow-uid');
    expect(record).toMatchObject({ label: 'Lesion margin', description: 'Arrow description' });
    expect(record.metadata).toMatchObject({
      text: 'Lesion margin', location: 'Femoral neck', measurementText: 'Arrow measurement text',
    });
    // What the tool is given back: its label as typed
    expect(service.getAnnotation(source, 'ArrowAnnotate', 'arrow-uid').measurementData.text).toBe('Lesion margin');
  });

  it('keeps a label the tool data clears', () => {
    const { service, source } = serviceWithArrowMapping();
    service.annotationToMeasurement(source, 'ArrowAnnotate', drawn('Lesion margin'));
    service.annotationToMeasurement(source, 'ArrowAnnotate', drawn(''), true);
    expect(service.getMeasurement('arrow-uid')).toMatchObject({ label: '', metadata: { text: '' } });
  });
});
