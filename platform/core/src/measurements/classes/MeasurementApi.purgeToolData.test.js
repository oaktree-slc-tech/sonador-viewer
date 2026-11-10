/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// Clearing the measurement session removes every representation, including those whose image has
// no tool state: after a series is deleted the study reload drops its metadata, so a read-only
// representation's image path resolves to an image id that was never drawn on.

const mockToolState = {};
jest.mock('cornerstone-core', () => ({}), { virtual: true });
jest.mock('cornerstone-tools', () => ({
  globalImageIdSpecificToolStateManager: {
    get toolState() { return mockToolState; },
    setImageIdToolState: (imageId, toolType, state) => { mockToolState[imageId][toolType] = state; },
  },
}), { virtual: true });
jest.mock('@cornerstonejs/adapters', () => ({
  adaptersSR: { Cornerstone3D: { CodeScheme: { CodingSchemeDesignator: 'CORNERSTONEJS', codeValues: {} } } },
}), { virtual: true });
jest.mock('../../utils', () => ({ __esModule: true, default: {} }));
jest.mock('../../utils/studyMetadataManager', () => ({ __esModule: true, default: {} }));
jest.mock('../../log', () => ({ __esModule: true, default: { info: () => {}, warn: () => {}, debug: () => {} } }));
jest.mock('../configuration.js', () => ({ measurementApiDefaultConfig: {} }));
jest.mock('../enums', () => ({ __esModule: true, default: { EVENTS: {} } }));
jest.mock('../lib/refreshCornerstoneViewports', () => ({ __esModule: true, default: () => {} }));
jest.mock('../lib/getImageIdForImagePath', () => ({
  __esModule: true, default: imagePath => (imagePath === 'loaded' ? 'wadors:loaded' : 'wadors:removed-series'),
}));
jest.mock('../../DICOMSR/readOnly/srDisplayAnnotations', () => ({
  clearSRDisplayAnnotations: () => {},
  setSRDisplayAnnotationVisible: () => {},
}));

import MeasurementApi from './MeasurementApi';

const session = tools => ({
  tools,
  measurementService: { triggerApiEvent: () => {}, clearMeasurements: jest.fn() },
  measurementsCount: () => ({ service: 0 }),
  syncMeasurementsAndToolData: () => {},
});

beforeEach(() => {
  Object.keys(mockToolState).forEach(key => delete mockToolState[key]);
  mockToolState['wadors:loaded'] = { DICOMSRDisplayTool: { data: [{ _id: 'kept-image' }] } };
});

it('clears representations whose image has no tool state, and every other one', () => {
  const api = session({
    DICOMSRDisplayTool: [{ _id: 'kept-image', imagePath: 'loaded' }, { _id: 'removed', imagePath: 'removed-series' }],
    Length: [{ _id: 'no-tool-entry', imagePath: 'loaded' }],
  });

  expect(() => MeasurementApi.prototype.clearMeasurements.call(api)).not.toThrow();
  expect(api.tools.DICOMSRDisplayTool).toEqual([]);
  expect(api.tools.Length).toEqual([]);
  expect(mockToolState['wadors:loaded'].DICOMSRDisplayTool.data).toEqual([]);
});

it('reports nothing purged for an image without tool state', () => {
  expect(MeasurementApi.purgeCornerstoneToolData('DICOMSRDisplayTool', 'wadors:removed-series', { _id: 'x' })).toBeUndefined();
  expect(MeasurementApi.purgeCornerstoneToolData('DICOMSRDisplayTool', undefined, { _id: 'x' })).toBeUndefined();
});
