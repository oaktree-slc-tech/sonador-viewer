// The legacy-facing bridge: the classic 2D stack reads pixels and metadata from Cornerstone3D.
//
// What these cases are about is the seam itself -- that the object handed to the legacy renderer
// is the Cornerstone3D one and not a copy, that eviction stays a Cornerstone3D decision, and that
// the legacy listeners still hear about images that never went through the legacy path.
//
// @cornerstonejs/core is ESM behind an `exports` map with no jest-resolvable entry point, so it is
// replaced wholesale. Legacy cornerstone-core is replaced too: the real module needs a DOM at
// import time, and what matters here is which of its functions the bridge calls, not what they do.

const mockLoadAndCacheImage = jest.fn();
const mockCancelLoadImage = jest.fn();
const mockC3dMetaDataGet = jest.fn();
const mockGetMaxCacheSize = jest.fn(() => 3 * 1024 * 1024 * 1024);

const c3dListeners = new Map();
const mockC3dEventTarget = {
  addEventListener: jest.fn((type, fn) => {
    if (!c3dListeners.has(type)) c3dListeners.set(type, new Set());
    c3dListeners.get(type).add(fn);
  }),
  removeEventListener: jest.fn((type, fn) => c3dListeners.get(type)?.delete(fn)),
};

function emitC3d(type, detail) {
  [...(c3dListeners.get(type) || [])].forEach(fn => fn({ detail }));
}

jest.mock('@cornerstonejs/core', () => ({
  imageLoader: {
    loadAndCacheImage: (...args) => mockLoadAndCacheImage(...args),
    cancelLoadImage: (...args) => mockCancelLoadImage(...args),
  },
  metaData: { get: (...args) => mockC3dMetaDataGet(...args) },
  cache: { getMaxCacheSize: (...args) => mockGetMaxCacheSize(...args) },
  // Referenced through a closure, not directly: jest.mock factories are hoisted above the const
  // declarations below and would otherwise run before this one is initialised.
  eventTarget: {
    addEventListener: (...args) => mockC3dEventTarget.addEventListener(...args),
    removeEventListener: (...args) => mockC3dEventTarget.removeEventListener(...args),
  },
  Enums: {
    RequestType: {
      Interaction: 'interaction',
      Thumbnail: 'thumbnail',
      Prefetch: 'prefetch',
      Compute: 'compute',
    },
    Events: {
      IMAGE_CACHE_IMAGE_ADDED: 'CORNERSTONE_IMAGE_CACHE_IMAGE_ADDED',
      IMAGE_CACHE_IMAGE_REMOVED: 'CORNERSTONE_IMAGE_CACHE_IMAGE_REMOVED',
    },
  },
}));

import { createBridgeLoader, registerLegacyBridgeLoaders, toRequestType, BRIDGED_SCHEMES } from './bridgeImageLoader';
import toLegacyImage from './toLegacyImage';
import { installLegacyCacheMirror } from './cacheMirror';
import { registerLegacyMetadataDelegate, createMetadataDelegate } from './metadataDelegate';

// A viewport element: a real event target, because the mirror subscribes NEW_IMAGE on it.
function makeElement(imageId) {
  const listeners = new Map();
  const element = {
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener: (type, fn) => listeners.get(type)?.delete(fn),
    listenerCount: type => (listeners.get(type) || new Set()).size,
  };

  // `{ element, image }` is the shape cornerstone-core's enabled-element list holds.
  const enabled = { element, image: { imageId } };

  enabled.showImage = nextImageId => {
    enabled.image = { imageId: nextImageId };
    [...(listeners.get('cornerstonenewimage') || [])].forEach(fn => fn({ type: 'cornerstonenewimage' }));
  };

  return enabled;
}

// A stand-in for a Cornerstone3D image, including the one thing that must not be copied.
function makeC3dImage(imageId, pixels) {
  const pixelData = pixels || new Uint16Array([1, 2, 3, 4]);
  return {
    imageId,
    sizeInBytes: pixelData.byteLength,
    getPixelData: () => pixelData,
    rows: 2,
    columns: 2,
  };
}

