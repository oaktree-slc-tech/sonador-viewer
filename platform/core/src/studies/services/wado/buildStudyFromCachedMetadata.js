// Network-free study open for offline-cached studies (ohif-viewers#125).
//
// The Download Manager stores the RAW DICOM+JSON metadata payloads it fetched while caching a
// study (QIDO series list + per-series WADO-RS metadata). This builder replays those payloads
// through the SAME pipeline the online path uses (createStudyFromSOPInstanceList → makeSOPInstance
// → metadata providers + DicomMetadataStore), so the resulting study descriptor is
// indistinguishable from a network retrieve — just without the 2–5s of QIDO/WADO round-trips.

import dcmjs from 'dcmjs';

import DICOMWeb from '../../../DICOMWeb';
import LocalCacheService from '../../../services/LocalCacheService/LocalCacheService';

import { createStudyFromSOPInstanceList } from './studyInstanceHelpers';

const { naturalizeDataset } = dcmjs.data.DicomMetaDictionary;

export default async function buildStudyFromCachedMetadata(server, StudyInstanceUID) {
  const payload = await LocalCacheService.getStudyMetadataPayload(StudyInstanceUID);
  if (!payload || !payload.instancesBySeries) {
    throw new Error(`No cached study metadata payload for ${StudyInstanceUID}`);
  }

  // Flatten instances in the stored (already pipeline-sorted) series order; append any series
  // that somehow are not represented in the QIDO list so nothing is dropped.
  const orderedSeriesUIDs = (payload.series || [])
    .map((series) => DICOMWeb.getString(series['0020000E']))
    .filter(Boolean);
  const remaining = Object.keys(payload.instancesBySeries).filter(
    (uid) => !orderedSeriesUIDs.includes(uid)
  );

  const sopInstanceList = [];
  [...orderedSeriesUIDs, ...remaining].forEach((seriesUID) => {
    (payload.instancesBySeries[seriesUID] || []).forEach((instance) => sopInstanceList.push(instance));
  });

  if (!sopInstanceList.length) {
    throw new Error(`Cached study metadata payload is empty for ${StudyInstanceUID}`);
  }

  const study = await createStudyFromSOPInstanceList(server, sopInstanceList);

  // Merge QIDO series-level fields into the instance-derived series entries, mirroring
  // RetrieveMetadataLoaderAsync.posLoad.
  (payload.series || []).forEach((seriesJson) => {
    let naturalized;
    try {
      naturalized = naturalizeDataset(seriesJson);
    } catch (error) {
      return;
    }
    const target = study.seriesMap && study.seriesMap[naturalized.SeriesInstanceUID];
    if (target) {
      if (target.SeriesDescription === undefined) target.SeriesDescription = naturalized.SeriesDescription;
      if (target.SeriesNumber === undefined) target.SeriesNumber = naturalized.SeriesNumber;
      if (target.Modality === undefined) target.Modality = naturalized.Modality;
    }
  });

  // The payload covers the whole study — nothing left for a lazy series loader to fetch.
  study.seriesLoader = null;

  return study;
}

export { buildStudyFromCachedMetadata };
