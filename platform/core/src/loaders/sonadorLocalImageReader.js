// Shared read logic for the `sonadorlocal:` local-cache image scheme (ohif-viewers#125, AR-2).
//
// This module is the SINGLE place that knows how to (a) build/parse a `sonadorlocal:` imageId and
// (b) turn a cached instance's Part10 bytes into a decoded Cornerstone image. Both the
// Cornerstone3D (v3) and legacy cornerstone-core (v2) loader registrations delegate here, passing in
// their own package's WADO image loader so the ONLY thing that differs between the two is the thin
// adapter that satisfies each package's exact return-object shape — the storage-read logic is not
// duplicated (AR-2).
//
// Decode strategy: cached bytes are materialised into an ephemeral in-memory File and handed to the
// respective `@cornerstonejs/dicom-image-loader` / `cornerstone-wado-image-loader` `wadouri`
// pipeline. The persistent artefact is the IndexedDB Part10 bytes; the blob/File is recreated per
// session, so nothing depends on blob-URL survival across reloads (contrast DicomLocalDataSource.js,
// AR-5). The per-SOP File imageId is memoised so repeated renders/scrolls of the same instance reuse
// one blob instead of leaking a new one each frame request.

import LocalCacheService from '../services/LocalCacheService/LocalCacheService';

export const SONADOR_LOCAL_SCHEME = 'sonadorlocal';

/**
 * Build a `sonadorlocal:` imageId for an instance (optionally a specific frame).
 * Frame convention matches getImageId.js's remote `&frame=` (the frame index passed by StackManager).
 */
export function buildSonadorLocalImageId(SOPInstanceUID, frame) {
  if (frame === undefined || frame === null) {
    return `${SONADOR_LOCAL_SCHEME}:${SOPInstanceUID}`;
  }
  return `${SONADOR_LOCAL_SCHEME}:${SOPInstanceUID}?frame=${frame}`;
}

/** Parse a `sonadorlocal:` imageId back into { SOPInstanceUID, frame }. */
export function parseSonadorLocalImageId(imageId) {
  // Strip the scheme (`sonadorlocal:`) only — SOPInstanceUIDs contain dots but never colons.
  const withoutScheme = imageId.substring(imageId.indexOf(':') + 1);
  const [sop, query] = withoutScheme.split('?');

  let frame;
  if (query) {
    const match = query.match(/frame=(\d+)/);
    if (match) {
      frame = parseInt(match[1], 10);
    }
  }
  return { SOPInstanceUID: sop, frame };
}

// SOPInstanceUID -> remote imageId that getImageId() would have produced. Populated by the FR-2
// imageId-selection hook so that a cache miss (evicted/corrupted entry) can fall back to the remote
// loader per-instance without failing the viewport or reloading the page (FR-10 / AC-2 / AC-5).
//
// Deliberately NOT cleared on INSTANCE_REMOVED: OHIFInstanceMetadata memoises `sonadorlocal:`
// imageIds for the session, so after "Remove Offline Copy" this map is exactly what routes those
// still-live ids back to the network (AC-5). Growth is bounded by the cached instances actually
// viewed in a session, and entries are two strings.
const _remoteFallbackBySop = new Map();

export function registerRemoteFallback(SOPInstanceUID, remoteImageId) {
  if (SOPInstanceUID && remoteImageId) {
    _remoteFallbackBySop.set(SOPInstanceUID, remoteImageId);
  }
}

export function getRemoteFallback(SOPInstanceUID) {
  return _remoteFallbackBySop.get(SOPInstanceUID);
}

// SOPInstanceUID -> ephemeral `dicomfile:` imageId produced by a wado fileManager. Keyed per wado
// package (v2 vs v3 fileManagers are independent) so both adapters can memoise safely.
const _fileImageIdCache = {
  v2: new Map(),
  v3: new Map(),
};