// Enough of cornerstone-core@2.6.1 to observe what the bridge does to it, with the two throwing
// behaviours the real cache has (`removeImageLoadObject` on an absent id).
function makeLegacyCornerstone() {
  const entries = {};
  const emitted = [];
  let maximumSizeInBytes = 1024 * 1024 * 1024;

  return {
    emitted,
    registered: {},
    unknownLoader: undefined,
    providers: [],
    enabledElements: [],

    registerImageLoader(scheme, loader) {
      this.registered[scheme] = loader;
    },
    registerUnknownImageLoader(loader) {
      this.unknownLoader = loader;
    },
    getEnabledElements() {
      return this.enabledElements;
    },
    metaData: {
      addProvider: function (provider, priority) {
        this.owner.providers.push({ provider, priority });
      },
    },
    EVENTS: {
      IMAGE_LOADED: 'cornerstoneimageloaded',
      IMAGE_CACHE_CHANGED: 'cornerstoneimagecachechanged',
      IMAGE_CACHE_PROMISE_REMOVED: 'cornerstoneimagecachepromiseremoved',
      ELEMENT_ENABLED: 'cornerstoneelementenabled',
      ELEMENT_DISABLED: 'cornerstoneelementdisabled',
      NEW_IMAGE: 'cornerstonenewimage',
    },
    events: (() => {
      const listeners = new Map();
      return {
        addEventListener: (type, fn) => {
          if (!listeners.has(type)) listeners.set(type, new Set());
          listeners.get(type).add(fn);
        },
        removeEventListener: (type, fn) => listeners.get(type)?.delete(fn),
        dispatch: (type, detail) => [...(listeners.get(type) || [])].forEach(fn => fn({ type, detail })),
      };
    })(),
    triggerEvent(target, type, detail) {
      emitted.push({ type, detail });
    },
    imageCache: {
      imageCache: entries,
      getCacheInfo: () => ({ maximumSizeInBytes }),
      setMaximumSizeBytes: jest.fn(bytes => {
        maximumSizeInBytes = bytes;
      }),
      removeImageLoadObject: jest.fn(imageId => {
        if (!entries[imageId]) {
          throw new Error('removeImageLoadObject: imageId was not present in imageCache');
        }
        delete entries[imageId];
      }),
    },
  };
}

function wireLegacy(cornerstone) {
  // metaData.addProvider needs a back-reference to record onto; done here rather than in the
  // literal above so the shape stays readable.
  cornerstone.metaData.owner = cornerstone;
  return cornerstone;
}

beforeEach(() => {
  jest.clearAllMocks();
  c3dListeners.clear();
  mockGetMaxCacheSize.mockReturnValue(3 * 1024 * 1024 * 1024);
});

