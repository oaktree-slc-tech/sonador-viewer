// 3D tool state shared by the palette and the 3D editing canvas

import {
  begin3DToolJob,
  end3DToolJob,
  get3DToolState,
  handle3DToolRequest,
  is3DTargetEditable,
  request3DToolAction,
  reset3DToolState,
  set3DSelectionCount,
  set3DToolBusy,
  set3DToolTarget,
  setActive3DTool,
  setRemovalDepth,
  REMOVAL_DEPTH,
  subscribe3DToolState,
  THREE_D_TOOLS,
} from './threeDToolState';


beforeEach(() => reset3DToolState({ settings: true }));

describe('threeDToolState', () => {
  it('notifies subscribers of changes, and only of changes', () => {
    const listener = jest.fn();
    const unsubscribe = subscribe3DToolState(listener);

    setActive3DTool(THREE_D_TOOLS.Selection);
    setActive3DTool(THREE_D_TOOLS.Selection);
    set3DSelectionCount(4);

    expect(listener).toHaveBeenCalledTimes(2);
    expect(get3DToolState()).toMatchObject({ activeTool: 'Selection', selectionCount: 4 });

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
