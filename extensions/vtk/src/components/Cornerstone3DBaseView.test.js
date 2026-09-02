// Streaming-volume progress and error handling in the Cornerstone3D view.
//
// The view is exercised as a plain object rather than through a renderer: this repo has no React
// test renderer, and what these cases are about is the event wiring, not the markup. The component
// is constructed directly and `setState` is stubbed, which is enough to drive the three events the
// load sequence listens to.

const listeners = new Map();

const mockEventTarget = {
  addEventListener: jest.fn((type, handler) => {
    if (!listeners.has(type)) {
      listeners.set(type, new Set());
    }
    listeners.get(type).add(handler);
  }),
  removeEventListener: jest.fn((type, handler) => {
    listeners.get(type)?.delete(handler);
  }),
};

function dispatch(type, detail) {
  [...(listeners.get(type) || [])].forEach(handler => handler({ detail }));
}

jest.mock('@cornerstonejs/core', () => ({
  init: jest.fn(),
  ImageVolume: class {},
  RenderingEngine: class {},
  getRenderingEngine: jest.fn(),
  Enums: {
    Events: {
      IMAGE_VOLUME_MODIFIED: 'CORNERSTONE_IMAGE_VOLUME_MODIFIED',
      IMAGE_VOLUME_LOADING_COMPLETED: 'CORNERSTONE_IMAGE_VOLUME_LOADING_COMPLETED',
      IMAGE_LOAD_ERROR: 'IMAGE_LOAD_ERROR',
      VOLUME_CACHE_VOLUME_REMOVED: 'VOLUME_CACHE_VOLUME_REMOVED',
    },
    ViewportType: { ORTHOGRAPHIC: 'orthographic' },
    OrientationAxis: { AXIAL: 'axial' },
    RequestType: {},
  },
  volumeLoader: { createAndCacheVolume: jest.fn() },
  cache: {
    getVolume: jest.fn(),
    getVolumeLoadObject: jest.fn(),
    removeVolumeLoadObject: jest.fn(),
  },
  eventTarget: mockEventTarget,
  metaData: { get: jest.fn() },
  canRenderFloatTextures: jest.fn(() => false),
  getRenderingEngines: jest.fn(() => []),
  getWebWorkerManager: jest.fn(() => ({})),
}), { virtual: true });

jest.mock('@cornerstonejs/core/utilities/triggerEvent', () => jest.fn(), { virtual: true });

jest.mock('@cornerstonejs/tools', () => ({
  init: jest.fn(),
  ToolGroupManager: {},
  SynchronizerManager: {},
  WindowLevelTool: { toolName: 'WindowLevel' },
  ZoomTool: { toolName: 'Zoom' },
  PanTool: { toolName: 'Pan' },
  StackScrollTool: { toolName: 'StackScroll' },
  Enums: {},
  addTool: jest.fn(),
  annotation: { state: { getAllAnnotations: jest.fn(() => []), removeAnnotation: jest.fn() } },
  segmentation: {
    state: { getSegmentations: jest.fn(() => []), removeSegmentation: jest.fn() },
    helpers: {},
    triggerSegmentationEvents: {},
  },
}), { virtual: true });

jest.mock('@cornerstonejs/dicom-image-loader', () => ({ init: jest.fn() }), { virtual: true });
jest.mock('@cornerstonejs/polymorphic-segmentation', () => ({ init: jest.fn() }), { virtual: true });
jest.mock('@kitware/vtk.js/Common/DataModel/ImageData', () => ({ vtkImageData: {} }), {
  virtual: true,
});
jest.mock('@ohif/core', () => ({
  utils: {
    cornerstone3dUtils: { initCornerstone3d: jest.fn() },
    gpuCapabilities: { assessVolumeFit: jest.fn() },
  },
}), { virtual: true });

const mockAssessFit = jest.fn();
const mockCreateVolume = jest.fn();
const mockSuggestAfterFailure = jest.fn();
const mockLeaseAcquire = jest.fn();
const mockLeaseRelease = jest.fn();

jest.mock('../utils/cornerstone3d.js', () => ({
  assessDisplaySetVolumeFit: (...args) => mockAssessFit(...args),
  createImageVolumeForDisplaySet: (...args) => mockCreateVolume(...args),
  getVolumeIdForDisplaySet: () => 'cornerstoneStreamingImageVolume:ds-1',
  suggestDecimationAfterFailure: (...args) => mockSuggestAfterFailure(...args),
  volumeLease: {
    acquire: (...args) => mockLeaseAcquire(...args),
    release: (...args) => mockLeaseRelease(...args),
    count: () => 1,
  },
}));

