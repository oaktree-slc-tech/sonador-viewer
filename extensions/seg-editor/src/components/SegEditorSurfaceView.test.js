// Segmentation Editor 3D editing canvas: loading surfaces from the Cornerstone3D cache and following
// the segmentation state. The component's logic is driven directly (this repo has no React test
// renderer) against a fake M3DModelView api.

import { cutAndPatch, repairSurface } from '../threeDTools/deleteSelection';
import { SELECTION_MODES, selectTrianglesInLasso } from '../threeDTools/lassoSelection';
import { triangleTopology } from '../threeDTools/meshRepair';
import { withOwnSurfaceWrite } from '../threeDTools/ownWrites';
import { collectTrianglesInSphere, raycastSurfaces } from '../threeDTools/paintSelection';
import { diagnoseSurfaceInWorker, getLabelmapForEdit, smoothInWorker } from '../threeDTools/segmentEdits';
import {
  queueSurfaceEditWrite,
  recordSurfaceEdit,
  setCachedSurface,
  SURFACE_CHANGED_REQUEST,
} from '../threeDTools/surfaceEdits';
import { resetSyncLedger } from '../threeDTools/syncLedger';
import {
  get3DToolState,
  request3DToolAction,
  reset3DToolState,
  set3DToolBusy,
  set3DToolOption,
  setActive3DTool,
  setRemovalDepth,
  THREE_D_TOOLS,
} from '../threeDTools/threeDToolState';

import SegEditorSurfaceView, {
  getCachedSurfaces,
  lutColorToCss,
  viewToVtkCamera,
  vtkToViewCamera,
} from './SegEditorSurfaceView';

const mockState = {
  segmentations: {},
  geometries: {},
  colorLUTs: {},
  representations: {},
  hiddenSegments: new Set(),
  representationVisible: true,
  locked: new Set(),
  activeSegmentIndex: {},
};

// virtual: jest's resolver does not follow the Cornerstone3D packages' `exports` maps
jest.mock('@cornerstonejs/core', () => ({
  cache: { getGeometry: id => mockState.geometries[id] },
  getWebWorkerManager: () => ({}),
  eventTarget: { addEventListener: jest.fn(), removeEventListener: jest.fn() },
}), { virtual: true });
jest.mock('@cornerstonejs/tools', () => ({
  Enums: {
    SegmentationRepresentations: { Surface: 'Surface' },
    Events: { SEGMENTATION_MODIFIED: 'SM', SEGMENTATION_REPRESENTATION_MODIFIED: 'SRM', SEGMENTATION_DATA_MODIFIED: 'SDM' },
  },
  segmentation: {
    state: {
      getSegmentation: id => mockState.segmentations[id],
      getColorLUT: index => mockState.colorLUTs[index],
      getSegmentationRepresentations: viewportId => mockState.representations[viewportId],
    },
    config: {
      visibility: {
        getSegmentationRepresentationVisibility: () => mockState.representationVisible,
        getSegmentIndexVisibility: (_vp, _spec, index) => !mockState.hiddenSegments.has(index),
      },
    },
    segmentLocking: {
      isSegmentIndexLocked: jest.fn((id, index) => mockState.locked.has(`${id}#${index}`)
        || mockState.locked.has(index)),
    },
    segmentIndex: { getActiveSegmentIndex: id => mockState.activeSegmentIndex[id] },
  },
}), { virtual: true });
jest.mock('@ohif/extension-viewerm3d', () => ({
  M3DModelView: () => null,
  MIMETYPE_STL: 'model/stl',
  createSurfaceModel: ({ geometryId, surface, color }) => ({
    geometryId,
    segmentIndex: surface.segmentIndex,
    color,
    instance: { geometry: { from: surface.points, dispose: jest.fn() } },
  }),
  disposeSurfaceModel: jest.fn(),
  surfaceToBufferGeometry: surface => ({
    from: surface.points,
    dispose: jest.fn(),
    morphAttributes: {},
    getAttribute: () => ({ getX: v => v, getY: () => 0, getZ: () => 0 }),
  }),
}), { virtual: true });

jest.mock('@ohif/extension-vtk', () => ({ LoadingIndicator: () => null }));
jest.mock('../threejs/meshBvh', () => ({
  ensureBoundsTree: jest.fn(),
  releaseBoundsTree: jest.fn(),
}));
jest.mock('../threeDTools/LassoInteraction', () => jest.fn().mockImplementation(params => ({
  params,
  enabled: false,
  shape: params.shape,
  enable: jest.fn(function enable() { this.enabled = true; }),
  disable: jest.fn(function disable() { this.enabled = false; }),
  setShape: jest.fn(function setShape(shape) { this.shape = shape; }),
  dispose: jest.fn(),
})));
jest.mock('../threeDTools/lassoSelection', () => ({
  ...jest.requireActual('../threeDTools/lassoSelection'),
  selectTrianglesInLasso: jest.fn(() => []),
}));
jest.mock('../threeDTools/PaintInteraction', () => jest.fn().mockImplementation(params => ({
  params,
  enabled: false,
  enable: jest.fn(function enable() { this.enabled = true; }),
  disable: jest.fn(function disable() { this.enabled = false; }),
  dispose: jest.fn(),
})));
jest.mock('../threeDTools/paintSelection', () => ({
  ...jest.requireActual('../threeDTools/paintSelection'),
  raycastSurfaces: jest.fn(() => null),
  collectTrianglesInSphere: jest.fn(() => []),
}));
jest.mock('../threeDTools/segmentEdits', () => ({
  getLabelmapForEdit: jest.fn(),
  patchHolesInWorker: jest.fn(),
  smoothInWorker: jest.fn(),
  diagnoseSurfaceInWorker: jest.fn(() => Promise.resolve({
    boundaryEdgeCount: 0, nonManifoldEdgeCount: 0, closed: true, boundaryEdges: [], nonManifoldEdges: [],
  })),
}));
jest.mock('../threeDTools/deleteSelection', () => ({
  ...jest.requireActual('../threeDTools/deleteSelection'),
  cutAndPatch: jest.fn(),
  repairSurface: jest.fn(),
}));
// The preview colour is a user preference (@ohif/core); the tests set it here
const mockPreviewColor = { value: '#ff8500', listeners: new Set() };
jest.mock('../utils/previewColor', () => ({
  getPreviewColor: () => mockPreviewColor.value,
  subscribePreviewColor: listener => {
    mockPreviewColor.listeners.add(listener);
    return () => mockPreviewColor.listeners.delete(listener);
  },
}));
jest.mock('../threeDTools/surfaceEdits', () => ({
  SURFACE_CHANGED_REQUEST: 'surfaceChanged',
  setCachedSurface: jest.fn(),
  queueSurfaceEditWrite: jest.fn(),
  // Applies the edit as the real one does, without the history
  recordSurfaceEdit: jest.fn(memo => memo.restoreMemo(false)),
}));
// The developer tools flag (window.config.segEditor.developerTools), off unless a test turns it on
const mockDeveloper = { enabled: false };
jest.mock('../utils/segEditorDeveloper', () => ({
  isDeveloperToolsEnabled: () => mockDeveloper.enabled,
}));

const SEG = 'vol3d:seg::edit';
// The worker's diagnosis of a Smooth result as the delta write would voxelize it (smoothAndDiagnose)
const WRITTEN_CLOSED = Object.freeze({
  boundaryEdgeCount: 0, nonManifoldEdgeCount: 0, inconsistentEdgeCount: 0, closed: true, degenerate: 0,
  boundaryEdges: [], nonManifoldEdges: [], inconsistentEdges: [],
});
const EDIT_SEG = 'seg::edit';
const VIEWPORT = 'sonadorSegViewer-3D';

// Six triangles over three points (the selection tests use their cell indices)
function surface(segmentIndex, points = [0, 0, 0, 1, 0, 0, 0, 1, 0]) {
  return { segmentIndex, points, polys: [3, 0, 1, 2, 3, 0, 2, 1, 3, 1, 2, 0, 3, 2, 1, 0, 3, 0, 1, 2, 3, 1, 0, 2] };
}

function setSurfaces(entries) {
  mockState.geometries = {};
  const geometryIds = new Map();
  entries.forEach(entry => {
    const id = `segmentation_${SEG}_surface_${entry.segmentIndex}`;
    geometryIds.set(entry.segmentIndex, id);
    mockState.geometries[id] = { data: entry };
  });
  mockState.segmentations[SEG] = { representationData: { Surface: { geometryIds } } };
}

// The subset of the M3DModelView api the canvas uses
function fakeApi(models) {
  const map = new Map(models.map(m => [m.geometryId, m]));
  const presentation = {};
  const set = key => (id, value) => {
    presentation[id] = { ...presentation[id], [key]: value };
  };
  return {
    presentation,
    getModels: () => [...map.values()],
    getModelInstance: id => map.get(id)?.instance,
    addModel: jest.fn(model => map.set(model.geometryId, model)),
    removeModel: jest.fn(id => {
      const model = map.get(id);
      map.delete(id);
      return model;
    }),
    setModelVisibility: set('visible'),
    setModelWireframe: set('wireframe'),
    setModelColor: set('color'),
    setCameraLookAt: jest.fn(),
    getCameraLookAt: jest.fn(() => ({
      position: [0, -400, 0], target: [0, 0, 0], up: [0, 0, 1], parallelScale: 120,
    })),
    setRenderingPaused: jest.fn(),
    resize: jest.fn(),
    setMouseActions: jest.fn(),
    getCamera: jest.fn(() => ({ isCamera: true })),
    scene: { add: jest.fn(), remove: jest.fn() },
    container: {},
    renderer: { domElement: {} },
  };
}

// Models whose instances carry a real position attribute (for the selection highlight)
function positionedModels(view) {
  view.state.initialModels.forEach(model => {
    model.instance.visible = true;
    model.instance.matrixWorld = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
    model.instance.geometry.getAttribute = () => ({
      getX: v => v, getY: () => 0, getZ: () => 0,
    });
  });
}

function createView(props = {}) {
  const view = new SegEditorSurfaceView({
    ...SegEditorSurfaceView.defaultProps,
    // The topology is built in a worker in the viewer; here it is built in place
    computeTopology: surface => triangleTopology(surface),
    segmentationId: SEG,
    referenceViewportId: VIEWPORT,
    colorLUTIndex: 1,
    surfaceReady: true,
    ...props,
  });
  view.setState = update => Object.assign(view.state, update);
  mountedViews.push(view);
  return view;
}

// Views are unmounted after each test: a view left mounted stays subscribed to the shared tool
// state and would follow the next test's surfaces (clearing the health it publishes, starting
// diagnoses), which a second canvas never does in the editor
const mountedViews = [];
afterEach(() => {
  mountedViews.splice(0).forEach(view => {
    if (view._isMounted) {
      view.componentWillUnmount();
    }
  });
});

beforeEach(() => {
  reset3DToolState();
  resetSyncLedger();
  jest.clearAllMocks();
  jest.spyOn(console, 'debug').mockImplementation(() => {});
  mockDeveloper.enabled = false;
  mockState.activeSegmentIndex = {};
  mockState.segmentations = {};
  mockState.colorLUTs = { 1: { 1: [255, 0, 0, 255], 2: [0, 128, 255, 255] } };
  mockState.representations = { [VIEWPORT]: [{ type: 'Surface' }] };
  mockState.hiddenSegments = new Set();
  mockState.representationVisible = true;
  mockState.locked = new Set();
});

describe('helpers', () => {
  it('lists the cached surfaces of a segmentation', () => {
    setSurfaces([surface(1), surface(2)]);
    expect(getCachedSurfaces(SEG).map(s => s.segmentIndex)).toEqual([1, 2]);
    expect(getCachedSurfaces('unknown')).toEqual([]);
  });

  it('skips surfaces with no geometry', () => {
    setSurfaces([surface(1), { segmentIndex: 2, points: [], polys: [] }]);
    expect(getCachedSurfaces(SEG).map(s => s.segmentIndex)).toEqual([1]);
  });

  it('converts LUT colours to CSS', () => {
    expect(lutColorToCss([0, 128.4, 255, 255])).toBe('rgb(0, 128, 255)');
    expect(lutColorToCss(undefined)).toBeUndefined();
  });
});

