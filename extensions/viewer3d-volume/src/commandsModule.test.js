// Crop Adjust state machine (ohif-viewers#155 §3.2) driven through the toolbar commands

import commandsModule from './commandsModule';
import { CROP_ADJUST, EVENTS, TOOLS } from './enums';

// Tool group fake: mirrors the VolumeCroppingTool behaviour the commands depend on —
// setToolActive resets handle/clipping visibility, setClippingPlanesVisible also sets handles.
const scene = { toolGroup: null };

jest.mock('@cornerstonejs/tools', () => {
  const ToolModes = { Active: 'Active', Passive: 'Passive', Enabled: 'Enabled', Disabled: 'Disabled' };
  const tool = (toolName) => ({ toolName });
  return {
    ToolGroupManager: { getToolGroup: () => scene.toolGroup, createToolGroup: jest.fn() },
    PanTool: tool('Pan'),
    TrackballRotateTool: tool('TrackballRotate'),
    VolumeCroppingTool: tool('VolumeCropping'),
    Enums: { ToolModes, MouseBindings: { Primary: 1, Secondary: 2, Auxiliary: 4, Wheel: 524288 } },
    addTool: jest.fn(),
  };
}, { virtual: true });

const displaySets = {};
const dispatchSignal = { fn: null };
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: {
    display: {
      DisplaySetApi: {
        Instance: {
          displaySetService: {
            getDisplaySetByUID: (uid) => displaySets[uid],
            addDisplaySets: jest.fn(),
            triggerApiEvent: (event, data) => dispatchSignal.fn?.(event, data),
          },
        },
      },
    },
  },
}), { virtual: true });

jest.mock('@ohif/extension-vtk', () => ({
  createViewportToggleFeatureCommand: () => jest.fn(),
  cornerstone3dUtils: { viewportTools: { SonadorZoomTool: { toolName: 'SonadorZoom' } } },
}), { virtual: true });

jest.mock('./utils/setCTVolumeLayout.js', () => jest.fn());


const UID = 'ds-1';

function createScene() {
  const cropping = {
    mode: 'Disabled',
    sphereStates: [{}],
    showHandles: false,
    clipping: false,
    getHandlesVisible() { return this.showHandles; },
    setHandlesVisible: jest.fn(function (visible) { this.showHandles = visible; }),
    setClippingPlanesVisible: jest.fn(function (visible) { this.clipping = visible; this.showHandles = visible; }),
  };
  const bindings = {};
  scene.toolGroup = {
    getToolInstance: (name) => (name == 'VolumeCropping' ? cropping : undefined),
    setToolActive: jest.fn((name, options) => {
      if (name == 'VolumeCropping') {
        cropping.mode = 'Active';
        cropping.showHandles = false;
        cropping.clipping = false;
      }
      (options?.bindings || []).forEach(({ mouseButton }) => { bindings[mouseButton] = name; });
    }),
    setToolEnabled: jest.fn((name) => {
      if (name == 'VolumeCropping') {
        cropping.mode = 'Enabled';
      }
    }),
    setToolDisabled: jest.fn((name) => {
      if (name == 'VolumeCropping') {
        cropping.mode = 'Disabled';
      }
    }),
    setToolPassive: jest.fn(),
  };
  return { cropping, bindings };
}

function setup() {
  displaySets[UID] = {
    displaySetInstanceUID: UID,
    imageVolumeRenderingEnabled: true,
    volumeCroppingEnabled: false,
    volumeCropAdjustState: CROP_ADJUST.OFF,
    volumeCropReturnMode: TOOLS.VOLVIEWER_TOOL_DEFAULT,
    volumeViewerToolMode: TOOLS.VOLVIEWER_TOOL_DEFAULT,
  };
  const { cropping, bindings } = createScene();

  const { definitions } = commandsModule({
    commandsManager: {},
    servicesManager: { services: {} },
  });
  const run = (name, options = {}) => definitions[name].commandFn(options);
  const viewports = { activeViewportIndex: 0, viewportSpecificData: { 0: { displaySetInstanceUID: UID } } };

  // Stand-in for the viewport's VOLVIEWER_ACTIVATE_TOOL handler (Cornerstone3DVolumeView.activateTools)
  dispatchSignal.fn = (event, data) => {
    if (event == EVENTS.VOLVIEWER_ACTIVATE_TOOL) {
      run('activateVolumeViewerTools', {
        toolGroupId: 'vol', toolMode: data.tool, displaySetInstanceUID: data.displaySetInstanceUID,
      });
    }
  };

  const click = (name) => run(name, { viewports });
  return { ds: displaySets[UID], cropping, bindings, click };
}

const PRIMARY = 1;


