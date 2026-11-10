// The measurement session's commands are found whichever viewport is active: Save Measurements
// (the Measurements panel's Save), Clear and Reload annotations are registered in the VIEWER
// context, which is always active, so they resolve with an MPR, 3D volume or segmentation editor
// viewport active as with a classic one. Clear annotations runs there too: without a classic
// element or image it clears the session; with a classic image it removes that image's measurements
// first. The module is registered as ExtensionManager registers command modules, into the real
// CommandsManager.

const mockCornerstone = { getEnabledElement: jest.fn() };
const mockToolStateManager = { toolState: {} };
const mockApi = { measurementsCount: () => 0, clearMeasurements: jest.fn() };
const mockOnRemoved = jest.fn();
const mockRefresh = jest.fn();
jest.mock('cornerstone-core', () => ({ getEnabledElement: (...args) => mockCornerstone.getEnabledElement(...args) }), { virtual: true });
jest.mock('cornerstone-tools', () => ({
  import: () => () => {},
  get globalImageIdSpecificToolStateManager() { return mockToolStateManager; },
}), { virtual: true });
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: {
    measurements: {
      MeasurementApi: {
        get Instance() { return mockApi; },
        _unpackMeasurementData: m => ({ measurementMeta: {}, measurementData: m, uid: m.uid, _id: m._id }),
      },
      MeasurementHandlers: { onRemoved: (...args) => mockOnRemoved(...args) },
    },
    display: {},
    DICOMSR: {},
    log: { warn: () => {}, debug: () => {}, info: () => {} },
    utils: { cornerstoneUtils: { refreshCornerstoneViewports: (...args) => mockRefresh(...args) } },
    redux: { actions: {} },
  },
}), { virtual: true });
jest.mock('@ohif/sonador-viewer/src/store/useDicomHeadersOverlay', () => ({ useDicomHeadersOverlayStore: {} }), { virtual: true });
jest.mock('@ohif/ui', () => ({ SaveDicomSeriesDialog: () => null, workflow: {} }), { virtual: true });
jest.mock('./utils/setCornerstoneLayout', () => jest.fn());
jest.mock('./CornerstoneViewportDownloadForm', () => () => null);
const mockState = { element: undefined };
jest.mock('./state', () => ({ getEnabledElement: () => mockState.element }));

import CommandsManager from '../../../platform/core/src/classes/CommandsManager';
import ExtensionManager from '../../../platform/core/src/extensions/ExtensionManager';
import commandsModule from './commandsModule';

const managerWithActive = (activeContexts) => {
  const commandsManager = new CommandsManager({ getAppState: () => ({}), getActiveContexts: () => activeContexts });
  const { definitions, defaultContext } = commandsModule({ servicesManager: { services: {} }, commandsManager });
  ExtensionManager.prototype._initCommandsModule.call({ _commandsManager: commandsManager }, definitions, defaultContext);
  return commandsManager;
};

const SESSION_COMMANDS = ['saveMeasurements', 'clearAnnotations', 'reloadAnnotations'];

it.each([
  ['the classic viewport', 'ACTIVE_VIEWPORT::CORNERSTONE'],
  ['the MPR view', 'ACTIVE_VIEWPORT::VTK'],
  ['the 3D volume viewer', 'ACTIVE_VIEWPORT::VIEWER3DVOL'],
  ['the segmentation editor', 'ACTIVE_VIEWPORT::SONADOR3DSEG'],
])('finds the measurement session commands with %s active', (_, viewportContext) => {
  const commandsManager = managerWithActive(['VIEWER', viewportContext]);
  SESSION_COMMANDS.forEach((name) => expect(commandsManager.getCommand(name)).toBeDefined());
});

it('keeps viewport-bound commands in the classic viewport context', () => {
  const commandsManager = managerWithActive(['VIEWER', 'ACTIVE_VIEWPORT::VTK']);
  expect(commandsManager.getCommand('clearAnnotations', 'VIEWER')).toBeDefined();
  expect(commandsManager.getCommand('nextImage')).toBeUndefined();
  expect(commandsManager.getCommand('nextImage', 'ACTIVE_VIEWPORT::CORNERSTONE')).toBeDefined();
});

describe('Clear annotations, run', () => {
  const VIEWPORTS = { activeViewportIndex: 0 };
  // As runCommand passes the store contexts
  const clear = (activeContext) => {
    const commandsManager = managerWithActive(['VIEWER', activeContext]);
    commandsManager._getAppState = () => ({ viewports: VIEWPORTS });
    return commandsManager.runCommand('clearAnnotations');
  };

  beforeEach(() => {
    mockState.element = undefined;
    mockToolStateManager.toolState = {};
    mockCornerstone.getEnabledElement.mockReset();
    mockApi.clearMeasurements.mockClear();
    mockOnRemoved.mockClear();
    mockRefresh.mockClear();
  });

  it.each(['ACTIVE_VIEWPORT::VTK', 'ACTIVE_VIEWPORT::VIEWER3DVOL', 'ACTIVE_VIEWPORT::SONADOR3DSEG'])(
    'clears the session without a classic element (%s active)', (context) => {
      expect(() => clear(context)).not.toThrow();
      expect(mockApi.clearMeasurements).toHaveBeenCalledTimes(1);
      expect(mockOnRemoved).not.toHaveBeenCalled();
    });

  it('clears the session when the classic element is no longer enabled (cornerstone throws)', () => {
    mockState.element = 'element';
    mockCornerstone.getEnabledElement.mockImplementation(() => { throw new Error('element not enabled'); });
    expect(() => clear('ACTIVE_VIEWPORT::CORNERSTONE')).not.toThrow();
    expect(mockApi.clearMeasurements).toHaveBeenCalledTimes(1);
  });

  it('clears the session when the classic element has no image', () => {
    mockState.element = 'element';
    mockCornerstone.getEnabledElement.mockReturnValue({});
    clear('ACTIVE_VIEWPORT::CORNERSTONE');
    expect(mockApi.clearMeasurements).toHaveBeenCalledTimes(1);
    expect(mockOnRemoved).not.toHaveBeenCalled();
  });

  it("removes the classic image's measurements, then clears the session, with a classic image", () => {
    mockState.element = 'element';
    mockCornerstone.getEnabledElement.mockReturnValue({ image: { imageId: 'wadors:image' } });
    mockToolStateManager.toolState = { 'wadors:image': { Angle: { data: [{ _id: 'a-1', uid: 'u-1' }] } } };
    clear('ACTIVE_VIEWPORT::CORNERSTONE');
    expect(mockOnRemoved).toHaveBeenCalledWith({
      detail: { toolType: 'Angle', measurementData: { toolType: 'Angle', _id: 'a-1', uid: 'u-1', measurementNumber: undefined }, element: 'element' },
    });
    expect(mockApi.clearMeasurements).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});