const Cornerstone3DBaseView = require('./Cornerstone3DBaseView.js').default;

const EVENTS = {
  MODIFIED: 'CORNERSTONE_IMAGE_VOLUME_MODIFIED',
  COMPLETED: 'CORNERSTONE_IMAGE_VOLUME_LOADING_COMPLETED',
  LOAD_ERROR: 'IMAGE_LOAD_ERROR',
};

const VOLUME_ID = 'cornerstoneStreamingImageVolume:ds-1';

function makeView(props = {}) {
  const view = new Cornerstone3DBaseView({
    renderId: 'test-engine',
    sep: '-',
    orientation: 'axial',
    cornerstone3dViewProps: { type: 'orthographic', defaultOptions: {} },
    viewportData: { displaySet: { displaySetInstanceUID: 'ds-1' } },
    imageIds: ['i0', 'i1', 'i2', 'i3'],
    isLoaded: true,
    ...props,
  });

  // No renderer, so state updates are applied directly.
  view.state = { ...view.state };
  view.setState = updates => Object.assign(view.state, updates);
  view._isViewMounted = true;

  return view;
}

// Faithful to ImageVolume at this pin: getImageIdIndex is a Map lookup, so a miss is `undefined`.
const volume = {
  volumeId: VOLUME_ID,
  imageIds: ['i0', 'i1', 'i2', 'i3'],
  getImageIdIndex: imageId => {
    const index = volume.imageIds.indexOf(imageId);
    return index === -1 ? undefined : index;
  },
};

// A volume that reports a miss the other conventional way, in case upstream ever changes.
const minusOneVolume = {
  ...volume,
  getImageIdIndex: imageId => volume.imageIds.indexOf(imageId),
};

beforeEach(() => {
  listeners.clear();
  jest.clearAllMocks();
});

describe('streaming volume progress', () => {
  it('reports progress from IMAGE_VOLUME_MODIFIED and completion from the completion event', () => {
    const onLoadProgress = jest.fn();
    const view = makeView({ onLoadProgress });

    view._subscribeVolumeEvents(VOLUME_ID, volume);

    dispatch(EVENTS.MODIFIED, { volumeId: VOLUME_ID, framesProcessed: 1, numberOfFrames: 4 });
    expect(view.state.loadProgress).toEqual({
      framesProcessed: 1, numberOfFrames: 4, complete: false,
    });

    dispatch(EVENTS.MODIFIED, { volumeId: VOLUME_ID, framesProcessed: 3, numberOfFrames: 4 });
    expect(view.state.loadProgress.framesProcessed).toBe(3);

    dispatch(EVENTS.COMPLETED, { volumeId: VOLUME_ID });
    expect(view.state.loadProgress).toEqual({
      framesProcessed: 4, numberOfFrames: 4, complete: true,
    });

    expect(onLoadProgress).toHaveBeenCalledTimes(3);
  });

  it('collapses per-slice events to one update per percentage point', () => {
    // IMAGE_VOLUME_MODIFIED fires once per slice. Left ungated that is one setState per slice per
    // view -- ~4,800 renders for a 1,600-slice series across three MPR panes, each cascading a
    // componentDidUpdate through every subclass.
    const onLoadProgress = jest.fn();
    const view = makeView({ onLoadProgress });
    const bigVolume = { ...volume, imageIds: Array.from({ length: 200 }, (_u, i) => `i${i}`) };

    view._subscribeVolumeEvents(VOLUME_ID, bigVolume);

    // 200 slices -> at most one update per whole percent, so far fewer than 200 updates.
    for (let framesProcessed = 1; framesProcessed <= 200; framesProcessed++) {
      dispatch(EVENTS.MODIFIED, { volumeId: VOLUME_ID, framesProcessed, numberOfFrames: 200 });
    }

    expect(onLoadProgress.mock.calls.length).toBeLessThanOrEqual(101);
    expect(onLoadProgress.mock.calls.length).toBeGreaterThan(0);
    // The last one still reports the true frame count, not a rounded one.
    expect(view.state.loadProgress.framesProcessed).toBe(200);
  });

  it('always reports completion, even if the percentage has not moved', () => {
    const onLoadProgress = jest.fn();
    const view = makeView({ onLoadProgress });

    view._subscribeVolumeEvents(VOLUME_ID, volume);

    dispatch(EVENTS.MODIFIED, { volumeId: VOLUME_ID, framesProcessed: 4, numberOfFrames: 4 });
    onLoadProgress.mockClear();

    // 100% already reported by the event above; completion must still get through, or the
    // indicator never clears.
    dispatch(EVENTS.COMPLETED, { volumeId: VOLUME_ID });

    expect(onLoadProgress).toHaveBeenCalledTimes(1);
    expect(view.state.loadProgress.complete).toBe(true);
  });

  it('ignores progress belonging to another volume', () => {
    const onLoadProgress = jest.fn();
    const view = makeView({ onLoadProgress });

    view._subscribeVolumeEvents(VOLUME_ID, volume);

    dispatch(EVENTS.MODIFIED, {
      volumeId: 'cornerstoneStreamingImageVolume:ds-other', framesProcessed: 2, numberOfFrames: 9,
    });
    dispatch(EVENTS.COMPLETED, { volumeId: 'cornerstoneStreamingImageVolume:ds-other' });

    expect(onLoadProgress).not.toHaveBeenCalled();
    expect(view.state.loadProgress).toBeNull();
  });

  it('runs the completion hook exactly once, and only for its own volume', () => {
    const view = makeView();
    view.onImageVolumeLoadingCompleted = jest.fn();

    view._subscribeVolumeEvents(VOLUME_ID, volume);

    dispatch(EVENTS.COMPLETED, { volumeId: 'cornerstoneStreamingImageVolume:ds-other' });
    expect(view.onImageVolumeLoadingCompleted).not.toHaveBeenCalled();

    dispatch(EVENTS.COMPLETED, { volumeId: VOLUME_ID });
    expect(view.onImageVolumeLoadingCompleted).toHaveBeenCalledTimes(1);
  });
});

