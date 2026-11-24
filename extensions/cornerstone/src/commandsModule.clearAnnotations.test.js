// Clearing annotations clears the study's measurements whatever the active viewport shows. A reload
// after a report series is removed runs it while the active viewport may hold no Cornerstone image
// (the report itself, or nothing): its measurements must still go, or they outlive the report.

const mockApi = { clearMeasurements: jest.fn(), measurementsCount: () => 0 };
const mockActiveElement = { element: undefined, enabledElement: undefined };
const mockToolState = { toolState: {} };

jest.mock('cornerstone-core', () => ({
  __esModule: true,
  default: { getEnabledElement: () => mockActiveElement.enabledElement },
}), { virtual: true });
jest.mock('cornerstone-tools', () => ({
  __esModule: true,
  default: { import: () => () => {}, get globalImageIdSpecificToolStateManager() { return mockToolState; } },
}), { virtual: true });
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: {
    sonador: {},
    log: { warn: () => {}, debug: () => {}, info: () => {} },
    measurements: { MeasurementApi: { get Instance() { return mockApi; } }, MeasurementHandlers: { onRemoved: jest.fn() } },
    display: {},
    utils: { studyMetadataManager: {}, cornerstoneUtils: { refreshCornerstoneViewports: jest.fn() } },
    redux: { actions: {} },
  },
}), { virtual: true });
jest.mock('@ohif/sonador-viewer/src/store/useDicomHeadersOverlay', () => ({ useDicomHeadersOverlayStore: {} }), { virtual: true });
jest.mock('@ohif/ui', () => ({ SaveDicomSeriesDialog: () => null, workflow: {} }), { virtual: true });
jest.mock('./utils/setCornerstoneLayout', () => jest.fn());
jest.mock('./CornerstoneViewportDownloadForm', () => () => null);
jest.mock('./state', () => ({ getEnabledElement: () => mockActiveElement.element }));

import commandsModule from './commandsModule';

const { definitions } = commandsModule({ servicesManager: { services: {} }, commandsManager: {} });
const clearAnnotations = () => definitions.clearAnnotations.commandFn({ viewports: { activeViewportIndex: 0 } });

beforeEach(() => {
  mockApi.clearMeasurements.mockClear();
  mockActiveElement.element = undefined;
  mockActiveElement.enabledElement = undefined;
  mockToolState.toolState = {};
});

it('clears the measurements when the active viewport has no Cornerstone element', () => {
  expect(() => clearAnnotations()).not.toThrow();
  expect(mockApi.clearMeasurements).toHaveBeenCalledTimes(1);
});

it('clears the measurements when the active viewport shows no image', () => {
  mockActiveElement.element = {};
  mockActiveElement.enabledElement = { image: undefined };
  expect(() => clearAnnotations()).not.toThrow();
  expect(mockApi.clearMeasurements).toHaveBeenCalledTimes(1);
});

it('clears the measurements when the active image has tool state', () => {
  mockActiveElement.element = {};
  mockActiveElement.enabledElement = { image: { imageId: 'wadors:image-1' } };
  mockToolState.toolState = { 'wadors:image-1': {} };
  clearAnnotations();
  expect(mockApi.clearMeasurements).toHaveBeenCalledTimes(1);
});
