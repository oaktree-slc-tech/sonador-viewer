// Surface follows 2D edits (ohif-viewers#142, FR-9 / AR-7)

import { createSurfaceSync } from './surfaceSync';

// virtual: jest's resolver does not follow the Cornerstone3D packages' `exports` maps. The
// module's defaults are replaced through `deps` below; these only satisfy its imports.
jest.mock('@cornerstonejs/core', () => ({ eventTarget: {} }), { virtual: true });
jest.mock('@cornerstonejs/tools', () => ({ Enums: { Events: {} }, segmentation: {} }), {
  virtual: true,
});

const SOURCE = 'seg::edit';
const TARGET = 'vol3d:seg::edit';
const DELAY = 1500;

function volume(values) {
  let data = Uint8Array.from(values);
  return {
    get data() {
      return [...data];
    },
    voxelManager: {
      getCompleteScalarDataArray: () => Uint8Array.from(data),
      setCompleteScalarDataArray: next => {
        data = Uint8Array.from(next);
      },
    },
  };
}

function setup({ surfaceShown = true } = {}) {
  const eventTarget = new EventTarget();
  const source = volume([0, 0, 0, 0]);
  const target = volume([0, 0, 0, 0]);
  const marked = [];
  // The polySeg wrapper's update notifications, driven by the test
  const updateListeners = new Set();
  const publish = event => updateListeners.forEach(listener => listener(event));
  const deps = {
    eventTarget,
    dataModifiedEvent: 'DATA_MODIFIED',
    // Record what the vol3d labelmap held each time it was marked modified
    markModified: jest.fn(id => marked.push({ id, voxels: target.data })),
    subscribeSurfaceUpdates: listener => { updateListeners.add(listener); return () => updateListeners.delete(listener); },
    waitForSurfaceUpdate: jest.fn(() => Promise.resolve({ ended: true })),
    isSurfaceUpdating: jest.fn(() => state.outstanding > 0),
  };
  const state = { surfaceShown, outstanding: 0 };
  const onError = jest.fn();
  const onUpdateStart = jest.fn();
  const onUpdateEnd = jest.fn();

  const sync = createSurfaceSync({
    sourceSegmentationId: SOURCE,
    targetSegmentationId: TARGET,
    getSourceVolume: () => source,
    getTargetVolume: () => (state.targetMissing ? undefined : target),
    isSurfaceShown: () => state.surfaceShown,
    onUpdateStart,
    onUpdateEnd,
    onError,
    delayMs: DELAY,
    deps,
  });

  const edit = (index, value, segmentationId = SOURCE) => {
    const next = source.data;
    next[index] = value;
    source.voxelManager.setCompleteScalarDataArray(next);
    const evt = new Event('DATA_MODIFIED');
    evt.detail = { segmentationId };
    eventTarget.dispatchEvent(evt);
  };

  return { sync, source, target, deps, marked, edit, state, onError, onUpdateStart, onUpdateEnd, publish, updateListeners };
}

