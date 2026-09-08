// The retrieval timeout, and the hook it shares with authentication.
//
// Both belong to the same function because the loader allows one `beforeSend`, so the cases that
// matter most are the ones where they interact: the headers must survive the timeout being
// applied, and the timeout must not disturb a call that has no XHR to bound.

import {
  DEFAULT_LOADER_REQUEST_TIMEOUT_MS,
  applyRequestTimeout,
  createLoaderBeforeSend,
  resolveRequestTimeoutMs,
} from './loaderRequestTimeout';

/** Only the parts of XMLHttpRequest this hook touches. */
function fakeXhr() {
  return { timeout: 0, ontimeout: undefined };
}

/** The bag the loader passes through; `deferred` appears on it after the hook resolves. */
function loaderParams() {
  return {};
}

describe('resolveRequestTimeoutMs', () => {
  it('defaults when nothing is configured', () => {
    expect(resolveRequestTimeoutMs(undefined)).toBe(DEFAULT_LOADER_REQUEST_TIMEOUT_MS);
    expect(resolveRequestTimeoutMs({})).toBe(DEFAULT_LOADER_REQUEST_TIMEOUT_MS);
  });

  it('takes a configured value', () => {
    expect(resolveRequestTimeoutMs({ requestTimeoutMs: 45000 })).toBe(45000);
  });

  it('cannot be switched off', () => {
    // There is deliberately no escape hatch. An unbounded request wedges its imageId in both
    // caches for the session and holds its prefetch reservation forever, so no configuration is
    // allowed to restore that -- zero and negatives fall back like any other unusable value.
    [0, -1, -30000].forEach(requestTimeoutMs => {
      expect(resolveRequestTimeoutMs({ requestTimeoutMs })).toBe(DEFAULT_LOADER_REQUEST_TIMEOUT_MS);
    });
  });

  it('falls back rather than trusting a nonsensical value', () => {
    [NaN, Infinity, -Infinity, '30000', null, {}].forEach(requestTimeoutMs => {
      expect(resolveRequestTimeoutMs({ requestTimeoutMs })).toBe(DEFAULT_LOADER_REQUEST_TIMEOUT_MS);
    });
  });

  it('never resolves to a value that would leave a request unbounded', () => {
    // The property that matters, stated directly: whatever the configuration says, what comes back
    // bounds the request.
    [undefined, {}, { requestTimeoutMs: 0 }, { requestTimeoutMs: -5 }, { requestTimeoutMs: 'x' }]
      .forEach(config => {
        const resolved = resolveRequestTimeoutMs(config);
        expect(Number.isFinite(resolved)).toBe(true);
        expect(resolved).toBeGreaterThan(0);
      });
  });
});

describe('applyRequestTimeout', () => {
  it('bounds the request', () => {
    const xhr = fakeXhr();

    expect(applyRequestTimeout(xhr, loaderParams(), 30000)).toBe(true);
    expect(xhr.timeout).toBe(30000);
  });

  it('does nothing when there is no XHR to bound', () => {
    // `internal/streamRequest` calls the hook as `beforeSend(null, url, headers, {})`. A fetch
    // needs an AbortController, which this hook cannot reach, so the streaming and range
    // transports are deliberately not covered.
    expect(() => applyRequestTimeout(null, {}, 30000)).not.toThrow();
    expect(applyRequestTimeout(null, {}, 30000)).toBe(false);
    expect(applyRequestTimeout(undefined, undefined, 30000)).toBe(false);
  });

  it('does not pretend to bound a request when handed an unusable timeout', () => {
    // Not reachable through `resolveRequestTimeoutMs`, which never returns a non-positive value;
    // this is the guard for a direct caller.
    const xhr = fakeXhr();

    expect(applyRequestTimeout(xhr, loaderParams(), 0)).toBe(false);
    expect(xhr.timeout).toBe(0);
    expect(xhr.ontimeout).toBeUndefined();
  });

  it('rejects the loader request when the timeout fires', () => {
    // The loader assigns `params.deferred` after this hook resolves, so the handler reads it when
    // it fires rather than closing over it.
    const xhr = fakeXhr();
    const params = loaderParams();
    applyRequestTimeout(xhr, params, 30000);

    const reject = jest.fn();
    params.deferred = { resolve: jest.fn(), reject };

    xhr.ontimeout();

    // Rejected with the xhr, which is what `xhrRequest` rejects with on error and on abort, so
    // everything downstream sees a transport failure of the shape it already handles.
    expect(reject).toHaveBeenCalledWith(xhr);
  });

  it('does not throw if it fires before the loader recorded its deferred', () => {
    const xhr = fakeXhr();
    const params = loaderParams();
    applyRequestTimeout(xhr, params, 30000);

    expect(() => xhr.ontimeout()).not.toThrow();
  });
});

describe('the beforeSend hook', () => {
  it('still answers with the authentication headers', () => {
    // The reason this is one function: the loader takes a single hook, and its contract is that
    // the return value is merged over the loader's own defaults. Losing it means every remote
    // request goes out unauthenticated and comes back 403.
    const headers = { Authorization: 'Bearer token' };
    const beforeSend = createLoaderBeforeSend({ timeoutMs: 30000, getHeaders: () => headers });
    const xhr = fakeXhr();

    expect(beforeSend(xhr, 'wadouri:study/1', {}, loaderParams())).toBe(headers);
    expect(xhr.timeout).toBe(30000);
  });

  it('answers with the headers on a transport that supplies no XHR', () => {
    const headers = { Authorization: 'Bearer token' };
    const beforeSend = createLoaderBeforeSend({ timeoutMs: 30000, getHeaders: () => headers });

    expect(beforeSend(null, 'https://example/frames/1', {}, {})).toBe(headers);
  });

  it('asks for the headers on every request rather than capturing them once', () => {
    // Tokens are refreshed; a hook that captured the header would authenticate with a stale one.
    const getHeaders = jest.fn(() => ({}));
    const beforeSend = createLoaderBeforeSend({ timeoutMs: 30000, getHeaders });

    beforeSend(fakeXhr(), 'a', {}, loaderParams());
    beforeSend(fakeXhr(), 'b', {}, loaderParams());

    expect(getHeaders).toHaveBeenCalledTimes(2);
  });
});
