/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// One copy per tracking UID (DICOMSR/utils/measurementCopies.js) against the production Measurements
// API and measurement service: a copy replaced by one of higher precedence leaves no classic
// representation, group entry, tool state or service record behind, and a failed import leaves the
// held copy, its tool state and its protection from saves as they were.

const mockToolState = {};
jest.mock('cornerstone-core', () => ({}), { virtual: true });
jest.mock('cornerstone-tools', () => ({
  globalImageIdSpecificToolStateManager: {
    get toolState() { return mockToolState; },
    saveToolState: () => mockToolState,
    restoreToolState: (state) => { Object.assign(mockToolState, state); },
  },
}), { virtual: true });
jest.mock('@cornerstonejs/adapters', () => ({
  adaptersSR: { Cornerstone3D: { CodeScheme: { CodingSchemeDesignator: 'CORNERSTONEJS', codeValues: {} } } },
}), { virtual: true });
jest.mock('../../utils', () => ({
  __esModule: true,
  default: { dataProc: { firstDefinedValue: (...values) => values.find(value => value !== undefined) } },
}));
jest.mock('../../utils/studyMetadataManager', () => ({ __esModule: true, default: { get: () => undefined } }));
jest.mock('../../log', () => ({ __esModule: true, default: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } }));
jest.mock('../configuration.js', () => ({ measurementApiDefaultConfig: {} }));
jest.mock('../enums', () => ({ __esModule: true, default: { EVENTS: {} } }));
jest.mock('../lib/refreshCornerstoneViewports', () => ({ __esModule: true, default: () => {} }));
jest.mock('../lib/getImageIdForImagePath', () => ({ __esModule: true, default: () => 'wadors:image' }));
const mockOverlays = new Set();
jest.mock('../../DICOMSR/readOnly/srDisplayAnnotations', () => ({
  clearSRDisplayAnnotations: () => {},
  setSRDisplayAnnotationVisible: () => {},
  hasSRDisplayAnnotation: uid => mockOverlays.has(uid),
  removeSRDisplayAnnotation: uid => mockOverlays.delete(uid),
}));

import MeasurementApi from './MeasurementApi';
import MeasurementService from '../../services/MeasurementService/MeasurementService';
import { showCopy } from '../../DICOMSR/utils/measurementCopies';
import { clearHydratedReports, isApplicationMeasurement } from '../../DICOMSR/utils/srDocument';

const caseProgress = { caseProgress: { include: true } };
const SHARED = '2.25.700';
const application = (SOPInstanceUID, content, predecessors = []) => ({
  order: { SOPInstanceUID, predecessors, content, creation: '' },
});

function setup() {
  MeasurementApi.setConfiguration({
    server: {},
    measurementTools: [{ id: 'allTools', options: caseProgress, childTools: [{ id: 'Length', options: caseProgress }] }],
  });
  const service = new MeasurementService();
  const source = { name: 'CornerstoneTools', version: '4', getAnnotation: () => ({}) };
  const api = Object.assign(Object.create(MeasurementApi.prototype), {
    measurementService: service,
    options: { sourceName: 'CornerstoneTools', sourceVersion: '4', onMeasurementsUpdated: () => {}, serviceEventCheckSource: false },
    toolsGroupsMap: { Length: 'allTools' },
    toolGroupTools: { allTools: ['Length'] },
    timepointApi: { study: () => [{ timepointId: 'tp-1' }], timepoints: [{ timepointId: 'tp-1' }], initialTimepointIds: () => ['tp-1'] },
    toolGroups: { allTools: [] },
    tools: { Length: [] },
  });
  api._serviceManagedTool = () => ({ toolServiceManaged: true, source });
  api.syncMeasurementsAndToolData = () => {};

  // As the classic bridge imports a hydrated Length: a service record, its classic representation
  // with its group entry, and its tool state on the image
  let counter = 0;
  const importer = (handles, { fail = false } = {}) => () => {
    if (fail) {
      return false;
    }
    counter += 1;
    const uid = `svc-${counter}`;
    const _id = `cs-${counter}`;
    service.measurements.set(uid, {
      uid, toolName: 'Length', source, data: { _id }, metadata: { _id, toolName: 'Length', TrackingUniqueIdentifier: SHARED },
    });
    api.addMeasurementRepresentation('Length', {
      _id, toolType: 'Length', StudyInstanceUID: '2.25.1', imagePath: 'image', handles,
      measurementData: { _id, _measurementServiceId: uid, TrackingUniqueIdentifier: SHARED },
      metadata: { _id, TrackingUniqueIdentifier: SHARED },
    });
    mockToolState['wadors:image'] = mockToolState['wadors:image'] || { Length: { data: [] } };
    mockToolState['wadors:image'].Length.data.push({ _id, handles });
    return true;
  };
  const state = () => ({
    representations: api.tools.Length.map(entry => entry.handles),
    groupEntries: api.toolGroups.allTools.length,
    toolState: ((mockToolState['wadors:image'] || {}).Length || { data: [] }).data.map(entry => entry.handles),
    records: service.getMeasurements().length,
  });
  // As the parser holds an off-slice Length: a service record only
  const heldImporter = label => () => {
    counter += 1;
    const uid = `held-${counter}`;
    service.measurements.set(uid, { uid, toolName: 'Length', source, label, metadata: { outOfPlane: true, TrackingUniqueIdentifier: SHARED } });
    return true;
  };
  const context = { measurementApi: api, measurementService: service };
  return { api, service, importer, heldImporter, state, context };
}

