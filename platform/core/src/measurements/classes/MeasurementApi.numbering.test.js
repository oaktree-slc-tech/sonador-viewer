/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// Measurement numbers name the rows of the Measurements panel, so two measurements that share one
// share a row and the second disappears. The API owns the numbers: renumbering reaches the service
// records, an update rebuilt from a record does not restore its old number, a measurement added
// again keeps its number and its single group pointer, a clear takes the group pointers too, and
// any duplicate left is repaired and logged.

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
const mockWarnings = [];
jest.mock('../../log', () => ({ __esModule: true, default: { info: () => {}, warn: (...args) => mockWarnings.push(args.join(' ')), debug: () => {} } }));
jest.mock('../configuration.js', () => ({ measurementApiDefaultConfig: {} }));
jest.mock('../enums', () => ({ __esModule: true, default: { EVENTS: {} } }));
jest.mock('../lib/refreshCornerstoneViewports', () => ({ __esModule: true, default: () => {} }));
jest.mock('../../DICOMSR/readOnly/srDisplayAnnotations', () => ({
  clearSRDisplayAnnotations: () => {}, setSRDisplayAnnotationVisible: () => {},
}));

import MeasurementApi from './MeasurementApi';
import MeasurementService from '../../services/MeasurementService/MeasurementService';

const caseProgress = { caseProgress: { include: true } };
const STUDY = '2.25.1';

function setup() {
  MeasurementApi.setConfiguration({
    server: {},
    measurementTools: [{
      id: 'allTools', options: caseProgress,
      childTools: [{ id: 'Length', options: caseProgress }, { id: 'Angle', options: caseProgress }],
    }],
  });
  const service = new MeasurementService();
  // As the classic source builds an annotation from a record (common.js): it carries the record's number
  const source = {
    name: 'CornerstoneTools', version: '4',
    getAnnotation: (toolType, uid) => {
      const record = service.getMeasurement(uid);
      const { _id, measurementNumber } = record.metadata;
      return {
        _id, toolType, StudyInstanceUID: STUDY, measurementNumber, visible: record.isVisible,
        measurementData: { _id, _measurementServiceId: uid, measurementNumber, visible: record.isVisible },
        metadata: { _id, measurementNumber },
      };
    },
  };
  const api = Object.assign(Object.create(MeasurementApi.prototype), {
    measurementService: service,
    options: { sourceName: 'CornerstoneTools', sourceVersion: '4', onMeasurementsUpdated: () => {}, serviceEventCheckSource: false },
    toolsGroupsMap: { Length: 'allTools', Angle: 'allTools' },
    toolGroupTools: { allTools: ['Length', 'Angle'] },
    timepointApi: { study: () => [{ timepointId: 'tp-1' }], timepoints: [{ timepointId: 'tp-1' }], initialTimepointIds: () => ['tp-1'] },
    toolGroups: { allTools: [] },
    tools: { Length: [], Angle: [] },
  });
  api._serviceManagedTool = () => ({ toolServiceManaged: true, source });
  api.updateMeasurement = (toolType, measurement) => service.measurements.set(measurement.uid, measurement);
  service.subscribe(service.EVENTS.MEASUREMENT_UPDATED, event => api.onServiceMeasurementUpdate(event));

  const add = (n, toolName = 'Length') => {
    const uid = `svc-${n}`;
    service.measurements.set(uid, {
      uid, toolName, source, isVisible: true, data: { _id: `cs-${n}` }, metadata: { _id: `cs-${n}`, toolName },
    });
    return api.addMeasurementRepresentation(toolName, source.getAnnotation(toolName, uid));
  };
  const remove = (n, toolName = 'Length') => {
    const index = api.tools[toolName].findIndex(t => t._id === `cs-${n}`);
    const [representation] = api.tools[toolName].splice(index, 1);
    api.onMeasurementRemoved(toolName, representation);
  };
  const numbers = (toolName = 'Length') => api.tools[toolName].map(t => [t._id, t.measurementNumber]);
  const recordNumbers = () => [...service.measurements.values()].map(m => [m.metadata._id, m.metadata.measurementNumber]);
  return { api, service, source, add, remove, numbers, recordNumbers };
}

beforeEach(() => { mockWarnings.length = 0; });