describe('streaming volume errors', () => {
  it('raises the error once per volume, for an imageId the volume owns', () => {
    const onLoadError = jest.fn();
    const view = makeView({ onLoadError });

    view._subscribeVolumeEvents(VOLUME_ID, volume);

    // IMAGE_LOAD_ERROR carries no volumeId, so the imageId is matched against the volume.
    dispatch(EVENTS.LOAD_ERROR, { imageId: 'not-in-this-volume', error: new Error('other') });
    expect(onLoadError).not.toHaveBeenCalled();

    dispatch(EVENTS.LOAD_ERROR, { imageId: 'i2', error: new Error('boom') });
    dispatch(EVENTS.LOAD_ERROR, { imageId: 'i3', error: new Error('boom again') });

    expect(onLoadError).toHaveBeenCalledTimes(1);
    expect(onLoadError.mock.calls[0][0].message).toBe('boom');
    expect(view.state.loadError.message).toBe('boom');
  });
});

describe('cross-volume error isolation', () => {
  it('ignores a failing imageId that this volume does not contain', () => {
    // IMAGE_LOAD_ERROR is global. Another series failing must not raise this view's sticky error
    // and Exit prompt.
    [volume, minusOneVolume].forEach(v => {
      const onLoadError = jest.fn();
      const view = makeView({ onLoadError });
      listeners.clear();

      view._subscribeVolumeEvents(VOLUME_ID, v);
      dispatch(EVENTS.LOAD_ERROR, { imageId: 'from-another-volume', error: new Error('other') });

      expect(onLoadError).not.toHaveBeenCalled();
      expect(view.state.loadError).toBeNull();
    });
  });

  it('still reports a failure for an imageId it does own, index 0 included', () => {
    const onLoadError = jest.fn();
    const view = makeView({ onLoadError });

    view._subscribeVolumeEvents(VOLUME_ID, volume);
    dispatch(EVENTS.LOAD_ERROR, { imageId: 'i0', error: new Error('mine') });

    expect(onLoadError).toHaveBeenCalledTimes(1);
  });
});

describe('event lifecycle', () => {
  it('removes every listener it added on unsubscribe', () => {
    const view = makeView();

    view._subscribeVolumeEvents(VOLUME_ID, volume);
    expect(mockEventTarget.addEventListener).toHaveBeenCalledTimes(3);

    view._unsubscribeVolumeEvents();

    expect(mockEventTarget.removeEventListener).toHaveBeenCalledTimes(3);
    expect([...listeners.values()].every(set => set.size === 0)).toBe(true);

    // A second unsubscribe (unmount after an onClose that already tore down) is a no-op.
    view._unsubscribeVolumeEvents();
    expect(mockEventTarget.removeEventListener).toHaveBeenCalledTimes(3);
  });

  it('drops progress once the view has unmounted', () => {
    const onLoadProgress = jest.fn();
    const view = makeView({ onLoadProgress });

    view._subscribeVolumeEvents(VOLUME_ID, volume);
    view._isViewMounted = false;

    dispatch(EVENTS.MODIFIED, { volumeId: VOLUME_ID, framesProcessed: 1, numberOfFrames: 4 });

    expect(onLoadProgress).not.toHaveBeenCalled();
  });
});


