// Retrieve study metadata.

import _ from 'lodash';

import LocalCacheService from '../services/LocalCacheService/LocalCacheService';

import buildStudyFromCachedMetadata from './services/wado/buildStudyFromCachedMetadata.js';
import RetrieveMetadata from './services/wado/retrieveMetadata.js';


const moduleName = 'RetrieveStudyMetadata';

// Cache for promises. Prevents unnecessary subsequent calls to the server
const StudyMetaDataPromises = new Map();


export function retrieveStudyMetadata(server, StudyInstanceUID, filters, separateSeriesInstanceUIDFilters=false, options={}) {

  /**
  * Retrieves study metadata
  *
  * @param {Object} server Object with server configuration parameters
  * @param {string} StudyInstanceUID The UID of the Study to be retrieved
  * @param {Object} [filters] - Object containing filters to be applied on retrieve metadata process
  * @param {string} [filter.seriesInstanceUID] - series instance uid to filter results against
  * @param {boolean} [separateSeriesInstanceUIDFilters = false] - If true, split filtered metadata calls into multiple calls,
  *        as some DICOMWeb implementations only support single filters.
  * @returns {Promise} that will be resolved with the metadata or rejected with the error
  */
  options = options || {};
  _.defaults(options, {
    force_fetch: false,
  });

  // @TODO: Whenever a study metadata request has failed, its related promise will be rejected once and for all
  // and further requests for that metadata will always fail. On failure, we probably need to remove the
  // corresponding promise from the "StudyMetaDataPromises" map...

  if (!server) {
    throw new Error(`${moduleName}: Required 'server' parameter not provided.`);
  }
  if (!StudyInstanceUID) {
    throw new Error(`${moduleName}: Required 'StudyInstanceUID' parameter not provided.`);
  }

  // Already waiting on result? Return cached promise
  if (StudyMetaDataPromises.has(StudyInstanceUID) && !options.force_fetch) {
    return StudyMetaDataPromises.get(StudyInstanceUID);
  }

  // Create a promise to handle the data retrieval
  let promise;

  if (filters && filters.seriesInstanceUID && separateSeriesInstanceUIDFilters) {
    promise = __separateSeriesRequestToAggregatePromiseateSeriesRequestToAggregatePromise(server, StudyInstanceUID, filters);
  } else if (!options.force_fetch && !(filters && filters.seriesInstanceUID) && LocalCacheService?.ready) {
    // Network-free open for offline-cached studies (ohif-viewers#125): when the Download Manager
    // stored the study's raw metadata payload, replay it locally instead of running the QIDO +
    // per-series WADO-RS round-trips. Skipped for explicit reloads (force_fetch) and for
    // series-filtered opens (the cached payload is the full study).
    //
    // IMPORTANT: the decision is made AFTER LocalCacheService.ready() so it never races the async
    // IndexedDB hydration on a fresh page load — and, just as important, everything built from
    // this study (memoized instance imageIds, thumbnails, stacks) is constructed with the cache
    // membership fully populated, keeping every downstream request local for cached studies.
    promise = LocalCacheService.ready().then(() => {
      if (LocalCacheService.hasStudyMetadataPayloadSync(StudyInstanceUID)) {
        return buildStudyFromCachedMetadata(server, StudyInstanceUID).catch((error) => {
          console.warn(
            `${moduleName}: cached-metadata open failed for ${StudyInstanceUID}; falling back to network.`,
            error
          );
          return RetrieveMetadata(server, StudyInstanceUID, filters);
        });
      }
      return RetrieveMetadata(server, StudyInstanceUID, filters);
    });
  } else {

    promise = RetrieveMetadata(server, StudyInstanceUID, filters);
  }

  // Store the promise in cache
  StudyMetaDataPromises.set(StudyInstanceUID, promise);

  return promise;
}


function __separateSeriesRequestToAggregatePromiseateSeriesRequestToAggregatePromise(server, StudyInstanceUID, filters) {

  /**
  * Splits up seriesInstanceUID filters to multiple calls for platforms
  * @param {Object} server Object with server configuration parameters
  * @param {string} StudyInstanceUID The UID of the Study to be retrieved
  * @param {Object} filters - Object containing filters to be applied on retrieve metadata process
  */

  const { seriesInstanceUID } = filters;
  const seriesInstanceUIDs = seriesInstanceUID.split(',');

  return new Promise((resolve, reject) => {
    const promises = [];

    seriesInstanceUIDs.forEach((uid) => {
      const seriesSpecificFilters = Object.assign({}, filters, {
        seriesInstanceUID: uid,
      });

      promises.push(RetrieveMetadata(server, StudyInstanceUID, seriesSpecificFilters));
    });

    Promise.all(promises).then((results) => {
      const data = results[0];

      let series = [];

      results.forEach((result) => {
        series = [...series, ...result.series];
      });

      data.series = series;

      resolve(data);
    }, reject);
  });
}


export function deleteStudyMetadataPromise(StudyInstanceUID) {
  
  /**
  * Delete the cached study metadata retrieval promise to ensure that the browser will
  * re-retrieve the study metadata when it is next requested
  *
  * @param {String} StudyInstanceUID The UID of the Study to be removed from cache
  *
  */

  if (StudyMetaDataPromises.has(StudyInstanceUID)) {
    StudyMetaDataPromises.delete(StudyInstanceUID);
  }
}