it('renumbers the service records with the representations after a delete, so hiding one keeps its row', () => {
  const { service, add, remove, numbers, recordNumbers } = setup();
  add(1); add(2); add(3);
  expect(numbers()).toEqual([['cs-1', 1], ['cs-2', 2], ['cs-3', 3]]);

  remove(1);
  expect(numbers()).toEqual([['cs-2', 1], ['cs-3', 2]]);
  expect(recordNumbers()).toEqual([['cs-2', 1], ['cs-3', 2]]);

  // Hiding rebuilds the representation from its record: it keeps its number, and its own row
  service.toggleVisibilityMeasurement('svc-2', false);
  expect(numbers()).toEqual([['cs-2', 1], ['cs-3', 2]]);
  expect(mockWarnings.filter(w => /held twice/.test(w))).toEqual([]);
});

it('does not apply a number an update carries in place of the one the API gave', () => {
  const { api, service, add, numbers } = setup();
  add(1); add(2);
  // A record whose number is out of date (an earlier session's, or one renumbered elsewhere)
  service.getMeasurement('svc-2').metadata.measurementNumber = 1;
  service.toggleVisibilityMeasurement('svc-2', false);
  expect(numbers()).toEqual([['cs-1', 1], ['cs-2', 2]]);
  const [, second] = api.tools.Length;
  expect([second.metadata.measurementNumber, second.measurementData.measurementNumber]).toEqual([2, 2]);
});

it('keeps the number and the single group pointer of a measurement added again (both added events)', () => {
  const { api, source, add, numbers } = setup();
  add(1); add(2); add(3);
  api.addMeasurementRepresentation('Length', source.getAnnotation('Length', 'svc-1'));
  api.addMeasurementRepresentation('Length', source.getAnnotation('Length', 'svc-2'));
  expect(numbers()).toEqual([['cs-1', 1], ['cs-2', 2], ['cs-3', 3]]);
  expect(api.toolGroups.allTools.map(p => [p.toolItemId, p.measurementNumber])).toEqual([['cs-1', 1], ['cs-2', 2], ['cs-3', 3]]);
});

it('numbers measurements across tools without a duplicate, a new one after the others', () => {
  const { add, numbers } = setup();
  add(1); add(2, 'Angle'); add(3);
  expect([...numbers(), ...numbers('Angle')].map(([, n]) => n).sort()).toEqual([1, 2, 3]);
});

it('takes the group pointers with a clear, so the measurements added after it are numbered from 1', () => {
  const { api, add, numbers } = setup();
  add(1); add(2); add(3);
  api.clearMeasurements();
  expect(api.toolGroups.allTools).toEqual([]);
  add(4); add(5);
  expect(numbers()).toEqual([['cs-4', 1], ['cs-5', 2]]);
});

it('repairs a duplicate number left by any other path, with its pointer and record, and logs it', () => {
  const { api, service, add, numbers } = setup();
  add(1); add(2); add(3);
  // Two measurements on number 2, however they got there
  api.tools.Length[2].measurementNumber = 2;
  api.toolGroups.allTools[2].measurementNumber = 2;

  expect(api.repairMeasurementNumbers()).toEqual(['cs-3']);
  expect(numbers()).toEqual([['cs-1', 1], ['cs-2', 2], ['cs-3', 3]]);
  expect(api.toolGroups.allTools[2].measurementNumber).toBe(3);
  expect(service.getMeasurement('svc-3').metadata.measurementNumber).toBe(3);
  expect(mockWarnings.some(w => /measurement number 2 was held twice.*cs-3 is renumbered 3/.test(w))).toBe(true);
});

it('fills only the empty group pointer a tool reserved, leaving the timepoint\'s other pointers', () => {
  const { api, add, remove, numbers } = setup();
  add(1); add(2);
  // A pointer a tool reserved before its measurement had data
  api.toolGroups.allTools.push({ timepointId: 'tp-1', measurementNumber: 3 });
  add(3);

  expect(api.toolGroups.allTools.map(p => [p.toolId, p.toolItemId, p.measurementNumber])).toEqual([
    ['Length', 'cs-1', 1], ['Length', 'cs-2', 2], ['Length', 'cs-3', 3],
  ]);
  expect(api.fetch('allTools').map(m => m._id)).toEqual(['cs-1', 'cs-2', 'cs-3']);

  remove(2);
  expect(numbers()).toEqual([['cs-1', 1], ['cs-3', 2]]);
  expect(api.fetch('allTools').map(m => [m._id, m.measurementNumber])).toEqual([['cs-1', 1], ['cs-3', 2]]);
});
