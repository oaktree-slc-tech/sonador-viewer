// Unit tests for the shared `sonadorlocal:` read module (ohif-viewers#125, AR-2), focused on the
// behaviours the MR review flagged: File-memo eviction on cache removal (so "Remove Offline Copy"
// takes effect within the session) and the per-instance remote fallback (FR-10 / AC-5).

import LocalCacheService from '../services/LocalCacheService/LocalCacheService';
import {
  buildSonadorLocalImageId,
  parseSonadorLocalImageId,
  registerRemoteFallback,
  loadCachedInstanceImage,
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
    loadImage: jest.fn(() => ({ promise: Promise.resolve({ decoded: true }) })),
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
