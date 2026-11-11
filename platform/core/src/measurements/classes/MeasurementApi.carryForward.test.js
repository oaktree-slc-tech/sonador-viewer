/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// A save writes the pending out-of-plane measurements and the held ones whose Frame of Reference no
// loaded series shares; other locked measurements stay in the report they were read from

jest.mock('cornerstone-core', () => ({}), { virtual: true });
jest.mock('cornerstone-tools', () => ({
  globalImageIdSpecificToolStateManager: { toolState: {}, setImageIdToolState: () => {} },
}), { virtual: true });
jest.mock('@cornerstonejs/adapters', () => ({
  adaptersSR: { Cornerstone3D: { CodeScheme: { CodingSchemeDesignator: 'CORNERSTONEJS', codeValues: {} } } },
}), { virtual: true });
jest.mock('../../utils', () => ({
  __esModule: true,
  default: { dataProc: { firstDefinedValue: (...values) => values.find(value => value !== undefined) } },
}));
jest.mock('../../utils/studyMetadataManager', () => ({ __esModule: true, default: {} }));
jest.mock('../../log', () => ({ __esModule: true, default: { info: () => {}, warn: () => {}, debug: () => {} } }));
jest.mock('../configuration.js', () => ({ measurementApiDefaultConfig: {} }));
jest.mock('../enums', () => ({ __esModule: true, default: { EVENTS: {} } }));
jest.mock('../lib/refreshCornerstoneViewports', () => ({ __esModule: true, default: () => {} }));
jest.mock('../../DICOMSR/readOnly/srDisplayAnnotations', () => ({
  clearSRDisplayAnnotations: () => {}, setSRDisplayAnnotationVisible: () => {},
}));

import MeasurementApi from './MeasurementApi';
import MeasurementService from '../../services/MeasurementService/MeasurementService';

const STUDY = '2.25.1001';
const caseProgress = { caseProgress: { include: true } };
const EVIDENCE = {
  StudyInstanceUID: STUDY, SeriesInstanceUID: '2.25.5001',
  instances: [{ SOPClassUID: '1.2.840.10008.5.1.4.1.1.2', SOPInstanceUID: '2.25.5001.1' }],
};

const outOfPlane = (uid, lifecycle, metadata = {}) => ({
  uid, toolName: 'Length', referenceStudyUID: STUDY, points: [[0, 0, 0], [0, 10, 0]], FrameOfReferenceUID: '2.25.9999',
  ...lifecycle,
  metadata: { outOfPlane: true, TrackingUniqueIdentifier: `${uid}.tracking`, ...lifecycle, ...metadata },
});

it('passes the pending and the carried-forward out-of-plane measurements to the store, and no other locked one', async () => {
  const store = jest.fn(() => Promise.resolve({}));
  MeasurementApi.setConfiguration({
    server: {},
    dataExchange: { store },
    measurementTools: [{ id: 'allTools', options: caseProgress, childTools: [{ id: 'Length', options: caseProgress }] }],
  });

  const measurementService = new MeasurementService();
  [
    outOfPlane('pending', { isLocked: false, isReadOnly: false }),
    outOfPlane('held', { isLocked: true, isReadOnly: true }, { sourceSeries: '2.25.5001', carriedEvidence: EVIDENCE }),
    // Read without a Source-Series: its evidence names the series of each instance
    outOfPlane('held-unsourced', { isLocked: true, isReadOnly: true }, {
      carriedEvidence: { ...EVIDENCE, instances: [{ ...EVIDENCE.instances[0], StudyInstanceUID: STUDY, SeriesInstanceUID: '2.25.5002' }] },
    }),
    outOfPlane('locked', { isLocked: true, isReadOnly: true }),
    { ...outOfPlane('other-study', { isLocked: true, isReadOnly: true }, { carriedEvidence: EVIDENCE }), referenceStudyUID: '2.25.2001' },
    // Locked by the user, not yet saved: saved with the others
    outOfPlane('user-locked', { isLocked: true, isReadOnly: false }),
  ].forEach(record => measurementService.measurements.set(record.uid, record));

  const api = {
    measurementService,
    timepointApi: { all: () => [{ timepointId: 't0', studyInstanceUIDs: [STUDY], PatientID: 'SYNTHETIC' }] },
    _serviceManagedTool: () => ({ toolServiceManaged: true }),
    serviceMeasurements: () => [],
  };
  measurementService.triggerApiEvent = () => {};
  await MeasurementApi.prototype.storeMeasurements.call(api, null, {});

  expect(store).toHaveBeenCalledTimes(1);
  expect(store.mock.calls[0][0].allTools.map(m => m.uid)).toEqual(['pending', 'held', 'held-unsourced', 'user-locked']);
});

it('passes a pending measurement the user locked to the store, and no saved one', async () => {
  const store = jest.fn(() => Promise.resolve({}));
  MeasurementApi.setConfiguration({
    server: {},
    dataExchange: { store },
    measurementTools: [{ id: 'allTools', options: caseProgress, childTools: [{ id: 'Length', options: caseProgress }] }],
  });
  const records = [
    { uid: 'pending', toolName: 'Length', referenceStudyUID: STUDY, isLocked: false, metadata: {} },
    { uid: 'user-locked', toolName: 'Length', referenceStudyUID: STUDY, isLocked: true, metadata: { isLocked: true } },
    { uid: 'saved', toolName: 'Length', referenceStudyUID: STUDY, isLocked: true, metadata: { isLocked: true, isReadOnly: true } },
  ];
  const measurementService = new MeasurementService();
  measurementService.triggerApiEvent = () => {};
  const api = {
    measurementService,
    timepointApi: { all: () => [{ timepointId: 't0', studyInstanceUIDs: [STUDY], PatientID: 'SYNTHETIC' }] },
    _serviceManagedTool: () => ({ toolServiceManaged: true }),
    serviceMeasurements: filter => records.filter(filter),
  };
  await MeasurementApi.prototype.storeMeasurements.call(api, null, {});

  expect(store.mock.calls[0][0].allTools.map(m => m.uid)).toEqual(['pending', 'user-locked']);
});