// The wado loader namespace each version's adapter last passed in, captured so eviction can hand
// the memoised File slot back to that package's fileManager. A memo entry can only exist after
// `loadCachedInstanceImage` ran (which captures the loader), so eviction always finds it here.
const _wadoLoaderByVersion = {
  v2: null,
  v3: null,
};

// (version -> SOPInstanceUID -> count) of live load objects that are holding the memoised File for
// an instance. A multiframe instance produces one load object per frame, all sharing one File, so
// the fileManager slot is handed back only when the last of them is decached.
const _fileHolders = {
  v2: new Map(),
  v3: new Map(),
};

function _acquireFileHold(version, SOPInstanceUID) {
  const holders = _fileHolders[version];
  holders.set(SOPInstanceUID, (holders.get(SOPInstanceUID) || 0) + 1);
}

function _releaseFileHold(version, SOPInstanceUID) {
  const holders = _fileHolders[version];
  const remaining = (holders.get(SOPInstanceUID) || 0) - 1;

  if (remaining > 0) {
    holders.set(SOPInstanceUID, remaining);
    return;
  }

  holders.delete(SOPInstanceUID);

  const fileImageId = _fileImageIdCache[version].get(SOPInstanceUID);
  if (fileImageId) {
    _releaseFileImageId(version, fileImageId);
    _fileImageIdCache[version].delete(SOPInstanceUID);
  }
}

function _releaseFileImageId(version, fileImageId) {
  const fileManager = _wadoLoaderByVersion[version]?.fileManager;
  if (!fileManager || typeof fileManager.remove !== 'function') {
    return;
  }
  // fileManager ids are `dicomfile:<index>`; remove() frees the File reference at that index.
  // Targeted remove only — purge() would also drop Files added by the local-upload flow.
  const index = parseInt(fileImageId.substring(fileImageId.indexOf(':') + 1), 10);
  if (!isNaN(index)) {
    fileManager.remove(index);
  }
}

function _releaseLoadObjectResources(state, version, SOPInstanceUID) {
  // Release whatever this load object currently holds. Idempotent per resource rather than behind
  // one latch, because a decache can arrive BEFORE the resources exist: the IndexedDB read is
  // still pending, there is no delegate and no File hold, and the call has nothing to act on. The
  // load then resumes and acquires both. This is called again at that point, so the release lands
  // exactly once whichever order the two happen in.
  if (state.delegate && !state.delegateDecached) {
    state.delegateDecached = true;

    try {
      // The wadouri delegate's own decache is exactly
      // `dataSetCacheManager.unload(<dicomfile url for this instance>)`. Upstream decrements a
      // reference count it does not floor at zero, so this must not run twice.
      state.delegate.decache?.();
    } catch (error) {
      console.warn(`[sonadorlocal] Error releasing DataSet for ${SOPInstanceUID}.`, error);
    }
  }

  if (state.holdsFile) {
    state.holdsFile = false;
    _releaseFileHold(version, SOPInstanceUID);
  }
}

/**
 * Record the load object a delegate loader returned, so the `sonadorlocal:` load object can forward
 * `cancelFn`/`decache` to it, and hand back its promise.
 *
 * Both shapes are accepted: the wado loaders and the Cornerstone3D image loader return a
 * `{ promise, cancelFn?, decache? }` load object, while the legacy v2 adapter passes a `remoteLoad`
 * that resolves to a bare promise. A bare promise simply leaves the delegate slot empty.
 */
function _adoptDelegate(result, state) {
  if (result && typeof result.then !== 'function' && typeof result.promise?.then === 'function') {
    if (state) {
      state.delegate = result;

      // A cancel raised while the read was still pending had no delegate to forward to; do it now.
      if (state.cancelled) {
        try {
          result.cancelFn?.();
        } catch (error) {
          console.warn('[sonadorlocal] Error cancelling load object.', error);
        }
      }

      // Likewise an eviction raised while the read was pending. Replaying it here rather than
      // after the load settles is what covers the cache-miss path: that branch adopts the remote
      // delegate and returns its promise in one step, so it never reaches a later release point.
      if (state.decached) {
        _releaseLoadObjectResources(state, state.version, state.SOPInstanceUID);
      }
    }
    return result.promise;
  }

  return result;
}