describe('bridge image loader', () => {
  it('resolves the Cornerstone3D image itself, sharing its pixel array', async () => {
    // The whole point of the phase: one decode, one copy. A resolved image whose getPixelData()
    // is not the same array as the Cornerstone3D cache entry's means a second copy exists.
    const image = makeC3dImage('wadors:series/1');
    mockLoadAndCacheImage.mockResolvedValue(image);

    const resolved = await createBridgeLoader()('wadors:series/1', {}).promise;

    expect(resolved).toBe(image);
    expect(Object.is(resolved.getPixelData(), image.getPixelData())).toBe(true);
  });

  it('maps the legacy request class and priority onto Cornerstone3D', async () => {
    mockLoadAndCacheImage.mockResolvedValue(makeC3dImage('wadors:series/2'));

    await createBridgeLoader()('wadors:series/2', { requestType: 'interaction', priority: 5 }).promise;

    const [imageId, options] = mockLoadAndCacheImage.mock.calls[0];
    expect(imageId).toBe('wadors:series/2');
    expect(options.requestType).toBe('interaction');
    expect(options.priority).toBe(5);
  });

  it('carries a thumbnail through as a thumbnail, not as background work', async () => {
    // The class the thumbnail call sites now send. Cornerstone3D sizes the thumbnail and prefetch
    // buckets separately, so a thumbnail arriving unclassed would queue as background prefetch and
    // contend with StudyPrefetcher for that bucket instead of using its own.
    mockLoadAndCacheImage.mockResolvedValue(makeC3dImage('wadors:series/thumb'));

    await createBridgeLoader()('wadors:series/thumb', { requestType: 'thumbnail' }).promise;

    expect(mockLoadAndCacheImage.mock.calls[0][1].requestType).toBe('thumbnail');
  });

  it('maps each legacy request class one to one', () => {
    expect(toRequestType('interaction')).toBe('interaction');
    expect(toRequestType('thumbnail')).toBe('thumbnail');
    expect(toRequestType('prefetch')).toBe('prefetch');
  });

  it('always tags the request with its imageId, which is what makes it cancellable', async () => {
    // cancelLoadImage filters the pool on additionalDetails.imageId; without it a queued request
    // cannot be found, so the cancel would silently do nothing.
    mockLoadAndCacheImage.mockResolvedValue(makeC3dImage('wadors:series/3'));

    await createBridgeLoader()('wadors:series/3', {}).promise;

    expect(mockLoadAndCacheImage.mock.calls[0][1].additionalDetails).toEqual({
      imageId: 'wadors:series/3',
    });
  });

  it('falls back to the lowest request class rather than passing an unknown one through', async () => {
    // Cornerstone3D's pool manager keys its queues on the enum; an unrecognised name would create
    // a queue nothing drains.
    expect(toRequestType('interaction')).toBe('interaction');
    expect(toRequestType('nonsense')).toBe('prefetch');
    expect(toRequestType(undefined)).toBe('prefetch');
  });

  it('forwards cancelFn to Cornerstone3D and survives it throwing', () => {
    mockLoadAndCacheImage.mockResolvedValue(makeC3dImage('wadors:series/4'));
    const loadObject = createBridgeLoader()('wadors:series/4', {});

    loadObject.cancelFn();
    expect(mockCancelLoadImage).toHaveBeenCalledWith('wadors:series/4');

    // cancelLoadImage calls the cached load object's cancelFn without checking it exists.
    mockCancelLoadImage.mockImplementation(() => {
      throw new Error('cancelFn is not a function');
    });
    expect(() => loadObject.cancelFn()).not.toThrow();
  });

  it('has a decache that frees nothing', async () => {
    // Cornerstone3D owns the pixels. If the legacy LRU could free them, a volume still using the
    // slices would lose them.
    const image = makeC3dImage('wadors:series/5');
    mockLoadAndCacheImage.mockResolvedValue(image);

    const loadObject = createBridgeLoader()('wadors:series/5', {});
    await loadObject.promise;
    loadObject.decache();

    expect(mockCancelLoadImage).not.toHaveBeenCalled();
    expect(ArrayBuffer.isView(image.getPixelData())).toBe(true);
    expect(image.getPixelData().length).toBe(4);
  });

  it('registers one loader for every scheme the viewer emits, plus the unknown fallback', () => {
    const cornerstone = wireLegacy(makeLegacyCornerstone());
    registerLegacyBridgeLoaders(cornerstone);

    expect(Object.keys(cornerstone.registered).sort()).toEqual([...BRIDGED_SCHEMES].sort());
    expect(new Set(Object.values(cornerstone.registered)).size).toBe(1);
    expect(typeof cornerstone.unknownLoader).toBe('function');
  });

  it('the unknown-scheme loader still works, though it is called with the imageId alone', async () => {
    const cornerstone = wireLegacy(makeLegacyCornerstone());
    registerLegacyBridgeLoaders(cornerstone);
    mockLoadAndCacheImage.mockResolvedValue(makeC3dImage('http:whatever'));

    await cornerstone.unknownLoader('http:whatever').promise;

    expect(mockLoadAndCacheImage).toHaveBeenCalledWith('http:whatever', expect.any(Object));
  });
});

