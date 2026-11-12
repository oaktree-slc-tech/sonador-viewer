/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// The lock and the line and text colors of a pending measurement, set from the Measurements
// panel's row menu: a locked measurement stays pending; a saved one (read-only) is left alone.

jest.mock('cornerstone-core', () => ({ getViewport: () => ({}) }), { virtual: true });
jest.mock('cornerstone-tools', () => ({
  globalImageIdSpecificToolStateManager: { toolState: {}, setImageIdToolState: () => {} },
  toolColors: { getToolColor: () => 'rgb(255, 255, 0)' },
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
  clearSRDisplayAnnotations: () => {},
  setSRDisplayAnnotationVisible: () => {},
}));

import _ from 'lodash';

import MeasurementApi from './MeasurementApi';
import MeasurementService from '../../services/MeasurementService/MeasurementService';

const serviceWith = (...measurements) => {
  const service = new MeasurementService();
  measurements.forEach(m => service.measurements.set(m.uid, { ...m }));
  return service;
};

const apiWith = service => Object.assign(Object.create(MeasurementApi.prototype), { measurementService: service });
const updatesOf = (service) => {
  const updated = [];
  service.subscribe(service.EVENTS.MEASUREMENT_UPDATED, ({ measurement, notYetUpdatedAtSource }) =>
    updated.push([measurement.uid, notYetUpdatedAtSource]));
  return updated;
};

describe('MeasurementApi.toggleLockMeasurement', () => {
  it('locks and unlocks a pending measurement, updating its representations', () => {
    const service = serviceWith({ uid: 'a', toolName: 'Length', metadata: { toolName: 'Length' } });
    const updated = updatesOf(service);
    const api = apiWith(service);

    api.toggleLockMeasurement('a');
    expect(service.getMeasurement('a')).toMatchObject({ isLocked: true, metadata: { isLocked: true } });
    expect(MeasurementApi._unpackMeasurementLifecycleAttrs(service.getMeasurement('a'))).toMatchObject({ isLocked: true, isReadOnly: undefined });
    api.toggleLockMeasurement('a');
    expect(service.getMeasurement('a')).toMatchObject({ isLocked: false, metadata: { isLocked: false } });
    expect(updated).toEqual([['a', true], ['a', true]]);
  });

  it('leaves a saved measurement locked', () => {
    const service = serviceWith({ uid: 's', isLocked: true, metadata: { isReadOnly: true, isLocked: true } });
    const updated = updatesOf(service);
    apiWith(service).toggleLockMeasurement('s');
    expect(service.getMeasurement('s').isLocked).toBe(true);
    expect(updated).toEqual([]);
  });
});

describe('MeasurementApi line and text colors', () => {
  it("sets a measurement's line and text colors in both sections, keeping its other roles, and clears them", () => {
    const service = serviceWith({ uid: 'a', toolName: 'Length', metadata: { toolName: 'Length' }, data: { length: 12 } });
    const api = apiWith(service);
    api.setMeasurementLineTextColor('a', 'line', '#ff8800');
    api.setMeasurementLineTextColor('a', 'text', '#00FF00');

    const measurement = service.getMeasurement('a');
    const expected = { Color: { Line: '#FF8800', Text: '#00FF00' } };
    expect(measurement.metadata.displayAttributes).toEqual(expected);
    expect(measurement.data).toEqual({ length: 12, displayAttributes: expected });
    expect(api.measurementLineTextColor('a')).toEqual({ line: '#FF8800', text: '#00FF00' });

    api.setMeasurementLineTextColor('a', 'line', null);
    expect(api.measurementLineTextColor('a')).toEqual({ line: null, text: '#00FF00' });
  });

  it("keeps a Series Tag's colors in its border and meaning roles", () => {
    const service = serviceWith({
      uid: 't', toolName: 'DICOMSRSeriesTagTool', metadata: { toolName: 'DICOMSRSeriesTagTool' },
      data: { displayAttributes: { Color: { Background: '#112233', Value: '#FF0000' } } },
    });
    const api = apiWith(service);
    api.setMeasurementLineTextColor('t', 'line', '#FFFFFF');
    api.setMeasurementLineTextColor('t', 'text', '#ABCDEF');
    expect(service.getMeasurement('t').data.displayAttributes).toEqual(
      { Color: { Background: '#112233', Value: '#FF0000', Border: '#FFFFFF', Meaning: '#ABCDEF' } });
  });

  it('gives the colors a measurement is drawn in where it stores none', () => {
    const service = serviceWith(
      { uid: 'a', toolName: 'Length' },
      { uid: 'b', toolName: 'Angle', data: { displayAttributes: { Color: { Line: '#FF8800' } } } },
      { uid: 't', toolName: 'DICOMSRSeriesTagTool' });
    const api = apiWith(service);
    expect(api.measurementLineTextColor('a', { drawn: true })).toEqual({ line: 'rgb(255, 255, 0)', text: 'rgb(255, 255, 0)' });
    expect(api.measurementLineTextColor('b', { drawn: true })).toEqual({ line: '#FF8800', text: '#FF8800' });
    expect(api.measurementLineTextColor('t', { drawn: true })).toEqual({ line: '#FFFFFF', text: '#C0C7F8' });
  });

  it('leaves a saved measurement as it was stored', () => {
    const service = serviceWith({ uid: 's', toolName: 'Length', metadata: { isReadOnly: true }, data: {} });
    apiWith(service).setMeasurementLineTextColor('s', 'line', '#FF8800');
    expect(service.getMeasurement('s').data).toEqual({});
  });
});

