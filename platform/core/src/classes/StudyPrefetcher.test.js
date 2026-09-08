// Background prefetching has to stop before it fills the image cache, and it has to do that
// without touching the requests a user is waiting on.
//
// The gate is admission control at dispatch: an image's decoded size is estimated, checked against
// the free cache minus a reserve minus whatever already-dispatched prefetches will occupy, and the
// whole remaining batch is dropped when it does not fit. Deciding once before the batch is queued
// is not enough -- a batch drains over a long time and that decision is stale almost immediately.

const mockLegacyListeners = new Map();
const mockClearRequestStack = jest.fn();
const mockAddRequest = jest.fn();
const mockLoadAndCacheImage = jest.fn(() => Promise.resolve({}));
const mockMetaDataGet = jest.fn();
const mockGetBytesAvailable = jest.fn();

function emit(store, type) {
  [...(store.get(type) || [])].forEach(fn => fn({ type }));
}

jest.mock('cornerstone-core', () => ({
  events: {
    addEventListener: (type, fn) => {
      if (!mockLegacyListeners.has(type)) mockLegacyListeners.set(type, new Set());
      mockLegacyListeners.get(type).add(fn);
    },
    removeEventListener: (type, fn) => mockLegacyListeners.get(type)?.delete(fn),
  },
  imageLoadPoolManager: {
    clearRequestStack: (...args) => mockClearRequestStack(...args),
    addRequest: (...args) => mockAddRequest(...args),
    maxNumRequests: {},
  },
  imageCache: { imageCache: {} },
  metaData: { get: (...args) => mockMetaDataGet(...args) },
  loadAndCacheImage: (...args) => mockLoadAndCacheImage(...args),
  loadImage: jest.fn(),
  getEnabledElement: () => ({}),
}));

jest.mock('@cornerstonejs/core', () => ({
  cache: { getBytesAvailable: (...args) => mockGetBytesAvailable(...args) },
}));

import { StudyPrefetcher } from './StudyPrefetcher';

const MIB = 1024 * 1024;
// 512 x 512 monochrome. Four bytes per sample, not two: the loader can promote a rescaled frame to
// a 32-bit typed array, and the estimate reserves that upper bound.
const IMAGE_BYTES = 512 * 512 * 4;

function prefetcher(options) {
  const p = new StudyPrefetcher([], { prefetchCacheReserveBytes: 0, ...options });
  p.filterCachedImageIds = ids => ids;
  return p;
}

/** Run every request the pool was handed, in order, as the pool would. */
function drain() {
  return Promise.all(mockAddRequest.mock.calls.map(([requestFn]) => requestFn()));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLegacyListeners.clear();
  mockMetaDataGet.mockReturnValue({ rows: 512, columns: 512, samplesPerPixel: 1, bitsAllocated: 16 });
  mockGetBytesAvailable.mockReturnValue(64 * MIB);
  mockLoadAndCacheImage.mockImplementation(() => Promise.resolve({}));
});