describe('toLegacyImage', () => {
  it('returns the same object, not a copy', () => {
    const image = makeC3dImage('wadors:x');
    expect(toLegacyImage(image, 'wadors:x')).toBe(image);
  });

  // The modality transform, which is where the two stacks' contracts actually differ.
  //
  // These numbers are a real CT: stored 0..4095, RescaleIntercept -1024, so the decoded pixels the
  // loader hands over are already -1024..3071 HU, and the VOI LUT module's window (40/400 for soft
  // tissue) is expressed in those units too.
  function prescaledCt() {
    return {
      ...makeC3dImage('wadouri:ct/1'),
      slope: 1,
      intercept: -1024,
      minPixelValue: -1024,
      maxPixelValue: 3071,
      windowCenter: 40,
      windowWidth: 400,
      preScale: { enabled: true, scaled: true, scalingParameters: { rescaleSlope: 1, rescaleIntercept: -1024 } },
    };
  }

  it('does not leave the legacy renderer applying the rescale a second time', () => {
    // The legacy LUT is built as `voiLut(storedValue * slope + intercept)`. The pixels are already
    // in HU, so anything but the identity here shifts the window off the tissue it was chosen for
    // -- about -1024 HU for this image.
    const image = toLegacyImage(prescaledCt(), 'wadouri:ct/1');

    expect(image.slope).toBe(1);
    expect(image.intercept).toBe(0);
  });

  it('keeps the file own rescale values reachable', () => {
    // Normalising the pair must not lose them; they stay where Cornerstone3D records them.
    const image = toLegacyImage(prescaledCt(), 'wadouri:ct/1');

    expect(image.preScale.scalingParameters).toEqual({ rescaleSlope: 1, rescaleIntercept: -1024 });
  });

  it('leaves the transform alone when the loader did not apply it', () => {
    // `preScale.scaled` is the discriminator, not `enabled`: the decode worker only records it
    // once it has actually run the transform.
    const unscaled = { ...prescaledCt(), preScale: { enabled: true, scaled: false } };
    const image = toLegacyImage(unscaled, 'wadouri:ct/1');

    expect(image.slope).toBe(1);
    expect(image.intercept).toBe(-1024);
  });

  it('leaves the transform alone when there is no preScale at all', () => {
    const noPreScale = { ...prescaledCt() };
    delete noPreScale.preScale;
    const image = toLegacyImage(noPreScale, 'wadouri:ct/1');

    expect(image.intercept).toBe(-1024);
  });

  it('is unchanged for an image whose transform is already the identity', () => {
    // Why MR looked right the whole time: the identity applied twice is still the identity.
    const mr = { ...prescaledCt(), intercept: 0, preScale: { enabled: true, scaled: true } };
    const image = toLegacyImage(mr, 'wadouri:mr/1');

    expect(image.slope).toBe(1);
    expect(image.intercept).toBe(0);
  });

  it('rejects an image the legacy cache would choke on later', () => {
    // The legacy cache throws on a missing sizeInBytes inside a promise callback, where the
    // imageId is out of scope; failing here names the image instead.
    expect(() => toLegacyImage({ getPixelData: () => new Uint8Array(1) }, 'wadors:y'))
      .toThrow(/sizeInBytes/);
    expect(() => toLegacyImage({ sizeInBytes: 4 }, 'wadors:y')).toThrow(/getPixelData/);
    expect(() => toLegacyImage({ sizeInBytes: 4, getPixelData: () => [1, 2] }, 'wadors:y'))
      .toThrow(/typed array/);
    expect(() => toLegacyImage(undefined, 'wadors:y')).toThrow(/no image/);
  });
});

