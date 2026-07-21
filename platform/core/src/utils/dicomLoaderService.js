// Utility methods for downloading DICOMweb data

import cornerstone from 'cornerstone-core';
import cornerstoneWADOImageLoader from 'cornerstone-wado-image-loader';
import { api } from 'dicomweb-client';

import DICOMWeb from '../DICOMWeb';
import errorHandler from '../errorHandler';
import LocalCacheService from '../services/LocalCacheService/LocalCacheService';

import { isUsablePart10 } from './dicomPart10';
import getXHRRetryRequestHook from './xhrRetryRequestHook';

const getImageId = (imageObj) => {
  if (!imageObj) {
    return;
  }

  return typeof imageObj.getImageId === 'function' ? imageObj.getImageId() : imageObj.url;
};

const findImageIdOnStudies = (studies, displaySetInstanceUID) => {
  const study = studies.find((study) => {
    const displaySet = study.displaySets.some(
      (displaySet) => displaySet.displaySetInstanceUID === displaySetInstanceUID
    );
    return displaySet;
  });
  const { series = [] } = study;
  const { instances = [] } = series[0] || {};
  const instance = instances[0];

  return getImageId(instance);
};

const someInvalidStrings = (strings) => {
  const stringsArray = Array.isArray(strings) ? strings : [strings];
  const emptyString = (string) => !string;
  let invalid = stringsArray.some(emptyString);
  return invalid;
};

const getImageInstance = (dataset) => {
  return dataset && dataset.images && dataset.images[0];
};

const getImageInstanceId = (imageInstance) => {
  return getImageId(imageInstance);
};

const fetchIt = (url, headers = DICOMWeb.getAuthorizationHeader()) => {
  return fetch(url, headers).then((response) => response.arrayBuffer());
};

const cornerstoneRetriever = (imageId) => {
  return cornerstone.loadAndCacheImage(imageId).then((image) => {
    return image && image.data && image.data.byteArray.buffer;
  });
};

const wadorsRetriever = (
  url,
  studyInstanceUID,
  seriesInstanceUID,
  sopInstanceUID,
  headers = DICOMWeb.getAuthorizationHeader(),
  errorInterceptor = errorHandler.getHTTPErrorHandler()
) => {
  const config = {
    url,
    headers,
    errorInterceptor,
    requestHooks: [getXHRRetryRequestHook()],
  };
  const dicomWeb = new api.DICOMwebClient(config);

  return dicomWeb.retrieveInstance({
    studyInstanceUID,
    seriesInstanceUID,
    sopInstanceUID,
  });
};

const getImageLoaderType = (imageId) => {
  const loaderRegExp = /^\w+\:/;
  const loaderType = loaderRegExp.exec(imageId);

  return (loaderRegExp.lastIndex === 0 && loaderType && loaderType[0] && loaderType[0].replace(':', '')) || '';
};

class DicomLoaderService {
  getLocalData(dataset, studies) {

    // Retrieve a locally cached version of the data
    if (dataset && dataset.localFile) {

      // Use referenced imageInstance
      const imageInstance = getImageInstance(dataset);
      let imageId = getImageInstanceId(imageInstance);

      // or Try to get it from studies
      if (someInvalidStrings(imageId)) {
        imageId = findImageIdOnStudies(studies, dataset.displaySetInstanceUID);
      }

      if (!someInvalidStrings(imageId)) {
        return cornerstoneWADOImageLoader.wadouri.loadFileRequest(imageId);
      }
    }
  }

  getOfflineCacheData(dataset) {
    // Prefer the persistent offline cache (ohif-viewers#125). Specialty display sets — PDF, M3D
    // (STL/GLB), SEG, RT, SR, ECG — fetch their raw Part10 bytes through this service rather than
    // the Cornerstone image loaders, so the cache has to be consulted here as well: without this
    // stage those types always hit the network even when the study is stored offline.
    const imageInstance = getImageInstance(dataset);
    const SOPInstanceUID =
      (dataset && dataset.SOPInstanceUID) ||
      (imageInstance && typeof imageInstance.getSOPInstanceUID === 'function' && imageInstance.getSOPInstanceUID()) ||
      (imageInstance && imageInstance.SOPInstanceUID);

    if (!SOPInstanceUID) {
      return;
    }

    if (LocalCacheService?.isInstanceCachedSync(SOPInstanceUID)) {
      return LocalCacheService.getInstanceBytes(SOPInstanceUID).then((bytes) => {
        if (bytes && bytes.byteLength && isUsablePart10(bytes)) {
          return bytes;
        }

        // Record gone (evicted) or not a usable Part10 stream (e.g. cached as-stored with a
        // sparse file-meta header before download-time validation existed): purge the bad record,
        // then fetch from the network and RE-CACHE the normalized bytes so the instance is local
        // again on the next load (FR-10).
        if (bytes && bytes.byteLength) {
          console.warn(
            `[dicomLoaderService] Cached bytes for ${SOPInstanceUID} are not a usable Part10 stream; ` +
            'purging the record and refetching from network.'
          );
          const { StudyInstanceUID, SeriesInstanceUID } = dataset || {};
          if (StudyInstanceUID && SeriesInstanceUID) {
            LocalCacheService.removeInstance(StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID)
              .catch(() => {});
          }
        }
        return this._fetchAndRecache(dataset, SOPInstanceUID);
      });
    }

    // Instance not cached but the rest of the study is — typically a record purged by an earlier
    // self-heal. Fetch remotely and repopulate the cache so subsequent loads are local again
    // (otherwise these instances would stay network-only until the user re-saves the study).
    const { StudyInstanceUID, SeriesInstanceUID } = dataset || {};
    if (StudyInstanceUID && SeriesInstanceUID && LocalCacheService?.isStudyCachedSync(StudyInstanceUID)) {
      return this._fetchAndRecache(dataset, SOPInstanceUID);
    }
  }

