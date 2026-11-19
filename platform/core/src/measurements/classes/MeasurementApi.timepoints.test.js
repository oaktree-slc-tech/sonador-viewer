/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// Timepoints in the Measurements API: series membership from the documents read (the current
// document of a series decides, in any load order), the descriptors it registers, aggregation and
// the active timepoint, the review-only rules (no save, no new annotation), the save refusal, the
// numbering of defined-timepoint records, and the session clear.

jest.mock('cornerstone-core', () => ({}), { virtual: true });
jest.mock('cornerstone-tools', () => ({
  globalImageIdSpecificToolStateManager: { toolState: {}, saveToolState: () => ({}), restoreToolState: () => {}, setImageIdToolState: () => {} },
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
jest.mock('../../log', () => ({
  __esModule: true,
  default: { info: () => {}, warn: (...args) => mockWarnings.push(args.join(' ')), debug: () => {}, error: () => {} },
}));
jest.mock('../configuration.js', () => ({ measurementApiDefaultConfig: {}, timepointApiDefaultConfig: {} }));
jest.mock('../enums', () => ({
  __esModule: true,
  default: {
    EVENTS: { TIMEPOINTS_CHANGED: 'api-event::timepoints::changed', MEASUREMENT_PERSIST_START: 'api-event:measurements:save:start' },
    TIMEPOINT_ERRORS: { SAVE_REFUSED: 'TimepointSaveRefused' },
  },
}));
jest.mock('../lib/refreshCornerstoneViewports', () => ({ __esModule: true, default: () => {} }));
jest.mock('../../DICOMSR/readOnly/srDisplayAnnotations', () => ({
  clearSRDisplayAnnotations: () => {}, setSRDisplayAnnotationVisible: () => {}, getSRDisplayAnnotations: () => [],
}));

import MeasurementApi from './MeasurementApi';
import TimepointApi from './TimepointApi';
import MeasurementService from '../../services/MeasurementService/MeasurementService';
import Enums from '../enums';
import { clearHydratedReports, registerHydratedReport, saveParent, setSaveParentExclusion } from '../../DICOMSR/utils/srDocument';
import { timepointIdFor } from '../../DICOMSR/utils/timepoint';

const STUDY = '2.25.1001';
const OTHER_STUDY = '2.25.2001';
const DEFAULT_ID = 'TimepointId';
const caseProgress = { caseProgress: { include: true } };

const TP_A = { uid: '2.25.71', id: 'TP-A', date: '20261104', time: '093000', description: 'Post-operative review, 6 weeks', dateValid: true, timeValid: true };
const TP_B = { uid: '2.25.72', id: 'TP-B', date: '20260101', time: null, description: 'Baseline', dateValid: true, timeValid: true };

/** A document of a series: { StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID, ContentDate/Time, predecessors } */
const document = (series, sop, { study = STUDY, content = '20260101', time = '120000', predecessors = [] } = {}) => ({
  StudyInstanceUID: study, SeriesInstanceUID: series, SOPInstanceUID: sop, ContentDate: content, ContentTime: time,
  PredecessorDocumentsSequence: predecessors.length ? [{ ReferencedSeriesSequence: [{ ReferencedSOPSequence: predecessors.map(uid => ({ ReferencedSOPInstanceUID: uid })) }] }] : undefined,
});

function setup() {
  MeasurementApi.setConfiguration({
    server: {},
    measurementTools: [{
      id: 'allTools', options: caseProgress,
      childTools: [{ id: 'Length', options: caseProgress }, { id: 'Angle', options: caseProgress }],
    }],
  });
  const service = new MeasurementService();
  const timepointApi = new TimepointApi(DEFAULT_ID, { onTimepointsUpdated: () => {} });
  timepointApi.timepoints = [{ timepointId: DEFAULT_ID, timepointType: 'baseline', isDefault: true, studyInstanceUIDs: [STUDY, OTHER_STUDY], PatientID: 'P' }];
  timepointApi.setCurrentTimepointId(DEFAULT_ID);
  const source = {
    name: 'CornerstoneTools', version: '4',
    getAnnotation: (toolType, uid) => {
      const record = service.getMeasurement(uid);
      const { _id, measurementNumber, srDocument } = record.metadata;
      return {
        _id, toolType, StudyInstanceUID: STUDY, measurementNumber, visible: record.isVisible, namingNumber: record.metadata.namingNumber,
        location: record.metadata.location, description: record.metadata.description,
        measurementData: { _id, _measurementServiceId: uid, measurementNumber, visible: record.isVisible },
        metadata: { _id, measurementNumber, srDocument },
      };
    },
  };
  const api = Object.assign(Object.create(MeasurementApi.prototype), {
    measurementService: service,
    timepointApi,
    timepointSeries: new Map(),
    options: { sourceName: 'CornerstoneTools', sourceVersion: '4', onMeasurementsUpdated: () => {}, serviceEventCheckSource: false },
    toolsGroupsMap: { Length: 'allTools', Angle: 'allTools' },
    toolGroupTools: { allTools: ['Length', 'Angle'] },
    toolGroups: { allTools: [] },
    tools: { Length: [], Angle: [] },
  });
  api._serviceManagedTool = () => ({ toolServiceManaged: true, source });
  // As initialize() installs it: a series that joined a defined timepoint is never a save parent
  setSaveParentExclusion(report => api.seriesHasDefinedTimepoint(report && report.SeriesInstanceUID));
  api.updateMeasurement = (toolType, measurement) => service.measurements.set(measurement.uid, measurement);
  api.syncMeasurementsAndToolData = () => {};
  service.subscribe(service.EVENTS.MEASUREMENT_UPDATED, event => api.onServiceMeasurementUpdate(event));

  /** A hydrated record (of a document when srDocument is given), with its representation */
  const add = (n, { srDocument, toolName = 'Length', namingNumber, location, description, study = STUDY } = {}) => {
    const uid = `svc-${n}`;
    service.measurements.set(uid, {
      uid, toolName, source, isVisible: true, referenceStudyUID: study, data: { _id: `cs-${n}` },
      metadata: { _id: `cs-${n}`, toolName, srDocument, namingNumber, location, description, isReadOnly: Boolean(srDocument) },
    });
    return api.addMeasurementRepresentation(toolName, source.getAnnotation(toolName, uid));
  };
  const events = [];
  service.subscribe(service.EVENTS.MEASUREMENTS_DATASYNC, ({ apiEvent }) => events.push(apiEvent));
  return { api, service, timepointApi, add, events };
}

beforeEach(() => {
  mockWarnings.length = 0;
  clearHydratedReports();
});


describe('membership and descriptors', () => {
  it('registers a defined timepoint for a document, keyed by study and UID, and places the document\'s annotations in it', () => {
    const { api, add } = setup();
    api.registerDocumentTimepoint(document('S1', 'D1'), TP_A);
    const id = timepointIdFor(STUDY, TP_A.uid);
    const timepoints = api.getTimepoints();
    expect(timepoints.map(tp => tp.timepointId)).toEqual([DEFAULT_ID, id]);
    expect(timepoints[1]).toMatchObject({
      timepointType: 'defined', uid: TP_A.uid, id: 'TP-A', date: '20261104', time: '093000', description: TP_A.description,
      studyInstanceUIDs: [STUDY], seriesInstanceUIDs: ['S1'], measurementCount: 0, landmarkSetCount: 0,
    });

    const fromDocument = add(1, { srDocument: { StudyInstanceUID: STUDY, SeriesInstanceUID: 'S1', SOPInstanceUID: 'D1' } });
    const drawn = add(2);
    expect(fromDocument.timepointId).toBe(id);
    expect(drawn.timepointId).toBe(DEFAULT_ID);
    expect(api.timepointIdOf(api.measurementService.getMeasurement('svc-1'))).toBe(id);
    expect(api.getTimepoints()[1].measurementCount).toBe(1);
    expect(api.getMeasurementsForTimepoint(id).map(entry => entry.measurement.uid)).toEqual(['svc-1']);
    expect(api.getMeasurementsForTimepoint(DEFAULT_ID).map(entry => entry.measurement.uid)).toEqual(['svc-2']);
    // The listed measurements by timepoint are those by series, each under one timepoint
    const bySeriesTotal = [...api.getMeasurementsBySeries().values()].reduce((sum, list) => sum + list.length, 0);
    const byTimepointTotal = [...api.getMeasurementsByTimepoint().values()].reduce((sum, list) => sum + list.length, 0);
    expect(byTimepointTotal).toBe(bySeriesTotal);
  });

  it('a series without a timepoint, and an annotation drawn in the Viewer, belong to Study Date/Time', () => {
    const { api, add } = setup();
    api.registerDocumentTimepoint(document('S1', 'D1'), null);
    expect(api.getTimepoints().map(tp => tp.timepointId)).toEqual([DEFAULT_ID]);
    expect(add(1, { srDocument: { SeriesInstanceUID: 'S1', SOPInstanceUID: 'D1' } }).timepointId).toBe(DEFAULT_ID);
    expect(add(2).timepointId).toBe(DEFAULT_ID);
  });

  it.each([['older first'], ['newer first']])('two revisions, the older without a timepoint and the newer with one, read %s: every annotation ends in the newer\'s timepoint and neither is a save parent', (order) => {
    const { api, add, service } = setup();
    const older = document('S1', 'R1', { content: '20260101' });
    const newer = document('S1', 'R2', { content: '20260201', predecessors: ['R1'] });
    const id = timepointIdFor(STUDY, TP_A.uid);
    const read = (doc, tp, n) => {
      api.registerDocumentTimepoint(doc, tp);
      registerHydratedReport({ ...doc, SOPClassUID: '1.2.840.10008.5.1.4.1.1.88.34' });
      add(n, { srDocument: { StudyInstanceUID: STUDY, SeriesInstanceUID: 'S1', SOPInstanceUID: doc.SOPInstanceUID } });
    };
    if (order === 'older first') {
      read(older, null, 1);
      expect(api.tools.Length[0].timepointId).toBe(DEFAULT_ID);
      read(newer, TP_A, 2);
    } else {
      read(newer, TP_A, 2);
      read(older, null, 1);
    }
    expect(api.tools.Length.map(rep => rep.timepointId)).toEqual([id, id]);
    expect(service.getMeasurements().map(record => record.metadata.timepointId)).toEqual([id, id]);
    expect(api.toolGroups.allTools.map(pointer => pointer.timepointId)).toEqual([id, id]);
    expect(api.getTimepoints()[1].measurementCount).toBe(2);
    expect(api.seriesHasDefinedTimepoint('S1')).toBe(true);
    expect(saveParent(STUDY)).toBeNull();
    // A document of another series stays a parent
    registerHydratedReport({ ...document('S9', 'X1'), SOPClassUID: '1.2.840.10008.5.1.4.1.1.88.34' });
    expect(saveParent(STUDY)).toMatchObject({ SOPInstanceUID: 'X1' });
  });

  it.each([['first then second'], ['second then first']])('two revisions with different timepoint UIDs, read %s: the newer applies and a conflict is logged', (order) => {
    const { api } = setup();
    const r1 = document('S1', 'R1', { content: '20260101' });
    const r2 = document('S1', 'R2', { content: '20260201' });
    const reads = order === 'first then second' ? [[r1, TP_B], [r2, TP_A]] : [[r2, TP_A], [r1, TP_B]];
    reads.forEach(([doc, tp]) => api.registerDocumentTimepoint(doc, tp));
    expect(api.seriesTimepoint('S1').timepoint.uid).toBe(TP_A.uid);
    expect(api.getTimepoints().map(tp => tp.uid)).toEqual([undefined, TP_A.uid]);
    expect(mockWarnings.some(line => line.includes('timepoint-series-conflict'))).toBe(true);
  });

  it('three revisions where C names B and B names A, with A carrying the latest timestamp: C is current in all six orders', () => {
    const A = document('S1', 'A', { content: '20260301' });
    const B = document('S1', 'B', { content: '20260201', predecessors: ['A'] });
    const C = document('S1', 'C', { content: '20260101', predecessors: ['B'] });
    const timepoints = { A: TP_B, B: null, C: TP_A };
    const orders = [[A, B, C], [A, C, B], [B, A, C], [B, C, A], [C, A, B], [C, B, A]];
    orders.forEach((docs) => {
      const { api } = setup();
      docs.forEach(doc => api.registerDocumentTimepoint(doc, timepoints[doc.SOPInstanceUID]));
      expect(api.seriesTimepoint('S1').SOPInstanceUID).toBe('C');
      expect(api.seriesTimepoint('S1').timepoint.uid).toBe(TP_A.uid);
    });
  });

  it('the same UID in two loaded studies gives two descriptors, each with its study, and no mixed annotations', () => {
    const { api, add } = setup();
    api.registerDocumentTimepoint(document('S1', 'D1', { study: STUDY }), TP_A);
    api.registerDocumentTimepoint(document('S2', 'D2', { study: OTHER_STUDY }), TP_A);
    const ids = api.getTimepoints().slice(1).map(tp => tp.timepointId);
    expect(ids).toEqual([timepointIdFor(STUDY, TP_A.uid), timepointIdFor(OTHER_STUDY, TP_A.uid)]);
    expect(api.getTimepoints().slice(1).map(tp => tp.studyInstanceUIDs)).toEqual([[STUDY], [OTHER_STUDY]]);
    add(1, { srDocument: { StudyInstanceUID: STUDY, SeriesInstanceUID: 'S1', SOPInstanceUID: 'D1' } });
    add(2, { srDocument: { StudyInstanceUID: OTHER_STUDY, SeriesInstanceUID: 'S2', SOPInstanceUID: 'D2' }, study: OTHER_STUDY });
    expect(api.getMeasurementsForTimepoint(ids[0]).map(entry => entry.measurement.uid)).toEqual(['svc-1']);
    expect(api.getMeasurementsForTimepoint(ids[1]).map(entry => entry.measurement.uid)).toEqual(['svc-2']);
  });

  it.each([['lower series first'], ['higher series first']])('members of one UID that differ in time log a warning; the values are the lowest Series Instance UID\'s, read %s', (order) => {
    const { api } = setup();
    const lower = [document('S1', 'D1'), TP_A];
    const higher = [document('S2', 'D2'), { ...TP_A, time: '101500' }];
    (order === 'lower series first' ? [lower, higher] : [higher, lower]).forEach(([doc, tp]) => api.registerDocumentTimepoint(doc, tp));
    const [, defined] = api.getTimepoints();
    expect(defined.time).toBe('093000');
    expect(defined.seriesInstanceUIDs).toEqual(['S1', 'S2']);
    expect(mockWarnings.some(line => line.includes('timepoint-attribute-mismatch'))).toBe(true);
  });

  it('orders the defined timepoints by the contract and removes a descriptor that loses its last member', () => {
    const { api } = setup();
    api.registerDocumentTimepoint(document('S1', 'D1'), TP_A);
    api.registerDocumentTimepoint(document('S2', 'D2'), TP_B);
    expect(api.getTimepoints().map(tp => tp.uid)).toEqual([undefined, TP_B.uid, TP_A.uid]);

    api.setActiveTimepoint(timepointIdFor(STUDY, TP_B.uid));
    // A newer revision without a timepoint takes S2 out of its timepoint: the descriptor goes, the default is active
    api.registerDocumentTimepoint(document('S2', 'D3', { content: '20270101', predecessors: ['D2'] }), null);
    expect(api.getTimepoints().map(tp => tp.uid)).toEqual([undefined, TP_A.uid]);
    expect(api.getActiveTimepointId()).toBe(DEFAULT_ID);
  });

  it('a document that holds only landmark sets is registered the same way, and ignores one without a series', () => {
    const { api } = setup();
    api.registerDocumentTimepoint({ StudyInstanceUID: STUDY, SeriesInstanceUID: 'S1', SOPInstanceUID: 'L1' }, TP_A);
    expect(api.getTimepoints()).toHaveLength(2);
    api.registerDocumentTimepoint({ StudyInstanceUID: STUDY }, TP_B);
    expect(api.getTimepoints()).toHaveLength(2);
  });
});


describe('the active timepoint', () => {
  it('refuses an unknown id before any change, and announces one event for a valid change', () => {
    const { api, events } = setup();
    api.registerDocumentTimepoint(document('S1', 'D1'), TP_A);
    events.length = 0;
    expect(api.setActiveTimepoint('timepoint:nope')).toBe(false);
    expect(api.getActiveTimepointId()).toBe(DEFAULT_ID);
    expect(events).toEqual([]);

    const id = timepointIdFor(STUDY, TP_A.uid);
    expect(api.setActiveTimepoint(id)).toBe(true);
    expect(api.getActiveTimepointId()).toBe(id);
    expect(api.getActiveTimepoint()).toMatchObject({ timepointId: id, timepointType: 'defined' });
    expect(events).toEqual([Enums.EVENTS.TIMEPOINTS_CHANGED]);
    expect(api.canCreateAnnotations()).toBe(false);
    expect(api.setActiveTimepoint(id)).toBe(true);
    expect(events).toHaveLength(1);
  });

  it('shows the active timepoint\'s annotations only, and keeps a user-hidden one hidden across a change and back', () => {
    const { api, add, service } = setup();
    api.registerDocumentTimepoint(document('S1', 'D1'), TP_A);
    const id = timepointIdFor(STUDY, TP_A.uid);
    add(1, { srDocument: { StudyInstanceUID: STUDY, SeriesInstanceUID: 'S1', SOPInstanceUID: 'D1' } });
    add(2);
    add(3);
    expect(service.getMeasurement('svc-1').isVisible).toBe(false);
    expect(service.getMeasurement('svc-2').isVisible).toBe(true);

    api.toggleVisibilityMeasurement('cs-3', false);
    expect(service.getMeasurement('svc-3').isVisible).toBe(false);
    api.setActiveTimepoint(id);
    expect(service.getMeasurement('svc-1').isVisible).toBe(true);
    expect(service.getMeasurement('svc-2').isVisible).toBe(false);
    expect(api.areAllMeasurementsHidden()).toBe(false);
    api.setActiveTimepoint(DEFAULT_ID);
    expect(service.getMeasurement('svc-1').isVisible).toBe(false);
    expect(service.getMeasurement('svc-2').isVisible).toBe(true);
    expect(service.getMeasurement('svc-3').isVisible).toBe(false);

    // Show all and Hide all act within the active timepoint
    api.setAllMeasurementsVisibility(false);
    expect(api.areAllMeasurementsHidden()).toBe(true);
    api.setAllMeasurementsVisibility(true);
    expect(service.getMeasurement('svc-3').isVisible).toBe(true);
    expect(service.getMeasurement('svc-1').isVisible).toBe(false);
  });

  it('a service record that arrives from another source, with no representation, is hidden at once while a defined timepoint is active', () => {
    const { api, service } = setup();
    api.options.serviceEventCheckSource = true;
    service.subscribe(service.EVENTS.RAW_MEASUREMENT_ADDED, event => api.onServiceRawMeasurementAdded(event));
    api.registerDocumentTimepoint(document('S1', 'D1'), TP_A);
    api.setActiveTimepoint(timepointIdFor(STUDY, TP_A.uid));

    // An out-of-plane record of a Cornerstone3D source: the API adds no classic representation for it
    const foreign = { name: 'Cornerstone3DTools-Sonador', version: '0.1' };
    const record = {
      uid: 'oop-1', toolName: 'Length', source: foreign, isVisible: true, referenceStudyUID: STUDY, points: [[0, 0, 0], [0, 10, 0]],
      metadata: { outOfPlane: true, toolName: 'Length' },
    };
    service.measurements.set(record.uid, record);
    service._broadcastEvent(service.EVENTS.RAW_MEASUREMENT_ADDED, { source: foreign, measurement: record, data: {} });
    expect(api.tools.Length).toHaveLength(0);
    expect(record.isVisible).toBe(false);

    // An update made outside the rule does not show it
    service.toggleVisibilityMeasurement(record.uid, true);
    expect(record.isVisible).toBe(false);

    api.setActiveTimepoint(DEFAULT_ID);
    expect(record.isVisible).toBe(true);
    expect(record.points).toEqual([[0, 0, 0], [0, 10, 0]]);
  });

  it('a measurement added while a defined timepoint is active belongs to Study Date/Time and is hidden at once', () => {
    const { api, add, service } = setup();
    api.registerDocumentTimepoint(document('S1', 'D1'), TP_A);
    api.setActiveTimepoint(timepointIdFor(STUDY, TP_A.uid));
    const drawn = add(1);
    expect(drawn.timepointId).toBe(DEFAULT_ID);
    expect(service.getMeasurement('svc-1').isVisible).toBe(false);
  });
});


describe('saving', () => {
  const configureStore = () => {
    const store = jest.fn(() => Promise.resolve({}));
    MeasurementApi.setConfiguration({ dataExchange: { store } });
    return store;
  };

  it('refuses a save while a defined timepoint is active, with a named error, before the persist start event', async () => {
    const { api, service } = setup();
    const store = configureStore();
    api.registerDocumentTimepoint(document('S1', 'D1'), TP_A);
    api.setActiveTimepoint(timepointIdFor(STUDY, TP_A.uid));
    const triggered = jest.spyOn(service, 'triggerApiEvent');
    await expect(api.storeMeasurements(undefined, {})).rejects.toMatchObject({ name: Enums.TIMEPOINT_ERRORS.SAVE_REFUSED });
    await expect(api.storeMeasurements(DEFAULT_ID, {})).rejects.toMatchObject({ name: Enums.TIMEPOINT_ERRORS.SAVE_REFUSED });
    expect(triggered).not.toHaveBeenCalled();
    expect(store).not.toHaveBeenCalled();
  });

  it('refuses a defined target id on Study Date/Time, and saves the eligible records otherwise', async () => {
    const { api, add, service } = setup();
    const store = configureStore();
    api.registerDocumentTimepoint(document('S1', 'D1'), TP_A);
    const id = timepointIdFor(STUDY, TP_A.uid);
    await expect(api.storeMeasurements(id, {})).rejects.toMatchObject({ name: Enums.TIMEPOINT_ERRORS.SAVE_REFUSED });
    expect(store).not.toHaveBeenCalled();

    add(1, { srDocument: { StudyInstanceUID: STUDY, SeriesInstanceUID: 'S1', SOPInstanceUID: 'D1' } });
    add(2);
    // The document's record is read-only (saved) in any case; a pending record of its series would be left out too
    service.getMeasurement('svc-1').metadata.isReadOnly = false;
    expect(api.isSaveEligible(service.getMeasurement('svc-1'))).toBe(false);
    expect(api.isSaveEligible(service.getMeasurement('svc-2'))).toBe(true);
    api.serviceMeasurements = filter => service.getMeasurements().filter(filter);
    service.triggerApiEvent = () => {};
    await api.storeMeasurements(undefined, {});
    expect(store).toHaveBeenCalledTimes(1);
    expect(store.mock.calls[0][0].allTools.map(m => m.uid)).toEqual(['svc-2']);
  });
});


describe('numbering', () => {
  it.each([['default first'], ['defined first']])('a defined-timepoint record and a Study Date/Time record with one naming number, %s: neither inherits from the other', (order) => {
    const { api, add } = setup();
    api.registerDocumentTimepoint(document('S1', 'D1'), TP_A);
    const defined = () => add(1, {
      srDocument: { StudyInstanceUID: STUDY, SeriesInstanceUID: 'S1', SOPInstanceUID: 'D1' }, namingNumber: 7, location: 'Femur', description: 'From the document',
    });
    const drawn = () => add(2, { namingNumber: 7 });
    const [first, second] = order === 'default first' ? [drawn(), defined()] : [defined(), drawn()];
    const byId = Object.fromEntries([first, second].map(rep => [rep._id, rep]));
    expect(byId['cs-2'].location).toBeUndefined();
    expect(byId['cs-2'].description).toBeUndefined();
    expect(byId['cs-1'].location).toBe('Femur');
    expect(byId['cs-1'].description).toBe('From the document');
    expect(byId['cs-1'].timepointId).toBe(timepointIdFor(STUDY, TP_A.uid));
    expect(byId['cs-2'].timepointId).toBe(DEFAULT_ID);
  });

  it('two Study Date/Time records with one naming number match as today', () => {
    const { api, add } = setup();
    add(1, { namingNumber: 7, location: 'Femur', description: 'First' });
    const second = add(2, { namingNumber: 7 });
    expect(second.location).toBe('Femur');
    expect(second.description).toBe('First');
    // Numbers stay unique within the timepoint (repairMeasurementNumbers)
    expect(api.tools.Length.map(rep => rep.measurementNumber)).toEqual([1, 2]);
  });

  it('renumbers after a deletion within the deleted record\'s timepoint only', () => {
    const { api, add, service } = setup();
    api.registerDocumentTimepoint(document('S1', 'D1'), TP_A);
    const doc = { StudyInstanceUID: STUDY, SeriesInstanceUID: 'S1', SOPInstanceUID: 'D1' };
    const first = add(1);
    add(2);
    const defined = add(3, { srDocument: doc });
    expect(api.tools.Length.map(rep => rep.measurementNumber)).toEqual([1, 2, 1]);

    const index = api.tools.Length.findIndex(rep => rep._id === first._id);
    const [removed] = api.tools.Length.splice(index, 1);
    api.onMeasurementRemoved('Length', removed);

    // The remaining Study Date/Time record is numbered 1, as without the defined record; the defined one is untouched
    expect(api.tools.Length.map(rep => [rep._id, rep.measurementNumber])).toEqual([['cs-2', 1], ['cs-3', 1]]);
    expect(service.getMeasurement('svc-3').metadata.measurementNumber).toBe(defined.measurementNumber);
    expect(api.toolGroups.allTools.map(pointer => [pointer.toolItemId, pointer.measurementNumber])).toEqual([['cs-2', 1], ['cs-3', 1]]);
  });

  it('numbers the records of a defined timepoint within it, apart from Study Date/Time', () => {
    const { api, add } = setup();
    api.registerDocumentTimepoint(document('S1', 'D1'), TP_A);
    const doc = { StudyInstanceUID: STUDY, SeriesInstanceUID: 'S1', SOPInstanceUID: 'D1' };
    add(1);
    add(2);
    const a = add(3, { srDocument: doc });
    const b = add(4, { srDocument: doc });
    expect([a.measurementNumber, b.measurementNumber]).toEqual([1, 2]);
    expect(api.tools.Length.slice(0, 2).map(rep => rep.measurementNumber)).toEqual([1, 2]);
  });
});


describe('clearing', () => {
  it('removes the defined descriptors and the membership, and makes Study Date/Time active again', () => {
    const { api, events } = setup();
    api.registerDocumentTimepoint(document('S1', 'D1'), TP_A);
    api.setActiveTimepoint(timepointIdFor(STUDY, TP_A.uid));
    events.length = 0;
    MeasurementApi.prototype.clearMeasurements.call(api);
    expect(api.getTimepoints().map(tp => tp.timepointId)).toEqual([DEFAULT_ID]);
    expect(api.getActiveTimepointId()).toBe(DEFAULT_ID);
    expect(api.timepointSeries.size).toBe(0);
    expect(api.seriesHasDefinedTimepoint('S1')).toBe(false);
    expect(events).toContain(Enums.EVENTS.TIMEPOINTS_CHANGED);
  });
});