describe('SegEditorSurfaceView', () => {
  it('waits for the surface before creating models', () => {
    setSurfaces([surface(1)]);
    const view = createView({ surfaceReady: false });

    view._loadInitialModels();
    expect(view.state.initialModels).toBeNull();

    view.props = { ...view.props, surfaceReady: true };
    view._loadInitialModels();
    expect(view.state.initialModels.map(m => m.segmentIndex)).toEqual([1]);
    expect(view.state.initialModels[0].color).toBe('rgb(255, 0, 0)');
  });

  it('matches the VTK camera and applies the segmentation state when created', () => {
    setSurfaces([surface(1), surface(2)]);
    mockState.locked.add(2);
    mockState.hiddenSegments.add(1);
    const camera = {
      position: [0, -500, 0], focalPoint: [0, 0, 0], viewUp: [0, 0, 1],
      parallelProjection: true, parallelScale: 150, viewAngle: 90,
    };
    const view = createView({ getReferenceCamera: () => camera, active: false });
    view._loadInitialModels();
    const api = fakeApi(view.state.initialModels);

    view._onCreated(api);

    expect(api.resize).toHaveBeenCalled();
    expect(api.setCameraLookAt).toHaveBeenCalledWith({
      position: [0, -500, 0], target: [0, 0, 0], up: [0, 0, 1], parallelScale: 150,
    });
    expect(api.setRenderingPaused).toHaveBeenCalledWith(true);
    const [g1, g2] = view.state.initialModels.map(m => m.geometryId);
    expect(api.presentation[g1]).toEqual({ visible: false, wireframe: false, color: 'rgb(255, 0, 0)' });
    expect(api.presentation[g2]).toEqual({ visible: true, wireframe: true, color: 'rgb(0, 128, 255)' });
  });

  it('hides everything when the whole surface representation is hidden', () => {
    setSurfaces([surface(1)]);
    mockState.representationVisible = false;
    const view = createView();
    view._loadInitialModels();
    const api = fakeApi(view.state.initialModels);
    view._onCreated(api);

    expect(Object.values(api.presentation)[0].visible).toBe(false);
  });

  it('rebuilds a mesh whose surface changed, and adds and removes segment surfaces', () => {
    setSurfaces([surface(1), surface(2)]);
    const view = createView();
    view._loadInitialModels();
    const api = fakeApi(view.state.initialModels);
    view._onCreated(api);
    const [g1, g2] = view.state.initialModels.map(m => m.geometryId);
    const oldGeometry = api.getModelInstance(g1).geometry;

    // Segment 1 edited (new points array), segment 2 removed, segment 3 added
    const edited = surface(1, [0, 0, 0, 2, 0, 0, 0, 2, 0]);
    setSurfaces([edited, surface(3)]);
    view.reconcileGeometry();

    expect(api.getModelInstance(g1).geometry.from).toBe(edited.points);
    expect(oldGeometry.dispose).toHaveBeenCalled();
    expect(api.removeModel).toHaveBeenCalledWith(g2);
    expect(api.addModel).toHaveBeenCalledWith(expect.objectContaining({ segmentIndex: 3 }));
  });

  it('leaves unchanged surfaces alone', () => {
    setSurfaces([surface(1)]);
    const view = createView();
    view._loadInitialModels();
    const api = fakeApi(view.state.initialModels);
    view._onCreated(api);
    const geometry = api.getModelInstance(view.state.initialModels[0].geometryId).geometry;

    view.reconcileGeometry();

    expect(api.getModelInstance(view.state.initialModels[0].geometryId).geometry).toBe(geometry);
    expect(api.addModel).not.toHaveBeenCalled();
  });

  it('follows segmentation events for its own segmentation only', () => {
    setSurfaces([surface(1)]);
    const view = createView();
    view._loadInitialModels();
    const api = fakeApi(view.state.initialModels);
    view._onCreated(api);
    const geometryId = view.state.initialModels[0].geometryId;

    mockState.locked.add(1);
    view._onSegmentationModified({ detail: { segmentationId: 'other' } });
    expect(api.presentation[geometryId].wireframe).toBe(false);

    view._onSegmentationModified({ detail: { segmentationId: SEG } });
    expect(api.presentation[geometryId].wireframe).toBe(true);

    mockState.colorLUTs[1][1] = [1, 2, 3, 255];
    view._onRepresentationModified({ detail: { segmentationId: SEG, viewportId: 'another-view' } });
    expect(api.presentation[geometryId].color).toBe('rgb(255, 0, 0)');
    view._onRepresentationModified({ detail: { segmentationId: SEG, viewportId: VIEWPORT } });
    expect(api.presentation[geometryId].color).toBe('rgb(1, 2, 3)');
  });

  it('loads its models from the first surface event when opened before the surface existed', () => {
    const view = createView();
    view._loadInitialModels();
    expect(view.state.initialModels).toBeNull();

    setSurfaces([surface(1)]);
    view._onSegmentationModified({ detail: { segmentationId: SEG } });

    expect(view.state.initialModels).toHaveLength(1);
  });

  it('pauses rendering while hidden and catches up when shown', () => {
    setSurfaces([surface(1)]);
    const view = createView();
    view._loadInitialModels();
    const api = fakeApi(view.state.initialModels);
    view._onCreated(api);

    const prevProps = view.props;
    view.props = { ...prevProps, active: false };
    view.componentDidUpdate(prevProps);
    expect(api.setRenderingPaused).toHaveBeenLastCalledWith(true);

    const hiddenProps = view.props;
    view.props = { ...hiddenProps, active: true };
    view.componentDidUpdate(hiddenProps);
    expect(api.setRenderingPaused).toHaveBeenLastCalledWith(false);
    expect(api.resize).toHaveBeenCalled();
  });

  it('takes the VTK camera each time it is shown and hands its camera back when hidden', () => {
    setSurfaces([surface(1)]);
    const reference = {
      position: [0, -500, 0], focalPoint: [0, 0, 0], viewUp: [0, 0, 1],
      parallelProjection: true, parallelScale: 150,
    };
    const setReferenceCamera = jest.fn();
    const view = createView({ getReferenceCamera: () => reference, setReferenceCamera });
    view._loadInitialModels();
    const api = fakeApi(view.state.initialModels);
    view._onCreated(api);
    api.setCameraLookAt.mockClear();

    const shownProps = view.props;
    view.props = { ...shownProps, active: false };
    view.componentDidUpdate(shownProps);
    expect(setReferenceCamera).toHaveBeenCalledWith({
      position: [0, -400, 0], focalPoint: [0, 0, 0], viewUp: [0, 0, 1], parallelScale: 120,
    });

    const hiddenProps = view.props;
    view.props = { ...hiddenProps, active: true };
    view.componentDidUpdate(hiddenProps);
    expect(api.setCameraLookAt).toHaveBeenCalledTimes(1);
  });

  it('hands its camera to the VTK view when unmounted while shown, and not while hidden', () => {
    setSurfaces([surface(1)]);
    const reference = {
      position: [0, -500, 0], focalPoint: [0, 0, 0], viewUp: [0, 0, 1],
      parallelProjection: true, parallelScale: 150,
    };
    const setReferenceCamera = jest.fn();

    // Shown: a layout change unmounts the canvas with its current camera
    const shown = createView({ active: true, getReferenceCamera: () => reference, setReferenceCamera });
    shown._loadInitialModels();
    shown._onCreated(fakeApi(shown.state.initialModels));
    shown.componentWillUnmount();
    expect(setReferenceCamera).toHaveBeenCalledWith({
      position: [0, -400, 0], focalPoint: [0, 0, 0], viewUp: [0, 0, 1], parallelScale: 120,
    });

    // Hidden: its camera is stale (the VTK view has been used since) and must not win
    setReferenceCamera.mockClear();
    const hidden = createView({ active: false, getReferenceCamera: () => reference, setReferenceCamera });
    hidden._loadInitialModels();
    hidden._onCreated(fakeApi(hidden.state.initialModels));
    hidden.componentWillUnmount();
    expect(setReferenceCamera).not.toHaveBeenCalled();
  });
});

