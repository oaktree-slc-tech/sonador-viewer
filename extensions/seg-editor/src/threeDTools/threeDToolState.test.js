// 3D tool state shared by the palette and the 3D editing canvas

import {
  adjustPendingWrites,
  begin3DToolJob,
  effectiveWeldTolerance,
  end3DToolJob,
  get3DEditOptions,
  get3DSmoothOptions,
  get3DToolState,
  handle3DToolRequest,
  is3DSelectionTool,
  is3DTargetEditable,
  MAX_CONSTRAINTS,
  PAINT_RADIUS,
  REMOVAL_DEPTH,
  request3DToolAction,
  reset3DToolState,
  set3DPreview,
  set3DSelectionCount,
  set3DUnsynchronizedEdits,
  set3DSurfaceHealth,
  set3DToolBusy,
  set3DToolOption,
  set3DToolTarget,
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