describe('prefetch admission', () => {
  it('dispatches while there is headroom', async () => {
    const p = prefetcher();
    p.prefetchImageIds(['a', 'b', 'c']);
    await drain();

    expect(mockLoadAndCacheImage).toHaveBeenCalledTimes(3);
    expect(mockClearRequestStack).not.toHaveBeenCalled();
    p.destroy();
  });

  it('drops the rest of the batch once an image will not fit', async () => {
    // Enough for one image and no more.
    mockGetBytesAvailable.mockReturnValue(IMAGE_BYTES);
    const p = prefetcher();

    p.prefetchImageIds(['a', 'b', 'c']);
    // In-flight accounting is what makes the second request fail admission: the cache has not
    // shrunk yet, because the first image has not arrived.
    const first = mockAddRequest.mock.calls[0][0]();
    await mockAddRequest.mock.calls[1][0]();

    expect(mockLoadAndCacheImage).toHaveBeenCalledTimes(1);
    expect(mockClearRequestStack).toHaveBeenCalledWith('prefetch');
    await first;
    p.destroy();
  });

  it('keeps the reserve free', async () => {
    // Room for the image, but not once the reserve is set aside.
    mockGetBytesAvailable.mockReturnValue(IMAGE_BYTES + 1);
    const p = prefetcher({ prefetchCacheReserveBytes: 2 * IMAGE_BYTES });

    p.prefetchImageIds(['a']);
    await drain();

    expect(mockLoadAndCacheImage).not.toHaveBeenCalled();
    expect(mockClearRequestStack).toHaveBeenCalledWith('prefetch');
    p.destroy();
  });

  it('only clears the prefetch pool, leaving interaction and thumbnail requests alone', async () => {
    mockGetBytesAvailable.mockReturnValue(0);
    const p = prefetcher();

    p.prefetchImageIds(['a']);
    await drain();

    expect(mockClearRequestStack).toHaveBeenCalledTimes(1);
    expect(mockClearRequestStack).toHaveBeenCalledWith('prefetch');
    p.destroy();
  });

  it('releases in-flight bytes when a request finishes, and when it fails', async () => {
    const p = prefetcher();

    p.prefetchImageIds(['a']);
    await drain();
    expect(p._prefetchInFlightBytes).toBe(0);

    mockLoadAndCacheImage.mockImplementation(() => Promise.reject(new Error('boom')));
    mockAddRequest.mockClear();
    p.prefetchImageIds(['b']);
    await Promise.all(mockAddRequest.mock.calls.map(([fn]) => fn().catch(() => {})));

    expect(p._prefetchInFlightBytes).toBe(0);
    p.destroy();
  });

  it('stays closed rather than reopening as images are evicted', async () => {
    // The gate must not oscillate: each eviction frees a little space, and re-admitting on that
    // would restart prefetching only to stop again immediately.
    mockGetBytesAvailable.mockReturnValue(0);
    const p = prefetcher();
    p.prefetchImageIds(['a', 'b']);
    await drain();
    expect(p._prefetchGateClosed).toBe(true);

    mockGetBytesAvailable.mockReturnValue(64 * MIB);
    await mockAddRequest.mock.calls[1][0]();

    expect(mockLoadAndCacheImage).not.toHaveBeenCalled();
    p.destroy();
  });

  it('reopens on the next prefetch trigger', async () => {
    mockGetBytesAvailable.mockReturnValue(0);
    const p = prefetcher();
    p.prefetchImageIds(['a']);
    await drain();
    expect(p._prefetchGateClosed).toBe(true);

    mockGetBytesAvailable.mockReturnValue(64 * MIB);
    mockAddRequest.mockClear();
    p.prefetchImageIds(['b']);
    await drain();

    expect(p._prefetchGateClosed).toBe(false);
    expect(mockLoadAndCacheImage).toHaveBeenCalledTimes(1);
    p.destroy();
  });

  it('assumes an unknown image is expensive', async () => {
    // A pixel module the providers cannot answer must not be treated as free.
    mockMetaDataGet.mockReturnValue(undefined);
    mockGetBytesAvailable.mockReturnValue(4 * MIB);
    const p = prefetcher({ unknownImageSizeBytes: 8 * MIB });

    p.prefetchImageIds(['a']);
    await drain();

    expect(mockLoadAndCacheImage).not.toHaveBeenCalled();
    p.destroy();
  });

  it('keeps the reservation of a dispatched request when prefetching stops', async () => {
    // `stopPrefetching` empties the queue; it does not cancel a request already handed to the
    // loader. That request is still going to put an image in the cache, so its bytes stay
    // reserved -- releasing them here would let the next batch be admitted against space this one
    // is about to consume.
    mockLoadAndCacheImage.mockImplementation(() => new Promise(() => {}));
    const p = prefetcher();

    p.prefetchImageIds(['a']);
    mockAddRequest.mock.calls[0][0]();
    const reserved = p._prefetchInFlightBytes;
    expect(reserved).toBeGreaterThan(0);

    p.stopPrefetching();

    expect(p._prefetchInFlightBytes).toBe(reserved);
    p.destroy();
  });

  it('does not admit a new batch against bytes an earlier request still holds', async () => {
    // The failure this accounting exists to prevent, end to end: a trigger stops the previous
    // batch and starts another one immediately, so without a reservation that outlives its batch
    // both generations would be admitted against the same free space.
    const IMAGE = 512 * 512 * 2 * 2; // rows * columns * bytes per sample, with the safety factor
    mockGetBytesAvailable.mockReturnValue(IMAGE + IMAGE / 2);
    mockLoadAndCacheImage.mockImplementation(() => new Promise(() => {}));
    const p = prefetcher();

    // A is dispatched and is still running.
    p.prefetchImageIds(['a']);
    mockAddRequest.mock.calls[0][0]();
    expect(mockLoadAndCacheImage).toHaveBeenCalledTimes(1);

    // The next trigger stops the batch and queues another.
    p.stopPrefetching();
    mockAddRequest.mockClear();
    p.prefetchImageIds(['b']);
    await mockAddRequest.mock.calls[0][0]();

    // There is room for one image, not two, and A has not finished with its half.
    expect(mockLoadAndCacheImage).toHaveBeenCalledTimes(1);
    p.destroy();
  });

  it('releases a reservation exactly once, whether the request succeeds or fails', async () => {
    // Exactly once in both directions: releasing twice understates what is outstanding, and never
    // releasing strands the bytes. A timed-out request rejects, which is the failing case here.
    let settle;
    mockLoadAndCacheImage.mockImplementation(() => new Promise((resolve, reject) => {
      settle = { resolve, reject };
    }));
    const p = prefetcher();

    p.prefetchImageIds(['a']);
    const inFlight = mockAddRequest.mock.calls[0][0]();
    const reserved = p._prefetchInFlightBytes;
    p.stopPrefetching();

    settle.reject(new Error('the request timed out'));
    // `dispatch` releases in a `finally`, so the rejection is re-thrown to the pool.
    await expect(inFlight).rejects.toThrow('the request timed out');

    expect(p._prefetchInFlightBytes).toBe(0);

    // A second batch can now use the bytes the failed request gave back. Not awaited: the mock
    // leaves it pending, and the reservation is taken synchronously at dispatch.
    mockAddRequest.mockClear();
    p.prefetchImageIds(['b']);
    mockAddRequest.mock.calls[0][0]();
    expect(p._prefetchInFlightBytes).toBe(reserved);
    p.destroy();
  });

  it('re-dispatches the same imageId on the next trigger', async () => {
    // Scope, because the name could be read as more than it is: this covers the prefetcher's own
    // behaviour only. It does NOT show that the image loads again. Legacy `loadAndCacheImage`
    // returns an already-cached pending load object before it consults any loader, so an imageId
    // whose request never settled stays wedged at the cache level and a re-dispatch inherits the
    // same promise. Clearing that means removing a pending entry from the Cornerstone3D cache,
    // which is a separate change with its own eviction consequences; it is recorded on the issue
    // and nothing here addresses it.
    //
    // The loader mock is deliberately left never-settling across both dispatches, so nothing about
    // the wedged case is mocked away to make this pass.
    mockLoadAndCacheImage.mockImplementation(() => new Promise(() => {}));
    const p = prefetcher();

    p.prefetchImageIds(['a']);
    mockAddRequest.mock.calls[0][0]();
    p.stopPrefetching();

    mockAddRequest.mockClear();
    p.prefetchImageIds(['a']);
    mockAddRequest.mock.calls[0][0]();

    expect(mockLoadAndCacheImage).toHaveBeenCalledTimes(2);
    p.destroy();
  });

  it('still honours the legacy cache-full event', () => {
    const p = prefetcher();
    emit(mockLegacyListeners, 'cornerstoneimagecachefull.StudyPrefetcher');

    expect(mockClearRequestStack).toHaveBeenCalledWith('prefetch');
    p.destroy();
  });
});