describe('crop Adjust control', () => {
  it('starts Active when cropping is turned on', () => {
    const { ds, cropping, bindings, click } = setup();
    click('toggleVolumeCropping');

    expect(ds.volumeCroppingEnabled).toBe(true);
    expect(ds.volumeCropAdjustState).toBe(CROP_ADJUST.ACTIVE);
    expect(ds.volumeViewerToolMode).toBe(TOOLS.VOLVIEWER_TOOL_SELECT);
    expect(cropping.clipping).toBe(true);
    expect(cropping.showHandles).toBe(true);
    expect(bindings[PRIMARY]).toBe('VolumeCropping');
  });

  it('hides the box but keeps the crop when Adjust is turned off, then restores it', () => {
    const { ds, cropping, bindings, click } = setup();
    click('toggleVolumeCropping');
    click('toggleVolumeCropAdjust');

    expect(ds.volumeCropAdjustState).toBe(CROP_ADJUST.OFF);
    expect(ds.volumeViewerToolMode).toBe(TOOLS.VOLVIEWER_TOOL_DEFAULT);
    expect(cropping.clipping).toBe(true);
    expect(cropping.showHandles).toBe(false);
    expect(cropping.mode).toBe('Enabled');
    expect(bindings[PRIMARY]).toBe('TrackballRotate');

    click('toggleVolumeCropAdjust');
    expect(ds.volumeCropAdjustState).toBe(CROP_ADJUST.ACTIVE);
    expect(cropping.clipping).toBe(true);
    expect(cropping.showHandles).toBe(true);
    expect(bindings[PRIMARY]).toBe('VolumeCropping');
  });

  it('pauses when another tool takes the mouse, and resumes on click', () => {
    const { ds, cropping, bindings, click } = setup();
    click('toggleVolumeCropping');
    click('enableVolumePanTool');

    expect(ds.volumeCropAdjustState).toBe(CROP_ADJUST.PAUSED);
    expect(ds.volumeViewerToolMode).toBe(TOOLS.VOLVIEWER_TOOL_PAN);
    expect(cropping.showHandles).toBe(true);
    expect(cropping.mode).toBe('Enabled');
    expect(bindings[PRIMARY]).toBe('Pan');

    // Rotate while paused stays paused
    click('enableVolumeRotateTool');
    expect(ds.volumeCropAdjustState).toBe(CROP_ADJUST.PAUSED);

    click('toggleVolumeCropAdjust');
    expect(ds.volumeCropAdjustState).toBe(CROP_ADJUST.ACTIVE);
    expect(cropping.showHandles).toBe(true);
    expect(bindings[PRIMARY]).toBe('VolumeCropping');
  });

  it('returns the mouse to the mode used before Adjust', () => {
    const { ds, bindings, click } = setup();
    click('enableVolumePanTool');
    click('toggleVolumeCropping');
    click('toggleVolumeCropAdjust');

    expect(ds.volumeCropAdjustState).toBe(CROP_ADJUST.OFF);
    expect(ds.volumeViewerToolMode).toBe(TOOLS.VOLVIEWER_TOOL_PAN);
    expect(bindings[PRIMARY]).toBe('Pan');
  });

  it('stays off when Rotate or Pan is chosen with the box hidden', () => {
    const { ds, cropping, click } = setup();
    click('toggleVolumeCropping');
    click('toggleVolumeCropAdjust');
    click('enableVolumePanTool');

    expect(ds.volumeCropAdjustState).toBe(CROP_ADJUST.OFF);
    expect(cropping.showHandles).toBe(false);
    expect(cropping.clipping).toBe(true);
  });

  it.each([CROP_ADJUST.ACTIVE, CROP_ADJUST.PAUSED, CROP_ADJUST.OFF])(
    'clears the crop when Crop is turned off from %s, and restarts Active', (from) => {
      const { ds, cropping, bindings, click } = setup();
      click('enableVolumePanTool');
      click('toggleVolumeCropping');
      if (from == CROP_ADJUST.PAUSED) {
        click('enableVolumePanTool');
      } else if (from == CROP_ADJUST.OFF) {
        click('toggleVolumeCropAdjust');
      }
      expect(ds.volumeCropAdjustState).toBe(from);

      click('toggleVolumeCropping');
      expect(ds.volumeCroppingEnabled).toBe(false);
      expect(ds.volumeCropAdjustState).toBe(CROP_ADJUST.OFF);
      expect(ds.volumeViewerToolMode).toBe(TOOLS.VOLVIEWER_TOOL_PAN);
      expect(cropping.clipping).toBe(false);
      expect(cropping.showHandles).toBe(false);
      expect(cropping.mode).toBe('Disabled');
      expect(bindings[PRIMARY]).toBe('Pan');

      click('toggleVolumeCropping');
      expect(ds.volumeCropAdjustState).toBe(CROP_ADJUST.ACTIVE);
      expect(cropping.showHandles).toBe(true);
    });

  it('ignores Adjust while cropping is off', () => {
    const { ds, bindings, click } = setup();
    click('toggleVolumeCropAdjust');

    expect(ds.volumeCropAdjustState).toBe(CROP_ADJUST.OFF);
    expect(ds.volumeViewerToolMode).toBe(TOOLS.VOLVIEWER_TOOL_DEFAULT);
    expect(bindings[PRIMARY]).toBeUndefined();
  });
});
