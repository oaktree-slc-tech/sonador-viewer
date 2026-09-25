// Segmentation Editor 3D editing canvas: loading surfaces from the Cornerstone3D cache and following
// the segmentation state. The component's logic is driven directly (this repo has no React test
// renderer) against a fake M3DModelView api.

import SegEditorSurfaceView, {
  getCachedSurfaces,
  lutColorToCss,
  viewToVtkCamera,
  vtkToViewCamera,
} from './SegEditorSurfaceView';
import { deleteSelection } from '../threeDTools/deleteSelection';
import { selectVerticesInLasso, SELECTION_MODES } from '../threeDTools/lassoSelection';
import { getLabelmapForEdit, removeLabelmapVoxels } from '../threeDTools/segmentEdits';
import {
  get3DToolState,
  request3DToolAction,
  reset3DToolState,
  set3DToolBusy,
  setActive3DTool,
  setRemovalDepth,
  THREE_D_TOOLS,
} from '../threeDTools/threeDToolState';

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
    Events: { SEGMENTATION_MODIFIED: 'SM', SEGMENTATION_REPRESENTATION_MODIFIED: 'SRM' },
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
  surfaceToBufferGeometry: surface => ({ from: surface.points, dispose: jest.fn() }),
}), { virtual: true });

jest.mock('@ohif/extension-vtk', () => ({ LoadingIndicator: () => null }));
jest.mock('../threejs/meshBvh', () => ({
  ensureBoundsTree: jest.fn(),
  releaseBoundsTree: jest.fn(),
}));
jest.mock('../threeDTools/LassoInteraction', () => jest.fn().mockImplementation(params => ({
  params,
  enabled: false,
  enable: jest.fn(function enable() { this.enabled = true; }),
  disable: jest.fn(function disable() { this.enabled = false; }),
  dispose: jest.fn(),
})));
jest.mock('../threeDTools/lassoSelection', () => ({
  ...jest.requireActual('../threeDTools/lassoSelection'),
  selectVerticesInLasso: jest.fn(() => []),
}));
jest.mock('../threeDTools/segmentEdits', () => ({
  getLabelmapForEdit: jest.fn(),
  patchHolesInWorker: jest.fn(),
  removeLabelmapVoxels: jest.fn(),
  voxelizeSurfaceInWorker: jest.fn(),
}));
jest.mock('../threeDTools/deleteSelection', () => ({
  ...jest.requireActual('../threeDTools/deleteSelection'),
  deleteSelection: jest.fn(),
}));

const SEG = 'vol3d:seg::edit';
const EDIT_SEG = 'seg::edit';
const VIEWPORT = 'sonadorSegViewer-3D';

function surface(segmentIndex, points = [0, 0, 0, 1, 0, 0, 0, 1, 0]) {
  return { segmentIndex, points, polys: [3, 0, 1, 2] };
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
    segmentationId: SEG,
    referenceViewportId: VIEWPORT,
    colorLUTIndex: 1,
    surfaceReady: true,
    ...props,
  });
  view.setState = update => Object.assign(view.state, update);
  return view;
}

beforeEach(() => {
  reset3DToolState();
  jest.clearAllMocks();
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
});

