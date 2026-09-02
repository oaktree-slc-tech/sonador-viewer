// Unit tests for the shared `sonadorlocal:` read module (ohif-viewers#125, AR-2), focused on the
// behaviours the MR review flagged: File-memo eviction on cache removal (so "Remove Offline Copy"
// takes effect within the session) and the per-instance remote fallback (FR-10 / AC-5).

import LocalCacheService from '../services/LocalCacheService/LocalCacheService';
import {
  buildSonadorLocalImageId,
  parseSonadorLocalImageId,
  registerRemoteFallback,
  loadCachedInstanceImage,
  loadCachedInstanceImageObject,
} from './sonadorLocalImageReader';

// Node test environment: shim the DOM mirror inside PubSubService._broadcastEvent (see
// LocalCacheService.test.js for the rationale).
global.CustomEvent = global.CustomEvent || class CustomEvent {
  constructor(type, params = {}) {
    this.type = type;
    this.detail = params.detail;
  }
};
global.document = global.document || { body: { dispatchEvent: () => {} } };
// The reader materialises cached bytes into an ephemeral File before handing it to the wado
// fileManager; this node version has no File global.
global.File = global.File || class File {
  constructor(bits, name, options = {}) {
    this.bits = bits;
    this.name = name;
    this.type = options.type;
  }
};

function makeFakeWadoLoader() {
  let nextIndex = 0;
  return {
    fileManager: {
      add: jest.fn(() => `dicomfile:${nextIndex++}`),
      remove: jest.fn(),
    },
    loadImage: jest.fn(() => ({
      promise: Promise.resolve({ decoded: true }),
      cancelFn: jest.fn(),
      // The real wadouri loader's decache is dataSetCacheManager.unload(<dicomfile url>).
      decache: jest.fn(),
    })),
  };
}

