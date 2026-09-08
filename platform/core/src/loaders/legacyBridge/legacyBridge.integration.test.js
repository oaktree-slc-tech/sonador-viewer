// The parts of the bridge's behaviour that only the real dependency can demonstrate.
//
// Everything here runs against the installed `cornerstone-core@2.6.1` -- its real image cache, its
// real `loadAndCacheImage`, and its real display-LUT construction. Nothing is transcribed into a
// double, which is the point: the sibling suite mocks the library to observe which functions the
// bridge calls, and a mock cannot show what the library then does with what it was given.
//
// `@cornerstonejs/*` cannot be exercised the same way here. Those packages ship ESM behind an
// `exports` map with no `require` or `default` condition, so jest's CommonJS resolver cannot reach
// them, and their subpaths are not exported at all. What that leaves uncovered is stated at the
// bottom of this file and in the MR.

// `platform/core/src/__mocks__/cornerstone-core.js` is applied automatically to every test in this
// package -- a `__mocks__` directory inside a jest root replaces a node module without anyone
// asking. Opting out is the whole point of this file.
jest.unmock('cornerstone-core');

// `cornerstone-core` ships as a UMD bundle that reads a global `window` when it is evaluated, and
// this project has no jsdom environment installed. Three globals are enough for the parts used
// here -- the cache, the loader registry and the LUT builder never touch a real canvas -- and a
// shim keeps this from turning into a dependency change. `require` rather than `import`, because
// the shim has to be in place before the module is evaluated and imports are hoisted.
// A plain object, not `global` itself: aliasing the global object to `window` makes it
// self-referential and the jest worker dies trying to serialise it.
//
// Node supplies `EventTarget` and `Event`, which is enough to give cornerstone-core the event
// plumbing it needs -- `triggerEvent` builds a `CustomEvent` and dispatches it, and the cache
// announces every add and removal that way.
class ShimCustomEvent extends Event {
  constructor(type, options = {}) {
    super(type, options);
    this.detail = options.detail === undefined ? null : options.detail;
  }
}

global.CustomEvent = global.CustomEvent || ShimCustomEvent;
global.window = {
  CustomEvent: global.CustomEvent,
  addEventListener: () => {},
  removeEventListener: () => {},
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  devicePixelRatio: 1,
};
global.document = {
  createElement: () => {
    const element = new EventTarget();
    element.style = {};
    element.getContext = () => null;
    return element;
  },
};
global.navigator = global.navigator || { userAgent: 'node' };

const csModule = require('cornerstone-core');
// The UMD bundle exports its API as named exports; babel's interop can also surface it as
// `default`, so take whichever carries the real functions.
const cornerstone = typeof csModule.generateLut === 'function' ? csModule : csModule.default;
const toLegacyImage = require('./toLegacyImage').default;

/** A CT frame as the Cornerstone3D loader hands it over: already rescaled to Hounsfield units. */
function prescaledCtImage(imageId = 'ct:1') {
  const pixelData = new Int16Array([-1024, -100, 0, 40, 200, 1000, 3071]);

  return {
    imageId,
    // The file's own values. The loader reports these even though it has already applied them.
    slope: 1,
    intercept: -1024,
    // Post-scale, as the decode worker reports them.
    minPixelValue: -1024,
    maxPixelValue: 3071,
    // Soft tissue, expressed in the same Hounsfield units as the pixels.
    windowCenter: 40,
    windowWidth: 400,
    sizeInBytes: pixelData.byteLength,
    getPixelData: () => pixelData,
    rows: 1,
    columns: 7,
    color: false,
    preScale: {
      enabled: true,
      scaled: true,
      scalingParameters: { rescaleSlope: 1, rescaleIntercept: -1024 },
    },
  };
}

/** Where a Hounsfield value lands in the LUT `generateLut` returns. */
function displayValueFor(lut, image, hounsfield) {
  const offset = Math.min(image.minPixelValue, 0);
  return lut[hounsfield - offset];
}