describe('volume creation lifecycle', () => {
  const OK_FIT = {
    fits: true, reason: 'ok', textureBytes: 100, budgetBytes: 200,
    maxDepth: 2048, suggestedDecimation: null, dimensions: [512, 512, 4], dataType: 'Int16Array',
  };

  function makeVolume(id = VOLUME_ID) {
    return {
      volumeId: id,
      imageIds: ['i0', 'i1', 'i2', 'i3'],
      load: jest.fn(),
      loadStatus: { loaded: false },
      getImageIdIndex: imageId => {
        const index = ['i0', 'i1', 'i2', 'i3'].indexOf(imageId);
        return index === -1 ? undefined : index;
      },
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockAssessFit.mockReturnValue(OK_FIT);
    mockSuggestAfterFailure.mockReturnValue(null);
  });

  it('does not take a lease, subscribe or stream when the view unmounts mid-creation', async () => {
    // componentWillUnmount has already run by the time creation resolves, so it saw no lease to
    // release. Acquiring one here and never giving it back leaks the volume, its listeners and its
    // in-flight streaming.
    const volume = makeVolume();
    let finishCreate;
    mockCreateVolume.mockReturnValue(
      new Promise(resolve => { finishCreate = () => resolve({ volumeId: VOLUME_ID, volume, decimated: false }); })
    );

    const view = makeView();
    const pending = view.loadImageVolume();

    view._isViewMounted = false;   // unmounted while the await is outstanding
    finishCreate();
    await pending;

    expect(volume.load).not.toHaveBeenCalled();
    expect(mockEventTarget.addEventListener).not.toHaveBeenCalled();
    expect(view._leasedVolumeId).toBeFalsy();

    // The volume is still handed back so it cannot sit in the cache owned by nobody.
    expect(mockLeaseAcquire).toHaveBeenCalledWith(VOLUME_ID);
    expect(mockLeaseRelease).toHaveBeenCalledWith(VOLUME_ID);
  });

  it('presents a successful decimated retry as reduced resolution, not as a failure', async () => {
    // The pre-flight passed and the allocation failed anyway. The retry works, so the user is
    // looking at a working reduced-resolution view -- they must get the notice, not a hard error.
    const volume = makeVolume();
    mockCreateVolume
      .mockRejectedValueOnce(new Error('CACHE_SIZE_EXCEEDED'))
      .mockResolvedValueOnce({ volumeId: VOLUME_ID, volume, decimated: true });
    mockSuggestAfterFailure.mockReturnValue([1, 1, 2]);

    const onLoadError = jest.fn();
    const onVolumeFit = jest.fn();
    const view = makeView({ onLoadError, onVolumeFit });

    await view.loadImageVolume();

    expect(onLoadError).not.toHaveBeenCalled();
    expect(view.state.loadError).toBeNull();

    const reportedFit = onVolumeFit.mock.calls[0][0];
    expect(reportedFit.fits).toBe(false);
    expect(reportedFit.reason).toBe('budget');
    expect(reportedFit.decimated).toBe(true);
    expect(reportedFit.suggestedDecimation).toEqual([1, 1, 2]);
    expect(volume.load).toHaveBeenCalled();
  });

  it('reports the original failure when the decimated retry also fails', async () => {
    const original = new Error('CACHE_SIZE_EXCEEDED');
    mockCreateVolume
      .mockRejectedValueOnce(original)
      .mockRejectedValueOnce(new Error('still too big'));
    mockSuggestAfterFailure.mockReturnValue([1, 1, 2]);

    const onLoadError = jest.fn();
    const view = makeView({ onLoadError });

    await expect(view.loadImageVolume()).rejects.toThrow('still too big');
    expect(onLoadError).toHaveBeenCalledTimes(1);
    expect(onLoadError.mock.calls[0][0]).toBe(original);
  });

  it('does not retry with the decimation that just failed', async () => {
    // Pre-flight already said "reduce", that attempt failed, and nothing smaller is on offer.
    mockAssessFit.mockReturnValue({ ...OK_FIT, fits: false, reason: 'budget', suggestedDecimation: [1, 1, 2] });
    mockSuggestAfterFailure.mockReturnValue([1, 1, 2]);
    mockCreateVolume.mockRejectedValueOnce(new Error('nope'));

    const onLoadError = jest.fn();
    const view = makeView({ onLoadError });

    await expect(view.loadImageVolume()).rejects.toThrow('nope');
    expect(mockCreateVolume).toHaveBeenCalledTimes(1);
    expect(onLoadError).toHaveBeenCalledTimes(1);
  });
});