/**
 * Core shared read+decode. Returns a Promise resolving to a decoded Cornerstone image for the given
 * `sonadorlocal:` imageId, using the supplied wado loader. On a cache miss it delegates to
 * `remoteLoad(remoteImageId, options)` when a fallback was registered, otherwise throws.
 *
 * @param {string} imageId - the `sonadorlocal:` imageId being requested
 * @param {object} options - Cornerstone image-load options, passed through to the wado loader
 * @param {object} deps
 * @param {'v2'|'v3'} deps.version - which fileManager cache to use
 * @param {object} deps.wadoImageLoader - the package's `wadouri` namespace (fileManager + loadImage)
 * @param {(remoteImageId: string, options: object) => Promise<any>} [deps.remoteLoad] - fallback
 * @param {object} [state] - mutable slot for the delegate load object and the File hold
 * @returns {Promise<any>} decoded image
 */
async function _loadCachedInstanceImage(imageId, options, { version, wadoImageLoader, remoteLoad }, state) {
  const { SOPInstanceUID, frame } = parseSonadorLocalImageId(imageId);

  let bytes = null;
  try {
    bytes = await LocalCacheService.getInstanceBytes(SOPInstanceUID);
  } catch (error) {
    console.warn(`[sonadorlocal] Error reading cached bytes for ${SOPInstanceUID}.`, error);
    bytes = null;
  }

  if (!bytes) {
    // FR-10: graceful per-instance fallback to the remote loader.
    const remoteImageId = getRemoteFallback(SOPInstanceUID);
    if (remoteImageId && typeof remoteLoad === 'function') {
      return _adoptDelegate(remoteLoad(remoteImageId, options), state);
    }
    throw new Error(
      `[sonadorlocal] Cache miss for ${SOPInstanceUID} and no remote fallback available.`
    );
  }

  _wadoLoaderByVersion[version] = wadoImageLoader;

  const fileCache = _fileImageIdCache[version];
  let fileImageId = fileCache.get(SOPInstanceUID);
  if (!fileImageId) {
    const file = new File([bytes], SOPInstanceUID, { type: 'application/dicom' });
    fileImageId = wadoImageLoader.fileManager.add(file);
    fileCache.set(SOPInstanceUID, fileImageId);
  }

  if (state && !state.holdsFile) {
    state.holdsFile = true;
    _acquireFileHold(version, SOPInstanceUID);

    // Evicted while the read was in flight: hand the hold straight back rather than leaving it
    // acquired with no remaining path to release it.
    if (state.decached) {
      _releaseLoadObjectResources(state, version, SOPInstanceUID);
    }
  }

  const delegateImageId = frame === undefined || frame === null
    ? fileImageId
    : `${fileImageId}?frame=${frame}`;

  const image = await _adoptDelegate(wadoImageLoader.loadImage(delegateImageId, options), state);

  // Present the image under the requested `sonadorlocal:` id so caches/consumers stay consistent.
  if (image && typeof image === 'object') {
    image.imageId = imageId;
  }
  return image;
}

/**
 * Shared read+decode as a Cornerstone load object: `{ promise, cancelFn, decache }`. This is the
 * shape both Cornerstone3D's `ImageLoaderFn` contract and the legacy loader contract expect;
 * `cache.removeImageLoadObject` calls `decache()` on eviction and `imageLoader.cancelLoadImage`
 * calls `cancelFn()`.
 *
 * Without a `decache` the parsed DataSet the wadouri pipeline built for this instance stays in
 * `dataSetCacheManager` under its `dicomfile:` key forever, so evicting the image from the image
 * cache would free the decoded pixels but not the Part10 parse -- the single biggest retained
 * allocation per instance.
 *
 * @param {string} imageId - the `sonadorlocal:` imageId being requested
 * @param {object} options - Cornerstone image-load options, passed through to the wado loader
 * @param {object} deps - as `loadCachedInstanceImage`
 * @returns {{promise: Promise<any>, cancelFn: Function, decache: Function}}
 */