describe('sonadorLocalImageReader', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('round-trips imageIds with and without a frame', () => {
    expect(parseSonadorLocalImageId(buildSonadorLocalImageId('1.2.3'))).toEqual({
      SOPInstanceUID: '1.2.3',
      frame: undefined,
    });
    expect(parseSonadorLocalImageId(buildSonadorLocalImageId('1.2.3', 4))).toEqual({
      SOPInstanceUID: '1.2.3',
      frame: 4,
    });
  });

  it('memoises the materialised File per SOP and re-uses it across loads', async () => {
    jest.spyOn(LocalCacheService, 'getInstanceBytes').mockResolvedValue(new ArrayBuffer(16));
    const wadoImageLoader = makeFakeWadoLoader();
    const imageId = buildSonadorLocalImageId('sop-memo-1');

    const image = await loadCachedInstanceImage(imageId, {}, { version: 'v3', wadoImageLoader });
    await loadCachedInstanceImage(imageId, {}, { version: 'v3', wadoImageLoader });

    expect(wadoImageLoader.fileManager.add).toHaveBeenCalledTimes(1);
    // The decoded image is presented under the requested sonadorlocal: id.
    expect(image.imageId).toBe(imageId);
  });

  it('evicts the File memo when the instance is removed from the cache (Critical #2 / AC-5)', async () => {
    jest.spyOn(LocalCacheService, 'getInstanceBytes').mockResolvedValue(new ArrayBuffer(16));
    const wadoImageLoader = makeFakeWadoLoader();
    const imageId = buildSonadorLocalImageId('sop-evict-1');

    await loadCachedInstanceImage(imageId, {}, { version: 'v3', wadoImageLoader });
    expect(wadoImageLoader.fileManager.add).toHaveBeenCalledTimes(1);

    // Broadcasts INSTANCE_REMOVED, which the reader module subscribes to at module scope.
    await LocalCacheService.removeInstance('study-x', 'series-x', 'sop-evict-1');

    // The fileManager slot was handed back...
    expect(wadoImageLoader.fileManager.remove).toHaveBeenCalledTimes(1);
    // ...and the next load materialises a fresh File instead of serving the stale memo.
    await loadCachedInstanceImage(imageId, {}, { version: 'v3', wadoImageLoader });
    expect(wadoImageLoader.fileManager.add).toHaveBeenCalledTimes(2);
  });

  it('clearAll evicts every memoised File (CACHE_CLEARED)', async () => {
    jest.spyOn(LocalCacheService, 'getInstanceBytes').mockResolvedValue(new ArrayBuffer(16));
    // The memo maps are module-level; flush entries leaked by earlier tests before counting.
    await LocalCacheService.clearAll();
    const wadoImageLoader = makeFakeWadoLoader();

    await loadCachedInstanceImage(buildSonadorLocalImageId('sop-clear-1'), {}, { version: 'v3', wadoImageLoader });
    await loadCachedInstanceImage(buildSonadorLocalImageId('sop-clear-2'), {}, { version: 'v3', wadoImageLoader });

    await LocalCacheService.clearAll();

    expect(wadoImageLoader.fileManager.remove).toHaveBeenCalledTimes(2);
  });

  it('falls back to the registered remote imageId on a cache miss (FR-10)', async () => {
    jest.spyOn(LocalCacheService, 'getInstanceBytes').mockResolvedValue(null);
    const wadoImageLoader = makeFakeWadoLoader();
    const remoteLoad = jest.fn().mockResolvedValue({ fromRemote: true });

    registerRemoteFallback('sop-fallback-1', 'wadors:https://example/instances/sop-fallback-1');
    const result = await loadCachedInstanceImage(
      buildSonadorLocalImageId('sop-fallback-1'),
      { opt: 1 },
      { version: 'v3', wadoImageLoader, remoteLoad }
    );

    expect(remoteLoad).toHaveBeenCalledWith('wadors:https://example/instances/sop-fallback-1', { opt: 1 });
    expect(result).toEqual({ fromRemote: true });
    expect(wadoImageLoader.fileManager.add).not.toHaveBeenCalled();
  });

  it('throws on a cache miss with no registered fallback', async () => {
    jest.spyOn(LocalCacheService, 'getInstanceBytes').mockResolvedValue(null);
    const wadoImageLoader = makeFakeWadoLoader();

    await expect(
      loadCachedInstanceImage(buildSonadorLocalImageId('sop-orphan-1'), {}, { version: 'v3', wadoImageLoader })
    ).rejects.toThrow('no remote fallback');
  });
});

