// Clearing the measurements empties the API whatever Cornerstone's tool state still holds. A
// reload after a report series is removed clears measurements whose image no longer has tool
// state, or has none for their tool; that must not stop the clear.

const mockToolState = { toolState: {} };
jest.mock('cornerstone-core', () => ({ __esModule: true, default: { getEnabledElements: () => [], updateImage: () => {} } }), { virtual: true });
jest.mock('cornerstone-tools', () => ({
  __esModule: true,
  default: {
    get globalImageIdSpecificToolStateManager() {
      return {
        toolState: mockToolState.toolState,
        setImageIdToolState: (imageId, toolType, state) => {
          mockToolState.toolState[imageId] = { ...(mockToolState.toolState[imageId] || {}), [toolType]: state };
        },
      };
    },
  },
}), { virtual: true });
jest.mock('../../log', () => ({ __esModule: true, default: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} } }));
jest.mock('../../utils/studyMetadataManager', () => ({ __esModule: true, default: {} }));
jest.mock('./../../utils', () => ({ __esModule: true, default: {} }));
jest.mock('../lib/getImageIdForImagePath', () => ({ __esModule: true, default: imagePath => `wadors:${imagePath}` }));
jest.mock('../enums', () => ({
  __esModule: true,
  default: { EVENTS: { MEAUSREMENT_CLEAR_START: 'clear-start', MEASUREMENT_CLEAR_SUCCESS: 'clear-success' } },
}));
jest.mock('./../configuration.js', () => ({ measurementApiDefaultConfig: {} }));
jest.mock('../lib/refreshCornerstoneViewports', () => ({ __esModule: true, default: () => {} }));

import MeasurementApi from './MeasurementApi';

/** A MeasurementApi holding `tools`, with the collaborators clearMeasurements reaches. */
function apiWith(tools) {
  const api = Object.create(MeasurementApi.prototype);
  api.tools = tools;
  api.measurementService = { triggerApiEvent: jest.fn(), clearMeasurements: jest.fn() };
  api.measurementsCount = () => ({ service: 0 });
  api.syncMeasurementsAndToolData = () => {};
  return api;
}

beforeEach(() => {
  mockToolState.toolState = {};
});

it('clears a measurement whose image holds no tool state', () => {
  const api = apiWith({ DICOMSRDisplayTool: [{ _id: 'm1', imagePath: 'series_1_image' }] });
  expect(() => api.clearMeasurements()).not.toThrow();
  expect(api.tools.DICOMSRDisplayTool).toEqual([]);
});

it('clears a measurement whose image holds no state for its tool', () => {
  mockToolState.toolState = { 'wadors:series_1_image': { Length: { data: [] } } };
  const api = apiWith({ DICOMSRDisplayTool: [{ _id: 'm1', imagePath: 'series_1_image' }] });
  expect(() => api.clearMeasurements()).not.toThrow();
  expect(api.tools.DICOMSRDisplayTool).toEqual([]);
});

it('removes a measurement from the tool state its image holds', () => {
  mockToolState.toolState = { 'wadors:series_1_image': { Length: { data: [{ _id: 'm1' }, { _id: 'm2' }] } } };
  expect(MeasurementApi.purgeCornerstoneToolData('Length', 'wadors:series_1_image', { _id: 'm1' })).not.toBe(false);
  expect(mockToolState.toolState['wadors:series_1_image'].Length.data.map(d => d._id)).toEqual(['m2']);
});
