/**
 * @jest-environment ./src/__tests__/jsdomEnvironment.js
 */
// The Measurements panel reads its rows again when the measurement service changes a measurement
// (its visibility, for one) or the measurements are cleared, without remounting the table: the
// table's display settings, search and viewport filter are kept.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const mockHandlers = {};
const mockMounts = jest.fn();
const mockRenders = jest.fn();
let mockLandmarkSets = [];
// The measurement-service records
let mockRecords = [];
// What a landmark row reads when the table renders: whether its image is loaded
let mockImageLoaded = false;
const mockPlacements = jest.fn();
jest.mock('./ConnectedMeasurementTable.js', () => ({
  __esModule: true,
  default: (props) => {
    jest.requireActual('react').useEffect(() => { mockMounts(); }, []);
    mockRenders(props.dataVersion);
    mockPlacements(mockImageLoaded ? 'placed' : 'held');
    return null;
  },
}));
jest.mock('@ohif/core', () => {
  let count = 0;
  const service = {
    EVENTS: {
      MEASUREMENT_UPDATED: 'updated', MEASUREMENTS_DATASYNC: 'datasync', RAW_MEASUREMENT_ADDED: 'raw-added', MEASUREMENT_REMOVED: 'removed',
    },
    subscribe: (event, handler) => {
      mockHandlers[event] = handler;
      return { unsubscribe: () => {} };
    },
    getMeasurements: () => mockRecords,
  };
  return {
    measurements: {
      MeasurementApi: { Instance: { measurementService: service } },
      Enums: { EVENTS: { MEASUREMENT_CLEAR_SUCCESS: 'cleared' } },
    },
    utils: { guid: () => `v${(count += 1)}` },
    DICOMSR: {
      outOfPlane: { isOutOfPlaneMeasurement: measurement => !!(measurement && measurement.metadata && measurement.metadata.outOfPlane) },
      landmarks: {
        subscribe: (handler) => {
          mockHandlers.landmarks = handler;
          return { unsubscribe: () => {} };
        },
        getLandmarkSets: () => mockLandmarkSets,
      },
    },
    DicomMetadataStore: {
      EVENTS: { SERIES_ADDED: 'series-added', INSTANCES_ADDED: 'instances-added', INSTANCE_ADDED: 'instance-added' },
      subscribe: (event, handler) => {
        mockHandlers[event] = handler;
        return { unsubscribe: () => {} };
      },
    },
  };
}, { virtual: true });

import SonadorMeasurementTable from './SonadorMeasurementsTable';

global.IS_REACT_ACT_ENVIRONMENT = true;

it('reads the rows again on a service update or a clear, keeping the table mounted', () => {
  jest.useFakeTimers();
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(<SonadorMeasurementTable servicesManager={{}} renderTimeout={50} />));
  const first = mockRenders.mock.calls[mockRenders.mock.calls.length - 1][0];

  // A visibility change in the service
  act(() => mockHandlers.updated({ measurement: {}, notYetUpdatedAtSource: true }));
  act(() => jest.advanceTimersByTime(50));
  const second = mockRenders.mock.calls[mockRenders.mock.calls.length - 1][0];
  expect(second).not.toBe(first);

  // The measurements cleared (a save's reload)
  act(() => mockHandlers.datasync({ apiEvent: 'cleared' }));
  expect(mockRenders.mock.calls[mockRenders.mock.calls.length - 1][0]).not.toBe(second);

  expect(mockMounts).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
  jest.useRealTimers();
});

it('reads the rows again when an out-of-plane measurement is added, changed (saved) or removed', () => {
  jest.useFakeTimers();
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(<SonadorMeasurementTable servicesManager={{}} renderTimeout={50} />));
  const latest = () => mockRenders.mock.calls[mockRenders.mock.calls.length - 1][0];

  [
    () => mockHandlers['raw-added']({ measurement: { metadata: { outOfPlane: true } } }),
    // Locked by a save: an update without notYetUpdatedAtSource
    () => mockHandlers.updated({ measurement: { metadata: { outOfPlane: true } } }),
    () => mockHandlers.removed({ measurement: 'oop-1' }),
  ].forEach((event) => {
    const before = latest();
    act(event);
    act(() => jest.advanceTimersByTime(50));
    expect(latest()).not.toBe(before);
  });

  // A classic update the store carries does not
  const before = latest();
  act(() => mockHandlers.updated({ measurement: {} }));
  act(() => jest.advanceTimersByTime(50));
  expect(latest()).toBe(before);

  act(() => root.unmount());
  jest.useRealTimers();
});