// The Cornerstone3D loader contract is `{ promise, cancelFn?, decache? }`.
// `cache.removeImageLoadObject` calls decache() on eviction and `imageLoader.cancelLoadImage` calls
// cancelFn(); without them the parsed DataSet the wadouri pipeline built stays in
// dataSetCacheManager under its `dicomfile:` key for the life of the session.
describe('sonadorLocalImageReader load object', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns promise, cancelFn and decache', async () => {
    jest.spyOn(LocalCacheService, 'getInstanceBytes').mockResolvedValue(new ArrayBuffer(16));
    const wadoImageLoader = makeFakeWadoLoader();

    const loadObject = loadCachedInstanceImageObject(
      buildSonadorLocalImageId('sop-loadobj-1'),
      {},
      { version: 'v3', wadoImageLoader }
    );

    expect(typeof loadObject.promise.then).toBe('function');
    expect(typeof loadObject.cancelFn).toBe('function');
    expect(typeof loadObject.decache).toBe('function');
    await expect(loadObject.promise).resolves.toMatchObject({ decoded: true });
  });

  it('decache releases the delegate DataSet exactly once, however often it is called', async () => {
    jest.spyOn(LocalCacheService, 'getInstanceBytes').mockResolvedValue(new ArrayBuffer(16));
    const wadoImageLoader = makeFakeWadoLoader();

    const loadObject = loadCachedInstanceImageObject(
      buildSonadorLocalImageId('sop-decache-1'),
      {},
      { version: 'v3', wadoImageLoader }
    );
    await loadObject.promise;

    const delegate = wadoImageLoader.loadImage.mock.results[0].value;

    loadObject.decache();
    loadObject.decache();

    // dataSetCacheManager.unload() decrements a reference count upstream does not floor at zero.
    expect(delegate.decache).toHaveBeenCalledTimes(1);
    // The last holder of the File went away, so the fileManager slot is handed back too.
    expect(wadoImageLoader.fileManager.remove).toHaveBeenCalledTimes(1);
  });

  it('keeps the shared File until the last frame of a multiframe instance is decached', async () => {
    jest.spyOn(LocalCacheService, 'getInstanceBytes').mockResolvedValue(new ArrayBuffer(16));
    const wadoImageLoader = makeFakeWadoLoader();
    const deps = { version: 'v3', wadoImageLoader };

    const frame0 = loadCachedInstanceImageObject(buildSonadorLocalImageId('sop-mf-1', 0), {}, deps);
    const frame1 = loadCachedInstanceImageObject(buildSonadorLocalImageId('sop-mf-1', 1), {}, deps);
    await Promise.all([frame0.promise, frame1.promise]);

    // One File, one fileManager slot, shared by both frames.
    expect(wadoImageLoader.fileManager.add).toHaveBeenCalledTimes(1);

    frame0.decache();
    expect(wadoImageLoader.fileManager.remove).not.toHaveBeenCalled();

    frame1.decache();
    expect(wadoImageLoader.fileManager.remove).toHaveBeenCalledTimes(1);
  });

  it('forwards cancelFn to the delegate load object', async () => {
    jest.spyOn(LocalCacheService, 'getInstanceBytes').mockResolvedValue(new ArrayBuffer(16));
    const wadoImageLoader = makeFakeWadoLoader();

    const loadObject = loadCachedInstanceImageObject(
      buildSonadorLocalImageId('sop-cancel-1'),
      {},
      { version: 'v3', wadoImageLoader }
    );
    await loadObject.promise;

    loadObject.cancelFn();

    expect(wadoImageLoader.loadImage.mock.results[0].value.cancelFn).toHaveBeenCalledTimes(1);
  });

  it('releases resources acquired after an early decache (deferred read)', async () => {
    // The eviction arrives while the IndexedDB read is still pending, so there is no delegate and
    // no File hold to act on. The load then resumes and acquires both. Without replaying the
    // intent, the DataSet and the fileManager slot are retained for the session -- on exactly the
    // pending-eviction path decache exists to handle.
    let releaseBytes;
    jest.spyOn(LocalCacheService, 'getInstanceBytes').mockReturnValue(
      new Promise(resolve => { releaseBytes = () => resolve(new ArrayBuffer(16)); })
    );
    const wadoImageLoader = makeFakeWadoLoader();

    const loadObject = loadCachedInstanceImageObject(
      buildSonadorLocalImageId('sop-deferred-decache'),
      {},
      { version: 'v3', wadoImageLoader }
    );

    // Evict before the bytes land.
    loadObject.decache();

    releaseBytes();
    await loadObject.promise;

    const delegate = wadoImageLoader.loadImage.mock.results[0].value;
    expect(delegate.decache).toHaveBeenCalledTimes(1);
    expect(wadoImageLoader.fileManager.remove).toHaveBeenCalledTimes(1);

    // And still exactly once if the consumer calls again afterwards.
    loadObject.decache();
    expect(delegate.decache).toHaveBeenCalledTimes(1);
    expect(wadoImageLoader.fileManager.remove).toHaveBeenCalledTimes(1);
  });

  it('releases the remote delegate after an early decache (deferred read, cache miss)', async () => {
    // The sibling of the test above, on the other branch. The eviction still arrives while the
    // read is pending, but the read then resolves to a miss, so the resources acquired afterwards
    // belong to the remote fallback rather than to a local File. That branch adopts the delegate
    // and returns its promise in one step, so the release has to happen at adoption.
    let releaseBytes;
    jest.spyOn(LocalCacheService, 'getInstanceBytes').mockReturnValue(
      new Promise(resolve => { releaseBytes = () => resolve(null); })
    );
    const remoteLoadObject = {
      promise: Promise.resolve({ fromRemote: true }),
      cancelFn: jest.fn(),
      decache: jest.fn(),
    };
    registerRemoteFallback('sop-deferred-miss', 'wadors:https://example/instances/sop-deferred-miss');

    const loadObject = loadCachedInstanceImageObject(
      buildSonadorLocalImageId('sop-deferred-miss'),
      {},
      { version: 'v3', wadoImageLoader: makeFakeWadoLoader(), remoteLoad: () => remoteLoadObject }
    );

    // Evict before the read resolves, i.e. before the remote delegate exists.
    loadObject.decache();

    releaseBytes();
    await loadObject.promise;

    expect(remoteLoadObject.decache).toHaveBeenCalledTimes(1);

    // And still exactly once if the consumer calls again afterwards.
    loadObject.decache();
    expect(remoteLoadObject.decache).toHaveBeenCalledTimes(1);
  });

  it('forwards a cancel raised before the delegate existed', async () => {
    let releaseBytes;
    jest.spyOn(LocalCacheService, 'getInstanceBytes').mockReturnValue(
      new Promise(resolve => { releaseBytes = () => resolve(new ArrayBuffer(16)); })
    );
    const wadoImageLoader = makeFakeWadoLoader();

    const loadObject = loadCachedInstanceImageObject(
      buildSonadorLocalImageId('sop-deferred-cancel'),
      {},
      { version: 'v3', wadoImageLoader }
    );

    loadObject.cancelFn();

    releaseBytes();
    await loadObject.promise;

    expect(wadoImageLoader.loadImage.mock.results[0].value.cancelFn).toHaveBeenCalledTimes(1);
  });

  it('forwards cancel/decache to the remote fallback load object on a cache miss', async () => {
    jest.spyOn(LocalCacheService, 'getInstanceBytes').mockResolvedValue(null);
    const wadoImageLoader = makeFakeWadoLoader();
    const remoteLoadObject = {
      promise: Promise.resolve({ fromRemote: true }),
      cancelFn: jest.fn(),
      decache: jest.fn(),
    };

    registerRemoteFallback('sop-fallback-obj', 'wadors:https://example/instances/sop-fallback-obj');
    const loadObject = loadCachedInstanceImageObject(
      buildSonadorLocalImageId('sop-fallback-obj'),
      {},
      { version: 'v3', wadoImageLoader, remoteLoad: () => remoteLoadObject }
    );

    await expect(loadObject.promise).resolves.toEqual({ fromRemote: true });

    loadObject.cancelFn();
    loadObject.decache();

    expect(remoteLoadObject.cancelFn).toHaveBeenCalledTimes(1);
    expect(remoteLoadObject.decache).toHaveBeenCalledTimes(1);
    // No File was materialised, so no fileManager slot to release.
    expect(wadoImageLoader.fileManager.remove).not.toHaveBeenCalled();
  });

  it('still accepts a remoteLoad that resolves to a bare promise (legacy adapter shape)', async () => {
    jest.spyOn(LocalCacheService, 'getInstanceBytes').mockResolvedValue(null);
    const wadoImageLoader = makeFakeWadoLoader();

    registerRemoteFallback('sop-fallback-bare', 'wadors:https://example/instances/sop-fallback-bare');
    const image = await loadCachedInstanceImage(
      buildSonadorLocalImageId('sop-fallback-bare'),
      {},
      {
        version: 'v2',
        wadoImageLoader,
        remoteLoad: () => Promise.resolve({ fromRemote: true }),
      }
    );

    expect(image).toEqual({ fromRemote: true });
  });
});
