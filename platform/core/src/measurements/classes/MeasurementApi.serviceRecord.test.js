/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// Removing a measurement from the Measurements panel removes its measurement-service record, which
// takes its Cornerstone3D annotation with it (measurementAnnotationSync). The panel's
// representation keeps the service uid in its nested sections, and its _id need not be the uid.
// Adding a representation updates the record's measurement number without putting the
// representation in the record's place: a record keeps its uid and points.

jest.mock('cornerstone-core', () => ({}), { virtual: true });
jest.mock('cornerstone-tools', () => ({
  globalImageIdSpecificToolStateManager: { toolState: {}, saveToolState: () => ({}), restoreToolState: () => {} },
}), { virtual: true });
jest.mock('@cornerstonejs/adapters', () => ({
  adaptersSR: { Cornerstone3D: { CodeScheme: { CodingSchemeDesignator: 'CORNERSTONEJS', codeValues: {} } } },
}), { virtual: true });
jest.mock('../../utils', () => ({
  __esModule: true,
  default: { dataProc: { firstDefinedValue: (...values) => values.find(value => value !== undefined) } },
}));
jest.mock('../../utils/studyMetadataManager', () => ({ __esModule: true, default: { get: () => undefined } }));
jest.mock('../../log', () => ({ __esModule: true, default: { info: () => {}, warn: () => {}, debug: () => {} } }));
jest.mock('../configuration.js', () => ({ measurementApiDefaultConfig: {} }));
jest.mock('../enums', () => ({ __esModule: true, default: { EVENTS: {} } }));
jest.mock('../lib/refreshCornerstoneViewports', () => ({ __esModule: true, default: () => {} }));
jest.mock('../../DICOMSR/readOnly/srDisplayAnnotations', () => ({
  clearSRDisplayAnnotations: () => {}, setSRDisplayAnnotationVisible: () => {},
}));

import MeasurementApi from './MeasurementApi';
import MeasurementService from '../../services/MeasurementService/MeasurementService';

const caseProgress = { caseProgress: { include: true } };

function apiWith(...records) {
  MeasurementApi.setConfiguration({
    server: {},
    measurementTools: [{
      id: 'allTools', options: caseProgress,
      childTools: [{ id: 'Length', options: caseProgress }, { id: 'CircleRoi', options: caseProgress }],
    }],
  });
  const service = new MeasurementService();
  records.forEach(record => service.measurements.set(record.uid, record));
  const removed = [];
  service.subscribe(service.EVENTS.MEASUREMENT_REMOVED, ({ measurement }) => removed.push(measurement));
  const api = Object.assign(Object.create(MeasurementApi.prototype), {
    measurementService: service,
    options: { sourceName: 'CornerstoneTools', sourceVersion: '4', onMeasurementsUpdated: () => {} },
    toolsGroupsMap: { Length: 'allTools', CircleRoi: 'allTools' },
    timepointApi: {
      study: () => [{ timepointId: 'tp-1' }], timepoints: [{ timepointId: 'tp-1' }], initialTimepointIds: () => ['tp-1'],
    },
    toolGroups: { allTools: [] },
    tools: { Length: [], CircleRoi: [] },
  });
  return { api, service, removed };
}

const record = (uid, _id, toolName) => ({
  uid, toolName, source: { name: 'CornerstoneTools', version: '4' }, data: { _id }, metadata: { _id, toolName },
});

it.each([['Length'], ['CircleRoi']])(
  'removes the record of a %s representation whose service uid is nested and whose _id is not the uid', (toolName) => {
    const { api, service, removed } = apiWith(record('service-uid', 'cornerstone-id', toolName));
    // As the panel holds it: the uid only in its measurement data, the _id its own
    const representation = { _id: 'cornerstone-id', toolType: toolName, measurementNumber: 1, measurementData: { _measurementServiceId: 'service-uid' } };

    api.onMeasurementRemoved(toolName, representation);
    expect(service.getMeasurement('service-uid')).toBeUndefined();
    expect(removed).toEqual(['service-uid']);
  });

it('finds the record by the _id it carries when the representation has no service uid', () => {
  const { api, service, removed } = apiWith(record('service-uid', 'cornerstone-id', 'Length'));
  api.onMeasurementRemoved('Length', { _id: 'cornerstone-id', toolType: 'Length', measurementNumber: 1 });
  expect(service.getMeasurement('service-uid')).toBeUndefined();
  expect(removed).toEqual(['service-uid']);
});

it('removes nothing else', () => {
  const { api, service, removed } = apiWith(record('a', 'a-id', 'Length'), record('b', 'b-id', 'Length'));
  api.onMeasurementRemoved('Length', { _id: 'a-id', toolType: 'Length', measurementNumber: 1 });
  expect(service.getMeasurement('b')).toBeDefined();
  expect(removed).toEqual(['a']);
});


describe('a representation added for a classic drawing', () => {
  const drawn = (uid, _id, toolName) => ({
    ...record(uid, _id, toolName),
    points: [{ x: 1, y: 2 }, { x: 4, y: 6 }],
    data: { _id, handles: { start: { x: 1, y: 2 }, end: { x: 4, y: 6 } } },
    metadata: { _id, toolName, StudyInstanceUID: '2.25.1001' },
    referenceStudyUID: '2.25.1001',
  });

  it.each([['Length'], ['CircleRoi']])(
    'numbers the %s record without replacing it: the record keeps its uid and points', (toolName) => {
      const { api, service } = apiWith(drawn('service-uid', 'service-uid', toolName));
      api._serviceManagedTool = () => ({ toolServiceManaged: true, source: service.getMeasurement('service-uid').source, toolMapping: {} });
      const updated = [];
      service.subscribe(service.EVENTS.MEASUREMENT_UPDATED, ({ measurement }) => updated.push(measurement));
      // As the panel's handler adds it, before the representation is given an _id of its own
      api.addMeasurementRepresentation(toolName, {
        toolType: toolName, StudyInstanceUID: '2.25.1001',
        measurementData: { _measurementServiceId: 'service-uid', handles: {} }, metadata: { _id: 'service-uid' },
      });

      expect(updated.length).toBeGreaterThan(0);
      updated.forEach(measurement => expect(measurement.uid).toBe('service-uid'));
      expect(service.getMeasurement('service-uid')).toMatchObject({
        uid: 'service-uid', points: [{ x: 1, y: 2 }, { x: 4, y: 6 }], metadata: { measurementNumber: 1 },
      });
    });
});

describe('MeasurementService.update', () => {
  it('keeps the uid a record is stored under, whatever the update carries', () => {
    const { service } = apiWith(record('service-uid', 'cornerstone-id', 'Length'));
    const updated = [];
    service.subscribe(service.EVENTS.MEASUREMENT_UPDATED, ({ measurement }) => updated.push(measurement));
    service.update('service-uid', { toolName: 'Length', metadata: { _id: 'cornerstone-id' } });
    expect(service.getMeasurement('service-uid').uid).toBe('service-uid');
    expect(updated.map(measurement => measurement.uid)).toEqual(['service-uid']);
  });
});