  _fetchAndRecache(dataset, SOPInstanceUID) {
    // Network fetch with an opportunistic write-back into the offline cache (validated Part10
    // only, and only for studies the user has saved offline).
    const network = this.getDataByImageType(dataset) || this.getDataByDatasetType(dataset);
    if (!network || typeof network.then !== 'function') {
      return network;
    }

    return network.then((bytes) => {
      const { StudyInstanceUID, SeriesInstanceUID, Modality, SeriesDescription } = dataset || {};
      if (
        bytes && bytes.byteLength && isUsablePart10(bytes) &&
        StudyInstanceUID && SeriesInstanceUID &&
        LocalCacheService?.isStudyCachedSync(StudyInstanceUID)
      ) {
        LocalCacheService.putInstance({
          StudyInstanceUID,
          SeriesInstanceUID,
          SOPInstanceUID,
          bytes,
          metadata: { SOPInstanceUID, Modality, SeriesDescription },
        }).catch(() => {});
      }
      return bytes;
    });
  }

  getDataByImageType(dataset) {
    const imageInstance = getImageInstance(dataset);

    if (imageInstance) {
      const imageId = getImageInstanceId(imageInstance);
      let getDicomDataMethod = fetchIt;
      const loaderType = getImageLoaderType(imageId);

      switch (loaderType) {
        case 'sonadorlocal':
          // Local-cache imageIds are not fetchable URLs; the cache stage handles these instances,
          // so let the iterator fall through to the dataset-based retriever instead.
          return;
        case 'dicomfile':
          getDicomDataMethod = cornerstoneRetriever.bind(this, imageId);
          break;
        case 'wadors':
          const url = imageInstance.getData().wadoRoot;
          const studyInstanceUID = imageInstance.getStudyInstanceUID();
          const seriesInstanceUID = imageInstance.getSeriesInstanceUID();
          const sopInstanceUID = imageInstance.getSOPInstanceUID();
          const invalidParams = someInvalidStrings([url, studyInstanceUID, seriesInstanceUID, sopInstanceUID]);
          if (invalidParams) {
            return;
          }

          getDicomDataMethod = wadorsRetriever.bind(this, url, studyInstanceUID, seriesInstanceUID, sopInstanceUID);
          break;
        case 'wadouri':
          // Strip out the image loader specifier
          imageId = imageId.substring(imageId.indexOf(':') + 1);

          if (someInvalidStrings(imageId)) {
            return;
          }
          getDicomDataMethod = fetchIt.bind(this, imageId);
          break;
      }

      return getDicomDataMethod();
    }
  }

  getDataByDatasetType(dataset) {
    const { StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID, authorizationHeaders, wadoRoot, wadoUri } = dataset;
    // Retrieve wadors or just try to fetch wadouri
    if (!someInvalidStrings(wadoRoot)) {
      return wadorsRetriever(wadoRoot, StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID, authorizationHeaders);
    } else if (!someInvalidStrings(wadoUri)) {
      return fetchIt(wadoUri, { headers: authorizationHeaders });
    }
  }

  *getLoaderIterator(dataset, studies) {
    yield this.getLocalData(dataset, studies);
    // Offline cache is consulted BEFORE any network retriever (ohif-viewers#125, FR-2); the
    // in-session upload path above stays first since those bytes never had a remote source.
    yield this.getOfflineCacheData(dataset);
    yield this.getDataByImageType(dataset);
    yield this.getDataByDatasetType(dataset);
  }

  findDicomDataPromise(dataset, studies) {
    const loaderIterator = this.getLoaderIterator(dataset, studies);
    // it returns first valid retriever method.
    for (const loader of loaderIterator) {
      if (loader) {
        return loader;
      }
    }

    // in case of no valid loader
    throw new Error('Invalid dicom data loader');
  }
}

const dicomLoaderService = new DicomLoaderService();

export default dicomLoaderService;