describe('SegEditorSurfaceView 3D tools', () => {
  function createEditingView(props = {}) {
    setSurfaces([surface(1), surface(2)]);
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

    expect(get3DToolState().target).toEqual({ segmentIndex: 1, label: 'Liver', disabledReason: undefined });
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

    setActive3DTool(THREE_D_TOOLS.Selection);
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
    setActive3DTool(THREE_D_TOOLS.Selection);

    const shownProps = view.props;
    view.props = { ...shownProps, active: false };
    view.componentDidUpdate(shownProps);

    expect(view._lasso.enabled).toBe(false);
    expect(api.setMouseActions).toHaveBeenLastCalledWith(null);
  });

  it('selects on the target mesh with every visible mesh as an occluder, and combines lassos', () => {
    const { view, api } = createEditingView();
    setActive3DTool(THREE_D_TOOLS.Selection);
    const [target, other] = view.state.initialModels;
    other.instance.visible = false;

    selectVerticesInLasso.mockReturnValueOnce([0, 1, 2]);
    view.selectWithLasso([0, 0, 1, 0, 1, 1], SELECTION_MODES.replace);
    expect(selectVerticesInLasso).toHaveBeenCalledWith(expect.objectContaining({
      mesh: target.instance, occluders: [target.instance],
    }));
    expect(get3DToolState().selectionCount).toBe(3);
    expect(api.scene.add).toHaveBeenCalledTimes(1);

    selectVerticesInLasso.mockReturnValueOnce([2, 5]);
    view.selectWithLasso([0, 0, 1, 0, 1, 1], SELECTION_MODES.add);
    expect([...view._selection]).toEqual([0, 1, 2, 5]);

    selectVerticesInLasso.mockReturnValueOnce([0, 1]);
    view.selectWithLasso([0, 0, 1, 0, 1, 1], SELECTION_MODES.subtract);
    expect([...view._selection]).toEqual([2, 5]);

    request3DToolAction('clearSelection');
    expect(get3DToolState().selectionCount).toBe(0);
    expect(view._highlight).toBeNull();
  });

  it('drops the selection when the target segment changes or its surface is rebuilt', () => {
    const { view } = createEditingView();
    setActive3DTool(THREE_D_TOOLS.Selection);
    selectVerticesInLasso.mockReturnValue([0, 1]);

    view.selectWithLasso([0, 0, 1, 0, 1, 1], SELECTION_MODES.replace);
    mockState.activeSegmentIndex[EDIT_SEG] = 2;
    view._onSegmentationModified({ detail: { segmentationId: EDIT_SEG } });
    expect(get3DToolState().selectionCount).toBe(0);

    view.selectWithLasso([0, 0, 1, 0, 1, 1], SELECTION_MODES.replace);
    expect(get3DToolState().selectionCount).toBe(2);
    setSurfaces([surface(1), surface(2, [0, 0, 0, 3, 0, 0, 0, 3, 0])]);
    view.reconcileGeometry();
    expect(get3DToolState().selectionCount).toBe(0);
    selectVerticesInLasso.mockReset();
  });

  describe('delete', () => {
    // What the surface sync does after a delete: the target's surface is rebuilt from the labelmap
    function rebuildTargetSurface() {
      setSurfaces([surface(1, [0, 0, 0, 5, 0, 0, 0, 5, 0]), surface(2)]);
    }

    function withSelection(props = {}) {
      const holder = {};
      const context = createEditingView({
        onLabelmapEdited: jest.fn(() => {
          rebuildTargetSurface();
          holder.view.reconcileGeometry();
        }),
        ...props,
      });
      holder.view = context.view;
      setActive3DTool(THREE_D_TOOLS.Selection);
      selectVerticesInLasso.mockReturnValueOnce([0, 2]);
      context.view.selectWithLasso([0, 0, 1, 0, 1, 1], SELECTION_MODES.replace);
      getLabelmapForEdit.mockReturnValue({ volume: { id: 'labelmap' }, scalarData: [], dimensions: [1, 1, 1] });
      return context;
    }

    it('does nothing when the confirmation is cancelled', async () => {
      const confirm = jest.fn(() => Promise.resolve(false));
      const { view } = withSelection({ confirm });

      expect(await view.deleteSelectedPoints()).toBe(false);

      expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringContaining('Remove 2 selected points from "Liver"'),
      }));
      expect(deleteSelection).not.toHaveBeenCalled();
      expect(get3DToolState().selectionCount).toBe(2);
    });

    it('removes the points from the target segment and writes to the working labelmap', async () => {
      const confirm = jest.fn(() => Promise.resolve(true));
      const notify = jest.fn();
      const { view } = withSelection({ confirm, notify });
      setRemovalDepth(3.5);
      let busyDuringDelete;
      deleteSelection.mockImplementation(async ({ deps }) => {
        busyDuringDelete = get3DToolState().busy;
        deps.removeVoxels(Int32Array.from([7]));
        return { removedVoxels: 1, holes: 1, cappedHoles: 0, patchErrors: [] };
      });

      const selectedSurface = mockState.geometries[view.state.initialModels[0].geometryId].data;

      expect(await request3DToolAction('deleteSelection')).toBe(true);

      expect(deleteSelection).toHaveBeenCalledWith(expect.objectContaining({
        surface: selectedSurface,
        selected: [0, 2],
        segmentIndex: 1,
        depth: 3.5,
      }));
      expect(removeLabelmapVoxels).toHaveBeenCalledWith({
        segmentationId: EDIT_SEG, volume: { id: 'labelmap' }, indices: Int32Array.from([7]),
      });
      expect(busyDuringDelete).toBe(true);
      expect(get3DToolState().busy).toBe(false);
      expect(get3DToolState().selectionCount).toBe(0);
      expect(notify).not.toHaveBeenCalled();
      expect(view.props.onLabelmapEdited).toHaveBeenCalledTimes(1);
      expect(view.state.deleteStep).toBeNull();
    });

    it('shows Rendering until the surface has been rebuilt from the labelmap', async () => {
      const { view } = withSelection({
        confirm: () => Promise.resolve(true),
        onLabelmapEdited: jest.fn(),
        renderingMessage: 'Rendering ...',
      });
      deleteSelection.mockResolvedValue({ removedVoxels: 4, holes: 1, cappedHoles: 0, patchErrors: [] });

      const done = view.deleteSelectedPoints();
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(view.state.deleteStep).toBe('render');
      expect(get3DToolState().busy).toBe(true);

      rebuildTargetSurface();
      view.reconcileGeometry();
      expect(await done).toBe(true);
      expect(view.state.deleteStep).toBeNull();
      expect(get3DToolState().busy).toBe(false);
    });

    it('does not wait for a surface update when nothing was removed', async () => {
      const onLabelmapEdited = jest.fn();
      const { view } = withSelection({ confirm: () => Promise.resolve(true), onLabelmapEdited });
      deleteSelection.mockResolvedValue({ removedVoxels: 0, holes: 1, cappedHoles: 0, patchErrors: [] });

      expect(await view.deleteSelectedPoints()).toBe(true);
      expect(onLabelmapEdited).not.toHaveBeenCalled();
    });

    it('stops waiting for the surface after the timeout', async () => {
      jest.useFakeTimers();
      try {
        const { view } = withSelection();
        const waiting = view.waitForSurfaceUpdate('some-geometry', 1000);
        const settled = jest.fn();
        waiting.then(settled);

        jest.advanceTimersByTime(999);
        await Promise.resolve();
        expect(settled).not.toHaveBeenCalled();

        jest.advanceTimersByTime(1);
        await waiting;
        expect(settled).toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('reports holes that were closed flat', async () => {
      const notify = jest.fn();
      const { view } = withSelection({ confirm: () => Promise.resolve(true), notify });
      deleteSelection.mockResolvedValue({ removedVoxels: 5, holes: 2, cappedHoles: 1, patchErrors: ['x'] });

      await view.deleteSelectedPoints();

      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' }));
    });

    it('reports failures and keeps the tool usable', async () => {
      const onEditError = jest.fn();
      const { view } = withSelection({ confirm: () => Promise.resolve(true), onEditError });
      const error = new Error('worker failed');
      deleteSelection.mockRejectedValue(error);

      expect(await view.deleteSelectedPoints()).toBe(false);

      expect(onEditError).toHaveBeenCalledWith(error);
      expect(get3DToolState().busy).toBe(false);
    });

    // A delete whose worker stages are still running when the editor closes or the target changes
    function pendingDelete() {
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      deleteSelection.mockImplementation(async ({ deps }) => {
        await gate;
        deps.removeVoxels(Int32Array.from([7]));
        return { removedVoxels: 1, holes: 1, cappedHoles: 0, patchErrors: [] };
      });
      return () => release();
    }
    const flush = () => new Promise(resolve => setTimeout(resolve, 0));

    it('writes nothing when the editor closes while the delete is running', async () => {
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
      expect(removeLabelmapVoxels).not.toHaveBeenCalled();
      expect(onEditError).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
      expect(get3DToolState().busy).toBe(true); // still the new session's job
      require('../threeDTools/threeDToolState').end3DToolJob(newJob);
    });

    it('writes nothing when the target is locked while the delete is running', async () => {
      const notify = jest.fn();
      const { view } = withSelection({ confirm: () => Promise.resolve(true), notify });
      const release = pendingDelete();

      const done = view.deleteSelectedPoints();
      await flush();
      mockState.locked.add(`${EDIT_SEG}#1`);
      release();

      expect(await done).toBe(false);
      expect(removeLabelmapVoxels).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'warning', message: expect.stringContaining('nothing was removed'),
      }));
      expect(get3DToolState().busy).toBe(false);
    });

    it('writes nothing when the working labelmap volume was replaced meanwhile', async () => {
      const { view } = withSelection({ confirm: () => Promise.resolve(true) });
      const release = pendingDelete();

      const done = view.deleteSelectedPoints();
      await flush();
      getLabelmapForEdit.mockReturnValue({ volume: { id: 'another' }, scalarData: [], dimensions: [1, 1, 1] });
      release();

      expect(await done).toBe(false);
      expect(removeLabelmapVoxels).not.toHaveBeenCalled();
    });

    it('refuses a selection made on a surface that has since changed', async () => {
      const notify = jest.fn();
      const { view } = withSelection({ confirm: () => Promise.resolve(true), notify });
      const geometryId = view.state.initialModels[0].geometryId;
      mockState.geometries[geometryId] = { data: surface(1, [9, 9, 9, 8, 8, 8, 7, 7, 7]) };

      expect(await view.deleteSelectedPoints()).toBe(false);

      expect(deleteSelection).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' }));
    });

    it('does nothing without a selection or while the target cannot be edited', async () => {
      const confirm = jest.fn(() => Promise.resolve(true));
      const { view } = createEditingView({ confirm });

      expect(await view.deleteSelectedPoints()).toBe(false);
      expect(confirm).not.toHaveBeenCalled();
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
