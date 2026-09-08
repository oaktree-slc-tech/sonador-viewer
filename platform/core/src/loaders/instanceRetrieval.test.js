// One retrieval path for instance payloads.
//
// The behaviour that matters is not "does it fetch" but "does it fetch only once". These cases pin
// the two things that make that true: the cache key is the one the image loader uses, and every
// scheme goes through the shared DataSet cache rather than past it.

const mockLoad = jest.fn();
const mockUnload = jest.fn();
const mockLoadFileRequest = jest.fn();
const mockRetrieveInstance = jest.fn();
const mockDicomWebClient = jest.fn();

jest.mock('@cornerstonejs/dicom-image-loader', () => ({
  wadouri: {
    dataSetCacheManager: {
      load: (...args) => mockLoad(...args),
      unload: (...args) => mockUnload(...args),
    },
    loadFileRequest: (...args) => mockLoadFileRequest(...args),
    // The real implementation, copied: the key derivation matching the image loader's is the
    // behaviour under test, so a simplified stand-in would test nothing.
    parseImageId: imageId => {
      const firstColonIndex = imageId.indexOf(':');
      let url = imageId.substring(firstColonIndex + 1);
      const frameIndex = url.indexOf('frame=');
      if (frameIndex !== -1) {
        url = url.substring(0, frameIndex - 1);
      }
      return { scheme: imageId.substring(0, firstColonIndex), url };
    },
  },
// The package's `exports` map gives jest no resolvable entry point, so the mock is virtual.
}), { virtual: true });

jest.mock('dicomweb-client', () => ({
  api: {
    DICOMwebClient: function (config) {
      mockDicomWebClient(config);
      this.retrieveInstance = (...args) => mockRetrieveInstance(...args);
    },
  },
}));

jest.mock('../DICOMWeb', () => ({ getAuthorizationHeader: () => ({ Authorization: 'Bearer x' }) }));
jest.mock('../errorHandler', () => ({ getHTTPErrorHandler: () => () => {} }));
jest.mock('../utils/xhrRetryRequestHook', () => () => 'retry-hook');

import retrieveInstanceBytes, { cacheKeyFor, schemeOf, releaseRetainedInstances } from './instanceRetrieval';

function dataSetOver(buffer) {
  // dicomParser builds its byteArray as `new Uint8Array(arrayBuffer)`, so .buffer is the original.
  return { byteArray: new Uint8Array(buffer) };
}

const BYTES = new Uint8Array([1, 2, 3, 4]).buffer;

beforeEach(() => {
  jest.clearAllMocks();
  releaseRetainedInstances();
  jest.clearAllMocks();
  mockLoad.mockResolvedValue(dataSetOver(BYTES));
  global.fetch = jest.fn();
});

describe('cache key', () => {
  it('is the one the image loader uses, so the parse is genuinely shared', () => {
    // A different derivation would mean a second entry for the same instance, which puts the
    // double fetch straight back.
    expect(cacheKeyFor('wadouri:https://host/study/1.dcm')).toBe('https://host/study/1.dcm');
    expect(cacheKeyFor('dicomfile:5')).toBe('5');
  });

  it('drops a frame suffix, since the payload is the whole instance', () => {
    expect(cacheKeyFor('wadouri:https://host/1.dcm?frame=3')).toBe('https://host/1.dcm');
  });

  it('reads the scheme', () => {
    expect(schemeOf('wadors:https://host/x')).toBe('wadors');
    expect(schemeOf('nonsense')).toBe('');
  });
});

