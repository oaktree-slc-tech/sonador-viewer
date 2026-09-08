// A retrieval timeout for the Cornerstone3D DICOM image loader's XHR transport.
//
// Without one, a stalled connection leaves the loader's promise pending forever. `xhrRequest`
// rejects on `error` and on `abort`, but sets no `timeout` and installs no `ontimeout`, and
// XMLHttpRequest has no timeout of its own by default. A request in that state is worse than a
// failed one: both image caches hand an existing entry back to every later caller before
// consulting any loader, so the imageId cannot be loaded again for the rest of the session, and
// prefetch's reservation for it is never released. A request that *fails* has neither problem --
// both caches drop their entry on rejection, and the reservation is released with the settlement.
//
// So the fix is to make a stalled request fail. Everything below is applied through the loader's
// own `beforeSend` hook, which receives the XHR before `send()`; nothing here touches a cache.

/**
 * Default retrieval timeout.
 *
 * `XMLHttpRequest.timeout` bounds the *whole* request, not idle time, so the value has to clear
 * the slowest legitimate retrieval rather than the slowest reasonable stall. Two minutes carries
 * 100 MB over a 1 MB/s link, which is the order of a large multiframe instance; it is a starting
 * point, not a measurement of any particular deployment. Operators should set it above the
 * largest legitimate retrieval they have measured on their own network.
 *
 * There is no way to switch it off. A request that never settles wedges its imageId in both
 * caches for the session and holds its prefetch reservation forever, which is the failure this
 * exists to prevent, so a non-positive or unreadable configured value falls back here rather than
 * restoring an unbounded request.
 */
export const DEFAULT_LOADER_REQUEST_TIMEOUT_MS = 120 * 1000;

/**
 * Read the configured timeout, falling back to the default.
 *
 * Only a positive, finite number is honoured. Zero, negatives and anything non-numeric fall back:
 * they would otherwise leave the request unbounded, and no configuration is allowed to do that.
 *
 * @param {object} [config] - the `cornerstone3d` section of the app configuration
 * @returns {number} milliseconds, always positive
 */
export function resolveRequestTimeoutMs(config) {
  const configured = config && config.requestTimeoutMs;

  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_LOADER_REQUEST_TIMEOUT_MS;
  }

  return configured;
}

/**
 * Bound one request.
 *
 * @param {XMLHttpRequest|null} xhr - null when the caller is a streaming or range transport
 * @param {object} params - the loader's per-request bag; `deferred` is assigned to it after this
 *   hook resolves, so it is present by the time a timeout could fire
 * @param {number} timeoutMs
 * @returns {boolean} whether a timeout was applied
 */
export function applyRequestTimeout(xhr, params, timeoutMs) {
  // `internal/streamRequest` calls the hook as `beforeSend(null, url, headers, {})`. Only the XHR
  // transport can be bounded this way: a fetch needs an AbortController, which this hook has no
  // way to reach.
  //
  // A non-positive timeout cannot reach here through `resolveRequestTimeoutMs`, which is the only
  // supported way to pick one; the guard is for a direct caller passing something unusable, and it
  // leaves the request as it found it rather than pretending to have bounded it.
  if (!xhr || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return false;
  }

  xhr.timeout = timeoutMs;

  // Belt and braces. A timed-out XHR reaches readyState 4 with status 0, which `xhrRequest`'s own
  // `onreadystatechange` already turns into `errorInterceptor(xhr); reject(xhr)` -- so the loader
  // reports and rejects a timeout exactly as it does a network error. This rejects as well, in
  // case that ordering does not hold somewhere, and settling a promise twice is a no-op. It
  // deliberately does not call any interceptor, so a timeout is still reported once.
  xhr.ontimeout = () => {
    const reject = params && params.deferred && params.deferred.reject;

    if (typeof reject === 'function') {
      reject(xhr);
    }
  };

  return true;
}

/**
 * Build the loader's `beforeSend` hook: bound the request, then answer with the headers.
 *
 * The two responsibilities are combined because the loader allows exactly one hook. Its contract
 * is that the return value is a header object merged over the loader's defaults -- headers set on
 * the XHR here would be overwritten by that merge.
 *
 * @param {{timeoutMs: number, getHeaders: Function}} options
 * @returns {Function}
 */
export function createLoaderBeforeSend({ timeoutMs, getHeaders }) {
  return function beforeSend(xhr, imageId, defaultHeaders, params) {
    applyRequestTimeout(xhr, params, timeoutMs);

    return getHeaders();
  };
}