beforeEach(() => {
  clearHydratedReports();
  mockOverlays.clear();
  Object.keys(mockToolState).forEach(key => delete mockToolState[key]);
});


describe('a placed copy replaced through the production Measurements API', () => {
  it('an exchange copy replaces an application copy: one representation, group entry, tool state and record remain', () => {
    const { importer, state, context } = setup();
    expect(showCopy(SHARED, { application: application('2.25.1', '20261101'), importer: importer('plan') }, context)).toBe(true);
    expect(isApplicationMeasurement(SHARED)).toBe(true);

    expect(showCopy(SHARED, { importer: importer('exchange') }, context)).toBe(true);
    expect(state()).toEqual({ representations: ['exchange'], groupEntries: 1, toolState: ['exchange'], records: 1 });
    // Saved as the exchange document's
    expect(isApplicationMeasurement(SHARED)).toBe(false);
  });

  it('a failed exchange import leaves the application copy shown and protected; a retry then replaces it', () => {
    const { importer, state, context } = setup();
    showCopy(SHARED, { application: application('2.25.1', '20261101'), importer: importer('plan') }, context);

    expect(showCopy(SHARED, { importer: importer('exchange', { fail: true }) }, context)).toBe(false);
    expect(state()).toEqual({ representations: ['plan'], groupEntries: 1, toolState: ['plan'], records: 1 });
    expect(isApplicationMeasurement(SHARED)).toBe(true);

    expect(showCopy(SHARED, { importer: importer('exchange') }, context)).toBe(true);
    expect(state()).toEqual({ representations: ['exchange'], groupEntries: 1, toolState: ['exchange'], records: 1 });
  });

  it('an import that throws leaves the held copy as it was', () => {
    const { importer, state, context } = setup();
    showCopy(SHARED, { application: application('2.25.1', '20261101'), importer: importer('plan') }, context);
    expect(() => showCopy(SHARED, { importer: () => { throw new Error('not mapped'); } }, context)).toThrow('not mapped');
    expect(state()).toEqual({ representations: ['plan'], groupEntries: 1, toolState: ['plan'], records: 1 });
    expect(isApplicationMeasurement(SHARED)).toBe(true);
  });

  it('an application copy never replaces an exchange copy', () => {
    const { importer, state, context } = setup();
    showCopy(SHARED, { importer: importer('exchange') }, context);
    expect(showCopy(SHARED, { application: application('2.25.1', '20261101'), importer: importer('plan') }, context)).toBe(false);
    expect(state().representations).toEqual(['exchange']);
    expect(isApplicationMeasurement(SHARED)).toBe(false);
  });
});


describe('the current application document, whatever the order its documents arrive in', () => {
  // A names nothing, B names A, C names B; content dates November 5, 1 and 2
  const A = application('2.25.A', '20261105');
  const B = application('2.25.B', '20261101', ['2.25.A']);
  const C = application('2.25.C', '20261102', ['2.25.B']);
  const orders = [['A', 'B', 'C'], ['A', 'C', 'B'], ['B', 'A', 'C'], ['B', 'C', 'A'], ['C', 'A', 'B'], ['C', 'B', 'A']];

  orders.forEach((order) => {
    it(`shows C after ${order.join(', ')}`, () => {
      const { importer, state, context } = setup();
      const documents = { A, B, C };
      order.forEach(name => showCopy(SHARED, { application: documents[name], importer: importer(name) }, context));
      expect(state()).toEqual({ representations: ['C'], groupEntries: 1, toolState: ['C'], records: 1 });
      expect(isApplicationMeasurement(SHARED)).toBe(true);
    });
  });
});