describe('SegEditorSurfaceView 3D tools', () => {
  function createEditingView(props = {}, { keepSurfaces = false } = {}) {
    if (!keepSurfaces) {
      setSurfaces([surface(1), surface(2)]);
    }
    mockState.segmentations[EDIT_SEG] = {
      segments: { 1: { label: 'Liver' }, 2: { label: 'Spleen' } },
    };
    mockState.activeSegmentIndex[EDIT_SEG] = 1;
    const view = createView({ editSegmentationId: EDIT_SEG, active: true, ...props });
    view.componentDidMount();
    view._loadInitialModels();
    positionedModels(view);
    const api = fakeApi(view.state.initialModels);
    view._onCreated(api);
    return { view, api };
  }

  it('shows the working segmentation\'s lock state', () => {
    mockState.locked.add(`${EDIT_SEG}#2`);
    const { view, api } = createEditingView();
    const [, g2] = view.state.initialModels.map(m => m.geometryId);

    expect(api.presentation[g2].wireframe).toBe(true);
  });

  it('publishes the active segment of the working segmentation as the target', () => {
    createEditingView();

    expect(get3DToolState().target).toEqual({
      segmentIndex: 1, label: 'Liver', color: 'rgb(255, 0, 0)', disabledReason: undefined,
    });
  });

  it.each([
    ['no active segment', () => { mockState.activeSegmentIndex[EDIT_SEG] = undefined; }, 'Select a segment to edit'],
    ['locked', () => { mockState.locked.add(`${EDIT_SEG}#1`); }, 'The selected segment is locked'],
    ['hidden', () => { mockState.hiddenSegments.add(1); }, 'The selected segment is hidden'],
    ['no surface', () => { mockState.activeSegmentIndex[EDIT_SEG] = 3; mockState.segmentations[EDIT_SEG].segments[3] = {}; },
      'The selected segment has no 3D surface yet'],
  ])('disables the target when the segment has %s', (_case, change, reason) => {
    const { view } = createEditingView();

    change();
    view._onSegmentationModified({ detail: { segmentationId: EDIT_SEG } });

    expect(get3DToolState().target.disabledReason).toBe(reason);
  });

  it('gives the left button to the Selection tool while it is active, and back to the camera after', () => {
    const { view, api } = createEditingView();
    const lasso = view._lasso;

    setActive3DTool(THREE_D_TOOLS.Lasso);
    expect(lasso.enable).toHaveBeenCalled();
    expect(api.setMouseActions).toHaveBeenLastCalledWith(
      { left: 'none', right: 'rotate', middle: 'pan', wheel: 'zoom' });

    set3DToolBusy(true);
    expect(lasso.disable).toHaveBeenCalled();
    expect(api.setMouseActions).toHaveBeenLastCalledWith(null);
    set3DToolBusy(false);

    setActive3DTool(null);
    expect(api.setMouseActions).toHaveBeenLastCalledWith(null);
  });

  it('releases the left button while the canvas is hidden', () => {
    const { view, api } = createEditingView();
    setActive3DTool(THREE_D_TOOLS.Lasso);

    const shownProps = view.props;
    view.props = { ...shownProps, active: false };
    view.componentDidUpdate(shownProps);

    expect(view._lasso.enabled).toBe(false);
    expect(api.setMouseActions).toHaveBeenLastCalledWith(null);
  });

  it('selects on the target mesh with every visible mesh as an occluder, and combines lassos', () => {
    const { view, api } = createEditingView();
    setActive3DTool(THREE_D_TOOLS.Lasso);
    const [target, other] = view.state.initialModels;
    other.instance.visible = false;

    selectTrianglesInLasso.mockReturnValueOnce([0, 1, 2]);
    view.selectWithLasso([0, 0, 1, 0, 1, 1], SELECTION_MODES.replace);
    expect(selectTrianglesInLasso).toHaveBeenCalledWith(expect.objectContaining({
      mesh: target.instance, occluders: [target.instance],
    }));
    expect(get3DToolState().selectionCount).toBe(3);
    expect(api.scene.add).toHaveBeenCalledTimes(1);

    selectTrianglesInLasso.mockReturnValueOnce([2, 5]);
    view.selectWithLasso([0, 0, 1, 0, 1, 1], SELECTION_MODES.add);
    expect([...view._selection]).toEqual([0, 1, 2, 5]);

    selectTrianglesInLasso.mockReturnValueOnce([0, 1]);
    view.selectWithLasso([0, 0, 1, 0, 1, 1], SELECTION_MODES.subtract);
    expect([...view._selection]).toEqual([2, 5]);

    request3DToolAction('clearSelection');
    expect(get3DToolState().selectionCount).toBe(0);
    expect(view._highlight).toBeNull();
  });

  it('paints the connected faces under the brush on the target, shows the brush only there, and erases', async () => {
    const { view, api } = createEditingView();
    const [target, other] = view.state.initialModels;
    target.instance.worldToLocal = point => point;
    const hitOn = (instance, faceIndex = 0) => ({
      object: instance, point: { x: 1, y: 0, z: 0, clone() { return { ...this }; } }, faceIndex,
    });

    // Each tool owns the left button in turn; the selection is kept between them
    setActive3DTool(THREE_D_TOOLS.Lasso);
    expect(view._lasso.enabled).toBe(true);
    expect(view._paint.enabled).toBe(false);
    selectTrianglesInLasso.mockReturnValueOnce([4]);
    view.selectWithLasso([0, 0, 1, 0, 1, 1], SELECTION_MODES.replace);
    setActive3DTool(THREE_D_TOOLS.Paint);
    expect(view._lasso.enabled).toBe(false);
    expect(view._paint.enabled).toBe(true);
    expect([...view._selection]).toEqual([4]);
    expect(api.setMouseActions).toHaveBeenCalledWith(expect.objectContaining({ left: 'none' }));

    // Hovering over the target shows the brush there, at the brush radius
    set3DToolOption('paintRadius', 3);
    raycastSurfaces.mockReturnValueOnce(hitOn(target.instance));
    view._brushHit([0, 0]);
    expect(view._brush.visible).toBe(true);
    expect(view._brush.scale.x).toBe(3);
    expect(api.scene.add).toHaveBeenCalledWith(view._brush);
    // Over another mesh, or nothing, it hides
    raycastSurfaces.mockReturnValueOnce(hitOn(other.instance));
    view._brushHit([0, 0]);
    expect(view._brush.visible).toBe(false);
    await view.selectWithBrush([0, 0], {});
    expect([...view._selection]).toEqual([4]);
    expect(collectTrianglesInSphere).not.toHaveBeenCalled();

    // A stroke adds the collected faces connected to the hit one
    raycastSurfaces.mockReturnValueOnce(hitOn(target.instance, 0));
    collectTrianglesInSphere.mockReturnValueOnce([0, 1]);
    await view.selectWithBrush([0, 0], { erase: false });
    expect(collectTrianglesInSphere).toHaveBeenCalledWith(expect.objectContaining({ center: [1, 0, 0], radius: 3 }));
    expect([...view._selection].sort()).toEqual([0, 1, 4]);
    expect(get3DToolState()).toMatchObject({ selectionCount: 3, selectionPoints: 3, selectionRegions: 1 });
    view._onStrokeEnd();
    expect(get3DToolState().selectionRegions).toBe(1);

    // Ctrl erases; so does the Erase mode
    raycastSurfaces.mockReturnValueOnce(hitOn(target.instance, 1));
    collectTrianglesInSphere.mockReturnValueOnce([1]);
    await view.selectWithBrush([0, 0], { erase: true });
    expect([...view._selection].sort()).toEqual([0, 4]);
    set3DToolOption('paintMode', 'erase');
    raycastSurfaces.mockReturnValueOnce(hitOn(target.instance, 4));
    collectTrianglesInSphere.mockReturnValueOnce([4]);
    await view.selectWithBrush([0, 0], {});
    expect([...view._selection]).toEqual([0]);
    set3DToolOption('paintMode', 'paint');

    // The brush goes with the canvas
    view.componentWillUnmount();
    expect(view._brush).toBeNull();
  });

  it('shows the selection as faces, edges and points, redrawn for the tool in use', () => {
    const { view } = createEditingView();
    setActive3DTool(THREE_D_TOOLS.Lasso);
    selectTrianglesInLasso.mockReturnValueOnce([0, 2]);
    view.selectWithLasso([0, 0, 1, 0, 1, 1], SELECTION_MODES.replace);
    expect(view._highlight.children).toHaveLength(3); // faces, edges, points
    const [, lassoEdges, lassoPoints] = view._highlight.children;

    setActive3DTool(THREE_D_TOOLS.Paint);
    expect(view._highlight.children).toHaveLength(3);
    const [, paintEdges, paintPoints] = view._highlight.children;
    // The brush's points and edges are subdued, the lasso's are nearer white
    expect(paintPoints.material.size).toBeLessThan(lassoPoints.material.size);
    expect(paintEdges.material.opacity).toBeLessThan(lassoEdges.material.opacity);
    expect(paintPoints.material.color.r + paintPoints.material.color.g + paintPoints.material.color.b)
      .toBeLessThan(lassoPoints.material.color.r + lassoPoints.material.color.g + lassoPoints.material.color.b);

    // The lasso follows its shape setting
    set3DToolOption('lassoShape', 'box');
    expect(view._lasso.setShape).toHaveBeenLastCalledWith('box');
    set3DToolOption('lassoShape', 'lasso');
  });

  it('drops the selection when the target segment changes or its surface is rebuilt', () => {
    const { view } = createEditingView();
    setActive3DTool(THREE_D_TOOLS.Lasso);
    selectTrianglesInLasso.mockReturnValue([0, 1]);

    view.selectWithLasso([0, 0, 1, 0, 1, 1], SELECTION_MODES.replace);
    mockState.activeSegmentIndex[EDIT_SEG] = 2;
    view._onSegmentationModified({ detail: { segmentationId: EDIT_SEG } });
    expect(get3DToolState().selectionCount).toBe(0);

    view.selectWithLasso([0, 0, 1, 0, 1, 1], SELECTION_MODES.replace);
    expect(get3DToolState().selectionCount).toBe(2);
    setSurfaces([surface(1), surface(2, [0, 0, 0, 3, 0, 0, 0, 3, 0])]);
    view.reconcileGeometry();
    expect(get3DToolState().selectionCount).toBe(0);
    selectTrianglesInLasso.mockReset();
  });

  it('follows a surface changed by a surface edit or its undo', () => {
    const { view, api } = createEditingView();
    const [g1] = view.state.initialModels.map(m => m.geometryId);
    const edited = surface(1, [0, 0, 0, 5, 0, 0, 0, 5, 0]);
    setSurfaces([edited, surface(2)]);

    request3DToolAction(SURFACE_CHANGED_REQUEST, { geometryId: g1 });

    expect(api.getModelInstance(g1).geometry.from).toBe(edited.points);
  });

  describe('delete', () => {
    const editedSurface = () => ({
      points: Float32Array.from([0, 0, 0, 5, 0, 0, 0, 5, 0]), polys: Int32Array.from([3, 0, 1, 2]),
    });
    const cutResult = (overrides = {}) => ({
      changed: true,
      edited: editedSurface(),
      editBox: { min: [0, 0, 0], max: [5, 5, 0] },
      selectedPoints: Float64Array.from([0, 0, 0, 0, 1, 0]),
      holes: 1,
      cappedHoles: 0,
      patchErrors: [],
      ...overrides,
    });

    function withSelection(props = {}, { preview = false } = {}) {
      set3DToolOption('previewEnabled', preview);
      const context = createEditingView(props);
      setActive3DTool(THREE_D_TOOLS.Lasso);
      selectTrianglesInLasso.mockReturnValueOnce([0, 2]);
      context.view.selectWithLasso([0, 0, 1, 0, 1, 1], SELECTION_MODES.replace);
      getLabelmapForEdit.mockReturnValue({ volume: { id: 'labelmap' }, scalarData: [], dimensions: [1, 1, 1] });
      return context;
    }

    // The cache applies a surface as the real setCachedSurface does: the geometry's arrays are
    // replaced and the canvas is told, so the next edit runs on the applied surface
    function applyToCache() {
      setCachedSurface.mockImplementation((segmentationId, geometryId, next, options) => {
        Object.assign(mockState.geometries[geometryId].data, { points: next.points, polys: next.polys });
        request3DToolAction('surfaceChanged', { geometryId, keepSelection: !!options?.keepSelection });
        return true;
      });
    }
    afterEach(() => {
      setCachedSurface.mockReset();
    });

    it('does nothing when the confirmation is cancelled', async () => {
      const confirm = jest.fn(() => Promise.resolve(false));
      const { view } = withSelection({ confirm });

      expect(await view.deleteSelectedPoints()).toBe(false);

      expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringContaining('Remove 2 selected faces from "Liver"'),
      }));
      expect(cutAndPatch).not.toHaveBeenCalled();
      expect(get3DToolState().selectionCount).toBe(2);
    });

    it('shows the edited surface at once and queues the labelmap write', async () => {
      const confirm = jest.fn(() => Promise.resolve(true));
      const notify = jest.fn();
      const withOwnLabelmapEdit = jest.fn(fn => fn());
      const { view } = withSelection({ confirm, notify, withOwnLabelmapEdit });
      setRemovalDepth(3.5);
      let busyDuringDelete;
      const result = cutResult();
      cutAndPatch.mockImplementation(async () => {
        busyDuringDelete = get3DToolState().busy;
        return result;
      });
      const geometryId = view.state.initialModels[0].geometryId;
      const original = mockState.geometries[geometryId].data;

      expect(await request3DToolAction('deleteSelection')).toBe(true);

      expect(cutAndPatch).toHaveBeenCalledWith(expect.objectContaining({
        surface: { points: original.points, polys: original.polys },
        selectedTriangles: [0, 2],
      }));
      expect(setCachedSurface).toHaveBeenCalledWith(SEG, geometryId, result.edited, { keepSelection: false });
      expect(queueSurfaceEditWrite).toHaveBeenCalledTimes(1);
      const [memo, deps] = queueSurfaceEditWrite.mock.calls[0];
      expect(memo).toMatchObject({
        geometryId, segmentIndex: 1, write: { kind: 'delete', depth: 3.5 }, after: result.edited, editBox: result.editBox,
        labelmapVolume: { id: 'labelmap' },
      });
      expect(memo.before.points).toBe(original.points);
      expect(deps).toMatchObject({ editSegmentationId: EDIT_SEG, withOwnEdit: withOwnLabelmapEdit });
      expect(recordSurfaceEdit).toHaveBeenCalledWith(memo);
      expect(busyDuringDelete).toBe(true);
      expect(get3DToolState().busy).toBe(false);
      expect(get3DToolState().selectionCount).toBe(0);
      expect(notify).not.toHaveBeenCalled();
      expect(view.state.deleteStep).toBeNull();
    });

    it('shows an emptied surface when the selection removed the whole surface', async () => {
      const { view } = withSelection({ confirm: () => Promise.resolve(true) });
      cutAndPatch.mockResolvedValue(cutResult({ edited: null, holes: 0 }));

      expect(await view.deleteSelectedPoints()).toBe(true);

      const [, , shown] = setCachedSurface.mock.calls[0];
      expect(shown.points).toHaveLength(0);
      expect(shown.polys).toHaveLength(0);
    });

    it('reports the refusal of a queued write with the layout\'s callbacks', async () => {
      const notify = jest.fn();
      const onEditError = jest.fn();
      const { view } = withSelection({ confirm: () => Promise.resolve(true), notify, onEditError });
      cutAndPatch.mockResolvedValue(cutResult());

      await view.deleteSelectedPoints();
      const [, deps] = queueSurfaceEditWrite.mock.calls[0];
      deps.onRefused();
      deps.onError(new Error('worker failed'));

      expect(notify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'warning', message: expect.stringContaining('Undo the removal'),
      }));
      expect(onEditError).toHaveBeenCalledWith(expect.any(Error));
    });

    it('tells the user when the selection touches no triangle', async () => {
      const notify = jest.fn();
      const { view } = withSelection({ confirm: () => Promise.resolve(true), notify });
      cutAndPatch.mockResolvedValue({ changed: false, edited: null, holes: 0, cappedHoles: 0, patchErrors: [] });

      expect(await view.deleteSelectedPoints()).toBe(true);

      expect(setCachedSurface).not.toHaveBeenCalled();
      expect(queueSurfaceEditWrite).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }));
      expect(get3DToolState().selectionCount).toBe(0);
    });

    it('reports holes that were closed flat', async () => {
      const notify = jest.fn();
      const { view } = withSelection({ confirm: () => Promise.resolve(true), notify });
      cutAndPatch.mockResolvedValue(cutResult({ holes: 2, cappedHoles: 1, patchErrors: ['x'] }));

      await view.deleteSelectedPoints();

      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' }));
      expect(setCachedSurface).toHaveBeenCalled();
    });

    it('reports failures and keeps the tool usable', async () => {
      const onEditError = jest.fn();
      const { view } = withSelection({ confirm: () => Promise.resolve(true), onEditError });
      const error = new Error('worker failed');
      cutAndPatch.mockRejectedValue(error);

      expect(await view.deleteSelectedPoints()).toBe(false);

      expect(onEditError).toHaveBeenCalledWith(error);
      expect(get3DToolState().busy).toBe(false);
      expect(setCachedSurface).not.toHaveBeenCalled();
    });

    // A delete whose patch stage is still running when the editor closes or the target changes
    function pendingDelete() {
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      cutAndPatch.mockImplementation(async ({ deps }) => {
        await gate;
        if (deps.isCancelled?.()) {
          const { DeleteCancelledError } = require('../threeDTools/deleteSelection');
          throw new DeleteCancelledError();
        }
        return cutResult();
      });
      return () => release();
    }
    const flush = () => new Promise(resolve => setTimeout(resolve, 0));

    it('applies nothing when the editor closes while the delete is running', async () => {
      const onEditError = jest.fn();
      const notify = jest.fn();
      const { view } = withSelection({ confirm: () => Promise.resolve(true), onEditError, notify });
      const release = pendingDelete();

      const done = view.deleteSelectedPoints();
      await flush();
      view.componentWillUnmount();
      // A new editor session starts its own job before the old one settles
      reset3DToolState();
      const newJob = require('../threeDTools/threeDToolState').begin3DToolJob();
      release();

      expect(await done).toBe(false);
      expect(setCachedSurface).not.toHaveBeenCalled();
      expect(queueSurfaceEditWrite).not.toHaveBeenCalled();
      expect(onEditError).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
      expect(get3DToolState().busy).toBe(true); // still the new session's job
      require('../threeDTools/threeDToolState').end3DToolJob(newJob);
    });

    it('applies nothing when the target is locked while the delete is running', async () => {
      const notify = jest.fn();
      const { view } = withSelection({ confirm: () => Promise.resolve(true), notify });
      const release = pendingDelete();

      const done = view.deleteSelectedPoints();
      await flush();
      mockState.locked.add(`${EDIT_SEG}#1`);
      release();

      expect(await done).toBe(false);
      expect(setCachedSurface).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'warning', message: expect.stringContaining('nothing was removed'),
      }));
      expect(get3DToolState().busy).toBe(false);
    });

    it('applies nothing when the working labelmap volume was replaced meanwhile', async () => {
      const { view } = withSelection({ confirm: () => Promise.resolve(true) });
      const release = pendingDelete();

      const done = view.deleteSelectedPoints();
      await flush();
      getLabelmapForEdit.mockReturnValue({ volume: { id: 'another' }, scalarData: [], dimensions: [1, 1, 1] });
      release();

      expect(await done).toBe(false);
      expect(setCachedSurface).not.toHaveBeenCalled();
    });

    it('refuses a selection made on a surface that has since changed', async () => {
      const notify = jest.fn();
      const { view } = withSelection({ confirm: () => Promise.resolve(true), notify });
      const geometryId = view.state.initialModels[0].geometryId;
      mockState.geometries[geometryId] = { data: surface(1, [9, 9, 9, 8, 8, 8, 7, 7, 7]) };

      expect(await view.deleteSelectedPoints()).toBe(false);

      expect(cutAndPatch).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' }));
    });

    it('does nothing without a selection or while the target cannot be edited, and says why', async () => {
      // Every guard answers with a notice naming the reason (ohif-viewers#149, FR-9)
      const confirm = jest.fn(() => Promise.resolve(true));
      const notify = jest.fn();
      const { view } = createEditingView({ confirm, notify });
      const lastMessage = () => notify.mock.calls[notify.mock.calls.length - 1][0];

      expect(await view.deleteSelectedPoints()).toBe(false);
      expect(confirm).not.toHaveBeenCalled();
      expect(lastMessage()).toMatchObject({ type: 'warning', title: 'Remove selected faces', message: 'Select faces first.' });
      expect(console.debug).toHaveBeenCalledWith('[SegEditor3D]', expect.objectContaining({ operation: 'remove', outcome: 'refused', reason: 'noSelection' }));

      setActive3DTool(THREE_D_TOOLS.Lasso);
      selectTrianglesInLasso.mockReturnValueOnce([0, 2]);
      view.selectWithLasso([0, 0, 1, 0, 1, 1], SELECTION_MODES.replace);
      set3DToolBusy(true);
      expect(await view.deleteSelectedPoints()).toBe(false);
      expect(lastMessage().message).toMatch(/Another edit is still running/);
      set3DToolBusy(false);

      require('../threeDTools/threeDToolState').set3DPreview({ holes: 1 });
      expect(await view.smoothSelection()).toBe(false);
      expect(lastMessage()).toMatchObject({ title: 'Smooth selected faces', message: expect.stringMatching(/Finish or cancel/) });
      require('../threeDTools/threeDToolState').set3DPreview(null);

      mockState.locked.add(`${EDIT_SEG}#1`);
      view._onSegmentationModified({ detail: { segmentationId: EDIT_SEG } });
      expect(await view.repairSurface()).toBe(false);
      expect(lastMessage()).toMatchObject({ title: 'Repair surface', message: 'The selected segment is locked' });
      expect(console.debug).toHaveBeenCalledWith('[SegEditor3D]', expect.objectContaining({ operation: 'repair', outcome: 'refused', reason: 'noTarget' }));
    });

    it('tells the user when a Repair finds the surface changed since it was checked', async () => {
      // The Repair path needs no selection, and used to fail silently here
      const notify = jest.fn();
      const { view } = createEditingView({ notify });
      getLabelmapForEdit.mockReturnValue({ volume: { id: 'labelmap' }, scalarData: [], dimensions: [1, 1, 1] });
      const geometryId = view.state.initialModels[0].geometryId;
      mockState.geometries[geometryId] = { data: surface(1, [9, 9, 9, 8, 8, 8, 7, 7, 7]) };

      expect(await view.repairSurface()).toBe(false);

      expect(repairSurface).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'warning', title: 'Repair surface', message: expect.stringMatching(/surface changed/),
      }));
    });

    it('keeps a removal that is not sound on the surface only, shown for Apply, and says so', async () => {
      // The result introduced open edges: no labelmap write, whatever the preview setting
      const notify = jest.fn();
      const { view } = withSelection({ confirm: () => Promise.resolve(true), notify }, { preview: false });
      applyToCache();
      cutAndPatch.mockResolvedValue(cutResult({
        diagnostics: {
          methods: { flat: 1 }, openEdges: 3, removedTriangles: 2, acceptable: false,
          output: { closed: false, boundaryEdgeCount: 3, nonManifoldEdgeCount: 0, inconsistentEdgeCount: 0 },
          introduced: { total: 3, boundaryEdgeCount: 3, nonManifoldEdgeCount: 0, inconsistentEdgeCount: 0, retained: {} },
          preexistingLoops: { count: 1, vertexCounts: [8] },
        },
      }));

      expect(await view.deleteSelectedPoints()).toBe(true);
      // Shown for Apply although the preview is off
      expect(get3DToolState().preview).toMatchObject({ write: 'surfaceOnly', preexistingLoops: 1, introduced: { total: 3 } });
      expect(recordSurfaceEdit).not.toHaveBeenCalled();

      request3DToolAction('applyPreview');

      expect(recordSurfaceEdit).toHaveBeenCalledTimes(1);
      const memo = recordSurfaceEdit.mock.calls[0][0];
      expect(memo.surfaceOnly).toBe(true);
      expect(queueSurfaceEditWrite).not.toHaveBeenCalled();
      expect(setCachedSurface).toHaveBeenCalledTimes(1);
      // The notice names the counts and the recovery that exists (Undo); Repair is surface-only
      // too, so it is not offered as the way to update the 2D views
      const warning = notify.mock.calls.map(([n]) => n).find(n => n.type === 'warning');
      expect(warning.message).toMatch(/2D views were not updated.*3 open, 0 non-manifold and 0 inverted edge\(s\), 3 of them new.*Undo restores/);
      expect(warning.message).not.toMatch(/Repair/);
      expect(get3DToolState().lastEdit).toMatchObject({ write: 'surfaceOnly', faces: 2, preexistingLoops: 1 });
      expect(get3DToolState().unsynchronizedEdits).toBe(1);
    });

    it('keeps a removal that retained an opening it did not touch on the surface only as well', async () => {
      // Nothing new is open, which the report says; but the result has open edges, and a detected
      // defect is voxelized only with the user's explicit acknowledgement (ohif-viewers#149 FR-4,
      // #152 §3), which this round cannot ask for. Ordinary Apply is not that acknowledgement.
      const notify = jest.fn();
      const { view } = withSelection({ confirm: () => Promise.resolve(true), notify }, { preview: false });
      applyToCache();
      cutAndPatch.mockResolvedValue(cutResult({
        diagnostics: {
          methods: { fitted: 1 }, openEdges: 0, removedTriangles: 2, acceptable: false,
          output: { closed: false, boundaryEdgeCount: 8, nonManifoldEdgeCount: 0, inconsistentEdgeCount: 0 },
          introduced: { total: 0, boundaryEdgeCount: 0, nonManifoldEdgeCount: 0, inconsistentEdgeCount: 0, retained: { boundaryEdgeCount: 8 } },
          preexistingLoops: { count: 1, vertexCounts: [8] },
        },
      }));

      expect(await view.deleteSelectedPoints()).toBe(true);
      expect(get3DToolState().preview).toMatchObject({ write: 'surfaceOnly', preexistingLoops: 1, closed: false });
      request3DToolAction('applyPreview');

      expect(queueSurfaceEditWrite).not.toHaveBeenCalled();
      expect(recordSurfaceEdit.mock.calls[0][0].surfaceOnly).toBe(true);
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'warning', message: expect.stringMatching(/8 open, 0 non-manifold and 0 inverted edge\(s\), 0 of them new/),
      }));
      expect(get3DToolState().lastEdit).toMatchObject({ write: 'surfaceOnly', preexistingLoops: 1, closed: false });
      expect(get3DToolState().unsynchronizedEdits).toBe(1);
    });

    const defective = () => cutResult({
      diagnostics: {
        methods: { flat: 1 }, openEdges: 3, removedTriangles: 2, acceptable: false,
        output: { closed: false, boundaryEdgeCount: 3, nonManifoldEdgeCount: 0, inconsistentEdgeCount: 0 },
        introduced: { total: 3, boundaryEdgeCount: 3, nonManifoldEdgeCount: 0, inconsistentEdgeCount: 0, retained: {} },
        preexistingLoops: { count: 0, vertexCounts: [] },
      },
    });
    const sound = () => cutResult({
      diagnostics: {
        methods: { fitted: 1 }, openEdges: 0, removedTriangles: 1, acceptable: true,
        output: { closed: true, boundaryEdgeCount: 0, nonManifoldEdgeCount: 0, inconsistentEdgeCount: 0 },
        introduced: { total: 0, boundaryEdgeCount: 0, nonManifoldEdgeCount: 0, inconsistentEdgeCount: 0, retained: {} },
        preexistingLoops: { count: 0, vertexCounts: [] },
      },
    });

    it('keeps every later edit on the surface while an earlier one has not reached the 2D views, until it is undone', async () => {
      // After a surface-only Remove the labelmap no longer reflects the surface: a later write
      // computed from that surface would voxelize an intermediate state (ohif-viewers#152 §4), so
      // a sound Remove and a Smooth stay surface-only too, and say why. Undoing the surface-only
      // edits brings the two back together, and the next sound edit is written again.
      const notify = jest.fn();
      const { view } = withSelection({ confirm: () => Promise.resolve(true), notify }, { preview: false });
      const geometryId = view.state.initialModels[0].geometryId;
      applyToCache();
      try {
        cutAndPatch.mockResolvedValue(defective());
        expect(await view.deleteSelectedPoints()).toBe(true);
        request3DToolAction('applyPreview');
        const first = recordSurfaceEdit.mock.calls[0][0];
        expect(get3DToolState().unsynchronizedEdits).toBe(1);
        expect(mockState.geometries[geometryId].data.points).toBe(first.after.points);

        // A sound Remove on the applied surface: shown for Apply, then surface-only, no write
        selectTrianglesInLasso.mockReturnValueOnce([0]);
        view.selectWithLasso([0, 0, 1, 0, 1, 1], SELECTION_MODES.replace);
        cutAndPatch.mockResolvedValue(sound());
        notify.mockClear();
        expect(await view.deleteSelectedPoints()).toBe(true);
        expect(get3DToolState().preview).toMatchObject({ write: 'surfaceOnly', closed: true });
        request3DToolAction('applyPreview');
        const second = recordSurfaceEdit.mock.calls[1][0];
        expect(second.surfaceOnly).toBe(true);
        expect(queueSurfaceEditWrite).not.toHaveBeenCalled();
        expect(notify).toHaveBeenCalledWith(expect.objectContaining({
          type: 'warning', message: expect.stringMatching(/an earlier edit of this surface has not reached them yet/),
        }));
        expect(get3DToolState().lastEdit).toMatchObject({ write: 'surfaceOnly', closed: true });
        expect(get3DToolState().unsynchronizedEdits).toBe(2);
        expect(console.debug).toHaveBeenCalledWith('[SegEditor3D]', expect.objectContaining({ operation: 'remove', outcome: 'preview', acceptable: true }));

        // A Smooth likewise
        selectTrianglesInLasso.mockReturnValueOnce([0]);
        view.selectWithLasso([0, 0, 1, 0, 1, 1], SELECTION_MODES.replace);
        const current = mockState.geometries[geometryId].data;
        smoothInWorker.mockResolvedValue({
          changed: true, after: { points: Float32Array.from(current.points), polys: current.polys },
          editBox: { min: [0, 0, 0], max: [5, 5, 0] }, moved: 1, maxDisplacement: 0.1, flipped: 0, degenerate: 0, written: WRITTEN_CLOSED,
        });
        expect(await view.smoothSelection()).toBe(true);
        request3DToolAction('applyPreview');
        const third = recordSurfaceEdit.mock.calls[2][0];
        expect(third.surfaceOnly).toBe(true);
        expect(queueSurfaceEditWrite).not.toHaveBeenCalled();
        expect(get3DToolState().unsynchronizedEdits).toBe(3);

        // Undo back to the synchronized surface: the state follows each step
        third.restoreMemo(true);
        expect(get3DToolState().unsynchronizedEdits).toBe(2);
        second.restoreMemo(true);
        first.restoreMemo(true);
        expect(get3DToolState().unsynchronizedEdits).toBe(0);
        expect(mockState.geometries[geometryId].data.points).toBe(first.before.points);
        // Redo puts it back
        first.restoreMemo(false);
        expect(get3DToolState().unsynchronizedEdits).toBe(1);
        first.restoreMemo(true);

        // Synchronized again: a sound Remove is written
        selectTrianglesInLasso.mockReturnValueOnce([0, 2]);
        view.selectWithLasso([0, 0, 1, 0, 1, 1], SELECTION_MODES.replace);
        cutAndPatch.mockResolvedValue(sound());
        expect(await view.deleteSelectedPoints()).toBe(true);
        expect(queueSurfaceEditWrite).toHaveBeenCalledTimes(1);
        expect(recordSurfaceEdit.mock.calls[3][0].surfaceOnly).toBe(false);
        expect(get3DToolState().unsynchronizedEdits).toBe(0);
      } finally {
        smoothInWorker.mockReset();
      }
    });

    it('keeps the synchronization ledger across a canvas remount, through undo and redo of the earlier memo', async () => {
      // The ledger lives with the session: a canvas remounted by a layout change starts from it,
      // and the memo recorded by the departed canvas keeps reporting there
      const { view } = withSelection({ confirm: () => Promise.resolve(true) }, { preview: false });
      const geometryId = view.state.initialModels[0].geometryId;
      applyToCache();
      try {
        cutAndPatch.mockResolvedValue(defective());
        expect(await view.deleteSelectedPoints()).toBe(true);
        request3DToolAction('applyPreview');
        const earlier = recordSurfaceEdit.mock.calls[0][0];
        expect(get3DToolState().unsynchronizedEdits).toBe(1);

        view.componentWillUnmount();
        const notify = jest.fn();
        const { view: again } = createEditingView({ confirm: () => Promise.resolve(true), notify }, { keepSurfaces: true });
        expect(get3DToolState().unsynchronizedEdits).toBe(1);

        // A Smooth on the remounted canvas stays surface-only
        setActive3DTool(THREE_D_TOOLS.Lasso);
        selectTrianglesInLasso.mockReturnValueOnce([0]);
        again.selectWithLasso([0, 0, 1, 0, 1, 1], SELECTION_MODES.replace);
        const current = mockState.geometries[geometryId].data;
        smoothInWorker.mockResolvedValueOnce({
          changed: true, after: { points: Float32Array.from(current.points), polys: current.polys },
          editBox: { min: [0, 0, 0], max: [5, 5, 0] }, moved: 1, maxDisplacement: 0.1, flipped: 0, degenerate: 0, written: WRITTEN_CLOSED,
        });
        expect(await again.smoothSelection()).toBe(true);
        request3DToolAction('applyPreview');
        const later = recordSurfaceEdit.mock.calls[1][0];
        expect(later.surfaceOnly).toBe(true);
        expect(queueSurfaceEditWrite).not.toHaveBeenCalled();
        expect(notify).toHaveBeenCalledWith(expect.objectContaining({
          title: 'Smooth selected faces', message: expect.stringMatching(/earlier edit of this surface has not reached them yet/),
        }));
        expect(get3DToolState().unsynchronizedEdits).toBe(2);

        // Undo and redo of the pre-remount memo are followed by the remounted canvas's state
        later.restoreMemo(true);
        earlier.restoreMemo(true);
        expect(get3DToolState().unsynchronizedEdits).toBe(0);
        earlier.restoreMemo(false);
        expect(get3DToolState().unsynchronizedEdits).toBe(1);
        earlier.restoreMemo(true);

        // Synchronized again: a sound Remove on the remounted canvas is written
        selectTrianglesInLasso.mockReturnValueOnce([0, 2]);
        again.selectWithLasso([0, 0, 1, 0, 1, 1], SELECTION_MODES.replace);
        cutAndPatch.mockResolvedValue(sound());
        expect(await again.deleteSelectedPoints()).toBe(true);
        expect(queueSurfaceEditWrite).toHaveBeenCalledTimes(1);
        expect(recordSurfaceEdit.mock.calls[2][0].surfaceOnly).toBe(false);
      } finally {
        smoothInWorker.mockReset();
      }
    });

    it('keeps a preview prepared while its predecessor\'s write was pending surface-only once that write fails', async () => {
      const notify = jest.fn();
      const { view } = withSelection({ confirm: () => Promise.resolve(true), notify }, { preview: false });
      const geometryId = view.state.initialModels[0].geometryId;
      applyToCache();
      try {
        let finish;
        queueSurfaceEditWrite.mockImplementation(memo => new Promise(resolve => {
          finish = () => {
            memo.surfaceOnly = true;
            memo.writeReport = { status: 'failed', message: 'worker lost' };
            resolve(false);
          };
        }));
        cutAndPatch.mockResolvedValue(sound());
        expect(await view.deleteSelectedPoints()).toBe(true);
        expect(get3DToolState().unsynchronizedEdits).toBe(0);

        // Prepared with a write of its own while the first write is still running
        selectTrianglesInLasso.mockReturnValueOnce([0]);
        view.selectWithLasso([0, 0, 1, 0, 1, 1], SELECTION_MODES.replace);
        const current = mockState.geometries[geometryId].data;
        smoothInWorker.mockResolvedValueOnce({
          changed: true, after: { points: Float32Array.from(current.points), polys: current.polys },
          editBox: { min: [0, 0, 0], max: [5, 5, 0] }, moved: 1, maxDisplacement: 0.1, flipped: 0, degenerate: 0, written: WRITTEN_CLOSED,
        });
        expect(await view.smoothSelection()).toBe(true);
        expect(view._pendingEdit.write).toEqual({ kind: 'smooth' });

        finish();
        await flush();
        expect(get3DToolState().unsynchronizedEdits).toBe(1);
        expect(get3DToolState().lastEdit.write).toBe('failed');

        request3DToolAction('applyPreview');
        expect(queueSurfaceEditWrite).toHaveBeenCalledTimes(1); // the first edit's only
        const second = recordSurfaceEdit.mock.calls[1][0];
        expect(second.surfaceOnly).toBe(true);
        expect(notify).toHaveBeenCalledWith(expect.objectContaining({
          title: 'Smooth selected faces', message: expect.stringMatching(/earlier edit of this surface has not reached them yet/),
        }));
        expect(get3DToolState()).toMatchObject({ unsynchronizedEdits: 2, lastEdit: { kind: 'smooth', write: 'surfaceOnly' } });
      } finally {
        queueSurfaceEditWrite.mockReset();
        smoothInWorker.mockReset();
      }
    });

    it('counts a refused write as unsynchronized, and a surface rebuilt from the labelmap as synchronized', async () => {
      const { view } = withSelection({ confirm: () => Promise.resolve(true) });
      const geometryId = view.state.initialModels[0].geometryId;
      applyToCache();
      try {
        cutAndPatch.mockResolvedValue(sound());
        let finish;
        queueSurfaceEditWrite.mockImplementation(memo => new Promise(resolve => {
          finish = () => {
            memo.surfaceOnly = true;
            memo.writeReport = { status: 'refused', reason: 'domain', farField: 5 };
            resolve(false);
          };
        }));
        expect(await view.deleteSelectedPoints()).toBe(true);
        expect(get3DToolState().unsynchronizedEdits).toBe(0);
        finish();
        await flush();
        expect(get3DToolState().unsynchronizedEdits).toBe(1);
        expect(get3DToolState().lastEdit.write).toBe('refused');

        // A slice edit rebuilt the surface from the labelmap: the labelmap is the authority again
        mockState.geometries[geometryId] = { data: surface(1, [0, 0, 0, 2, 0, 0, 0, 2, 0]) };
        view._onSegmentationModified({ detail: { segmentationId: SEG } });
        expect(get3DToolState().unsynchronizedEdits).toBe(0);
      } finally {
        queueSurfaceEditWrite.mockReset();
      }
    });

    it('refuses a malformed result without showing, caching, recording or writing it', async () => {
      // A worker result is data until checked: a NaN coordinate leaves the connectivity closed, so
      // the edge diagnostics cannot see it; nothing of such a result may reach the cache, the
      // history or the labelmap (ohif-viewers#149 FR-4)
      const notify = jest.fn();
      const { view } = withSelection({ confirm: () => Promise.resolve(true), notify }, { preview: true });
      const poisoned = sound();
      poisoned.edited.points[4] = NaN;
      cutAndPatch.mockResolvedValue(poisoned);

      expect(await view.deleteSelectedPoints()).toBe(false);

      expect(get3DToolState().preview).toBeNull();
      expect(view._pendingEdit).toBeNull();
      expect(setCachedSurface).not.toHaveBeenCalled();
      expect(recordSurfaceEdit).not.toHaveBeenCalled();
      expect(queueSurfaceEditWrite).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'error', title: 'Remove selected faces', message: expect.stringMatching(/not valid geometry: 1 non-finite coordinate\(s\) in the result/),
      }));
      expect(console.debug).toHaveBeenCalledWith('[SegEditor3D]', expect.objectContaining({ operation: 'remove', outcome: 'invalid', reason: 'nonFinitePoints', where: 'after' }));
      expect(get3DToolState().busy).toBe(false);

      // The cut stage refused a patch itself: the same answer
      selectTrianglesInLasso.mockReturnValueOnce([0, 2]);
      view.selectWithLasso([0, 0, 1, 0, 1, 1], SELECTION_MODES.replace);
      cutAndPatch.mockResolvedValue({ changed: false, invalid: { reason: 'invalidIndices', count: 2, where: 'patch', loop: 0 }, diagnostics: {} });
      expect(await view.deleteSelectedPoints()).toBe(false);
      expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({
        type: 'error', message: expect.stringMatching(/2 index\(es\) out of range in the patch/),
      }));
      expect(console.debug).toHaveBeenCalledWith('[SegEditor3D]', expect.objectContaining({ operation: 'remove', outcome: 'invalid', reason: 'invalidIndices' }));

      // A Smooth whose result has a non-finite coordinate, and a Repair with an unbounded box
      selectTrianglesInLasso.mockReturnValueOnce([0, 2]);
      view.selectWithLasso([0, 0, 1, 0, 1, 1], SELECTION_MODES.replace);
      smoothInWorker.mockResolvedValueOnce({
        changed: true, after: { points: [0, 0, 0, 1, 0, NaN, 0, 1, 0], polys: surface(1).polys },
        editBox: { min: [0, 0, 0], max: [1, 1, 0] }, moved: 1, maxDisplacement: 0.1, flipped: 0, degenerate: 0, written: WRITTEN_CLOSED,
      });
      expect(await view.smoothSelection()).toBe(false);
      expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'error', title: 'Smooth selected faces' }));
      repairSurface.mockResolvedValueOnce({
        changed: true, edited: editedSurface(), editBox: { min: [0, 0, 0], max: [NaN, 5, 0] }, selectedPoints: new Float64Array(0),
        holes: 1, cappedHoles: 0, patchErrors: [], diagnostics: { methods: { flat: 1 }, output: { closed: true } },
      });
      expect(await view.repairSurface()).toBe(false);
      expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({
        type: 'error', title: 'Repair surface', message: expect.stringMatching(/unbounded extent in the edit region/),
      }));
      expect(setCachedSurface).not.toHaveBeenCalled();
      expect(recordSurfaceEdit).not.toHaveBeenCalled();
    });

    it('follows the write of the last edit on the Last-edit line', async () => {
      const { view } = withSelection({ confirm: () => Promise.resolve(true) });
      cutAndPatch.mockResolvedValue(cutResult({ diagnostics: { methods: { fitted: 1 }, output: { closed: true }, acceptable: true } }));
      let finish;
      queueSurfaceEditWrite.mockImplementation(memo => new Promise(resolve => {
        finish = () => {
          memo.writeReport = { status: 'written', removed: 42, added: 0, farField: 0 };
          resolve(true);
        };
      }));

      await view.deleteSelectedPoints();
      expect(get3DToolState().lastEdit.write).toBe('queued');
      finish();
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(get3DToolState().lastEdit).toMatchObject({ write: 'written', removedVoxels: 42, farField: 0 });
      queueSurfaceEditWrite.mockReset();
    });

    it('keeps the last edit as an export bundle with the developer tools, and only then', async () => {
      const { view } = withSelection({ confirm: () => Promise.resolve(true) });
      cutAndPatch.mockResolvedValue(cutResult({ diagnostics: { methods: { fitted: 1 }, output: { closed: true }, acceptable: true, inputEdges: { boundaryEdges: [] } } }));

      await view.deleteSelectedPoints();
      expect(request3DToolAction('editCase')).toBeNull();

      mockDeveloper.enabled = true;
      selectTrianglesInLasso.mockReturnValueOnce([0, 2]);
      view.selectWithLasso([0, 0, 1, 0, 1, 1], SELECTION_MODES.replace);
      await view.deleteSelectedPoints();
      const bundle = request3DToolAction('editCase');
      expect(bundle).toMatchObject({
        schema: 'sonador.segEditor.3dEditCase', version: 1, operation: 'remove', selectedTriangles: [0, 2], segmentIndex: 1,
        write: { kind: 'delete', status: 'pending' },
      });
      expect(bundle.diagnostics.inputEdges).toBeUndefined();
      expect(bundle.before.points).toBe(mockState.geometries[view.state.initialModels[0].geometryId].data.points);
      // The options the edit ran with are the resolved ones (an exact weld without statistics)
      expect(bundle.options).toMatchObject({ weldTolerance: 0, maxConstraints: 8 });
    });
  });

  describe('preview', () => {
    const editedSurface = () => ({
      points: Float32Array.from([0, 0, 0, 5, 0, 0, 0, 5, 0, 1, 1, 0]), polys: Int32Array.from([3, 0, 1, 2, 3, 0, 2, 3]),
      patchPolysOffset: 4,
    });
    const cutResult = () => ({
      changed: true, edited: editedSurface(), editBox: { min: [0, 0, 0], max: [5, 5, 0] },
      selectedPoints: Float64Array.from([0, 0, 0]), holes: 1, cappedHoles: 0, patchErrors: [],
      diagnostics: { methods: { fitted: 1 }, output: { closed: true }, openEdges: 0 },
    });

    function previewing(props = {}) {
      set3DToolOption('previewEnabled', true);
      const context = createEditingView(props);
      setActive3DTool(THREE_D_TOOLS.Lasso);
      selectTrianglesInLasso.mockReturnValueOnce([0, 2]);
      context.view.selectWithLasso([0, 0, 1, 0, 1, 1], SELECTION_MODES.replace);
      getLabelmapForEdit.mockReturnValue({ volume: { id: 'labelmap' }, scalarData: [], dimensions: [1, 1, 1] });
      cutAndPatch.mockResolvedValue(cutResult());
      return context;
    }

    it('shows the edit on the canvas only, with its patches tinted, and waits for Apply, without a confirmation', async () => {
      const confirm = jest.fn(() => Promise.resolve(true));
      const { view, api } = previewing({ confirm });
      const geometryId = view.state.initialModels[0].geometryId;

      expect(await view.deleteSelectedPoints()).toBe(true);

      expect(confirm).not.toHaveBeenCalled();
      // The cache (and with it the VTK view) and the history are untouched until Apply
      expect(setCachedSurface).not.toHaveBeenCalled();
      expect(recordSurfaceEdit).not.toHaveBeenCalled();
      // A preview mesh is shown in place of the real one
      expect(view._previewMesh.geometryId).toBe(geometryId);
      expect(api.scene.add).toHaveBeenCalledWith(view._previewMesh.mesh);
      expect(api.presentation[geometryId].visible).toBe(false);
      expect(get3DToolState().preview).toEqual({
        points: 1, faces: 0, holes: 1, methods: { fitted: 1 }, closed: true, openEdges: 0, repair: false,
        preexistingLoops: 0, introduced: null, before: null, after: { closed: true }, conditioning: null, write: 'queued',
      });
      expect(view._changeOverlay).not.toBeNull();
      expect(api.scene.add).toHaveBeenCalledWith(view._changeOverlay);
      // The new patch faces, as faces, edges and vertices in the preview colour (Blender orange)
      const faces = view._changeOverlay.getObjectByName('faces');
      expect(faces.material.color.getHexString()).toBe('ff8500');
      expect(view._changeOverlay.getObjectByName('vertices').geometry.getAttribute('position').count).toBeGreaterThan(0);
      // The preview mesh is pushed back, so the overlay's edges and vertices show on its surface
      expect(view._previewMesh.mesh.material.polygonOffsetFactor).toBe(1);
      // A colour picked while the preview is up recolours it
      mockPreviewColor.listeners.forEach(listener => listener('#33aaff'));
      expect(faces.material.color.getHexString()).toBe('33aaff');
      // No further edit while the preview is up
      expect(get3DToolState().busy).toBe(false);
      expect(await view.deleteSelectedPoints()).toBe(false);
    });

    it('records the edit on Apply and queues its write', async () => {
      const { view } = previewing();
      await view.deleteSelectedPoints();

      expect(request3DToolAction('applyPreview')).toBe(true);

      expect(recordSurfaceEdit).toHaveBeenCalledTimes(1);
      expect(queueSurfaceEditWrite).toHaveBeenCalledTimes(1);
      expect(get3DToolState().preview).toBeNull();
      expect(get3DToolState().lastEdit).toMatchObject({ holes: 1, closed: true });
      expect(view._changeOverlay).toBeNull();
      expect(view._previewMesh).toBeNull();
    });

    it('takes the preview away on Cancel, writing and recording nothing', async () => {
      const { view, api } = previewing();
      const geometryId = view.state.initialModels[0].geometryId;
      await view.deleteSelectedPoints();

      expect(request3DToolAction('cancelPreview')).toBe(true);

      expect(setCachedSurface).not.toHaveBeenCalled();
      expect(recordSurfaceEdit).not.toHaveBeenCalled();
      expect(view._previewMesh).toBeNull();
      expect(api.presentation[geometryId].visible).toBe(true);
      expect(get3DToolState().preview).toBeNull();
      expect(get3DToolState().lastEdit).toBeNull();
    });

    it('restores the selection on Cancel, so the edit can be tried again with other options', async () => {
      const { view } = previewing();
      const geometryId = view.state.initialModels[0].geometryId;
      const original = mockState.geometries[geometryId].data;
      // The mocked cache write does not touch the cache: put the original surface back as it would
      setCachedSurface.mockImplementation((_seg, id, next) => {
        mockState.geometries[id].data = { ...mockState.geometries[id].data, points: next.points, polys: next.polys };
        view._onSurfaceChanged();
        positionedModels(view); // the rebuilt (fake) geometry needs its position attribute again
      });
      await view.deleteSelectedPoints();
      expect(get3DToolState().selectionCount).toBe(0);

      request3DToolAction('cancelPreview');

      expect(mockState.geometries[geometryId].data.points).toBe(original.points);
      expect([...view._selection]).toEqual([0, 2]);
      expect(get3DToolState().selectionCount).toBe(2);
      setCachedSurface.mockReset();
    });

    it('cancels the preview on Escape', async () => {
      const { view } = previewing();
      await view.deleteSelectedPoints();

      view._lasso.params.onClear();

      expect(get3DToolState().preview).toBeNull();
      expect(recordSurfaceEdit).not.toHaveBeenCalled();
    });

    it('keeps the tool that was in use when the edit started', async () => {
      const { view } = previewing();
      await view.deleteSelectedPoints();
      // Something released the tool while the preview was up
      setActive3DTool(null);

      request3DToolAction('applyPreview');

      expect(get3DToolState().activeTool).toBe(THREE_D_TOOLS.Lasso);
    });

    it('cancels a pending preview with the canvas: nothing is written and no listener is left', async () => {
      const listeners = new Map();
      global.window = {
        addEventListener: jest.fn((type, fn) => listeners.set(type, fn)),
        removeEventListener: jest.fn((type, fn) => { if (listeners.get(type) === fn) listeners.delete(type); }),
      };
      try {
        const { view } = previewing();
        const geometryId = view.state.initialModels[0].geometryId;
        const original = mockState.geometries[geometryId].data;
        await view.deleteSelectedPoints();
        expect(listeners.has('keydown')).toBe(true);

        view.componentWillUnmount();

        expect(setCachedSurface).not.toHaveBeenCalled();
        expect(mockState.geometries[geometryId].data).toBe(original);
        expect(recordSurfaceEdit).not.toHaveBeenCalled();
        expect(queueSurfaceEditWrite).not.toHaveBeenCalled();
        expect(listeners.has('keydown')).toBe(false);
        expect(get3DToolState().preview).toBeNull();
        expect(view._changeOverlay).toBeNull();
        expect(view._ghost).toBeNull();
        expect(view._previewMesh).toBeNull();
      } finally {
        delete global.window;
      }
    });

    it('ghosts the original faces behind the preview, and removes the ghost on Apply or Cancel', async () => {
      const { view, api } = previewing();
      await view.deleteSelectedPoints();

      expect(view._ghost).not.toBeNull();
      expect(api.scene.add).toHaveBeenCalledWith(view._ghost);
      // Faint and drawn under the change overlay, so the overlay is what stands out
      expect(view._ghost.material.opacity).toBeLessThanOrEqual(0.15);
      expect(view._ghost.renderOrder).toBeLessThan(view._changeOverlay.children[0].renderOrder);

      request3DToolAction('cancelPreview');
      expect(view._ghost).toBeNull();
    });

    it('runs the whole-mesh stages of the cut in the carve worker', async () => {
      const { view } = previewing();
      await view.deleteSelectedPoints();

      const { deps } = cutAndPatch.mock.calls[0][0];
      expect(deps.prepareCut).toEqual(expect.any(Function));
      expect(deps.assembleCut).toEqual(expect.any(Function));
      expect(deps.patchHoles).toEqual(expect.any(Function));
    });
  });

  describe('stale previews', () => {
    const cut = () => ({
      changed: true,
      edited: {
        points: Float32Array.from([0, 0, 0, 5, 0, 0, 0, 5, 0, 1, 1, 0]),
        polys: Int32Array.from([3, 0, 1, 2, 3, 0, 2, 3]),
        patchPolysOffset: 4,
      },
      editBox: { min: [0, 0, 0], max: [5, 5, 0] },
      selectedPoints: Float64Array.from([0, 0, 0]),
      holes: 1,
      cappedHoles: 0,
      patchErrors: [],
      diagnostics: { methods: { fitted: 1 }, output: { closed: true }, openEdges: 0 },
    });

    // Any error the edit flow swallows fails the test: a half-built preview passes for the wrong reason
    let onEditError;
    afterEach(() => expect(onEditError).not.toHaveBeenCalled());

    function previewed(props = {}) {
      set3DToolOption('previewEnabled', true);
      const notify = jest.fn();
      onEditError = jest.fn();
      const context = createEditingView({ notify, onEditError, ...props });
      setActive3DTool(THREE_D_TOOLS.Lasso);
      selectTrianglesInLasso.mockReturnValueOnce([0, 2]);
      context.view.selectWithLasso([0, 0, 1, 0, 1, 1], SELECTION_MODES.replace);
      getLabelmapForEdit.mockReturnValue({ volume: { id: 'labelmap' }, scalarData: [], dimensions: [1, 1, 1] });
      cutAndPatch.mockResolvedValue(cut());
      const geometryId = context.view.state.initialModels[0].geometryId;
      return { ...context, notify, geometryId };
    }

    // A slice edit or import rebuilds the cached surface from the labelmap
    function rebuild(view, geometryId) {
      const rebuilt = { ...mockState.geometries[geometryId].data, points: [0, 0, 0, 2, 0, 0, 0, 2, 0] };
      mockState.geometries[geometryId].data = rebuilt;
      return rebuilt;
    }

    it('ends the preview when the surface is rebuilt under it, keeping the newer surface', async () => {
      const { view, notify, geometryId } = previewed();
      await view.deleteSelectedPoints();
      expect(view._pendingEdit).not.toBeNull();
      expect(view._changeOverlay).not.toBeNull();

      const rebuilt = rebuild(view, geometryId);
      view._onSurfaceChanged();

      expect(view._pendingEdit).toBeNull();
      expect(view._previewMesh).toBeNull();
      expect(get3DToolState().preview).toBeNull();
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' }));
      // Neither Cancel nor Apply nor a remount can write over the newer surface now
      expect(request3DToolAction('cancelPreview')).toBe(false);
      expect(request3DToolAction('applyPreview')).toBe(false);
      view.componentWillUnmount();
      expect(setCachedSurface).not.toHaveBeenCalled();
      expect(recordSurfaceEdit).not.toHaveBeenCalled();
      expect(mockState.geometries[geometryId].data).toBe(rebuilt);
    });

    it('refuses Apply when the cached surface changed without the canvas being told', async () => {
      const { view, notify, geometryId } = previewed();
      await view.deleteSelectedPoints();
      const rebuilt = rebuild(view, geometryId);

      expect(request3DToolAction('applyPreview')).toBe(false);

      expect(recordSurfaceEdit).not.toHaveBeenCalled();
      expect(queueSurfaceEditWrite).not.toHaveBeenCalled();
      expect(setCachedSurface).not.toHaveBeenCalled();
      expect(mockState.geometries[geometryId].data).toBe(rebuilt);
      expect(view._pendingEdit).toBeNull();
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' }));
    });

    it('refuses Apply when the target was locked meanwhile', async () => {
      const { view } = previewed();
      await view.deleteSelectedPoints();
      mockState.locked.add(`${EDIT_SEG}#1`);

      expect(request3DToolAction('applyPreview')).toBe(false);
      expect(recordSurfaceEdit).not.toHaveBeenCalled();
    });

    it('ends the preview on a foreign edit of the working labelmap, not on its own writes', async () => {
      const { view } = previewed();
      await view.deleteSelectedPoints();

      // An earlier edit's queued write landing is the 3D tools' own
      withOwnSurfaceWrite(() => view._onLabelmapModified({ detail: { segmentationId: EDIT_SEG } }));
      expect(view._pendingEdit).not.toBeNull();
      // Another segmentation's edit is not this one's
      view._onLabelmapModified({ detail: { segmentationId: 'another' } });
      expect(view._pendingEdit).not.toBeNull();

      // A slice edit is foreign
      view._onLabelmapModified({ detail: { segmentationId: EDIT_SEG } });
      expect(view._pendingEdit).toBeNull();
      expect(request3DToolAction('applyPreview')).toBe(false);
      expect(recordSurfaceEdit).not.toHaveBeenCalled();
      expect(setCachedSurface).not.toHaveBeenCalled();
    });

    it.each([
      ['with the preview on', true],
      ['committing at once', false],
    ])('refuses a computation the working labelmap was edited under, %s', async (_case, preview) => {
      const { view, notify } = previewed({ confirm: () => Promise.resolve(true) });
      set3DToolOption('previewEnabled', preview);
      let finish;
      cutAndPatch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));

      const removal = view.deleteSelectedPoints();
      await new Promise(resolve => setTimeout(resolve, 0));
      // A slice edit lands while the worker runs; the surface is not rebuilt yet (debounced)
      view._onLabelmapModified({ detail: { segmentationId: EDIT_SEG } });
      finish(cut());

      expect(await removal).toBe(false);
      expect(view._pendingEdit).toBeNull();
      expect(setCachedSurface).not.toHaveBeenCalled();
      expect(recordSurfaceEdit).not.toHaveBeenCalled();
      expect(queueSurfaceEditWrite).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' }));
    });

    it('lets a computation through when only the 3D tools\' own writes landed meanwhile', async () => {
      const { view } = previewed();
      let finish;
      cutAndPatch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));

      const removal = view.deleteSelectedPoints();
      await new Promise(resolve => setTimeout(resolve, 0));
      withOwnSurfaceWrite(() => view._onLabelmapModified({ detail: { segmentationId: EDIT_SEG } }));
      finish(cut());

      expect(await removal).toBe(true);
      expect(view._pendingEdit).not.toBeNull();
      expect(request3DToolAction('applyPreview')).toBe(true);
      expect(recordSurfaceEdit).toHaveBeenCalledTimes(1);
    });

    it('validates a live Smooth recompute, keeping the shown result, and the Apply boundary', async () => {
      // A recompute is a worker result like the first (ohif-viewers#149 FR-4): a malformed one
      // never replaces the preview, and a pending edit that is not valid geometry is not committed
      const { view, notify, geometryId } = previewed();
      selectTrianglesInLasso.mockReturnValueOnce([0, 2]);
      view.selectWithLasso([0, 0, 1, 0, 1, 1], SELECTION_MODES.replace);
      const original = mockState.geometries[geometryId].data;
      const valid = {
        changed: true, after: { points: original.points.map(v => v + 0.1), polys: original.polys },
        editBox: { min: [0, 0, 0], max: [1, 1, 1] }, moved: 2, flipped: 0, degenerate: 0, written: WRITTEN_CLOSED,
      };
      smoothInWorker.mockResolvedValue(valid);
      await request3DToolAction('smoothSelection');
      const shown = view._pendingEdit.after;
      expect(shown).toBe(valid.after);

      smoothInWorker.mockResolvedValueOnce({
        ...valid, after: { points: original.points.map((v, i) => (i === 2 ? NaN : v)), polys: original.polys },
      });
      await view._rerunSmoothPreview();

      expect(view._pendingEdit.after).toBe(shown);
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'error', title: 'Smooth selected faces', message: expect.stringMatching(/1 non-finite coordinate\(s\) in the result/),
      }));
      expect(console.debug).toHaveBeenCalledWith('[SegEditor3D]', expect.objectContaining({ operation: 'smooth', outcome: 'invalid', recompute: true, reason: 'nonFinitePoints' }));

      // A recompute with an unbounded box is kept out the same way
      smoothInWorker.mockResolvedValueOnce({ ...valid, editBox: { min: [0, 0, 0], max: [1, NaN, 1] } });
      await view._rerunSmoothPreview();
      expect(view._pendingEdit.editBox).toEqual(valid.editBox);

      // Apply commits validated geometry only, whatever path produced the pending edit
      view._pendingEdit.after = { points: original.points.map((v, i) => (i === 0 ? Infinity : v)), polys: original.polys };
      expect(request3DToolAction('applyPreview')).toBe(false);
      expect(view._pendingEdit).toBeNull();
      expect(setCachedSurface).not.toHaveBeenCalled();
      expect(recordSurfaceEdit).not.toHaveBeenCalled();
      expect(queueSurfaceEditWrite).not.toHaveBeenCalled();
      expect(console.debug).toHaveBeenCalledWith('[SegEditor3D]', expect.objectContaining({ operation: 'smooth', outcome: 'invalid', apply: true }));
    });

    it('drops a Smooth recompute whose surface changed, without starting the worker', async () => {
      const { view, notify, geometryId } = previewed();
      selectTrianglesInLasso.mockReturnValueOnce([0, 2]);
      view.selectWithLasso([0, 0, 1, 0, 1, 1], SELECTION_MODES.replace);
      const original = mockState.geometries[geometryId].data;
      smoothInWorker.mockResolvedValue({
        changed: true, after: { points: original.points.map(v => v + 0.1), polys: original.polys },
        editBox: { min: [0, 0, 0], max: [1, 1, 1] }, moved: 2, flipped: 0, degenerate: 0, written: WRITTEN_CLOSED,
      });
      await request3DToolAction('smoothSelection');
      smoothInWorker.mockClear();

      rebuild(view, geometryId);
      await view._rerunSmoothPreview();

      expect(smoothInWorker).not.toHaveBeenCalled();
      expect(view._pendingEdit).toBeNull();
      expect(setCachedSurface).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' }));
    });
  });

  describe('selections waiting for the topology', () => {
    // A dropped stroke never consumes its queued mock values: start each test clean
    beforeEach(() => {
      raycastSurfaces.mockReset().mockReturnValue(null);
      collectTrianglesInSphere.mockReset().mockReturnValue([]);
      selectTrianglesInLasso.mockReset().mockReturnValue([]);
    });

    function deferredTopology() {
      // The build starts a microtask after it is asked for; release waits for it, then lets it land
      const waiting = [];
      const computeTopology = surface => new Promise(resolve => {
        waiting.push(() => resolve(triangleTopology(surface)));
      });
      const release = async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
        waiting.splice(0).forEach(done => done());
      };
      return { computeTopology, release };
    }

    function painting(props) {
      const context = createEditingView(props);
      const [target] = context.view.state.initialModels;
      target.instance.worldToLocal = point => point;
      target.instance.geometry.getIndex = () => ({ getX: i => i });
      setActive3DTool(THREE_D_TOOLS.Paint);
      return { ...context, target };
    }

    const hitOn = (instance, faceIndex = 0) => ({
      object: instance, point: { x: 1, y: 0, z: 0, clone() { return { ...this }; } }, faceIndex,
    });

    it('drops a connected-only lasso cleared while it waited', async () => {
      const topology = deferredTopology();
      const { view } = createEditingView({ computeTopology: topology.computeTopology });
      setActive3DTool(THREE_D_TOOLS.Lasso);
      set3DToolOption('connectedOnly', true);
      selectTrianglesInLasso.mockReturnValueOnce([0]);

      const pending = view.selectWithLasso([0, 0, 1, 0, 1, 1], SELECTION_MODES.replace);
      request3DToolAction('clearSelection');
      await topology.release();
      await pending;

      expect(view._selection.size).toBe(0);
      expect(get3DToolState().selectionCount).toBe(0);
      set3DToolOption('connectedOnly', false);
    });

    it('drops a paint stroke cleared by Escape, or left behind by switching to the Pointer', async () => {
      const topology = deferredTopology();
      const { view, target } = painting({ computeTopology: topology.computeTopology });

      raycastSurfaces.mockReturnValueOnce(hitOn(target.instance));
      collectTrianglesInSphere.mockReturnValueOnce([0, 1]);
      const cleared = view.selectWithBrush([0, 0], {});
      view._paint.params.onClear(); // Escape
      raycastSurfaces.mockReturnValueOnce(hitOn(target.instance));
      collectTrianglesInSphere.mockReturnValueOnce([4]);
      const leftBehind = view.selectWithBrush([0, 0], {});
      setActive3DTool(null); // the Pointer
      await topology.release();
      await Promise.all([cleared, leftBehind]);

      expect(view._selection.size).toBe(0);
    });

    it('applies strokes and lassos in order: a stroke waiting for the topology keeps what came before it', async () => {
      const topology = deferredTopology();
      const { view, target } = painting({ computeTopology: topology.computeTopology });

      raycastSurfaces.mockReturnValueOnce(hitOn(target.instance));
      collectTrianglesInSphere.mockReturnValueOnce([0]);
      const stroke = view.selectWithBrush([0, 0], {});
      // A plain lasso (no topology needed) lands first
      selectTrianglesInLasso.mockReturnValueOnce([4]);
      await view.selectWithLasso([0, 0, 1, 0, 1, 1], SELECTION_MODES.add);
      await topology.release();
      await stroke;

      expect([...view._selection].sort()).toEqual([0, 4]);
    });
  });

  describe('smooth', () => {
    const smoothResult = (original, overrides = {}) => ({
      changed: true,
      after: { points: original.points.map((v, i) => (i === 2 ? 0.5 : v)), polys: original.polys },
      editBox: { min: [0, 0, 0], max: [1, 1, 0.5] },
      moved: 2,
      maxDisplacement: 0.5,
      flipped: 0,
      degenerate: 0,
      written: WRITTEN_CLOSED,
      ...overrides,
    });

    beforeEach(() => reset3DToolState({ settings: true }));

    function selected(props = {}) {
      const context = createEditingView(props);
      setActive3DTool(THREE_D_TOOLS.Lasso);
      selectTrianglesInLasso.mockReturnValueOnce([0, 2]);
      context.view.selectWithLasso([0, 0, 1, 0, 1, 1], SELECTION_MODES.replace);
      getLabelmapForEdit.mockReturnValue({ volume: { id: 'labelmap' }, scalarData: [], dimensions: [1, 1, 1] });
      const geometryId = context.view.state.initialModels[0].geometryId;
      const original = mockState.geometries[geometryId].data;
      smoothInWorker.mockResolvedValue(smoothResult(original));
      return { ...context, geometryId, original };
    }

    it('keeps a Smooth whose written result has defects surface-only, whatever the health says', async () => {
      // A smooth keeps its input's faces: a duplicate face or an unwelded seam the conditioned
      // health does not count is still in the geometry the delta write would voxelize. The gate
      // is the worker's diagnosis of that geometry (`written`), so the write waits for the
      // acknowledgement #152 provides even while the panel's health says closed
      const notify = jest.fn();
      const { view, original } = selected({ notify });
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(get3DToolState().surfaceHealth.closed).toBe(true);
      smoothInWorker.mockResolvedValue(smoothResult(original, {
        written: { ...WRITTEN_CLOSED, closed: false, nonManifoldEdgeCount: 3 },
      }));
      // The cache takes the applied surface, as the real setCachedSurface does
      setCachedSurface.mockImplementation((segmentationId, id, next) => {
        Object.assign(mockState.geometries[id].data, { points: next.points, polys: next.polys });
        request3DToolAction('surfaceChanged', { geometryId: id, keepSelection: true });
        return true;
      });
      try {
        expect(await view.smoothSelection()).toBe(true);
        expect(get3DToolState().preview).toMatchObject({ kind: 'smooth', write: 'surfaceOnly' });
        request3DToolAction('applyPreview');

        expect(queueSurfaceEditWrite).not.toHaveBeenCalled();
        expect(recordSurfaceEdit.mock.calls[0][0].surfaceOnly).toBe(true);
        expect(notify).toHaveBeenCalledWith(expect.objectContaining({
          type: 'warning', title: 'Smooth selected faces',
          message: expect.stringMatching(/0 open, 3 non-manifold and 0 inverted edge\(s\), 0 of them new.*Undo restores/),
        }));
        expect(get3DToolState()).toMatchObject({ unsynchronizedEdits: 1, lastEdit: { kind: 'smooth', write: 'surfaceOnly' } });
      } finally {
        setCachedSurface.mockReset();
      }
    });

    it('decides each live recompute from its own written diagnosis', async () => {
      // A recompute is a new result: one whose written geometry is open is not written even
      // though the first result was, and the preview says so before Apply
      const notify = jest.fn();
      const { view, original } = selected({ notify });
      expect(await view.smoothSelection()).toBe(true);
      expect(get3DToolState().preview).toMatchObject({ kind: 'smooth', write: 'queued' });

      set3DToolOption('smoothPasses', 6);
      clearTimeout(view._smoothRerun);
      smoothInWorker.mockResolvedValueOnce(smoothResult(original, {
        moved: 3, written: { ...WRITTEN_CLOSED, closed: false, boundaryEdgeCount: 4 },
      }));
      await view._rerunSmoothPreview();
      expect(get3DToolState().preview).toMatchObject({ kind: 'smooth', points: 3, write: 'surfaceOnly' });
      expect(view._pendingEdit).toMatchObject({ write: null, surfaceOnly: true, surfaceOnlyReason: 'defects' });

      request3DToolAction('applyPreview');
      expect(queueSurfaceEditWrite).not.toHaveBeenCalled();
      expect(recordSurfaceEdit.mock.calls[0][0].surfaceOnly).toBe(true);
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'warning', message: expect.stringMatching(/4 open, 0 non-manifold and 0 inverted edge\(s\)/),
      }));
    });

    it('does not wait for the health to write a Smooth, and writes nothing without the written diagnosis', async () => {
      // The gate is the diagnosis of the result itself, from the same worker call as the
      // smoothing: a health still running does not hold the result back, and the health's
      // verdict does not authorize the write
      diagnoseSurfaceInWorker.mockImplementationOnce(() => new Promise(() => {}));
      const { view } = selected();
      expect(await view.smoothSelection()).toBe(true);
      expect(get3DToolState().surfaceHealth).toBeNull();
      expect(get3DToolState().preview).toMatchObject({ kind: 'smooth', write: 'queued' });
      request3DToolAction('applyPreview');
      expect(queueSurfaceEditWrite).toHaveBeenCalledTimes(1);
      view.componentWillUnmount();

      // A result that came without its diagnosis is not known to be sound
      jest.clearAllMocks();
      const notify = jest.fn();
      const { view: other, original } = selected({ notify });
      const { written, ...undiagnosed } = smoothResult(original);
      expect(written).toBeDefined();
      smoothInWorker.mockResolvedValue(undiagnosed);
      expect(await other.smoothSelection()).toBe(true);
      expect(get3DToolState().preview).toMatchObject({ kind: 'smooth', write: 'surfaceOnly' });
      request3DToolAction('applyPreview');
      expect(queueSurfaceEditWrite).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'warning', message: expect.stringMatching(/check did not complete, so it is not known to be sound/),
      }));
    });

    it('smooths the selection in the worker and shows it for Apply, keeping the selection', async () => {
      const { view, geometryId, original } = selected();
      set3DToolOption('smoothStrength', 0.7);
      // The mocked cache write does not touch the cache: apply it as the real one would
      setCachedSurface.mockImplementation((_seg, id, next, options) => {
        mockState.geometries[id].data = { ...mockState.geometries[id].data, points: next.points, polys: next.polys };
        view._onSurfaceChanged(options);
        positionedModels(view);
      });

      expect(await request3DToolAction('smoothSelection')).toBe(true);

      expect(smoothInWorker).toHaveBeenCalledWith({
        surface: { points: original.points, polys: original.polys },
        selectedTriangles: [0, 2],
        options: { strength: 0.7, passes: 3, feather: true },
      });
      // Shown on the canvas only until Apply
      expect(setCachedSurface).not.toHaveBeenCalled();
      expect(view._previewMesh.geometryId).toBe(geometryId);
      expect(recordSurfaceEdit).not.toHaveBeenCalled();
      expect(get3DToolState().preview).toEqual({ kind: 'smooth', points: 2, write: 'queued' });
      expect([...view._selection]).toEqual([0, 2]); // kept across the moved surface
      // Every face the smooth moves is drawn in the preview colour, in place of the selection
      // highlight: the moved point 0 is in all 6 faces, though only 2 are selected
      const overlay = view._changeOverlay;
      expect(overlay.children.map(part => part.name)).toEqual(['faces', 'edges', 'vertices']);
      expect(overlay.getObjectByName('faces').geometry.index.count).toBe(6 * 3);
      expect(view._highlight).toBeNull();
      expect(get3DToolState().busy).toBe(false);
      expect(view.state.deleteStep).toBeNull();

      expect(request3DToolAction('applyPreview')).toBe(true);
      expect(view._changeOverlay).toBeNull();
      expect(view._highlight).not.toBeNull(); // the kept selection is drawn again
      expect(setCachedSurface).toHaveBeenCalledWith(SEG, geometryId, expect.objectContaining({ polys: original.polys }), { keepSelection: true });
      expect(recordSurfaceEdit).toHaveBeenCalledTimes(1);
      const [memo] = queueSurfaceEditWrite.mock.calls[0];
      expect(memo).toMatchObject({ write: { kind: 'smooth' }, keepSelection: true, segmentIndex: 1 });
      expect(get3DToolState().lastEdit).toEqual({ id: expect.any(Number), kind: 'smooth', points: 2, write: 'queued' });
      expect([...view._selection]).toEqual([0, 2]);
    });

    it('recomputes the preview when a setting changes, and keeps the shown result when the new one folds', async () => {
      const { view, original } = selected({ notify: jest.fn() });
      await request3DToolAction('smoothSelection');
      const shown = view._previewMesh.mesh;

      set3DToolOption('smoothPasses', 6);
      expect(view._smoothRerun).not.toBeNull();
      clearTimeout(view._smoothRerun);
      const again = smoothResult(original, { moved: 3 });
      smoothInWorker.mockResolvedValueOnce(again);
      await view._rerunSmoothPreview();

      expect(smoothInWorker).toHaveBeenLastCalledWith(expect.objectContaining({
        options: { strength: 0.5, passes: 6, feather: true },
      }));
      // The recompute updates the preview mesh and its overlay only
      expect(shown.geometry.from).toBe(again.after.points);
      expect([...view._changeOverlay.getObjectByName('faces').geometry.getAttribute('position').array])
        .toContain(0.5); // the moved vertex
      expect(view._changeOverlay.getObjectByName('faces').geometry.index.count).toBe(6 * 3);
      expect(setCachedSurface).not.toHaveBeenCalled();
      expect(get3DToolState().preview).toEqual({ kind: 'smooth', points: 3, write: 'queued' });

      smoothInWorker.mockResolvedValueOnce(smoothResult(original, { flipped: 2 }));
      await view._rerunSmoothPreview();
      expect(shown.geometry.from).toBe(again.after.points);
      expect(view.props.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' }));

      // Cancel takes the preview away and keeps the selection
      expect(request3DToolAction('cancelPreview')).toBe(true);
      expect(setCachedSurface).not.toHaveBeenCalled();
      expect(view._smoothRerun).toBeNull();
      expect([...view._selection]).toEqual([0, 2]);
    });

    it('takes up settings changed during a recompute once, when it is done', async () => {
      const { view, original } = selected();
      await request3DToolAction('smoothSelection');
      let finish;
      smoothInWorker.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));

      const first = view._rerunSmoothPreview();
      // Three more changes while the worker is busy: none is dispatched now
      view._rerunSmoothPreview();
      view._rerunSmoothPreview();
      view._rerunSmoothPreview();
      expect(smoothInWorker).toHaveBeenCalledTimes(2);

      smoothInWorker.mockResolvedValue(smoothResult(original));
      finish(smoothResult(original));
      await first;
      await new Promise(resolve => setTimeout(resolve, 0));
      // One follow-up for all three
      expect(smoothInWorker).toHaveBeenCalledTimes(3);
    });

    it('refuses a pass that would fold the surface, and says so when there is nothing to smooth', async () => {
      const notify = jest.fn();
      const { original } = selected({ notify });

      smoothInWorker.mockResolvedValueOnce(smoothResult(original, { flipped: 1 }));
      expect(await request3DToolAction('smoothSelection')).toBe(false);
      expect(setCachedSurface).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' }));

      smoothInWorker.mockResolvedValueOnce({ changed: false, after: null, moved: 0, flipped: 0, degenerate: 0 });
      expect(await request3DToolAction('smoothSelection')).toBe(true);
      expect(setCachedSurface).not.toHaveBeenCalled();
      expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'info' }));
      expect(get3DToolState().preview).toBeNull();
    });

    it('applies nothing when the target is locked while the smoothing runs', async () => {
      const notify = jest.fn();
      const { view, original } = selected({ notify });
      smoothInWorker.mockImplementation(async () => {
        mockState.locked.add(1);
        return smoothResult(original);
      });

      expect(await view.smoothSelection()).toBe(false);

      expect(setCachedSurface).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' }));
    });
  });

  describe('selection shaping', () => {
    // A fan of four triangles around vertex 0, so growing from the centre reaches every vertex
    const fan = () => ({
      segmentIndex: 1,
      points: [0, 0, 0, 1, 0, 0, 0, 1, 0, -1, 0, 0, 0, -1, 0],
      polys: [3, 0, 1, 2, 3, 0, 2, 3, 3, 0, 3, 4, 3, 0, 4, 1],
    });

    function withFan() {
      setSurfaces([fan(), surface(2)]);
      mockState.segmentations[EDIT_SEG] = { segments: { 1: { label: 'Liver' }, 2: {} } };
      mockState.activeSegmentIndex[EDIT_SEG] = 1;
      const view = createView({ editSegmentationId: EDIT_SEG, active: true });
      view.componentDidMount();
      view._loadInitialModels();
      positionedModels(view);
      view._onCreated(fakeApi(view.state.initialModels));
      setActive3DTool(THREE_D_TOOLS.Lasso);
      return view;
    }

    it('grows the selection by a ring of faces and shrinks it back', async () => {
      const view = withFan();
      selectTrianglesInLasso.mockReturnValueOnce([0]);
      view.selectWithLasso([0, 0, 1, 0, 1, 1], SELECTION_MODES.replace);
      expect(get3DToolState()).toMatchObject({ selectionCount: 1, selectionPoints: 3 });

      // The fan is a ring: triangle 0 shares an edge with 1 and 3
      expect(await request3DToolAction('growSelection')).toBe(true);
      expect([...view._selection].sort()).toEqual([0, 1, 3]);
      expect(await request3DToolAction('growSelection')).toBe(true);
      expect(get3DToolState().selectionCount).toBe(4);

      // Every face selected: nothing is at the edge, so nothing shrinks away
      expect(await request3DToolAction('shrinkSelection')).toBe(true);
      expect(get3DToolState().selectionCount).toBe(4);

      // Without triangle 2, only triangle 0 still has both its neighbours selected
      selectTrianglesInLasso.mockReturnValueOnce([2]);
      view.selectWithLasso([0, 0, 1, 0, 1, 1], SELECTION_MODES.subtract);
      expect(await request3DToolAction('shrinkSelection')).toBe(true);
      expect([...view._selection]).toEqual([0]);
    });

    it('keeps the largest connected part when asked', async () => {
      const view = withFan();
      set3DToolOption('connectedOnly', true);
      selectTrianglesInLasso.mockReturnValueOnce([0, 2]); // two opposite faces, not edge-adjacent
      await view.selectWithLasso([0, 0, 1, 0, 1, 1], SELECTION_MODES.replace);
      expect(get3DToolState().selectionCount).toBe(1);
      set3DToolOption('connectedOnly', false);
    });
  });

  describe('surface health and repair', () => {
    it('publishes the target surface\'s health from the worker diagnostics', async () => {
      diagnoseSurfaceInWorker.mockResolvedValueOnce({
        boundaryEdgeCount: 2, nonManifoldEdgeCount: 0, inconsistentEdgeCount: 3, closed: false,
        boundaryEdges: [0, 1, 1, 2], nonManifoldEdges: [], inconsistentEdges: [0, 2, 1, 2, 0, 1],
        edges: { p1: 0.2, p50: 0.6, mean: 0.7, edgeCount: 9, sampleSize: 9, sampled: false },
        conditioning: { requestedWeldTolerance: 0, effectiveWeldTolerance: 0, fellBack: false, preservation: null },
      });
      createEditingView();
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(get3DToolState().surfaceHealth).toEqual({
        boundaryEdgeCount: 2, nonManifoldEdgeCount: 0, inconsistentEdgeCount: 3, degenerate: 0, duplicate: 0, closed: false, triangles: 6,
        edges: { p1: 0.2, p50: 0.6, mean: 0.7, edgeCount: 9, sampleSize: 9, sampled: false },
        conditioning: { requestedWeldTolerance: 0, effectiveWeldTolerance: 0, fellBack: false, preservation: null },
        weldTolerance: 0,
      });
      expect(diagnoseSurfaceInWorker).toHaveBeenCalledWith(expect.anything(), { weldTolerance: 0 });
    });

    it('re-runs the diagnostics at the derived weld when a developer fraction is set, and when it changes', async () => {
      mockDeveloper.enabled = true;
      set3DToolOption('weldFraction', 0.05);
      diagnoseSurfaceInWorker.mockImplementation(async (_surface, { weldTolerance }) => ({
        boundaryEdgeCount: 0, nonManifoldEdgeCount: 0, inconsistentEdgeCount: 0, closed: true,
        boundaryEdges: [], nonManifoldEdges: [], inconsistentEdges: [],
        edges: { p1: 2, p50: 2, mean: 2, edgeCount: 9, sampleSize: 9, sampled: false },
        conditioning: { effectiveWeldTolerance: weldTolerance, fellBack: false },
      }));
      createEditingView();
      await new Promise(resolve => setTimeout(resolve, 0));
      await new Promise(resolve => setTimeout(resolve, 0));

      // First exact (no statistics yet), then at 0.05 x p1
      expect(diagnoseSurfaceInWorker.mock.calls.map(([, options]) => options.weldTolerance)).toEqual([0, 0.1]);
      expect(get3DToolState().surfaceHealth.weldTolerance).toBeCloseTo(0.1, 9);

      set3DToolOption('weldFraction', 0.1);
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(diagnoseSurfaceInWorker).toHaveBeenLastCalledWith(expect.anything(), { weldTolerance: expect.closeTo(0.2, 9) });

      diagnoseSurfaceInWorker.mockReset();
      diagnoseSurfaceInWorker.mockResolvedValue({
        boundaryEdgeCount: 0, nonManifoldEdgeCount: 0, closed: true, boundaryEdges: [], nonManifoldEdges: [],
      });
    });

    it('explains a Repair that finds no rim but inverted or non-manifold edges', async () => {
      set3DToolOption('previewEnabled', false);
      const notify = jest.fn();
      createEditingView({ notify });
      getLabelmapForEdit.mockReturnValue({ volume: { id: 'labelmap' }, scalarData: [], dimensions: [1, 1, 1] });
      repairSurface.mockResolvedValue({
        changed: false, holes: 0, diagnostics: { input: { boundaryEdgeCount: 0, nonManifoldEdgeCount: 2, inconsistentEdgeCount: 3, closed: false } },
      });

      expect(await request3DToolAction('repairSurface')).toBe(true);

      expect(notify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'info', message: expect.stringMatching(/cannot close 2 non-manifold and 3 inverted/),
      }));
    });

    it('draws the open, non-manifold and inverted edges in their own colours while the overlay is on', async () => {
      diagnoseSurfaceInWorker.mockResolvedValue({
        boundaryEdgeCount: 1, nonManifoldEdgeCount: 0, inconsistentEdgeCount: 1, closed: false,
        boundaryEdges: [0, 1], nonManifoldEdges: [], inconsistentEdges: [1, 2],
      });
      set3DToolOption('showIssues', true);
      const { view, api } = createEditingView();
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(view._issues).not.toBeNull();
      expect(api.scene.add).toHaveBeenCalledWith(view._issues);
      // Two edges, four vertices, each with its kind's colour
      const colors = view._issues.geometry.getAttribute('color');
      expect(colors.count).toBe(4);
      expect(colors.getX(0)).toBeCloseTo(0xff / 255, 6); // open: red
      expect(colors.getZ(2)).toBeCloseTo(0xd8 / 255, 6); // inverted: purple
      set3DToolOption('showIssues', false);
      expect(view._issues).toBeNull();
      diagnoseSurfaceInWorker.mockReset();
      diagnoseSurfaceInWorker.mockResolvedValue({
        boundaryEdgeCount: 0, nonManifoldEdgeCount: 0, closed: true, boundaryEdges: [], nonManifoldEdges: [],
      });
    });

    it('repairs the surface as a surface-only edit through the preview', async () => {
      set3DToolOption('previewEnabled', true);
      const notify = jest.fn();
      createEditingView({ notify });
      getLabelmapForEdit.mockReturnValue({ volume: { id: 'labelmap' }, scalarData: [], dimensions: [1, 1, 1] });
      repairSurface.mockResolvedValue({
        changed: true,
        edited: { points: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]), polys: Int32Array.from([3, 0, 1, 2]), patchPolysOffset: 0 },
        editBox: { min: [0, 0, 0], max: [1, 1, 0] }, selectedPoints: new Float64Array(0),
        holes: 2, cappedHoles: 0, patchErrors: [], diagnostics: { methods: { flat: 2 }, output: { closed: true }, openEdges: 0 },
      });

      expect(await request3DToolAction('repairSurface')).toBe(true);
      expect(get3DToolState().preview).toMatchObject({ holes: 2, repair: true });

      request3DToolAction('applyPreview');
      expect(recordSurfaceEdit).toHaveBeenCalledTimes(1);
      const memo = recordSurfaceEdit.mock.calls[0][0];
      expect(memo.surfaceOnly).toBe(true);
      expect(queueSurfaceEditWrite).not.toHaveBeenCalled();
    });

    it('says so when there is nothing to repair', async () => {
      set3DToolOption('previewEnabled', false);
      const notify = jest.fn();
      createEditingView({ notify });
      getLabelmapForEdit.mockReturnValue({ volume: { id: 'labelmap' }, scalarData: [], dimensions: [1, 1, 1] });
      repairSurface.mockResolvedValue({ changed: false, holes: 0, diagnostics: {} });

      expect(await request3DToolAction('repairSurface')).toBe(true);
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }));
      expect(recordSurfaceEdit).not.toHaveBeenCalled();
    });

    it('leaves the 2D views alone through Remove-with-defects, Apply, Repair, Apply, and says so', async () => {
      // Repair is surface-only: applying a successful one after a surface-only Remove closes the
      // surface but writes nothing, and the status says the surface is still ahead of the views
      set3DToolOption('previewEnabled', true);
      const notify = jest.fn();
      const { view } = createEditingView({ notify });
      setActive3DTool(THREE_D_TOOLS.Lasso);
      selectTrianglesInLasso.mockReturnValueOnce([0, 2]);
      view.selectWithLasso([0, 0, 1, 0, 1, 1], SELECTION_MODES.replace);
      const labelmap = { volume: { id: 'labelmap' }, scalarData: Uint8Array.from([1, 1, 1, 1]), dimensions: [2, 2, 1] };
      getLabelmapForEdit.mockReturnValue(labelmap);
      const geometryId = view.state.initialModels[0].geometryId;
      setCachedSurface.mockImplementation((segmentationId, id, next, options) => {
        Object.assign(mockState.geometries[id].data, { points: next.points, polys: next.polys });
        request3DToolAction('surfaceChanged', { geometryId: id, keepSelection: !!options?.keepSelection });
        return true;
      });
      try {
        cutAndPatch.mockResolvedValue({
          changed: true,
          edited: { points: Float32Array.from([0, 0, 0, 5, 0, 0, 0, 5, 0]), polys: Int32Array.from([3, 0, 1, 2]) },
          editBox: { min: [0, 0, 0], max: [5, 5, 0] }, selectedPoints: Float64Array.from([0, 0, 0]), holes: 1, cappedHoles: 0, patchErrors: [],
          diagnostics: {
            methods: { flat: 1 }, openEdges: 3, removedTriangles: 2, acceptable: false,
            output: { closed: false, boundaryEdgeCount: 3, nonManifoldEdgeCount: 0, inconsistentEdgeCount: 0 },
            introduced: { total: 3, boundaryEdgeCount: 3, nonManifoldEdgeCount: 0, inconsistentEdgeCount: 0, retained: {} },
            preexistingLoops: { count: 0, vertexCounts: [] },
          },
        });
        expect(await view.deleteSelectedPoints()).toBe(true);
        request3DToolAction('applyPreview');
        expect(get3DToolState()).toMatchObject({ unsynchronizedEdits: 1, lastEdit: { write: 'surfaceOnly' } });

        repairSurface.mockResolvedValue({
          changed: true,
          edited: { points: Float32Array.from([0, 0, 0, 5, 0, 0, 0, 5, 0, 0, 0, 5]), polys: Int32Array.from([3, 0, 1, 2, 3, 0, 3, 1, 3, 1, 3, 2, 3, 0, 2, 3]), patchPolysOffset: 4 },
          editBox: { min: [0, 0, 0], max: [5, 5, 5] }, selectedPoints: new Float64Array(0),
          holes: 1, cappedHoles: 0, patchErrors: [],
          diagnostics: {
            methods: { flat: 1 }, openEdges: 0,
            input: { closed: false, boundaryEdgeCount: 3, nonManifoldEdgeCount: 0, inconsistentEdgeCount: 0 },
            output: { closed: true, boundaryEdgeCount: 0, nonManifoldEdgeCount: 0, inconsistentEdgeCount: 0 },
          },
        });
        expect(await request3DToolAction('repairSurface')).toBe(true);
        expect(get3DToolState().preview).toMatchObject({ repair: true, write: 'surfaceOnly', closed: true });
        request3DToolAction('applyPreview');

        // Closed now, but nothing was written: both memos are surface-only, the labelmap is as it
        // was, and the state still says the surface is ahead of the 2D views
        expect(queueSurfaceEditWrite).not.toHaveBeenCalled();
        expect(recordSurfaceEdit).toHaveBeenCalledTimes(2);
        expect(recordSurfaceEdit.mock.calls.every(([memo]) => memo.surfaceOnly)).toBe(true);
        expect(Array.from(labelmap.scalarData)).toEqual([1, 1, 1, 1]);
        expect(mockState.geometries[geometryId].data.polys).toHaveLength(16);
        expect(get3DToolState()).toMatchObject({
          unsynchronizedEdits: 2,
          lastEdit: { repair: true, closed: true, write: 'surfaceOnly', before: { boundaryEdgeCount: 3 }, after: { closed: true } },
        });
        expect(notify.mock.calls.map(([n]) => n.message).join('\n')).not.toMatch(/Repair the surface to update/);
      } finally {
        setCachedSurface.mockReset();
        repairSurface.mockReset();
      }
    });

    it('resolves an edit\'s weld from the statistics of the surface it edits, never from one still being diagnosed', async () => {
      // A new surface version or target clears the published health at once; until its own
      // diagnosis resolves, edits run with the exact weld (ohif-viewers#149 FR-1, #151 FR-4)
      mockDeveloper.enabled = true;
      set3DToolOption('weldFraction', 0.1);
      const pending = [];
      const health = p1 => ({
        boundaryEdgeCount: 0, nonManifoldEdgeCount: 0, inconsistentEdgeCount: 0, closed: true,
        boundaryEdges: [], nonManifoldEdges: [], inconsistentEdges: [],
        edges: { p1, p50: p1, mean: p1, edgeCount: 9, sampleSize: 9, sampled: false },
        conditioning: { effectiveWeldTolerance: 0, fellBack: false },
      });
      diagnoseSurfaceInWorker.mockImplementation(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
      const tick = () => new Promise(resolve => setTimeout(resolve, 0));
      const settle = async (value, reject = false) => {
        await tick();
        const next = pending.shift();
        if (reject) {
          next.reject(value);
        } else {
          next.resolve(value);
        }
        await tick();
      };
      const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const { view } = createEditingView();
        const geometryId = view.state.initialModels[0].geometryId;
        const first = mockState.geometries[geometryId].data.points;
        await tick(); // the diagnosis is started in a microtask
        await settle(health(1000)); // the exact run, which measures p1
        await settle(health(1000)); // the run at the derived tolerance
        expect(get3DToolState().surfaceHealth.edges.p1).toBe(1000);
        expect(view._editOptions(first).weldTolerance).toBeCloseTo(100, 9);

        // A new surface version: the published health goes at once, the weld is exact meanwhile
        const second = [0, 0, 0, 0.01, 0, 0, 0, 0.01, 0];
        mockState.geometries[geometryId] = { data: surface(1, second) };
        view._onSegmentationModified({ detail: { segmentationId: SEG } });
        expect(get3DToolState().surfaceHealth).toBeNull();
        await tick();
        expect(pending).toHaveLength(1);
        expect(view._editOptions(second).weldTolerance).toBe(0);
        expect(view._editOptions(first).weldTolerance).toBe(0);
        // Its own statistics arrive: the cap follows them (0.1 x 1), not the old surface's 100
        await settle(health(1));
        await settle(health(1));
        expect(get3DToolState().surfaceHealth.edges.p1).toBe(1);
        expect(view._editOptions(second).weldTolerance).toBeCloseTo(0.1, 9);

        // A new target while its diagnosis is pending: likewise
        mockState.activeSegmentIndex[EDIT_SEG] = 2;
        view._onSegmentationModified({ detail: { segmentationId: EDIT_SEG } });
        const spleen = mockState.geometries[view.state.initialModels[1].geometryId].data.points;
        expect(get3DToolState().surfaceHealth).toBeNull();
        expect(view._editOptions(spleen).weldTolerance).toBe(0);
        await tick();
        // Its diagnosis fails: the health stays unknown and the weld exact
        await settle(new Error('worker lost'), true);
        expect(errors).toHaveBeenCalled();
        expect(get3DToolState().surfaceHealth).toBeNull();
        expect(view._editOptions(spleen).weldTolerance).toBe(0);
      } finally {
        errors.mockRestore();
        diagnoseSurfaceInWorker.mockReset();
        diagnoseSurfaceInWorker.mockResolvedValue({
          boundaryEdgeCount: 0, nonManifoldEdgeCount: 0, closed: true, boundaryEdges: [], nonManifoldEdges: [],
        });
      }
    });
  });

  it('releases the tool state on unmount', () => {
    const { view } = createEditingView();

    view.componentWillUnmount();

    expect(get3DToolState().target).toBeNull();
    expect(request3DToolAction('deleteSelection')).toBeUndefined();
  });
});

