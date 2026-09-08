// One place instance Part-10 payloads are retrieved.
//
// SEG, RT, SR, PDF, ECG and M3D need whole DICOM instances rather than decoded pixels. Every
// scheme resolves through Cornerstone3D's `wadouri` DataSet cache, which gives two guarantees:
// concurrent requests for one instance collapse into a single request, and one instance is fetched
// and parsed once for all payload consumers until the retained references are released.
//
// A third guarantee holds for `wadouri` and `dicomfile` only: their image loader parses into this
// same cache under the same key, so an instance already displayed is not fetched or parsed again
// for its payload. It does NOT hold for `wadors`, whose loader is frame-oriented -- it retrieves
// through `imageRetrievalPoolManager` and never touches this cache -- so display and payload
// retrieval stay separate there.

import dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import { api } from 'dicomweb-client';

import DICOMWeb from '../DICOMWeb';
import errorHandler from '../errorHandler';
import getXHRRetryRequestHook from '../utils/xhrRetryRequestHook';

const { wadouri } = dicomImageLoader;

/** Scheme of an imageId, or '' if it carries none. */
export function schemeOf(imageId) {
  const match = /^(\w+):/.exec(imageId || '');
  return match ? match[1] : '';
}

/**
 * The DataSet cache key for an imageId.
 *
 * Deliberately the same derivation the image loader uses (`parseImageId(imageId).url`, which drops
 * the scheme and any frame suffix). Matching it is the whole point: a different key would give a
 * second cache entry for the same instance and put the double fetch straight back.
 */
export function cacheKeyFor(imageId) {
  return wadouri.parseImageId(imageId).url;
}

/**
 * Retrieval function honouring caller-supplied credentials.
 *
 * Not `xhrRequest` with `defaultHeaders`: that merges the loader's global `beforeSend` result over
 * the defaults, so the global credentials would win over the display set's own.
 */
function makeRequestWithHeaders(headers) {
  return uri =>
    fetch(uri, { headers }).then(response => {
      if (!response.ok) {
        throw new Error(`[instanceRetrieval] ${response.status} retrieving ${uri}.`);
      }
      return response.arrayBuffer();
    });
}

/** Retrieval function for a DICOMweb instance, used as the manager's `loadRequest`. */
function makeWadorsRequest({ url, StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID, headers }) {
  return () => {
    const client = new api.DICOMwebClient({
      url,
      headers: headers || DICOMWeb.getAuthorizationHeader(),
      errorInterceptor: errorHandler.getHTTPErrorHandler(),
      requestHooks: [getXHRRetryRequestHook()],
    });

    return client.retrieveInstance({
      studyInstanceUID: StudyInstanceUID,
      seriesInstanceUID: SeriesInstanceUID,
      sopInstanceUID: SOPInstanceUID,
    });
  };
}

/**
 * Resolve an instance's Part-10 bytes through the shared DataSet cache.
 *
 * @param {string} key - cache key, shared with the image loader
 * @param {Function} [loadRequest] - retrieval function; the manager's XHR is used when omitted
 * @returns {Promise<ArrayBuffer>}
 */
// Keys this module holds a manager reference for, and how many. The reference is what makes an
// entry survive between consumers; without it only concurrent requests would be shared, and a
// later consumer would fetch and parse from scratch. Bounded by `releaseRetainedInstances`, called
// when the study viewer unmounts, so growth is per study rather than per session.
const _retained = new Map();

// Incremented by every release. A load carries the value it started under, so one still in flight
// when the study viewer tears down can tell that its retention window has closed: the manager took
// its reference before the promise resolved, but there was nothing in `_retained` for the release
// to find, so without this the reference would be recorded after the only cleanup had run and the
// DataSet would outlive the study that asked for it.
let _generation = 0;

function loadThroughDataSetCache(key, loadRequest) {
  const generation = _generation;

  return wadouri.dataSetCacheManager.load(key, loadRequest).then(
    dataSet => {
      if (generation !== _generation) {
        // Settled after teardown: hand the reference straight back rather than retaining it.
        wadouri.dataSetCacheManager.unload(key);
        return dataSet?.byteArray?.buffer;
      }

      _retained.set(key, (_retained.get(key) || 0) + 1);

      // dicomParser builds its byteArray as `new Uint8Array(arrayBuffer)`, so this is the buffer
      // that was fetched, not a copy of it.
      return dataSet?.byteArray?.buffer;
    },
    error => {
      // The manager drops a failed entry itself; this only balances the reference `load` took.
      wadouri.dataSetCacheManager.unload(key);
      throw error;
    }
  );
}

/**
 * Release every DataSet reference this module is holding.
 *
 * The manager refcounts, so an instance the image loader also holds survives this; what it frees
 * is the parse that exists only for payload consumers. Callers keep any ArrayBuffer they were
 * already handed.
 *
 * @returns {number} how many references were released
 */
export function releaseRetainedInstances() {
  let released = 0;

  // Closes the window for anything still in flight; those loads release themselves on arrival.
  _generation += 1;

  _retained.forEach((count, key) => {
    for (let i = 0; i < count; i += 1) {
      wadouri.dataSetCacheManager.unload(key);
      released += 1;
    }
  });

  _retained.clear();
  return released;
}

/**
 * Retrieve the Part-10 bytes for one instance.
 *
 * @param {object} request
 * @param {string} [request.imageId] - the instance's imageId, when it has one
 * @param {object} [request.dicomweb] - `{ url, StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID, headers }`
 *   for an instance identified by DICOMweb rather than by imageId
 * @param {object} [request.headers] - credentials supplied by the display set. Present for a
 *   private or multi-server source, where the loader's global `beforeSend` would attach the wrong
 *   ones -- `xhrRequest` merges `beforeSend`'s result over any defaults, so the global would win.
 * @returns {Promise<ArrayBuffer>|undefined} undefined when the request cannot be served
 *
 * `sonadorlocal:` is deliberately absent: offline instances are served by dicomLoaderService's own
 * cache stage, which runs before any retrieval and reads IndexedDB directly. There is no second
 * network client there to fold in.
 */
export default function retrieveInstanceBytes({ imageId, dicomweb, headers } = {}) {
  if (imageId) {
    const scheme = schemeOf(imageId);
    const key = cacheKeyFor(imageId);

    if (!key) {
      return undefined;
    }

    switch (scheme) {
      case 'dicomfile':
        // A File held by the loader's fileManager; the manager reads it rather than fetching.
        return loadThroughDataSetCache(key, wadouri.loadFileRequest);

      case 'wadouri':
      case 'dicomweb':
        // The manager's own XHR, and the same key the image loader used, so a display that has
        // already parsed this instance means no second request. Credentials the display set
        // carries take precedence over the loader's global ones, which is what a private or
        // multi-server source depends on.
        return loadThroughDataSetCache(key, headers ? makeRequestWithHeaders(headers) : undefined);

      default:
        break;
    }
  }

  if (dicomweb && dicomweb.url && dicomweb.SOPInstanceUID) {
    // WADO-RS, either from a `wadors:` imageId's parts or from the display set's own wadoRoot.
    // Keyed on the instance URL so repeat asks share one entry.
    const key = `${dicomweb.url}/studies/${dicomweb.StudyInstanceUID}/series/${dicomweb.SeriesInstanceUID}/instances/${dicomweb.SOPInstanceUID}`;
    return loadThroughDataSetCache(key, makeWadorsRequest(dicomweb));
  }

  return undefined;
}

export { retrieveInstanceBytes };
