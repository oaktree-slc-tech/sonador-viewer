// VOI synchronizer enrollment for the MPR slice panes (initMprImageSync / clearMprImageSync).
//
// The Synchronizer mock below is reproduced faithfully from @cornerstonejs/tools 6.0.10
// (store/SynchronizerManager/Synchronizer.js), because the defects these commands work around ARE
// the library's semantics -- a mock that "fixed" them would test nothing:
//
//   * addSource() silently skips a {renderingEngineId, viewportId} it has already seen, and the
//     VOI_MODIFIED listener lives on the viewport's DOM element -- so a stale enrollment from a
//     previous mount blocks the remounted element from ever getting a listener.
//   * addTarget() pushes unconditionally, so a pane can end up receiving VOI changes while its own
//     changes propagate nowhere (the asymmetric sync the MPR exhibited).
//   * removeSource() computes the entry's element BEFORE splicing and then calls
//     removeEventListener on it -- null when the rendering engine is already gone, which throws
//     AFTER the entry has been cleaned up. The commands' try/catch depends on that ordering.
//   * The ELEMENT_DISABLED auto-cleanup registers its handler on the element while the event fires
//     on eventTarget, so it never runs for element-sourced synchronizers; nothing prunes stale
//     entries. It is modelled as the no-op it effectively is.

// --- minimal DOM-element / event-target stand-in ------------------------------------------------

function makeEventTarget(name) {
  const listeners = new Map();

  const target = {
    name,
    addEventListener: (type, handler) => {
      if (!listeners.has(type)) {
        listeners.set(type, []);
      }
      listeners.get(type).push(handler);
    },
    removeEventListener: (type, handler) => {
      const forType = listeners.get(type) || [];
      const index = forType.indexOf(handler);
      if (index >= 0) {
        forType.splice(index, 1);
      }
    },
    dispatch: (type, detail) => {
      [...(listeners.get(type) || [])].forEach(handler =>
        handler({ type, detail, currentTarget: target }));
    },
    listenerCount: type => (listeners.get(type) || []).length,
  };

  return target;
}

// --- shared registries the jest.mock factories close over ---------------------------------------

const mockEngines = new Map(); // renderingEngineId -> { getViewport }
const mockElementOwners = new Map(); // element -> { renderingEngineId, viewportId }
const mockGlobalEventTarget = makeEventTarget('eventTarget');
const mockSyncState = { synchronizers: [] };
const mockVoiSyncCalls = []; // { source, target } viewportId pairs the callback applied

const MOCK_EVENTS = {
  VOI_MODIFIED: 'CORNERSTONE_VOI_MODIFIED',
  COLORMAP_MODIFIED: 'CORNERSTONE_COLORMAP_MODIFIED',
  ELEMENT_DISABLED: 'CORNERSTONE_ELEMENT_DISABLED',
};

jest.mock('@cornerstonejs/core', () => ({
  getRenderingEngine: id => mockEngines.get(id),
  getEnabledElement: element => mockElementOwners.get(element),
  getEnabledElementByViewportId: () => undefined,
  eventTarget: mockGlobalEventTarget,
  Enums: { Events: MOCK_EVENTS },
}), { virtual: true });

// Faithful reproduction of the library Synchronizer (see the header comment for which behaviours
// are load-bearing for these tests).
class MockSynchronizer {
  constructor(synchronizerId, eventName, eventHandler, options) {
    this._onEvent = evt => {
      if (this._ignoreFiredEvents === true) {
        return;
      }
      if (!this._targetViewports.length) {
        return;
      }
      const enabledElement = mockElementOwners.get(evt.currentTarget);
      if (!enabledElement) {
        return;
      }
      const { renderingEngineId, viewportId } = enabledElement;
      if (!this._sourceViewports.find(s => s.viewportId === viewportId)) {
        return;
      }
      this.fireEvent({ renderingEngineId, viewportId }, evt);
    };

    this._enabled = true;
    this._eventName = eventName;
    this._eventHandler = eventHandler;
    this._ignoreFiredEvents = false;
    this._sourceViewports = [];
    this._targetViewports = [];
    this._options = options || {};
    this._auxiliaryEvents = this._options.auxiliaryEvents || [];
    this.id = synchronizerId;
  }