describe('camera conversion', () => {
  it('uses a parallel-projection VTK camera\'s scale directly (Cornerstone3D 3D viewports)', () => {
    expect(vtkToViewCamera({
      position: [1, 2, 3], focalPoint: [4, 5, 6], viewUp: [0, 0, 1],
      parallelProjection: true, parallelScale: 80, viewAngle: 90,
    })).toEqual({ position: [1, 2, 3], target: [4, 5, 6], up: [0, 0, 1], parallelScale: 80 });
  });

  it('converts a perspective VTK camera to the scale that frames its focal plane', () => {
    const camera = vtkToViewCamera({
      position: [0, 0, 100], focalPoint: [0, 0, 0], viewUp: [0, 1, 0],
      parallelProjection: false, viewAngle: 90,
    });
    expect(camera.parallelScale).toBeCloseTo(100);
  });

  it('round-trips through a parallel-projection VTK camera', () => {
    const reference = { parallelProjection: true };
    const view = { position: [0, -300, 10], target: [0, 0, 10], up: [0, 0, 1], parallelScale: 64 };
    expect(vtkToViewCamera({ ...viewToVtkCamera(view, reference), parallelProjection: true })).toEqual(view);
  });

  it('places a perspective VTK camera at the distance matching the scale', () => {
    const vtkCamera = viewToVtkCamera(
      { position: [0, 0, 5], target: [0, 0, 0], up: [0, 1, 0], parallelScale: 100 },
      { parallelProjection: false, viewAngle: 90 });
    expect(vtkCamera.position[2]).toBeCloseTo(100);
    expect(vtkCamera.focalPoint).toEqual([0, 0, 0]);
  });

  it('ignores incomplete cameras', () => {
    expect(vtkToViewCamera(undefined)).toBeUndefined();
    expect(viewToVtkCamera({ position: [0, 0, 1] })).toBeUndefined();
  });
});