describe('read-only display copies', () => {
  it('an exchange copy retires an earlier read-only display annotation of an application document', () => {
    const { importer, state, context } = setup();
    // As the read-only display draws a group of an unregistered tool off the acquired images
    const drawOverlay = () => { mockOverlays.add(SHARED); return true; };
    expect(showCopy(SHARED, { application: application('2.25.1', '20261101'), importer: drawOverlay, overlay: true }, context)).toBe(true);

    expect(showCopy(SHARED, { importer: importer('exchange') }, context)).toBe(true);
    expect(mockOverlays.has(SHARED)).toBe(false);
    expect(state().representations).toEqual(['exchange']);
  });

  it('a read-only display copy of an application document never replaces a hydrated exchange copy', () => {
    const { importer, context } = setup();
    showCopy(SHARED, { importer: importer('exchange') }, context);
    const drawOverlay = jest.fn(() => { mockOverlays.add(SHARED); return true; });
    expect(showCopy(SHARED, { application: application('2.25.1', '20261101'), importer: drawOverlay, overlay: true }, context)).toBe(false);
    expect(drawOverlay).not.toHaveBeenCalled();
  });
});


describe('retiring a classic copy whose tool state is already gone', () => {
  // The image keeps another tool's state; the Length bucket is gone
  const dropLengthState = () => {
    mockToolState['wadors:image'] = { Angle: { data: [{ _id: 'angle' }] } };
  };

  [false, true].forEach((retry) => {
    it(`finishes the replacement by an off-slice exchange copy${retry ? ', on a retry after a failed import' : ''}`, () => {
      const { importer, heldImporter, state, service, context } = setup();
      showCopy(SHARED, { application: application('2.25.1', '20261101'), importer: importer('plan') }, context);
      dropLengthState();
      if (retry) {
        expect(showCopy(SHARED, { importer: () => false }, context)).toBe(false);
        expect(isApplicationMeasurement(SHARED)).toBe(true);
      }

      expect(showCopy(SHARED, { importer: heldImporter('exchange') }, context)).toBe(true);
      expect(state()).toMatchObject({ representations: [], groupEntries: 0, records: 1 });
      expect(service.getMeasurements().map(record => record.label)).toEqual(['exchange']);
      // Unmarked: a save writes it as the exchange document's
      expect(isApplicationMeasurement(SHARED)).toBe(false);
      expect(mockToolState['wadors:image'].Angle.data).toHaveLength(1);
    });
  });
});


describe('an application copy that cannot be imported', () => {
  const older = application('2.25.O', '20261101');
  const newer = application('2.25.N', '20261102');

  it('older then a newer that fails: the older stays shown and protected', () => {
    const { importer, state, context } = setup();
    showCopy(SHARED, { application: older, importer: importer('older') }, context);
    expect(showCopy(SHARED, { application: newer, importer: importer('newer', { fail: true }) }, context)).toBe(false);
    expect(state().representations).toEqual(['older']);
    expect(isApplicationMeasurement(SHARED)).toBe(true);
  });

  it('a newer that fails then the older: the older is shown', () => {
    const { importer, state, context } = setup();
    expect(showCopy(SHARED, { application: newer, importer: importer('newer', { fail: true }) }, context)).toBe(false);
    expect(showCopy(SHARED, { application: older, importer: importer('older') }, context)).toBe(true);
    expect(state()).toEqual({ representations: ['older'], groupEntries: 1, toolState: ['older'], records: 1 });
    expect(isApplicationMeasurement(SHARED)).toBe(true);
  });

  it('a newer that throws, in either order: its error reaches the caller and the older is shown', () => {
    const throwing = () => { throw new Error('not mapped'); };
    [['older', 'newer'], ['newer', 'older']].forEach((order) => {
      clearHydratedReports();
      const { importer, state, context } = setup();
      const load = {
        older: () => showCopy(SHARED, { application: older, importer: importer('older') }, context),
        newer: () => showCopy(SHARED, { application: newer, importer: throwing }, context),
      };
      order.forEach(name => (name === 'newer' ? expect(load.newer).toThrow('not mapped') : load.older()));
      expect(state().representations).toEqual(['older']);
    });
  });

  it('the newer read again and imported replaces the older', () => {
    const { importer, state, context } = setup();
    showCopy(SHARED, { application: newer, importer: importer('newer', { fail: true }) }, context);
    showCopy(SHARED, { application: older, importer: importer('older') }, context);
    expect(showCopy(SHARED, { application: newer, importer: importer('newer') }, context)).toBe(true);
    expect(state()).toEqual({ representations: ['newer'], groupEntries: 1, toolState: ['newer'], records: 1 });
  });
});


describe('a copy without a tracking UID', () => {
  it('is imported from an exchange document, as it always was, and not from an application document', () => {
    const { context } = setup();
    const exchange = jest.fn(() => true);
    const plan = jest.fn(() => true);
    expect(showCopy(undefined, { importer: exchange }, context)).toBe(true);
    expect(showCopy(undefined, { application: application('2.25.1', '20261101'), importer: plan }, context)).toBe(false);
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(plan).not.toHaveBeenCalled();
  });
});