it('reads the rows again when landmark sets are listed or cleared, and when series metadata arrives while sets are listed', () => {
  jest.useFakeTimers();
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(<SonadorMeasurementTable servicesManager={{}} renderTimeout={50} />));
  const latest = () => mockRenders.mock.calls[mockRenders.mock.calls.length - 1][0];

  let before = latest();
  act(() => mockHandlers.landmarks({ type: 'changed' }));
  act(() => jest.advanceTimersByTime(50));
  expect(latest()).not.toBe(before);

  // Series metadata: only while a set is listed
  before = latest();
  act(() => mockHandlers['series-added']({}));
  act(() => jest.advanceTimersByTime(50));
  expect(latest()).toBe(before);
  mockLandmarkSets = [{ key: 'set' }];
  act(() => mockHandlers['series-added']({}));
  act(() => jest.advanceTimersByTime(50));
  expect(latest()).not.toBe(before);

  mockLandmarkSets = [];
  act(() => root.unmount());
  jest.useRealTimers();
});


describe('placement of the landmark rows', () => {
  const displaySetService = {
    EVENTS: { DISPLAY_SETS_ADDED: 'ds-added', DISPLAY_SETS_REMOVED: 'ds-removed', DISPLAY_SETS_CHANGED: 'ds-changed' },
    subscribe: (event, handler) => {
      mockHandlers[event] = handler;
      return { unsubscribe: () => {} };
    },
  };
  const mount = () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    act(() => root.render(<SonadorMeasurementTable servicesManager={{ services: { displaySetService } }} renderTimeout={50} />));
    return root;
  };

  beforeEach(() => {
    jest.useFakeTimers();
    mockLandmarkSets = [{ key: 'set' }];
    mockImageLoaded = false;
  });
  afterEach(() => {
    mockLandmarkSets = [];
    mockRecords = [];
    jest.useRealTimers();
  });

  it('a held row is placed when the one image it is on arrives (a single instance added)', () => {
    const root = mount();
    expect(mockPlacements.mock.calls[mockPlacements.mock.calls.length - 1][0]).toBe('held');
    mockImageLoaded = true;
    act(() => mockHandlers['instance-added']({ SeriesInstanceUID: '2.25.2' }));
    act(() => jest.advanceTimersByTime(50));
    expect(mockPlacements.mock.calls[mockPlacements.mock.calls.length - 1][0]).toBe('placed');
    act(() => root.unmount());
  });

  it('reads the rows again when display sets are added or removed', () => {
    const root = mount();
    ['ds-added', 'ds-removed', 'ds-changed'].forEach((event) => {
      const before = mockRenders.mock.calls.length;
      act(() => mockHandlers[event]({}));
      act(() => jest.advanceTimersByTime(50));
      expect(mockRenders.mock.calls.length).toBe(before + 1);
    });
    act(() => root.unmount());
  });

  it('reads the rows once for a burst of events', () => {
    const root = mount();
    const before = mockRenders.mock.calls.length;
    act(() => {
      for (let index = 0; index < 20; index += 1) {
        mockHandlers['instance-added']({ SeriesInstanceUID: '2.25.2' });
      }
      mockHandlers['series-added']({});
      mockHandlers['ds-added']({});
    });
    act(() => jest.advanceTimersByTime(50));
    expect(mockRenders.mock.calls.length).toBe(before + 1);
    act(() => root.unmount());
  });

  it('reads the rows again on display-set and metadata events while only out-of-plane measurements are listed', () => {
    mockLandmarkSets = [];
    const root = mount();
    const reads = () => {
      const before = mockRenders.mock.calls.length;
      act(() => mockHandlers['ds-removed']({}));
      act(() => mockHandlers['series-added']({}));
      act(() => jest.advanceTimersByTime(50));
      return mockRenders.mock.calls.length - before;
    };
    // Nothing placed by the displayed series: no read
    mockRecords = [{ uid: 'classic', metadata: {} }];
    expect(reads()).toBe(0);
    mockRecords = [{ uid: 'held', metadata: { outOfPlane: true } }];
    expect(reads()).toBe(1);
    act(() => root.unmount());
  });
});