  add(viewportInfo) {
    this.addTarget(viewportInfo);
    this.addSource(viewportInfo);
  }

  addSource(viewportInfo) {
    if (containsViewport(this._sourceViewports, viewportInfo)) {
      return;
    }
    const { renderingEngineId, viewportId } = viewportInfo;
    const viewport = mockEngines.get(renderingEngineId).getViewport(viewportId);
    if (!viewport) {
      return;
    }
    viewport.element.addEventListener(this._eventName, this._onEvent.bind(this));
    this._auxiliaryEvents.forEach(({ name }) => {
      viewport.element.addEventListener(name, this._onEvent.bind(this));
    });
    this._sourceViewports.push(viewportInfo);
  }

  addTarget(viewportInfo) {
    if (containsViewport(this._targetViewports, viewportInfo)) {
      return;
    }
    this._targetViewports.push(viewportInfo);
  }

  remove(viewportInfo) {
    this.removeTarget(viewportInfo);
    this.removeSource(viewportInfo);
  }

  removeSource(viewportInfo) {
    const index = viewportIndex(this._sourceViewports, viewportInfo);
    if (index === -1) {
      return;
    }
    const eventSource = this.getViewportElement(viewportInfo);
    this._sourceViewports.splice(index, 1);
    // Faithful library bug pair: throws when the element no longer resolves (AFTER the splice),
    // and removes _eventHandler -- not the bound _onEvent -- so a live listener is never removed.
    eventSource.removeEventListener(this._eventName, this._eventHandler);
  }

  removeTarget(viewportInfo) {
    const index = viewportIndex(this._targetViewports, viewportInfo);
    if (index === -1) {
      return;
    }
    this._targetViewports.splice(index, 1);
  }

  hasSourceViewport(renderingEngineId, viewportId) {
    return containsViewport(this._sourceViewports, { renderingEngineId, viewportId });
  }

  hasTargetViewport(renderingEngineId, viewportId) {
    return containsViewport(this._targetViewports, { renderingEngineId, viewportId });
  }

  getSourceViewports() {
    return this._sourceViewports;
  }

  getTargetViewports() {
    return this._targetViewports;
  }

  destroy() {
    this._sourceViewports.forEach(s => this.removeSource(s));
    this._targetViewports.forEach(t => this.removeTarget(t));
  }

  fireEvent(sourceViewport, sourceEvent) {
    if (!this._enabled || !this._sourceViewports.length || this._ignoreFiredEvents) {
      return;
    }
    this._ignoreFiredEvents = true;
    try {
      for (let i = 0; i < this._targetViewports.length; i++) {
        const targetViewport = this._targetViewports[i];
        if (sourceViewport.viewportId === targetViewport.viewportId) {
          continue;
        }
        this._eventHandler(this, sourceViewport, targetViewport, sourceEvent, this._options);
      }
    } finally {
      this._ignoreFiredEvents = false;
    }
  }

  getViewportElement(viewportInfo) {
    const engine = mockEngines.get(viewportInfo.renderingEngineId);
    if (!engine) {
      return null;
    }
    const viewport = engine.getViewport(viewportInfo.viewportId);
    if (!viewport) {
      return null;
    }
    return viewport.element;
  }
}

function containsViewport(arr, vp) {
  return arr.some(ar =>
    ar.renderingEngineId === vp.renderingEngineId && ar.viewportId === vp.viewportId);
}

function viewportIndex(arr, vp) {
  return arr.findIndex(ar =>
    ar.renderingEngineId === vp.renderingEngineId && ar.viewportId === vp.viewportId);
}

const mockSynchronizerManager = {
  getSynchronizer: id => mockSyncState.synchronizers.find(sync => sync.id === id),
  destroySynchronizer: id => {
    const index = mockSyncState.synchronizers.findIndex(sync => sync.id === id);
    if (index > -1) {
      mockSyncState.synchronizers[index].destroy();
      mockSyncState.synchronizers.splice(index, 1);
    }
  },
};