describe('the display LUT the legacy renderer builds', () => {
  // This is the rendering contract, not a field comparison: `cornerstone.generateLut` is the real
  // function every legacy render path goes through -- study-drawer previews, viewer thumbnails and
  // the classic 2D viewport.
  const WINDOW_WIDTH = 400;
  const WINDOW_CENTER = 40;

  it('puts the middle of the window in the middle of the display range', () => {
    const image = toLegacyImage(prescaledCtImage(), 'ct:1');
    const lut = cornerstone.generateLut(image, WINDOW_WIDTH, WINDOW_CENTER, false);

    // 40 HU is the centre of a soft-tissue window, so it must render mid-grey.
    expect(displayValueFor(lut, image, 40)).toBe(128);

    // And the ends of the range still saturate.
    expect(displayValueFor(lut, image, -1000)).toBe(0);
    expect(displayValueFor(lut, image, 1000)).toBe(255);
  });

  it('renders that window as black without the reconciliation', () => {
    // The defect, against the real LUT. The image is identical except that the transform has not
    // been neutralised, which is what the bridge shipped before: `generateLut` then computes
    // `40 * 1 + (-1024)`, so soft tissue is 1024 HU below the window and everything in it is
    // black. This is what CT previews and thumbnails looked like.
    const unreconciled = prescaledCtImage();
    const lut = cornerstone.generateLut(unreconciled, WINDOW_WIDTH, WINDOW_CENTER, false);

    expect(displayValueFor(lut, unreconciled, 40)).toBe(0);
    expect(displayValueFor(lut, unreconciled, 200)).toBe(0);
  });

  it('is unchanged for an image whose transform was already the identity', () => {
    // Why MR was unaffected: reconciled and unreconciled produce the same LUT.
    const mr = { ...prescaledCtImage('mr:1'), intercept: 0 };
    const reconciled = toLegacyImage({ ...mr }, 'mr:1');

    expect(Array.from(cornerstone.generateLut(reconciled, 400, 40, false)))
      .toEqual(Array.from(cornerstone.generateLut({ ...mr }, 400, 40, false)));
  });
});

describe('the view the bridge hands to the legacy stack', () => {
  it('shares the pixel array with the Cornerstone3D image', () => {
    // AR-2's invariant. A view is only useful if it costs nothing.
    const c3dImage = prescaledCtImage();
    const legacy = toLegacyImage(c3dImage, 'ct:1');

    expect(Object.is(legacy.getPixelData(), c3dImage.getPixelData())).toBe(true);
  });

  it('leaves the Cornerstone3D image holding the file own rescale values', () => {
    const c3dImage = prescaledCtImage();
    const legacy = toLegacyImage(c3dImage, 'ct:1');

    expect(legacy.slope).toBe(1);
    expect(legacy.intercept).toBe(0);
    expect(c3dImage.slope).toBe(1);
    expect(c3dImage.intercept).toBe(-1024);
  });

  it('keeps the legacy renderer own writes off the cached image', () => {
    // `generateLut` caches onto whatever it is given. On the shared object that would be a write
    // into the Cornerstone3D cache entry from a thumbnail render.
    const c3dImage = prescaledCtImage();
    const legacy = toLegacyImage(c3dImage, 'ct:1');

    cornerstone.generateLut(legacy, 400, 40, false);

    expect(legacy.cachedLut).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(c3dImage, 'cachedLut')).toBe(false);
  });
});