export function loadCachedInstanceImageObject(imageId, options, deps) {
  const { SOPInstanceUID } = parseSonadorLocalImageId(imageId);
  const state = {
    // Carried on the state so a release can be replayed from wherever the delegate is adopted.
    version: deps.version,
    SOPInstanceUID,
    delegate: null,
    holdsFile: false,
    delegateDecached: false,
    cancelled: false,
    decached: false,
  };

  const promise = _loadCachedInstanceImage(imageId, options, deps, state);

  return {
    promise,

    cancelFn: () => {
      // Recorded as well as forwarded: the delegate may not exist yet, and `_adoptDelegate`
      // replays the cancel onto it when it appears.
      state.cancelled = true;

      try {
        state.delegate?.cancelFn?.();
      } catch (error) {
        console.warn(`[sonadorlocal] Error cancelling load for ${SOPInstanceUID}.`, error);
      }
    },

    decache: () => {
      // Recorded as well as acted on, for the same reason: an eviction that arrives while the
      // IndexedDB read is pending has no DataSet and no File hold to release, and the load will
      // acquire both moments later.
      state.decached = true;
      _releaseLoadObjectResources(state, deps.version, SOPInstanceUID);
    },
  };
}

/**
 * Promise-only form, kept for the legacy (v2) adapter, whose loader contract is a bare promise.
 */
export function loadCachedInstanceImage(imageId, options, deps) {
  return loadCachedInstanceImageObject(imageId, options, deps).promise;
}

/**
 * Drop the memoised File reference for an instance (called on cache removal, below). Without this,
 * "Remove Offline Copy" would keep serving the instance from the in-memory File for the rest of the
 * session — removal would not take effect until reload, and the Part10 byte copy would be retained.
 * After eviction the next load of the still-memoised `sonadorlocal:` id reads null bytes and takes
 * the remote fallback (AC-5).
 */
export function evictFileImageId(SOPInstanceUID) {
  ['v2', 'v3'].forEach(version => {
    const fileImageId = _fileImageIdCache[version].get(SOPInstanceUID);
    if (fileImageId) {
      _releaseFileImageId(version, fileImageId);
      _fileImageIdCache[version].delete(SOPInstanceUID);
    }
  });
}

/** Bulk eviction for LocalCacheService.clearAll(), which does not emit per-instance events. */
export function evictAllFileImageIds() {
  ['v2', 'v3'].forEach(version => {
    _fileImageIdCache[version].forEach(fileImageId => _releaseFileImageId(version, fileImageId));
    _fileImageIdCache[version].clear();
  });
}

// Keep the File memos honest with the persistent cache. Subscribed at module scope: this module is
// the single owner of the memo maps (AR-2) and already imports the LocalCacheService singleton, so
// wiring here avoids a circular import from the service side.
LocalCacheService.subscribe(LocalCacheService.EVENTS.INSTANCE_REMOVED, ({ SOPInstanceUID }) =>
  evictFileImageId(SOPInstanceUID)
);
LocalCacheService.subscribe(LocalCacheService.EVENTS.CACHE_CLEARED, () => evictAllFileImageIds());

export default {
  SONADOR_LOCAL_SCHEME,
  buildSonadorLocalImageId,
  parseSonadorLocalImageId,
  registerRemoteFallback,
  getRemoteFallback,
  loadCachedInstanceImage,
  loadCachedInstanceImageObject,
  evictFileImageId,
  evictAllFileImageIds,
};