describe('legacy cache mirror', () => {
  it('raises the legacy ceiling to the Cornerstone3D one so the legacy LRU never runs first', () => {
    const cornerstone = wireLegacy(makeLegacyCornerstone());
    installLegacyCacheMirror(cornerstone);

    expect(cornerstone.imageCache.setMaximumSizeBytes).toHaveBeenCalledWith(3 * 1024 * 1024 * 1024);
  });

  it('does not rewrite the ceiling when it already matches', () => {
    // The setter fires an event and walks the cache, so writing it on every cache event would be
    // a steady drip of needless work.
    const cornerstone = wireLegacy(makeLegacyCornerstone());
    installLegacyCacheMirror(cornerstone);
    cornerstone.imageCache.setMaximumSizeBytes.mockClear();

    emitC3d('CORNERSTONE_IMAGE_CACHE_IMAGE_ADDED', { imageId: 'wadors:a' });

    expect(cornerstone.imageCache.setMaximumSizeBytes).not.toHaveBeenCalled();
  });

  it('drops the mirrored entry when Cornerstone3D evicts an image nothing is showing', () => {
    const cornerstone = wireLegacy(makeLegacyCornerstone());
    cornerstone.imageCache.imageCache['wadors:gone'] = { imageId: 'wadors:gone' };
    installLegacyCacheMirror(cornerstone);

    emitC3d('CORNERSTONE_IMAGE_CACHE_IMAGE_REMOVED', { imageId: 'wadors:gone' });

    expect(cornerstone.imageCache.removeImageLoadObject).toHaveBeenCalledWith('wadors:gone');
    expect(cornerstone.emitted.map(e => e.type)).toContain('cornerstoneimagecachepromiseremoved');
  });

  it('keeps the entry while an enabled element is still displaying that image', () => {
    // Otherwise the displayed image could be pulled out from under the element that is painting
    // it. This is the case behind "eviction never blanks a displayed 2D image".
    const cornerstone = wireLegacy(makeLegacyCornerstone());
    cornerstone.imageCache.imageCache['wadors:shown'] = { imageId: 'wadors:shown' };
    cornerstone.enabledElements = [makeElement('wadors:shown')];
    installLegacyCacheMirror(cornerstone);

    emitC3d('CORNERSTONE_IMAGE_CACHE_IMAGE_REMOVED', { imageId: 'wadors:shown' });

    expect(cornerstone.imageCache.removeImageLoadObject).not.toHaveBeenCalled();
  });

  it('ignores an eviction for something the legacy cache never mirrored', () => {
    const cornerstone = wireLegacy(makeLegacyCornerstone());
    installLegacyCacheMirror(cornerstone);

    emitC3d('CORNERSTONE_IMAGE_CACHE_IMAGE_REMOVED', { imageId: 'wadors:never-here' });

    expect(cornerstone.imageCache.removeImageLoadObject).not.toHaveBeenCalled();
  });

  it('announces an image that reached Cornerstone3D without going through the legacy path', () => {
    // A volume slice pulled in by MPR. StudyLoadingListener counts these events, so without the
    // re-emission its progress would stall.
    const cornerstone = wireLegacy(makeLegacyCornerstone());
    installLegacyCacheMirror(cornerstone);
    const image = makeC3dImage('wadors:volume-slice');

    emitC3d('CORNERSTONE_IMAGE_CACHE_IMAGE_ADDED', { image });

    expect(cornerstone.emitted.map(e => e.type)).toEqual([
      'cornerstoneimageloaded',
      'cornerstoneimagecachechanged',
    ]);
    expect(cornerstone.emitted[1].detail.action).toBe('addImage');
  });

  it('stays quiet for an image the legacy path already announced', () => {
    // Legacy loadAndCacheImage records its entry synchronously and fires its own events; a second
    // set here would double-count the image in the listeners' progress.
    const cornerstone = wireLegacy(makeLegacyCornerstone());
    cornerstone.imageCache.imageCache['wadors:via-bridge'] = { imageId: 'wadors:via-bridge' };
    installLegacyCacheMirror(cornerstone);

    emitC3d('CORNERSTONE_IMAGE_CACHE_IMAGE_ADDED', { image: makeC3dImage('wadors:via-bridge') });

    expect(cornerstone.emitted).toEqual([]);
  });

  it('defers removal while displayed, then removes it once the element moves on', () => {
    // The full sequence the mirror has to survive: Cornerstone3D evicts a slice that is on screen,
    // the user scrolls away, and the entry must be gone by the time they scroll back. Legacy
    // `loadAndCacheImage` returns an existing entry's promise BEFORE consulting any loader, so a
    // stale entry means the bridge is never called for that imageId again -- the slice is never
    // reloaded into Cornerstone3D and the legacy cache quietly becomes a second owner of pixels
    // Cornerstone3D has already released.
    const cornerstone = wireLegacy(makeLegacyCornerstone());
    cornerstone.imageCache.imageCache['wadors:slice'] = { imageId: 'wadors:slice' };
    const slice = makeElement('wadors:slice');
    cornerstone.enabledElements = [slice];
    installLegacyCacheMirror(cornerstone);

    emitC3d('CORNERSTONE_IMAGE_CACHE_IMAGE_REMOVED', { imageId: 'wadors:slice' });
    expect(cornerstone.imageCache.removeImageLoadObject).not.toHaveBeenCalled();

    // The element scrolls to another image; the next cache event is the sweep's trigger.
    slice.showImage('wadors:other');
    emitC3d('CORNERSTONE_IMAGE_CACHE_IMAGE_ADDED', { image: makeC3dImage('wadors:other') });

    expect(cornerstone.imageCache.removeImageLoadObject).toHaveBeenCalledWith('wadors:slice');
    expect(cornerstone.imageCache.imageCache['wadors:slice']).toBeUndefined();

    // Which is what lets the bridge be reached again when the user scrolls back.
    expect(cornerstone.imageCache.imageCache['wadors:slice']).toBeUndefined();
  });

  it('keeps deferring while the image is still the one on screen', () => {
    const cornerstone = wireLegacy(makeLegacyCornerstone());
    cornerstone.imageCache.imageCache['wadors:held'] = { imageId: 'wadors:held' };
    cornerstone.enabledElements = [makeElement('wadors:held')];
    installLegacyCacheMirror(cornerstone);

    emitC3d('CORNERSTONE_IMAGE_CACHE_IMAGE_REMOVED', { imageId: 'wadors:held' });
    emitC3d('CORNERSTONE_IMAGE_CACHE_IMAGE_ADDED', { image: makeC3dImage('wadors:another') });

    expect(cornerstone.imageCache.removeImageLoadObject).not.toHaveBeenCalled();
  });

  it('sweeps when the element scrolls to a neighbour that is already cached', () => {
    // The case cache events cannot catch: both slices are already in both caches, so scrolling
    // between them produces no cache activity at all. Without a signal tied to the image
    // transition the stale entry survives, and legacy loadAndCacheImage would keep returning it
    // instead of reaching the bridge.
    const cornerstone = wireLegacy(makeLegacyCornerstone());
    const enabled = makeElement('wadors:slice-1');
    cornerstone.imageCache.imageCache['wadors:slice-1'] = { imageId: 'wadors:slice-1' };
    cornerstone.enabledElements = [enabled];
    installLegacyCacheMirror(cornerstone);

    emitC3d('CORNERSTONE_IMAGE_CACHE_IMAGE_REMOVED', { imageId: 'wadors:slice-1' });
    expect(cornerstone.imageCache.removeImageLoadObject).not.toHaveBeenCalled();

    enabled.showImage('wadors:slice-2');

    expect(cornerstone.imageCache.removeImageLoadObject).toHaveBeenCalledWith('wadors:slice-1');
  });

  it('watches an element enabled after the bridge was installed', () => {
    const cornerstone = wireLegacy(makeLegacyCornerstone());
    installLegacyCacheMirror(cornerstone);

    const enabled = makeElement('wadors:later');
    cornerstone.enabledElements = [enabled];
    cornerstone.events.dispatch('cornerstoneelementenabled', { element: enabled.element });
    cornerstone.imageCache.imageCache['wadors:later'] = { imageId: 'wadors:later' };

    emitC3d('CORNERSTONE_IMAGE_CACHE_IMAGE_REMOVED', { imageId: 'wadors:later' });
    enabled.showImage('wadors:next');

    expect(cornerstone.imageCache.removeImageLoadObject).toHaveBeenCalledWith('wadors:later');
  });

  it('sweeps on teardown even though the element is still listed at that point', () => {
    // cornerstone-core 2.6.1 fires the global ELEMENT_DISABLED event BEFORE splicing the element
    // out of the enabled list, so a sweep that simply asks "is anything showing this?" during the
    // callback still sees the element being torn down and keeps the entry forever.
    const cornerstone = wireLegacy(makeLegacyCornerstone());
    const enabled = makeElement('wadors:last');
    cornerstone.imageCache.imageCache['wadors:last'] = { imageId: 'wadors:last' };
    cornerstone.enabledElements = [enabled];
    installLegacyCacheMirror(cornerstone);

    emitC3d('CORNERSTONE_IMAGE_CACHE_IMAGE_REMOVED', { imageId: 'wadors:last' });

    // Exactly the upstream order: event first, element still present.
    cornerstone.events.dispatch('cornerstoneelementdisabled', { element: enabled.element });

    expect(cornerstone.imageCache.removeImageLoadObject).toHaveBeenCalledWith('wadors:last');
  });

  it('stops watching an element once it is disabled', () => {
    const cornerstone = wireLegacy(makeLegacyCornerstone());
    const enabled = makeElement('wadors:x');
    cornerstone.enabledElements = [enabled];
    installLegacyCacheMirror(cornerstone);

    expect(enabled.element.listenerCount('cornerstonenewimage')).toBe(1);
    cornerstone.events.dispatch('cornerstoneelementdisabled', { element: enabled.element });
    expect(enabled.element.listenerCount('cornerstonenewimage')).toBe(0);
  });

  it('forgets a deferred removal that something else already performed', () => {
    const cornerstone = wireLegacy(makeLegacyCornerstone());
    cornerstone.imageCache.imageCache['wadors:raced'] = { imageId: 'wadors:raced' };
    const raced = makeElement('wadors:raced');
    cornerstone.enabledElements = [raced];
    installLegacyCacheMirror(cornerstone);

    emitC3d('CORNERSTONE_IMAGE_CACHE_IMAGE_REMOVED', { imageId: 'wadors:raced' });
    delete cornerstone.imageCache.imageCache['wadors:raced'];
    raced.showImage('wadors:elsewhere');

    // removeImageLoadObject throws on an absent id, so a blind retry would surface as a warning.
    expect(cornerstone.imageCache.removeImageLoadObject).not.toHaveBeenCalled();
  });

  it('uninstalls cleanly', () => {
    const cornerstone = wireLegacy(makeLegacyCornerstone());
    cornerstone.imageCache.imageCache['wadors:gone'] = { imageId: 'wadors:gone' };
    const uninstall = installLegacyCacheMirror(cornerstone);

    uninstall();
    emitC3d('CORNERSTONE_IMAGE_CACHE_IMAGE_REMOVED', { imageId: 'wadors:gone' });

    expect(cornerstone.imageCache.removeImageLoadObject).not.toHaveBeenCalled();
  });
});

