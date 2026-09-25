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
  const deps = {
    eventTarget,
    dataModifiedEvent: 'DATA_MODIFIED',
    // Record what the vol3d labelmap held each time it was marked modified
    markModified: jest.fn(id => marked.push({ id, voxels: target.data })),
  };
  const state = { surfaceShown };
  const onError = jest.fn();

  const sync = createSurfaceSync({
    sourceSegmentationId: SOURCE,
    targetSegmentationId: TARGET,
    getSourceVolume: () => source,
    getTargetVolume: () => (state.targetMissing ? undefined : target),
    isSurfaceShown: () => state.surfaceShown,
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

  return { sync, source, target, deps, marked, edit, state, onError };
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

  it('syncNow copies and marks modified immediately, even while the surface is not shown', () => {
    const { sync, deps, edit, target } = setup({ surfaceShown: false });

    edit(0, 3);
    sync.syncNow();

    expect(target.data).toEqual([3, 0, 0, 0]);
    expect(deps.markModified).toHaveBeenCalledWith(TARGET);
    expect(sync.state.scheduled).toBe(false);
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

  it('stops following edits once stopped', () => {
    const { sync, deps, edit } = setup();

    edit(0, 1);
    sync.stop();
    jest.advanceTimersByTime(DELAY);
    edit(1, 1);
    jest.advanceTimersByTime(DELAY);
    sync.syncNow();

    expect(deps.markModified).not.toHaveBeenCalled();
  });
});