jest.mock('@ohif/core/src/log.js', () => ({ debug: jest.fn(), error: jest.fn() }));

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('createSurfaceSync', () => {
  it('copies the edits into the vol3d labelmap and marks it modified once editing pauses', () => {
    const { deps, edit, marked } = setup();

    edit(0, 1);
    jest.advanceTimersByTime(DELAY - 1);
    edit(1, 2);
    jest.advanceTimersByTime(DELAY - 1);
    expect(deps.markModified).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(marked).toEqual([{ id: TARGET, voxels: [1, 2, 0, 0] }]);
  });

  it('marks the vol3d labelmap (not the working copy) modified, so new segments get a surface', () => {
    // A new segment (value 3) painted in 2D reaches the vol3d labelmap, and the event that
    // updates the surface is raised for vol3d: that event is what invalidates Cornerstone3D's
    // cached segment indices, which a direct updateSurfaceData call would not.
    const { deps, edit, marked } = setup();

    edit(2, 3);
    jest.advanceTimersByTime(DELAY);

    expect(deps.markModified).toHaveBeenCalledWith(TARGET);
    expect(marked[0].voxels).toContain(3);
  });

  it('ignores edits to other segmentations, including its own vol3d events', () => {
    const { deps, edit, target } = setup();

    edit(0, 1, 'some-other-seg');
    edit(0, 1, TARGET);
    jest.advanceTimersByTime(DELAY);

    expect(deps.markModified).not.toHaveBeenCalled();
    expect(target.data).toEqual([0, 0, 0, 0]);
  });

  it('keeps the vol3d labelmap current while the surface is not shown, then catches it up', () => {
    const { sync, deps, edit, target, state } = setup({ surfaceShown: false });

    edit(3, 2);
    jest.advanceTimersByTime(DELAY);
    expect(target.data).toEqual([0, 0, 0, 2]);
    expect(deps.markModified).not.toHaveBeenCalled();
    expect(sync.state.surfaceStale).toBe(true);

    sync.refreshIfStale();
    expect(deps.markModified).not.toHaveBeenCalled();

    state.surfaceShown = true;
    sync.refreshIfStale();
    expect(deps.markModified).toHaveBeenCalledTimes(1);
    expect(sync.state.surfaceStale).toBe(false);

    sync.refreshIfStale();
    expect(deps.markModified).toHaveBeenCalledTimes(1);
  });

  it('syncNow copies and marks modified immediately, even while the surface is not shown', async () => {
    const { sync, deps, edit, target } = setup({ surfaceShown: false });

    edit(0, 3);
    const outcome = sync.syncNow();

    expect(target.data).toEqual([3, 0, 0, 0]);
    expect(deps.markModified).toHaveBeenCalledWith(TARGET);
    expect(sync.state.scheduled).toBe(false);
    // ... and resolves with the outcome of the update the library runs for it
    expect(deps.waitForSurfaceUpdate).toHaveBeenCalledWith(TARGET, expect.objectContaining({ timeoutMs: expect.any(Number) }));
    await expect(outcome).resolves.toEqual({ ended: true });
  });

  it('syncNow resolves false when there is nothing to update', async () => {
    const { sync, deps, state } = setup();
    state.targetMissing = true;
    await expect(sync.syncNow()).resolves.toBe(false);
    expect(deps.markModified).not.toHaveBeenCalled();
  });

  it('reports the start of the vol3d surface updates and their end once none is outstanding', () => {
    const { sync, publish, onUpdateStart, onUpdateEnd, state } = setup();

    publish({ segmentationId: 'other', phase: 'start' });
    state.outstanding = 1;
    publish({ segmentationId: TARGET, phase: 'start', update: 1 });
    state.outstanding = 2;
    publish({ segmentationId: TARGET, phase: 'start', update: 2 });   // a queued second update: still one "updating"
    expect(onUpdateStart).toHaveBeenCalledTimes(1);
    expect(sync.state.updating).toBe(true);

    // The first update ends while the second is still outstanding: not the end
    state.outstanding = 1;
    publish({ segmentationId: TARGET, phase: 'end', update: 1 });
    expect(onUpdateEnd).not.toHaveBeenCalled();
    expect(sync.state.updating).toBe(true);

    state.outstanding = 0;
    publish({ segmentationId: TARGET, phase: 'end', update: 2, cancelled: true });
    expect(onUpdateEnd).toHaveBeenCalledWith({ error: undefined, cancelled: true });
    expect(sync.state.updating).toBe(false);
    publish({ segmentationId: TARGET, phase: 'end', update: 2 });
    expect(onUpdateEnd).toHaveBeenCalledTimes(1);
  });

  it('skips the update when a labelmap volume is unavailable', () => {
    const { deps, edit, state } = setup();
    state.targetMissing = true;

    edit(0, 1);
    jest.advanceTimersByTime(DELAY);

    expect(deps.markModified).not.toHaveBeenCalled();
  });

  it('reports a failed copy without marking anything modified', () => {
    const { deps, edit, source, onError } = setup();
    const failure = new Error('voxel manager unavailable');
    source.voxelManager.getCompleteScalarDataArray = () => {
      throw failure;
    };

    edit(0, 1);
    jest.advanceTimersByTime(DELAY);

    expect(onError).toHaveBeenCalledWith(failure);
    expect(deps.markModified).not.toHaveBeenCalled();
  });

  it('stops following edits and updates once stopped', () => {
    const { sync, deps, edit, updateListeners, publish, onUpdateStart } = setup();

    edit(0, 1);
    sync.stop();
    jest.advanceTimersByTime(DELAY);
    edit(1, 1);
    jest.advanceTimersByTime(DELAY);
    sync.syncNow();
    publish({ segmentationId: TARGET, phase: 'start' });

    expect(deps.markModified).not.toHaveBeenCalled();
    expect(onUpdateStart).not.toHaveBeenCalled();
    expect(updateListeners.size).toBe(0);
  });
});
