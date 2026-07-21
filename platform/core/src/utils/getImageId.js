import getWADORSImageId from './getWADORSImageId';

import LocalCacheService from '../services/LocalCacheService/LocalCacheService';
import {
  buildSonadorLocalImageId,
  registerRemoteFallback,
} from '../loaders/sonadorLocalImageReader';


function updateQueryStringParameter(uri, key, value) {
  /**
   * Update query string parameter. Refer to https://stackoverflow.com/a/6021027/3895126.
  */
  const regex = new RegExp('([?&])' + key + '=.*?(&|$)', 'i');
  const separator = uri.indexOf('?') !== -1 ? '&' : '?';
  if (uri.match(regex)) {
    return uri.replace(regex, '$1' + key + '=' + value + '$2');
  } else {
    return uri + separator + key + '=' + value;
  }
}


function getRemoteImageId(instance, frame, thumbnail = false) {
  // Build the imageId for an instance from its remote (server) source. This is the pre-#125
  // behaviour, factored out so the local-cache preference can wrap it (FR-2).

  if (typeof instance.getImageId === 'function') {
    return instance.getImageId();
  }

  if (instance.url) {
    if (frame !== undefined) {
      instance.url = updateQueryStringParameter(instance.url, 'frame', frame);
    }

    return instance.url;
  }

  const renderingAttr = thumbnail ? 'thumbnailRendering' : 'imageRendering';

  if (!instance[renderingAttr] || instance[renderingAttr] === 'wadouri' || !instance.wadorsuri) {
    let imageId = 'dicomweb:' + instance.wadouri;
    if (frame !== undefined) {
      imageId += '&frame=' + frame;
    }

    return imageId;
  } else {
    return getWADORSImageId(instance, frame, thumbnail); // WADO-RS Retrieve Frame
  }
}


export default function getImageId(instance, frame, thumbnail = false) {
  /**
   * Obtain an imageId for Cornerstone from an image instance
   *
   * @param instance
   * @param frame
   * @param thumbnail
   * @returns {string} The imageId to be used by Cornerstone
  */
  if (!instance) {
    return;
  }

  const remoteImageId = getRemoteImageId(instance, frame, thumbnail);

  // Prefer the local/offline cache when this instance is cached (ohif-viewers#125, FR-2). This is
  // the single imageId-construction site the spec targets (§5.3-2.3): there is no data-source
  // chaining (AR-4), so the local-vs-remote decision lives here. Only genuine remote imageIds are
  // swapped — locally-uploaded instances (getImageId()/url) are left untouched. Thumbnails are
  // INCLUDED: the sidebar preview renders from the full cached instance, so no network request is
  // needed for previews of cached studies either.
  const isRemote =
    typeof remoteImageId === 'string' &&
    (remoteImageId.startsWith('dicomweb:') || remoteImageId.startsWith('wadors:'));

  if (isRemote) {
    const SOPInstanceUID =
      instance.SOPInstanceUID || instance.SopInstanceUID || instance.metadata?.SOPInstanceUID;

    if (SOPInstanceUID && LocalCacheService.isInstanceCachedSync(SOPInstanceUID)) {
      // Record the remote imageId so the loader can fall back per-instance on a cache miss (FR-10).
      registerRemoteFallback(SOPInstanceUID, remoteImageId);
      return buildSonadorLocalImageId(SOPInstanceUID, frame);
    }
  }

  return remoteImageId;
}
