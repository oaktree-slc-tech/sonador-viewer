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
jest.mock('./ConnectedMeasurementTable.js', () => ({
  __esModule: true,
  default: (props) => {
    jest.requireActual('react').useEffect(() => { mockMounts(); }, []);
    mockRenders(props.dataVersion);
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
  };
  return {
    measurements: {
      MeasurementApi: { Instance: { measurementService: service } },
      Enums: { EVENTS: { MEASUREMENT_CLEAR_SUCCESS: 'cleared' } },
    },
    utils: { guid: () => `v${(count += 1)}` },
    DICOMSR: { outOfPlane: { isOutOfPlaneMeasurement: measurement => !!(measurement && measurement.metadata && measurement.metadata.outOfPlane) } },
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