describe('a legacy render after Cornerstone3D has already rendered on the CPU', () => {
  // The sequence that shows a prototype alone is not isolation. Cornerstone3D's CPU fallback
  // builds the same `cachedLut` structure that legacy cornerstone does, so by the time a thumbnail
  // is drawn the cached image can already own one -- and `generateLut` allocates only when it
  // finds `undefined`.

  /** A LUT of the shape Cornerstone3D's CPU renderer would have left behind, for a lung window. */
  function seedCornerstone3dLut(image) {
    image.cachedLut = {
      lutArray: new Uint8ClampedArray(image.maxPixelValue - Math.min(image.minPixelValue, 0) + 1),
      windowWidth: 1500,
      windowCenter: -600,
      invert: false,
    };
    return image;
  }

  it('builds its LUT on the view, leaving the Cornerstone3D one untouched', () => {
    const c3dImage = seedCornerstone3dLut(prescaledCtImage());
    const c3dLut = c3dImage.cachedLut;
    const c3dLutArray = c3dLut.lutArray;

    const legacy = toLegacyImage(c3dImage, 'ct:1');
    cornerstone.generateLut(legacy, 400, 40, false);

    // The legacy renderer allocated its own.
    expect(legacy.cachedLut).toBeDefined();
    expect(legacy.cachedLut).not.toBe(c3dLut);

    // And Cornerstone3D's is exactly as it was -- same object, same array, same window state.
    expect(c3dImage.cachedLut).toBe(c3dLut);
    expect(c3dLut.lutArray).toBe(c3dLutArray);
    expect(c3dLut.windowWidth).toBe(1500);
    expect(c3dLut.windowCenter).toBe(-600);
    expect(c3dLutArray.every(value => value === 0)).toBe(true);
  });

  it('would write through the prototype without the shadow', () => {
    // The control: the same view without the `cachedLut` boundary, which is what the adapter did
    // before. `generateLut` finds the inherited object, skips allocating, and fills the
    // Cornerstone3D image's own array with a window it knows nothing about.
    const c3dImage = seedCornerstone3dLut(prescaledCtImage());
    const c3dLutArray = c3dImage.cachedLut.lutArray;

    const naiveView = Object.create(c3dImage);
    naiveView.slope = 1;
    naiveView.intercept = 0;

    cornerstone.generateLut(naiveView, 400, 40, false);

    expect(naiveView.cachedLut).toBe(c3dImage.cachedLut);
    expect(c3dLutArray.every(value => value === 0)).toBe(false);
  });

  it('gives the render timings their own home as well', () => {
    // `image.stats = image.stats || {}` keeps an inherited object, and the render functions then
    // time themselves into it. Shadowed for the same reason as the LUT.
    const c3dImage = prescaledCtImage();
    c3dImage.stats = { lastRenderTime: 12 };

    const legacy = toLegacyImage(c3dImage, 'ct:1');

    expect(Object.prototype.hasOwnProperty.call(legacy, 'stats')).toBe(true);
    expect(legacy.stats).toBeUndefined();
    expect(c3dImage.stats).toEqual({ lastRenderTime: 12 });
  });
});

describe('what a rejected request does to the legacy cache', () => {
  // The half of the timeout sequence this harness can actually run: a bounded request that stalls
  // rejects, and this is what the real cache then does with it.
  const SCHEME = 'bridgeintegration';
  let loader;

  beforeEach(() => {
    loader = jest.fn();
    cornerstone.registerImageLoader(SCHEME, (imageId, options) => loader(imageId, options));
  });

  function idFor(name) {
    return `${SCHEME}:${name}`;
  }

  it('drops the entry, so the same imageId reaches the loader again', async () => {
    const imageId = idFor('rejects');
    loader.mockImplementation(() => ({
      promise: Promise.reject(new Error('the request timed out')),
      cancelFn: () => {},
      decache: () => {},
    }));

    await expect(cornerstone.loadAndCacheImage(imageId)).rejects.toThrow('the request timed out');
    // Let the cache's own rejection handler run.
    await Promise.resolve();

    expect(cornerstone.imageCache.imageCache[imageId]).toBeUndefined();

    cornerstone.loadAndCacheImage(imageId).catch(() => {});
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('holds the imageId for good while a request stays pending', async () => {
    // The failure the timeout exists to prevent, against the real cache: nothing settles, the
    // entry stays, and every later request is handed the same promise instead of reaching the
    // loader. This is why the timeout is not optional.
    const imageId = idFor('never-settles');
    loader.mockImplementation(() => ({
      promise: new Promise(() => {}),
      cancelFn: () => {},
      decache: () => {},
    }));

    const first = cornerstone.loadAndCacheImage(imageId);
    const second = cornerstone.loadAndCacheImage(imageId);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(cornerstone.imageCache.imageCache[imageId]).toBeDefined();
  });
});
