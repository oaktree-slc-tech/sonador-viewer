// 3D tool state shared by the palette and the 3D editing canvas

import {
  adjustPendingWrites,
  begin3DToolJob,
  effectiveWeldTolerance,
  end3DToolJob,
  get3DEditOptions,
  get3DLength,
  get3DSmoothOptions,
  get3DToolState,
  handle3DToolRequest,
  is3DSelectionTool,
  is3DTargetEditable,
  LENGTH_BASIS,
  lengthBasisFor,
  MAX_CONSTRAINTS,
  PAINT_RADIUS,
  PAINT_RADIUS_VOXELS,
  REMOVAL_DEPTH,
  REMOVAL_DEPTH_VOXELS,
  request3DToolAction,
  reset3DToolState,
  set3DPreview,
  set3DSelectionCount,
  set3DSurfaceHealth,
  set3DToolBusy,
  set3DToolOption,
  set3DToolTarget,
  set3DToolUnits,
  set3DUnsynchronizedEdits,
  setActive3DTool,
  setRemovalDepth,
  subscribe3DToolState,
  THREE_D_TOOLS,
} from './threeDToolState';


beforeEach(() => reset3DToolState({ settings: true }));

describe('threeDToolState', () => {
  it('notifies subscribers of changes, and only of changes', () => {
    const listener = jest.fn();
    const unsubscribe = subscribe3DToolState(listener);

    setActive3DTool(THREE_D_TOOLS.Lasso);
    setActive3DTool(THREE_D_TOOLS.Lasso);
    set3DSelectionCount(4);

    expect(listener).toHaveBeenCalledTimes(2);
    expect(get3DToolState()).toMatchObject({ activeTool: 'Lasso', selectionCount: 4 });

    unsubscribe();
    setActive3DTool(null);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('keeps notifying when a subscriber throws', () => {
    const failing = jest.fn(() => {
      throw new Error('listener failed');
    });
    const listener = jest.fn();
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const unsubscribers = [subscribe3DToolState(failing), subscribe3DToolState(listener)];

    set3DToolBusy(true);

    expect(listener).toHaveBeenCalled();
    unsubscribers.forEach(unsubscribe => unsubscribe());
    error.mockRestore();
  });

  it('can edit the target only when it is enabled and nothing is running', () => {
    expect(is3DTargetEditable()).toBe(false);

    set3DToolTarget({ segmentIndex: 1, label: 'Liver' });
    expect(is3DTargetEditable()).toBe(true);

    set3DToolBusy(true);
    expect(is3DTargetEditable()).toBe(false);
    set3DToolBusy(false);

    set3DToolTarget({ segmentIndex: 1, disabledReason: 'locked' });
    expect(is3DTargetEditable()).toBe(false);
  });

  it('clamps the removal depth, and keeps it when the editor closes', () => {
    expect(get3DToolState().removalDepth).toBe(REMOVAL_DEPTH.default);

    setRemovalDepth('4.5');
    expect(get3DToolState().removalDepth).toBe(4.5);
    setRemovalDepth(1000);
    expect(get3DToolState().removalDepth).toBe(REMOVAL_DEPTH.max);
    setRemovalDepth('not a number');
    expect(get3DToolState().removalDepth).toBe(REMOVAL_DEPTH.max);

    reset3DToolState();
    expect(get3DToolState().removalDepth).toBe(REMOVAL_DEPTH.max);
    reset3DToolState({ settings: true });
    expect(get3DToolState().removalDepth).toBe(REMOVAL_DEPTH.default);
  });

  it('only the job that owns the busy flag clears it', () => {
    const first = begin3DToolJob();
    const second = begin3DToolJob();

    end3DToolJob(first); // stale
    expect(get3DToolState().busy).toBe(true);
    end3DToolJob(second);
    expect(get3DToolState().busy).toBe(false);

    const old = begin3DToolJob();
    reset3DToolState(); // new editor session
    const current = begin3DToolJob();
    end3DToolJob(old);
    expect(get3DToolState().busy).toBe(true);
    end3DToolJob(current);
  });

  it('counts queued labelmap writes, never below zero, and forgets them when the editor closes', () => {
    adjustPendingWrites(1);
    adjustPendingWrites(1);
    expect(get3DToolState().pendingWrites).toBe(2);
    adjustPendingWrites(-3);
    expect(get3DToolState().pendingWrites).toBe(0);

    adjustPendingWrites(1);
    reset3DToolState();
    expect(get3DToolState().pendingWrites).toBe(0);
  });

  it('validates and keeps the Selection tool settings', () => {
    expect(set3DToolOption('closure', 'flat')).toBe(true);
    expect(set3DToolOption('closure', 'bogus')).toBe(false);
    expect(set3DToolOption('connectedOnly', 'yes')).toBe(true);
    expect(set3DToolOption('maxConstraints', 100)).toBe(true);
    expect(set3DToolOption('weldFraction', 'x')).toBe(false);
    expect(set3DToolOption('weldTolerance', 0.5)).toBe(false); // the earlier world-unit setting is gone
    expect(set3DToolOption('unknown', 1)).toBe(false);
    expect(get3DToolState()).toMatchObject({ closure: 'flat', connectedOnly: true, maxConstraints: MAX_CONSTRAINTS.max });
    expect(get3DEditOptions()).toEqual({
      closure: 'flat', rimCleanup: 'full', weldTolerance: 0, islandMaxTriangles: 50, maxConstraints: 8,
    });

    reset3DToolState();
    expect(get3DToolState().closure).toBe('flat');
    reset3DToolState({ settings: true });
    expect(get3DToolState().closure).toBe('auto');
  });

  it('clamps a stored setting from an earlier range when the editor reopens', () => {
    // A constraint cap of 32 and a weld fraction of 1 from an earlier session: the restore path
    // goes through the same validation as the setter (ohif-viewers#149, AR-6)
    set3DToolOption('closure', 'flat');
    get3DToolState().maxConstraints = 32; // as a persisted raw value would land
    get3DToolState().weldFraction = 1;
    get3DToolState().smoothPasses = 'many';

    reset3DToolState();

    expect(get3DToolState()).toMatchObject({ closure: 'flat', maxConstraints: 8, weldFraction: 0.1, smoothPasses: 3 });
  });

  describe('length settings per basis (ohif-viewers#151 FR-3)', () => {
    const MM = { calibration: 'mm', length: 'mm', spacing: [0.5, 0.5, 3] };
    const UNKNOWN = { calibration: 'unknown', length: 'units', spacing: [1, 1, 2.5] };
    const NO_SPACING = { calibration: 'unknown', length: 'units', spacing: null };

    it('resolves in world units with no target, and on a calibrated grid with the voxel reading beside', () => {
      expect(lengthBasisFor(null)).toBe(LENGTH_BASIS.world);
      expect(get3DLength('removalDepth')).toMatchObject({
        basis: LENGTH_BASIS.world, settingKey: 'removalDepth', range: REMOVAL_DEPTH,
        value: REMOVAL_DEPTH.default, world: REMOVAL_DEPTH.default, voxels: null, reference: null,
      });

      set3DToolUnits(MM);
      setRemovalDepth(2);
      set3DToolOption('paintRadius', 1.5);
      expect(get3DLength('removalDepth')).toMatchObject({ basis: LENGTH_BASIS.world, value: 2, world: 2, voxels: 4, reference: 0.5, spacing: [0.5, 0.5, 3] });
      expect(get3DLength('paintRadius')).toMatchObject({ basis: LENGTH_BASIS.world, value: 1.5, world: 1.5, voxels: 3 });
    });

    it('switches to voxel units on an uncalibrated grid, resolving whole steps of the smallest spacing', () => {
      set3DToolUnits(UNKNOWN);
      expect(lengthBasisFor(UNKNOWN)).toBe(LENGTH_BASIS.voxels);
      expect(get3DLength('removalDepth')).toMatchObject({
        basis: LENGTH_BASIS.voxels, settingKey: 'removalDepthVoxels', range: REMOVAL_DEPTH_VOXELS,
        value: REMOVAL_DEPTH_VOXELS.default, world: REMOVAL_DEPTH_VOXELS.default * 1, voxels: REMOVAL_DEPTH_VOXELS.default, reference: 1,
      });
      // The voxel-unit value is whole, clamped to its own range, and never touches the world value
      expect(set3DToolOption('removalDepthVoxels', 3.6)).toBe(true);
      expect(set3DToolOption('paintRadiusVoxels', 100)).toBe(true);
      expect(get3DToolState()).toMatchObject({ removalDepthVoxels: 4, paintRadiusVoxels: PAINT_RADIUS_VOXELS.max, removalDepth: REMOVAL_DEPTH.default, paintRadius: PAINT_RADIUS.default });
      expect(get3DLength('removalDepth')).toMatchObject({ value: 4, world: 4 });
      expect(get3DLength('paintRadius')).toMatchObject({ value: PAINT_RADIUS_VOXELS.max, world: PAINT_RADIUS_VOXELS.max, settingKey: 'paintRadiusVoxels' });
    });

    it('resolves a voxel-unit length against the grid now published, not the one before it', () => {
      // The reference volume was replaced under the same id on a coarser grid (ohif-viewers!117)
      set3DToolUnits({ calibration: 'unknown', length: 'units', spacing: [1, 1, 2] });
      set3DToolOption('removalDepthVoxels', 4);
      set3DToolOption('paintRadiusVoxels', 2);
      expect(get3DLength('removalDepth')).toMatchObject({ value: 4, world: 4, reference: 1 });
      set3DToolUnits({ calibration: 'unknown', length: 'units', spacing: [3, 3, 6] });
      expect(get3DLength('removalDepth')).toMatchObject({ value: 4, world: 12, reference: 3, spacing: [3, 3, 6] });
      expect(get3DLength('paintRadius')).toMatchObject({ value: 2, world: 6 });
    });

    it('keeps a value per basis, so a number set on one kind of grid is never reread on the other', () => {
      set3DToolUnits(MM);
      setRemovalDepth(6);
      set3DToolUnits(UNKNOWN);
      set3DToolOption('removalDepthVoxels', 9);
      expect(get3DLength('removalDepth')).toMatchObject({ basis: LENGTH_BASIS.voxels, value: 9, world: 9 });
      set3DToolUnits(MM);
      expect(get3DLength('removalDepth')).toMatchObject({ basis: LENGTH_BASIS.world, value: 6, world: 6, voxels: 12 });
      // Both survive the editor closing, as the other settings do
      reset3DToolState();
      expect(get3DToolState()).toMatchObject({ removalDepth: 6, removalDepthVoxels: 9, units: null });
      expect(get3DLength('removalDepth')).toMatchObject({ basis: LENGTH_BASIS.world, value: 6 });
    });

    it('stays in world units on an uncalibrated grid without a usable spacing rather than inventing a voxel unit', () => {
      set3DToolUnits(NO_SPACING);
      expect(lengthBasisFor(NO_SPACING)).toBe(LENGTH_BASIS.world);
      expect(get3DLength('removalDepth')).toMatchObject({ basis: LENGTH_BASIS.world, settingKey: 'removalDepth', world: REMOVAL_DEPTH.default, voxels: null, reference: null });
      expect(get3DLength('paintRadius')).toMatchObject({ basis: LENGTH_BASIS.world, world: PAINT_RADIUS.default });
      set3DToolUnits({ calibration: 'unknown', spacing: [1, 0, 1] });
      expect(get3DLength('removalDepth').basis).toBe(LENGTH_BASIS.world);
      set3DToolUnits({ calibration: 'unknown', spacing: [2, 2, 'x'] });
      expect(get3DLength('removalDepth').basis).toBe(LENGTH_BASIS.world);
      // A record for a grid nobody has read yet (no metadata, no spacing) is the same case
      set3DToolUnits({ calibration: 'unknown', reason: 'no-metadata', spacing: null });
      expect(get3DLength('paintRadius')).toMatchObject({ basis: LENGTH_BASIS.world, world: PAINT_RADIUS.default });
    });

    it('re-derives the lengths only when the units or a length setting change', () => {
      const seen = [];
      const unsubscribe = subscribe3DToolState(state => seen.push(state.lengths));
      set3DToolUnits(MM);
      const afterUnits = get3DToolState().lengths;
      set3DToolOption('closure', 'flat');
      expect(get3DToolState().lengths).toBe(afterUnits);
      set3DToolUnits(MM);
      expect(get3DToolState().lengths).toBe(afterUnits);
      setRemovalDepth(3);
      expect(get3DToolState().lengths).not.toBe(afterUnits);
      unsubscribe();
    });
  });

  it('derives the weld from the surface statistics, for the developer tools only', () => {
    expect(set3DToolOption('weldFraction', 0.5)).toBe(true); // capped at a tenth of p1
    expect(get3DToolState().weldFraction).toBe(0.1);
    const health = { edges: { p1: 0.4 } };

    expect(effectiveWeldTolerance(0.1, health, { developerTools: true })).toBeCloseTo(0.04, 9);
    expect(effectiveWeldTolerance(0.1, health)).toBe(0);
    expect(effectiveWeldTolerance(0, health, { developerTools: true })).toBe(0);
    // Missing or invalid statistics mean an exact weld, never an unbounded one
    expect(effectiveWeldTolerance(0.1, null, { developerTools: true })).toBe(0);
    expect(effectiveWeldTolerance(0.1, { edges: { p1: 0 } }, { developerTools: true })).toBe(0);
    expect(effectiveWeldTolerance(0.1, { edges: { p1: NaN } }, { developerTools: true })).toBe(0);

    set3DSurfaceHealth(health);
    expect(get3DEditOptions(undefined, { developerTools: true }).weldTolerance).toBeCloseTo(0.04, 9);
    expect(get3DEditOptions().weldTolerance).toBe(0);
    expect(get3DEditOptions(get3DToolState(), { surfaceHealth: { edges: { p1: 1 } }, developerTools: true }).weldTolerance).toBeCloseTo(0.1, 9);
  });

  it('validates the Lasso, Paint and Smooth settings', () => {
    expect(set3DToolOption('lassoShape', 'box')).toBe(true);
    expect(set3DToolOption('lassoShape', 'circle')).toBe(false);
    expect(set3DToolOption('paintMode', 'erase')).toBe(true);
    expect(set3DToolOption('paintRadius', 1000)).toBe(true);
    expect(set3DToolOption('action', 'smooth')).toBe(true);
    expect(set3DToolOption('action', 'heal')).toBe(false);
    expect(set3DToolOption('smoothStrength', 2)).toBe(true);
    expect(set3DToolOption('smoothPasses', 4.4)).toBe(true);
    expect(set3DToolOption('smoothFeather', 0)).toBe(true);
    expect(get3DToolState()).toMatchObject({
      lassoShape: 'box', paintMode: 'erase', paintRadius: PAINT_RADIUS.max, action: 'smooth',
      smoothStrength: 0.9, smoothPasses: 4, smoothFeather: false,
    });
    expect(get3DSmoothOptions()).toEqual({ strength: 0.9, passes: 4, feather: false });

    reset3DToolState();
    expect(get3DToolState().lassoShape).toBe('box');
    reset3DToolState({ settings: true });
    expect(get3DToolState()).toMatchObject({ lassoShape: 'lasso', paintMode: 'paint', smoothPasses: 3, smoothFeather: true });
  });

  it('publishes the selection as faces, points and regions', () => {
    set3DSelectionCount(12, { points: 9, regions: 2 });
    expect(get3DToolState()).toMatchObject({ selectionCount: 12, selectionPoints: 9, selectionRegions: 2 });
    set3DSelectionCount(0);
    expect(get3DToolState()).toMatchObject({ selectionCount: 0, selectionPoints: 0, selectionRegions: 0 });
    expect(is3DSelectionTool(THREE_D_TOOLS.Lasso)).toBe(true);
    expect(is3DSelectionTool(THREE_D_TOOLS.Paint)).toBe(true);
    expect(is3DSelectionTool(null)).toBe(false);
  });

  it('cannot edit the target while an edit awaits Apply / Cancel', () => {
    set3DToolTarget({ segmentIndex: 1, label: 'Liver' });
    expect(is3DTargetEditable()).toBe(true);
    set3DPreview({ holes: 1 });
    expect(is3DTargetEditable()).toBe(false);
    set3DPreview(null);
    expect(is3DTargetEditable()).toBe(true);
  });

  it('routes palette requests to the registered handler', () => {
    const handler = jest.fn(() => 'done');
    const unregister = handle3DToolRequest('deleteSelection', handler);

    expect(request3DToolAction('deleteSelection', { a: 1 })).toBe('done');
    expect(handler).toHaveBeenCalledWith({ a: 1 });

    unregister();
    expect(request3DToolAction('deleteSelection')).toBeUndefined();
  });

  it('does not let a stale unregister remove a newer handler', () => {
    const unregisterOld = handle3DToolRequest('clearSelection', () => 'old');
    handle3DToolRequest('clearSelection', () => 'new');

    unregisterOld();

    expect(request3DToolAction('clearSelection')).toBe('new');
  });
});

describe('synchronization state', () => {
  beforeEach(() => reset3DToolState());

  it('publishes how many applied edits the 2D views have not received, and only changes', () => {
    const listener = jest.fn();
    const unsubscribe = subscribe3DToolState(listener);
    expect(get3DToolState().unsynchronizedEdits).toBe(0);

    set3DUnsynchronizedEdits(2);
    set3DUnsynchronizedEdits(2);
    expect(get3DToolState().unsynchronizedEdits).toBe(2);
    expect(listener).toHaveBeenCalledTimes(1);

    set3DUnsynchronizedEdits(-1);
    expect(get3DToolState().unsynchronizedEdits).toBe(0);
    set3DUnsynchronizedEdits(NaN);
    expect(get3DToolState().unsynchronizedEdits).toBe(0);
    reset3DToolState();
    expect(get3DToolState().unsynchronizedEdits).toBe(0);
    unsubscribe();
  });
});

describe('synchronization state: failed writes', () => {
  beforeEach(() => reset3DToolState());

  it('publishes how many of the unsynchronized edits are refused or failed writes, never more than all', () => {
    set3DUnsynchronizedEdits(3, 1);
    expect(get3DToolState()).toMatchObject({ unsynchronizedEdits: 3, failedWrites: 1 });
    set3DUnsynchronizedEdits(2, 5);
    expect(get3DToolState()).toMatchObject({ unsynchronizedEdits: 2, failedWrites: 2 });
    set3DUnsynchronizedEdits(0, 2);
    expect(get3DToolState()).toMatchObject({ unsynchronizedEdits: 0, failedWrites: 0 });
  });
});
