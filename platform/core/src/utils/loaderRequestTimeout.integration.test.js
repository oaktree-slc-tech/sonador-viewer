// The retrieval timeout, driven through the pinned loader's own XHR transport.
//
// The sibling unit suite checks the hook in isolation. This one installs it the way the viewer
// installs it -- through `setOptions` -- and then runs the loader's real `xhrRequest`, so what is
// under test is the actual interaction: that our `beforeSend` is the hook the loader calls, that
// the timeout lands on the request object the loader created, and that the loader's own handlers
// turn a timeout into a rejection.
//
// Reaching `xhrRequest` needs two `moduleNameMapper` aliases and a narrowed
// `transformIgnorePatterns`, both in this package's jest config: the package `exports` map has no
// `require` condition and does not expose `dist/esm/**`. That is route A, authorized on
// ohif-viewers#135 note 37337. `@cornerstonejs/core` is deliberately still unresolvable, so the two
// symbols `xhrRequest` imports from it are stubbed virtually -- reaching the real one would pull in
// vtk.js and the WebGL stack.

jest.mock(
  '@cornerstonejs/core',
  () => ({ triggerEvent: () => {}, eventTarget: {} }),
  { virtual: true }
);

import { createLoaderBeforeSend } from './loaderRequestTimeout';

const xhrRequest = require('@cornerstonejs/dicom-image-loader/xhrRequest').default;
const { setOptions } = require('@cornerstonejs/dicom-image-loader/loaderOptions');

const TIMEOUT_MS = 30000;
const AUTH = { Authorization: 'Bearer test-token' };

/** Only what `xhrRequest` touches, with the settle paths driven by hand. */
class ControlledXhr {
  static last = null;

  constructor() {
    this.readyState = 0;
    this.status = 0;
    this.response = undefined;
    this.timeout = 0;
    this.requestHeaders = {};
    this.sent = false;
    ControlledXhr.last = this;
  }

  open() {}

  setRequestHeader(key, value) {
    this.requestHeaders[key] = value;
  }

  send() {
    this.sent = true;
  }

  /** What the browser does when `timeout` elapses: DONE with status 0, then the timeout event. */
  fireTimeout() {
    this.readyState = 4;
    this.status = 0;
    if (this.onreadystatechange) this.onreadystatechange({});
    if (this.ontimeout) this.ontimeout({});
  }

  respond(status, response) {
    this.readyState = 4;
    this.status = status;
    this.response = response;
    if (this.onreadystatechange) this.onreadystatechange({});
  }
}

beforeEach(() => {
  ControlledXhr.last = null;
  global.XMLHttpRequest = ControlledXhr;

  setOptions({
    beforeSend: createLoaderBeforeSend({ timeoutMs: TIMEOUT_MS, getHeaders: () => AUTH }),
    // The loader's own defaults, restated so one test cannot leak into the next.
    open: (xhr, url) => xhr.open('get', url, true),
    beforeProcessing: xhr => Promise.resolve(xhr.response),
    errorInterceptor: undefined,
  });
});

/**
 * Start a request and wait for the hook's await to settle, so the XHR is configured.
 *
 * Wrapped in an object rather than returned bare: an async function returning a promise unwraps
 * it, so `await startRequest()` would await the request itself and hang until it is driven.
 */
async function startRequest() {
  const promise = xhrRequest('https://example.test/frames/1', 'wadouri:frames/1');
  // Nothing here has to observe a rejection, and an unobserved one fails the run.
  promise.catch(() => {});
  // `beforeSend` is awaited inside the loader, so the handlers are attached a microtask later.
  await Promise.resolve();
  await Promise.resolve();
  return { promise };
}

describe('the timeout, through the pinned xhrRequest', () => {
  it('bounds the request the loader created', async () => {
    const { promise } = await startRequest();

    expect(ControlledXhr.last.timeout).toBe(TIMEOUT_MS);

    ControlledXhr.last.respond(200, new ArrayBuffer(8));
    await promise;
  });

  it('still applies the authentication headers', async () => {
    // The same hook does both, because the loader allows only one. If bounding the request cost us
    // the headers, every remote retrieval would come back 403.
    const { promise } = await startRequest();

    expect(ControlledXhr.last.requestHeaders.Authorization).toBe('Bearer test-token');

    ControlledXhr.last.respond(200, new ArrayBuffer(8));
    await promise;
  });

  it('rejects when the request times out', async () => {
    // The point of the whole exercise: a stalled retrieval becomes an ordinary transport failure,
    // which is what lets both caches drop their entry and the imageId be asked for again.
    const { promise } = await startRequest();
    const settled = jest.fn();
    promise.then(() => settled('resolved'), () => settled('rejected'));

    ControlledXhr.last.fireTimeout();
    await promise.catch(() => {});

    expect(settled).toHaveBeenCalledWith('rejected');
  });

  it('resolves a healthy response that arrives before the timeout', async () => {
    const body = new ArrayBuffer(16);
    const { promise } = await startRequest();

    ControlledXhr.last.respond(200, body);

    await expect(promise).resolves.toBe(body);
  });

  it('leaves the request unbounded when the loader supplies no XHR', async () => {
    // `internal/streamRequest` calls the same hook with a null xhr. Exercised here against the
    // hook the loader actually holds, rather than against a locally built one.
    const { getOptions } = require('@cornerstonejs/dicom-image-loader/loaderOptions');

    expect(() => getOptions().beforeSend(null, 'https://example.test/frames/1', {}, {}))
      .not.toThrow();
    expect(getOptions().beforeSend(null, 'https://example.test/frames/1', {}, {})).toBe(AUTH);
  });
});
