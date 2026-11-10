/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// Global annotation visibility: the measurement service shows or hides every measurement, each
// updated as a single toggle updates it, and the API also covers the representations only it holds.

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
  clearSRDisplayAnnotations: () => {},
  setSRDisplayAnnotationVisible: () => {},
}));

import MeasurementApi from './MeasurementApi';
import MeasurementService from '../../services/MeasurementService/MeasurementService';

const serviceWith = (...measurements) => {
  const service = new MeasurementService();
  measurements.forEach(m => service.measurements.set(m.uid, { ...m }));
  return service;
};

describe('MeasurementService', () => {
  it('hides and shows every measurement, broadcasting an update for each one that changes', () => {
    const service = serviceWith({ uid: 'a', isVisible: true }, { uid: 'b', isVisible: false }, { uid: 'c' });
    const updated = [];
    service.subscribe(service.EVENTS.MEASUREMENT_UPDATED, ({ measurement, notYetUpdatedAtSource }) =>
      updated.push([measurement.uid, measurement.isVisible, notYetUpdatedAtSource]));

    expect(service.areAllMeasurementsVisible()).toBe(false);
    service.setMeasurementsVisibility(false);
    expect([...service.measurements.values()].every(m => m.isVisible === false)).toBe(true);
    expect(updated).toEqual([['a', false, true], ['c', false, true]]);

    service.setMeasurementsVisibility(true);
    expect(service.areAllMeasurementsVisible()).toBe(true);
  });

  it('counts no measurements as all shown', () => {
    expect(serviceWith().areAllMeasurementsVisible()).toBe(true);
  });
});

describe('MeasurementApi.setAllMeasurementsVisibility', () => {
  it('sets the service measurements and the representations only the API holds', () => {
    const measurementService = serviceWith({ uid: 'svc-1', isVisible: true });
    const api = {
      measurementService,
      tools: {
        Length: [{ _id: 'len-1', uid: 'svc-1' }],
        DICOMSRDisplayTool: [{ _id: 'ro-1', isReadOnly: true }],
      },
      toggleVisibilityMeasurement: jest.fn(),
    };
    MeasurementApi.prototype.setAllMeasurementsVisibility.call(api, false);

    expect(measurementService.measurements.get('svc-1').isVisible).toBe(false);
    expect(api.toggleVisibilityMeasurement).toHaveBeenCalledTimes(1);
    expect(api.toggleVisibilityMeasurement).toHaveBeenCalledWith('ro-1', false);
  });
});

describe('MeasurementApi.areAllMeasurementsHidden', () => {
  const apiWith = (service, tools = {}) => ({ measurementService: service, tools });
  const allHidden = api => MeasurementApi.prototype.areAllMeasurementsHidden.call(api);

  it('is true only when there are measurements and every one, service or API-only, is hidden', () => {
    const readOnly = visible => ({ DICOMSRDisplayTool: [{ _id: 'ro-1', isReadOnly: true, visible }] });
    expect(allHidden(apiWith(serviceWith({ uid: 'a', isVisible: false }), readOnly(false)))).toBe(true);
    expect(allHidden(apiWith(serviceWith({ uid: 'a', isVisible: false }), readOnly(true)))).toBe(false);
    expect(allHidden(apiWith(serviceWith({ uid: 'a', isVisible: false }, { uid: 'b' })))).toBe(false);
    expect(allHidden(apiWith(serviceWith(), readOnly(false)))).toBe(true);
  });

  it('counts a service measurement once, not again through its tool representation', () => {
    const api = apiWith(serviceWith({ uid: 'svc-1', isVisible: false }), { Length: [{ _id: 'len-1', uid: 'svc-1' }] });
    expect(allHidden(api)).toBe(true);
  });

  it('is false without measurements', () => {
    expect(allHidden(apiWith(serviceWith()))).toBe(false);
  });
});

describe('session-only annotations (registered visibility sources)', () => {
  // An annotation source as the Cornerstone3D views register theirs: annotations drawn there and
  // not saved, with no measurement or API representation
  const sourceOf = (...visibility) => {
    const state = [...visibility];
    return {
      state,
      visibilities: () => [...state],
      setVisibility: jest.fn((visible) => state.fill(visible)),
    };
  };
  const apiWith = (service) => ({
    measurementService: service,
    tools: {},
    toggleVisibilityMeasurement: jest.fn(),
    onMeasurementsUpdated: jest.fn(),
  });
  const { setAllMeasurementsVisibility, areAllMeasurementsHidden } = MeasurementApi.prototype;

  let removeSource = () => {};
  afterEach(() => removeSource());

  it('hides and shows a standalone-only session, and counts it in the state', () => {
    const source = sourceOf(true);
    removeSource = MeasurementApi.addAnnotationVisibilitySource(source);
    const api = apiWith(serviceWith());

    expect(areAllMeasurementsHidden.call(api)).toBe(false);
    setAllMeasurementsVisibility.call(api, false);
    expect(source.setVisibility).toHaveBeenCalledWith(false);
    expect(api.onMeasurementsUpdated).toHaveBeenCalled();
    expect(areAllMeasurementsHidden.call(api)).toBe(true);

    setAllMeasurementsVisibility.call(api, true);
    expect(source.state).toEqual([true]);
    expect(areAllMeasurementsHidden.call(api)).toBe(false);
  });

  it('is not all hidden while a standalone annotation is shown beside hidden measurements', () => {
    removeSource = MeasurementApi.addAnnotationVisibilitySource(sourceOf(true));
    const api = apiWith(serviceWith({ uid: 'a', isVisible: false }));
    expect(areAllMeasurementsHidden.call(api)).toBe(false);

    setAllMeasurementsVisibility.call(api, false);
    expect(areAllMeasurementsHidden.call(api)).toBe(true);
    setAllMeasurementsVisibility.call(api, true);
    expect(api.measurementService.measurements.get('a').isVisible).toBe(true);
    expect(areAllMeasurementsHidden.call(api)).toBe(false);
  });

  it('stops covering a source once it is removed', () => {
    const source = sourceOf(true);
    MeasurementApi.addAnnotationVisibilitySource(source)();
    const api = apiWith(serviceWith({ uid: 'a', isVisible: false }));
    expect(areAllMeasurementsHidden.call(api)).toBe(true);
    setAllMeasurementsVisibility.call(api, false);
    expect(source.setVisibility).not.toHaveBeenCalled();
    expect(api.onMeasurementsUpdated).not.toHaveBeenCalled();
  });
});