describe('retrieveInstanceBytes', () => {
  it('resolves the fetched buffer itself, not a copy', async () => {
    const bytes = await retrieveInstanceBytes({ imageId: 'wadouri:https://host/1.dcm' });

    expect(bytes).toBe(BYTES);
  });

  it('lets the manager fetch a remote wadouri instance, under the shared key', async () => {
    await retrieveInstanceBytes({ imageId: 'wadouri:https://host/1.dcm' });

    const [key, loadRequest] = mockLoad.mock.calls[0];
    expect(key).toBe('https://host/1.dcm');
    // No custom request function: the manager's own XHR, the same one the image loader gets.
    expect(loadRequest).toBeUndefined();
  });

  it('reads a dicomfile instance from the loader file manager', async () => {
    await retrieveInstanceBytes({ imageId: 'dicomfile:7' });

    const [key, loadRequest] = mockLoad.mock.calls[0];
    expect(key).toBe('7');

    // Asserted by delegation rather than identity: the manager is handed the loader's own file
    // reader, so an uploaded instance is read from the File it already holds, not fetched.
    loadRequest('7');
    expect(mockLoadFileRequest).toHaveBeenCalledWith('7');
  });

  it('fetches a wadors instance through DICOMweb, but inside the shared cache', async () => {
    // The loader package has no instance-level wadors retrieval, so DICOMweb stays as transport.
    // What matters is that it is supplied to the manager rather than run beside it, so it is
    // deduplicated, cached and refcounted like every other scheme.
    mockRetrieveInstance.mockResolvedValue(BYTES);

    await retrieveInstanceBytes({
      dicomweb: {
        url: 'https://host/dicom-web',
        StudyInstanceUID: '1.2',
        SeriesInstanceUID: '1.2.3',
        SOPInstanceUID: '1.2.3.4',
      },
    });

    const [key, loadRequest] = mockLoad.mock.calls[0];
    expect(key).toBe('https://host/dicom-web/studies/1.2/series/1.2.3/instances/1.2.3.4');
    expect(typeof loadRequest).toBe('function');

    // The client is not constructed until the manager decides it actually needs the bytes -- a
    // cache hit or an in-flight request means no client and no request at all.
    expect(mockDicomWebClient).not.toHaveBeenCalled();

    await loadRequest();
    expect(mockRetrieveInstance).toHaveBeenCalledWith({
      studyInstanceUID: '1.2',
      seriesInstanceUID: '1.2.3',
      sopInstanceUID: '1.2.3.4',
    });
  });

  it('holds its reference so a later consumer reuses the parse instead of refetching', async () => {
    // Releasing as soon as the bytes resolved would take the entry's refcount to zero and delete
    // it whenever the image loader is not also holding it, leaving only in-flight coalescing. A
    // second consumer asking afterwards would fetch and parse the instance again -- always the
    // case for wadors, whose display path does not populate this cache at all.
    await retrieveInstanceBytes({ imageId: 'wadouri:https://host/1.dcm' });

    expect(mockUnload).not.toHaveBeenCalled();
  });

  it('releases everything it holds when the study viewer lets go', async () => {
    // Retention is bounded by the study rather than the session.
    await retrieveInstanceBytes({ imageId: 'wadouri:https://host/1.dcm' });
    await retrieveInstanceBytes({ imageId: 'wadouri:https://host/2.dcm' });

    expect(releaseRetainedInstances()).toBe(2);
    expect(mockUnload).toHaveBeenCalledWith('https://host/1.dcm');
    expect(mockUnload).toHaveBeenCalledWith('https://host/2.dcm');
  });

  it('balances a reference per load, so repeat asks do not strand one', async () => {
    // Every load takes a reference; releasing once per key would leave the rest held forever.
    await retrieveInstanceBytes({ imageId: 'wadouri:https://host/1.dcm' });
    await retrieveInstanceBytes({ imageId: 'wadouri:https://host/1.dcm' });

    expect(releaseRetainedInstances()).toBe(2);
    expect(mockUnload).toHaveBeenCalledTimes(2);
  });

  it('releases a retrieval that settles after the study viewer has torn down', async () => {
    // The manager takes its reference when the load starts, not when it resolves, so a retrieval
    // still in flight at teardown has nothing in the retained map for the release to find. Without
    // a generation the reference would be recorded afterwards and the DataSet would outlive the
    // study, which is exactly what the study bound is supposed to prevent.
    let settle;
    mockLoad.mockReturnValue(new Promise(resolve => { settle = () => resolve(dataSetOver(BYTES)); }));

    const pending = retrieveInstanceBytes({ imageId: 'wadouri:https://host/late.dcm' });

    expect(releaseRetainedInstances()).toBe(0);

    settle();
    await pending;

    expect(mockUnload).toHaveBeenCalledWith('https://host/late.dcm');
    // And nothing is left behind for a later release to find.
    expect(releaseRetainedInstances()).toBe(0);
    expect(mockUnload).toHaveBeenCalledTimes(1);
  });

  it('still resolves the bytes to the caller that asked before teardown', async () => {
    let settle;
    mockLoad.mockReturnValue(new Promise(resolve => { settle = () => resolve(dataSetOver(BYTES)); }));

    const pending = retrieveInstanceBytes({ imageId: 'wadouri:https://host/late.dcm' });
    releaseRetainedInstances();
    settle();

    // The consumer's own reference keeps the bytes alive even though the parse was released.
    await expect(pending).resolves.toBe(BYTES);
  });

  it('does not hold a reference for a retrieval that failed', async () => {
    mockLoad.mockRejectedValue(new Error('network'));

    await expect(retrieveInstanceBytes({ imageId: 'wadouri:https://host/1.dcm' }))
      .rejects.toThrow('network');

    expect(mockUnload).toHaveBeenCalledWith('https://host/1.dcm');
    expect(releaseRetainedInstances()).toBe(0);
  });

  it('uses the display set\'s own credentials when it supplies them', async () => {
    // xhrRequest merges the loader's global beforeSend result OVER any defaults it is given, so
    // passing these as defaultHeaders would let the global credentials win. A private or
    // multi-server source needs the ones the display set carries.
    global.fetch.mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(BYTES) });
    const headers = { Authorization: 'Bearer dataset-specific' };

    await retrieveInstanceBytes({ imageId: 'wadouri:https://host/1.dcm', headers });

    const [, loadRequest] = mockLoad.mock.calls[0];
    expect(typeof loadRequest).toBe('function');

    await loadRequest('https://host/1.dcm');
    expect(global.fetch).toHaveBeenCalledWith('https://host/1.dcm', { headers });
  });

  it('surfaces an HTTP failure on the credentialled path rather than resolving empty', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 403 });

    await retrieveInstanceBytes({
      imageId: 'wadouri:https://host/1.dcm',
      headers: { Authorization: 'Bearer x' },
    });

    const [, loadRequest] = mockLoad.mock.calls[0];
    await expect(loadRequest('https://host/1.dcm')).rejects.toThrow('403');
  });

  it('declines a request it cannot serve rather than inventing one', async () => {
    expect(retrieveInstanceBytes({})).toBeUndefined();
    expect(retrieveInstanceBytes({ imageId: 'sonadorlocal:1.2.3' })).toBeUndefined();
    expect(retrieveInstanceBytes({ dicomweb: { url: 'https://host' } })).toBeUndefined();
    expect(mockLoad).not.toHaveBeenCalled();
  });
});
