import cornerstone from 'cornerstone-core';

// The request class a user-visible thumbnail is loaded under.
//
// It has to be said explicitly. Legacy `loadAndCacheImage(imageId)` passes no options, and the
// bridge maps an absent request type to Cornerstone3D's lowest class -- so a thumbnail asked for
// without one is queued as background prefetch and competes with `StudyPrefetcher` for that
// bucket, while the thumbnail bucket sits unused. The two are sized separately in
// `DEFAULT_MAX_NUM_REQUESTS`, and a study drawer full of thumbnails is work the user is waiting on.
//
// One helper rather than the literal at each call site, so the two cannot drift apart.
export const THUMBNAIL_REQUEST_TYPE = 'thumbnail';

/**
 * Load an image for display as a thumbnail.
 *
 * @param {string} imageId
 * @returns {Promise<object>} the loaded image
 */
export default function loadThumbnailImage(imageId) {
  return cornerstone.loadAndCacheImage(imageId, { requestType: THUMBNAIL_REQUEST_TYPE });
}