describe('legacy metadata delegate', () => {
  it('answers from Cornerstone3D', () => {
    mockC3dMetaDataGet.mockReturnValue({ rows: 512 });

    expect(createMetadataDelegate()('imagePixelModule', 'wadors:z')).toEqual({ rows: 512 });
    expect(mockC3dMetaDataGet).toHaveBeenCalledWith('imagePixelModule', 'wadors:z');
  });

  it('returns undefined rather than throwing, so the legacy chain can fall through', () => {
    // Neither library wraps its providers in try/catch: a throwing provider aborts the whole
    // lookup instead of falling through, and this one sits at the top of the legacy chain.
    mockC3dMetaDataGet.mockImplementation(() => {
      throw new Error('provider blew up');
    });

    expect(createMetadataDelegate()('imagePixelModule', 'wadors:z')).toBeUndefined();
  });

  it('passes the imageId through untouched', () => {
    // Frame-suffix normalisation belongs to the Cornerstone3D provider; rewriting ids here would
    // give the two front doors different answers for the same image.
    mockC3dMetaDataGet.mockReturnValue(undefined);
    createMetadataDelegate()('imagePlaneModule', 'sonadorlocal:1.2.3?frame=4');

    expect(mockC3dMetaDataGet).toHaveBeenCalledWith('imagePlaneModule', 'sonadorlocal:1.2.3?frame=4');
  });

  it('registers above the legacy provider, which stays as the fallback', () => {
    const cornerstone = wireLegacy(makeLegacyCornerstone());
    const legacyProvider = { get: jest.fn() };

    registerLegacyMetadataDelegate(cornerstone, { legacyProvider });

    expect(cornerstone.providers).toHaveLength(2);
    expect(cornerstone.providers[0].priority).toBe(9999);
    expect(cornerstone.providers[1].priority).toBe(0);
    expect(cornerstone.providers[0].priority).toBeGreaterThan(cornerstone.providers[1].priority);
  });
});