jest.mock('@cornerstonejs/tools', () => ({
  ToolGroupManager: {},
  SynchronizerManager: mockSynchronizerManager,
  WindowLevelTool: class {},
  CrosshairsTool: class {},
  ZoomTool: class {},
  PanTool: class {},
  StackScrollTool: class {},
  TrackballRotateTool: class {},
  Enums: { MouseBindings: {} },
  addTool: jest.fn(),
  segmentation: {},
}), { virtual: true });

jest.mock('@cornerstonejs/tools/enums', () => ({
  SegmentationRepresentations: { Labelmap: 'Labelmap', Contour: 'Contour' },
}), { virtual: true });

jest.mock('@cornerstonejs/tools/synchronizers', () => ({
  // As the library's createVOISynchronizer: same-id creation is a hard error, the sync listens for
  // VOI_MODIFIED, and the handler applies the change to each target. The handler records the
  // source -> target pair so the tests can assert what actually propagated.
  createVOISynchronizer: synchronizerName => {
    if (mockSyncState.synchronizers.some(sync => sync.id === synchronizerName)) {
      throw new Error(`Synchronizer with id '${synchronizerName}' already exists.`);
    }
    const synchronizer = new MockSynchronizer(
      synchronizerName,
      MOCK_EVENTS.VOI_MODIFIED,
      (sync, sourceViewport, targetViewport) => {
        mockVoiSyncCalls.push({
          source: sourceViewport.viewportId,
          target: targetViewport.viewportId,
        });
      },
      { auxiliaryEvents: [{ name: MOCK_EVENTS.COLORMAP_MODIFIED }] },
    );
    mockSyncState.synchronizers.push(synchronizer);
    return synchronizer;
  },
}), { virtual: true });

jest.mock('@ohif/core', () => ({
  display: { DisplaySetApi: {} },
}), { virtual: true });

