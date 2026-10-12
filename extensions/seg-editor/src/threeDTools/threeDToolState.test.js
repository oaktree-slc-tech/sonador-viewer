// 3D tool state shared by the palette and the 3D editing canvas

import {
  adjustPendingWrites,
  begin3DToolJob,
  end3DToolJob,
  get3DEditOptions,
  get3DSmoothOptions,
  get3DToolState,
  handle3DToolRequest,
  is3DSelectionTool,
  is3DTargetEditable,
  PAINT_RADIUS,
  REMOVAL_DEPTH,
  request3DToolAction,
  reset3DToolState,
  set3DPreview,
  set3DSelectionCount,
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
    expect(set3DToolOption('weldTolerance', 'x')).toBe(false);
    expect(set3DToolOption('unknown', 1)).toBe(false);
    expect(get3DToolState()).toMatchObject({ closure: 'flat', connectedOnly: true, maxConstraints: 32 });
    expect(get3DEditOptions()).toEqual({
      closure: 'flat', rimCleanup: 'full', weldTolerance: 0.001, islandMaxTriangles: 50, maxConstraints: 32,
    });

    reset3DToolState();
    expect(get3DToolState().closure).toBe('flat');
    reset3DToolState({ settings: true });
    expect(get3DToolState().closure).toBe('auto');
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
