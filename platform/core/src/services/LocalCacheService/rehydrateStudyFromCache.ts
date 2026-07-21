// Rehydrate DicomMetadataStore for a cached study straight from IndexedDB (ohif-viewers#125, FR-3).
//
// Opening a cached study must be able to populate the metadata store by Study/Series/SOP UID the
// same way the local-upload flow does (platform/core/src/store/fileLoaderService/filesToStudies.js),
// which routes raw Part10 bytes through DicomMetadataStore.addInstance(ArrayBuffer). We reuse that
// exact code path here rather than duplicating naturalization, so a rehydrated instance is
// indistinguishable from an uploaded one to downstream consumers.
//
// NOTE: exported through @ohif/core but not yet called by the viewer — this is a deliberate
// primitive, not dead code. Normal cached opens replay the stored DICOM+JSON metadata payload
// (retrieveStudyMetadata's cache-first branch); auto-wiring this bytes-based path into the v2
// ViewerRetrieveStudyData flow was judged too risky to verify for #125. It is the intended
// foundation for the remaining follow-up: full network-less viewer bootstrap, including studies
// cached before the metadata payload existed (hasMetadataPayload false).

import { DicomMetadataStore } from '../DicomMetadataStore';

import LocalCacheService from './LocalCacheService';

/**
 * Populate DicomMetadataStore from the cache for a study. Idempotent: if the study's series are
 * already present in the store this is effectively a no-op (addInstance de-dupes by UID). Returns
 * the number of instances rehydrated.
 */
export default async function rehydrateStudyFromCache(StudyInstanceUID: string): Promise<number> {
  if (!LocalCacheService.isStudyCachedSync(StudyInstanceUID)) {
    return 0;
  }

  const records = await LocalCacheService.getStudyInstanceRecords(StudyInstanceUID);
  let count = 0;

  for (const record of records) {
    try {
      // addInstance accepts a Part10 ArrayBuffer, parses + naturalizes it, and registers the
      // instance under its Study/Series/SOP UID — mirroring the upload path exactly.
      DicomMetadataStore.addInstance(record.bytes);
      count += 1;
    } catch (error) {
      console.warn(
        `[LocalCacheService] Failed to rehydrate instance ${record.SOPInstanceUID} from cache.`,
        error
      );
    }
  }

  return count;
}

export { rehydrateStudyFromCache };