describe('a measurement the user unlocks', () => {
  it('is not held locked by the representation an earlier locked state left', () => {
    const service = serviceWith({ uid: 'a', toolName: 'Length', isLocked: false, metadata: { _id: 'r1', isLocked: false } });
    const api = Object.assign(apiWith(service), {
      // Added while locked: the lock is copied to the top level
      tools: { Length: [{ _id: 'r1', isLocked: true, metadata: { _id: 'r1', isLocked: true } }] },
      onMeasurementsUpdated: () => {},
    });
    service.triggerApiEvent = () => {};

    // The unlocked record's annotation carries the lock in its metadata only
    api.updateMeasurementRepresentation('Length', { _id: 'r1', metadata: { _id: 'r1', isLocked: false } });
    expect(MeasurementApi._unpackMeasurementLifecycleAttrs(api.tools.Length[0]).isLocked).toBe(false);
  });

  it("takes the record's lock state when its tool reports a change, not the tool data's earlier one", () => {
    const handleSingleMeasurementModified = require('../measurementHandlers/handleSingleMeasurementModified').default;
    const service = serviceWith({ uid: 'a', toolName: 'Length', isLocked: false, metadata: { _id: 'r1', isLocked: false } });
    const updates = [];
    const api = Object.assign(apiWith(service), {
      tools: { Length: [{ _id: 'r1', metadata: { _id: 'r1' } }] },
      _serviceManagedTool: () => ({ toolServiceManaged: true }),
      updateMeasurementRepresentation: (toolType, measurement) => updates.push(_.cloneDeep(measurement)),
    });
    const instance = MeasurementApi.Instance;
    MeasurementApi.Instance = api;

    // The tool data still holds the lock from before the unlock
    const measurementData = { _id: 'r1', uid: 'a', isLocked: true, metadata: { _id: 'r1', isLocked: true } };
    handleSingleMeasurementModified({ eventData: { toolType: 'Length', measurementData, element: {} } });
    MeasurementApi.Instance = instance;

    expect(measurementData.metadata.isLocked).toBe(false);
    expect(measurementData.isLocked).toBe(false);
    expect(MeasurementApi._unpackMeasurementLifecycleAttrs(updates[0]).isLocked).toBe(false);
  });
});

describe('MeasurementApi.customLineTextColor (the panel indicator)', () => {
  const custom = data => MeasurementApi.customLineTextColor({ toolName: 'Length', data: { displayAttributes: { Color: data } } });

  it('is none without a line or text color of its own', () => {
    expect(custom({})).toBeNull();
    // A read-only measurement's Border is not a custom color of its own
    expect(custom({ Border: '#FF8800' })).toBeNull();
    expect(MeasurementApi.customLineTextColor({ toolName: 'DICOMSRSeriesTagTool', data: { displayAttributes: { Color: { Border: '#FFFFFF', Meaning: '#ABCDEF' } } } })).toBeNull();
  });

  it('gives the line color alone, or the drawn line color and the text color', () => {
    expect(custom({ Line: '#FF8800' })).toEqual({ line: '#FF8800', text: null });
    expect(custom({ Line: '#FF8800', Text: '#00FF00' })).toEqual({ line: '#FF8800', text: '#00FF00' });
    // A text color alone: the line is drawn in the tool color
    expect(custom({ Text: '#00FF00' })).toEqual({ line: 'rgb(255, 255, 0)', text: '#00FF00' });
  });
});


describe('MeasurementApi.setMeasurementViewportValues', () => {
  it("sets the values a pending measurement's viewport label shows, in both sections, at least one", () => {
    const service = serviceWith({ uid: 'c', toolName: 'CircleRoi', metadata: { toolName: 'CircleRoi' }, data: { cachedStats: { radius: 5 } } });
    const updated = updatesOf(service);
    const api = apiWith(service);

    api.setMeasurementViewportValues('c', ['radius', 'mean', 'mean']);
    expect(service.getMeasurement('c').metadata.viewportValues).toEqual(['radius', 'mean']);
    expect(service.getMeasurement('c').data).toEqual({ cachedStats: { radius: 5 }, viewportValues: ['radius', 'mean'] });
    expect(updated).toEqual([['c', true]]);

    // None is refused
    api.setMeasurementViewportValues('c', []);
    expect(service.getMeasurement('c').metadata.viewportValues).toEqual(['radius', 'mean']);
    expect(updated).toHaveLength(1);
  });

  it('leaves a saved measurement alone', () => {
    const service = serviceWith({ uid: 's', toolName: 'CircleRoi', metadata: { isReadOnly: true } });
    const updated = updatesOf(service);
    apiWith(service).setMeasurementViewportValues('s', ['radius']);
    expect(service.getMeasurement('s').metadata.viewportValues).toBeUndefined();
    expect(updated).toEqual([]);
  });
});
