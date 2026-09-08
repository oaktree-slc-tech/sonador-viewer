// Utility methods for downloading DICOMweb data

import LocalCacheService from '../services/LocalCacheService/LocalCacheService';
import retrieveInstanceBytes from '../loaders/instanceRetrieval';

import { isUsablePart10 } from './dicomPart10';

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
        // Through the same retrieval as everything else, so an uploaded instance is read and
        // parsed once whether it is asked for as pixels or as a payload.
        return retrieveInstanceBytes({ imageId });
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
    // Retrieval by the instance's own imageId. Every scheme here resolves through the shared
    // Cornerstone3D DataSet cache, so an instance already fetched and parsed for display is not
    // fetched or parsed a second time for its payload.
    const imageInstance = getImageInstance(dataset);

    if (!imageInstance) {
      return;
    }

    const imageId = getImageInstanceId(imageInstance);
    const loaderType = getImageLoaderType(imageId);

    switch (loaderType) {
      case 'sonadorlocal':
        // Local-cache imageIds are not fetchable URLs; the cache stage handles these instances,
        // so let the iterator fall through to the dataset-based retriever instead.
        return;

      case 'wadors': {
        const url = imageInstance.getData().wadoRoot;
        const StudyInstanceUID = imageInstance.getStudyInstanceUID();
        const SeriesInstanceUID = imageInstance.getSeriesInstanceUID();
        const SOPInstanceUID = imageInstance.getSOPInstanceUID();

        if (someInvalidStrings([url, StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID])) {
          return;
        }

        return retrieveInstanceBytes({
          dicomweb: { url, StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID },
        });
      }

      case 'dicomfile':
      case 'wadouri':
      case 'dicomweb':
        if (someInvalidStrings(imageId)) {
          return;
        }

        return retrieveInstanceBytes({ imageId });

      default:
        return;
    }
  }

  getDataByDatasetType(dataset) {
    // Retrieval from the display set's own DICOMweb roots, for instances with no usable imageId.
    const { StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID, authorizationHeaders, wadoRoot, wadoUri } = dataset;

    if (!someInvalidStrings(wadoRoot)) {
      return retrieveInstanceBytes({
        dicomweb: {
          url: wadoRoot,
          StudyInstanceUID,
          SeriesInstanceUID,
          SOPInstanceUID,
          headers: authorizationHeaders,
        },
      });
    }

    if (!someInvalidStrings(wadoUri)) {
      // A direct WADO-URI instance URL, under the same key the image loader would use for
      // `wadouri:<url>`. The display set's own credentials are passed through: this branch
      // supplied them before, and a private or multi-server source needs them rather than the
      // loader's global ones.
      return retrieveInstanceBytes({ imageId: `wadouri:${wadoUri}`, headers: authorizationHeaders });
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