jest.mock('@ohif/extension-cornerstone', () => ({ utils: {} }), { virtual: true });
jest.mock('./utils/setMPRLayout.js', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('./utils/cornerstone3d.js', () => ({ getCornerstone3dViewport: jest.fn() }));

// Required (not ES-imported) so the jest.mock factories above run only after this file's
// module-scope registries are initialized; an import would hoist above them.
const commandsModule = require('./commandsModule').default;

// --- harness ------------------------------------------------------------------------------------

const RENDER_ID = 'cornerstone3dSliceView';
const VOI_SYNC_ID = 'cornerstone3dSliceView';
const ORIENTATIONS = ['axial', 'sagittal', 'coronal'];

const { definitions } = commandsModule({ commandsManager: {}, servicesManager: { services: {} } });
const initMprImageSync = definitions.initMprImageSync.commandFn;
const clearMprImageSync = definitions.clearMprImageSync.commandFn;

// Stand up a rendering engine holding one viewport per orientation, each with a fresh element --
// what enableElement leaves behind on a (re)mounted MPR layout.
function mountEngine() {
  const viewports = new Map();

  ORIENTATIONS.forEach(orientation => {
    const viewportId = `${RENDER_ID}-${orientation}`;
    const element = makeEventTarget(viewportId);
    viewports.set(viewportId, { id: viewportId, element });
    mockElementOwners.set(element, { renderingEngineId: RENDER_ID, viewportId });
  });

  const engine = { getViewport: id => viewports.get(id) };
  mockEngines.set(RENDER_ID, engine);
  return viewports;
}

// Tear the session down the way the base view's unmount does when clearMprImageSync is NOT run:
// the engine and elements just go away; the synchronizer is left holding its entries.
function destroyEngine() {
  mockEngines.delete(RENDER_ID);
  mockElementOwners.clear();
}

function makePane(orientation) {
  const viewportId = `${RENDER_ID}-${orientation}`;
  return {
    props: { renderId: RENDER_ID, voiSyncId: VOI_SYNC_ID },
    imgSync: undefined,
    getViewportId: () => viewportId,
    _checkViewportActive() {
      const engine = mockEngines.get(RENDER_ID);
      const viewport = engine && engine.getViewport(viewportId);
      return viewport ? { viewportId, viewport } : {};
    },
  };
}

function enrollAll() {
  return ORIENTATIONS.map(orientation => {
    const pane = makePane(orientation);
    expect(initMprImageSync({ voiSyncId: VOI_SYNC_ID, component: pane })).toBe(true);
    return pane;
  });
}

function changeVoiOn(viewports, orientation) {
  mockVoiSyncCalls.length = 0;
  viewports.get(`${RENDER_ID}-${orientation}`).element
    .dispatch(MOCK_EVENTS.VOI_MODIFIED, { range: { lower: 0, upper: 100 } });
  return mockVoiSyncCalls.map(call => call.target).sort();
}

beforeEach(() => {
  mockEngines.clear();
  mockElementOwners.clear();
  mockSyncState.synchronizers.length = 0;
  mockVoiSyncCalls.length = 0;
});

// --- tests --------------------------------------------------------------------------------------

describe('initMprImageSync', () => {
  test('reports failure and enrolls nothing while the viewport is not yet enabled', () => {
    mockEngines.set(RENDER_ID, { getViewport: () => undefined });
    const pane = makePane('axial');

    expect(initMprImageSync({ voiSyncId: VOI_SYNC_ID, component: pane })).toBe(false);
    expect(pane.imgSync).toBeUndefined();
    expect(mockSynchronizerManager.getSynchronizer(VOI_SYNC_ID)).toBeUndefined();
  });

  test('a VOI change in any enrolled pane reaches both of the others', () => {
    const viewports = mountEngine();
    enrollAll();

    expect(changeVoiOn(viewports, 'axial'))
      .toEqual([`${RENDER_ID}-coronal`, `${RENDER_ID}-sagittal`]);
    expect(changeVoiOn(viewports, 'coronal'))
      .toEqual([`${RENDER_ID}-axial`, `${RENDER_ID}-sagittal`]);
  });

  test('heals a stale enrollment so a remounted pane gets a listener on its new element', () => {
    // First session enrolls, then tears down without clearMprImageSync -- the pre-fix teardown.
    mountEngine();
    enrollAll();
    destroyEngine();

    // Second session: same fixed ids, brand-new elements. Without the remove-before-add heal,
    // Synchronizer.add() skips every pane as a duplicate and no new element gets a listener.
    const viewports = mountEngine();
    enrollAll();

    ORIENTATIONS.forEach(orientation => {
      const { element } = viewports.get(`${RENDER_ID}-${orientation}`);
      expect(element.listenerCount(MOCK_EVENTS.VOI_MODIFIED)).toBe(1);
    });
    expect(changeVoiOn(viewports, 'sagittal'))
      .toEqual([`${RENDER_ID}-axial`, `${RENDER_ID}-coronal`]);
  });
});

describe('clearMprImageSync', () => {
  test('a cleared pane stops propagating, and the last pane out destroys the synchronizer', () => {
    const viewports = mountEngine();
    const panes = enrollAll();

    clearMprImageSync({ voiSyncId: VOI_SYNC_ID, component: panes[0] });
    expect(panes[0].imgSync).toBeUndefined();
    expect(changeVoiOn(viewports, 'axial')).toEqual([]);
    expect(changeVoiOn(viewports, 'sagittal')).toEqual([`${RENDER_ID}-coronal`]);

    clearMprImageSync({ voiSyncId: VOI_SYNC_ID, component: panes[1] });
    clearMprImageSync({ voiSyncId: VOI_SYNC_ID, component: panes[2] });
    expect(mockSynchronizerManager.getSynchronizer(VOI_SYNC_ID)).toBeUndefined();
  });

  test('still withdraws cleanly when the rendering engine is already gone', () => {
    mountEngine();
    const panes = enrollAll();
    destroyEngine();

    // removeSource resolves the element to null and throws after splicing the entry out; the
    // command swallows that and the empty synchronizer is still destroyed by the last pane.
    panes.forEach(pane => clearMprImageSync({ voiSyncId: VOI_SYNC_ID, component: pane }));
    expect(mockSynchronizerManager.getSynchronizer(VOI_SYNC_ID)).toBeUndefined();
  });
});
