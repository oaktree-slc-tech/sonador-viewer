import { useContext } from 'react';
import { useQuery } from '@tanstack/react-query';

import { log, metadata, studies, utils, display } from '@ohif/core';

import { extensionManager } from '../App';
import AppContext from '../context/AppContext';
const { OHIFStudyMetadata, OHIFSeriesMetadata } = metadata;
const { retrieveStudiesMetadata } = studies;
const { studyMetadataManager } = utils;


const loadStudies = async (studyId, server, appConfig) => {
  // Retrieve study data from application store

  const displaySetApi = display.DisplaySetApi.Instance;

  try {
    const result = await retrieveStudiesMetadata(server, [studyId], {},
      appConfig.splitQueryParameterCalls || appConfig.enableGoogleCloudAdapter);

    if (result && !result.isCanceled) {
      await Promise.all(
        result.map(async (study) => {
          const studyMetadata = new OHIFStudyMetadata(study, study.StudyInstanceUID);
          await loadRemainingSeries(
            studyMetadata,
            appConfig.maxConcurrentMetadataRequests || studyMetadata.getSeriesCount()
          );
        })
      );
    }

    const sopClassHandlerModules = extensionManager.modules['sopClassHandlerModule'];

    return result.map((study) => {

      // Initialize study metadata and create series displaysets
      const studyMetadata = new OHIFStudyMetadata(study, study.StudyInstanceUID);
      const displaySets = studyMetadata.createDisplaySets(sopClassHandlerModules);

      // Add displaysets to displaySet service
      if (displaySetApi && displaySetApi.displaySetService) {
        displaySetApi.displaySetService.addDisplaySets(displaySets);
      }

      return {
        ...study,
        displaySets,
      };
    });
  } catch (error) {
    log.error(error);
  }
};


const processThumbnail = (study, displaySet) => {
  // Filter display set properties to those required for display in the item drawer

  const {
    displaySetInstanceUID,
    SeriesDescription,
    SeriesInstanceUID,
    numImageFrames,
    SeriesNumber,
    Modality,
    images,
    isSOPClassUIDSupported,
    SOPClassUIDNaturalized,
  } = displaySet;
  let imageId;
  let altImageText;

  if (Modality === 'SEG') {
    altImageText = 'SEG';
  } else if (Modality === 'SR') {
    altImageText = 'SR';
  } else if (images && images.length) {
    const imageIndex = Math.floor(images.length / 2);
    imageId = images[imageIndex].getImageId();
  } else if (isSOPClassUIDSupported === false) {
    altImageText = SOPClassUIDNaturalized;
  } else {
    altImageText = Modality || 'UN';
  }

  return {
    imageId,
    altImageText,
    displaySetInstanceUID,
    SeriesInstanceUID,
    SeriesDescription,
    numImageFrames,
    SeriesNumber,
  };
};


const processStudy = (study) => {
  const thumbnails = study.displaySets.map((displaySet) => processThumbnail(study, displaySet));

  return {
    StudyInstanceUID: study.StudyInstanceUID,
    thumbnails,
  };
};


const mapStudiesToThumbnails = (studies = []) => {
  return studies.map(processStudy);
};


const addSeriesToStudy = (studyMetadata, series) => {
  // Retrieve the metadata for a series and add it to the study instance

  const sopClassHandlerModules = extensionManager.modules['sopClassHandlerModule'];
  const study = studyMetadata.getData();
  const seriesMetadata = new OHIFSeriesMetadata(series, study);
  const existingSeries = studyMetadata.getSeriesByUID(series.SeriesInstanceUID);
  if (existingSeries) {
    studyMetadata.updateSeries(series.SeriesInstanceUID, seriesMetadata);
  } else {
    studyMetadata.addSeries(seriesMetadata);
  }

  studyMetadata.createAndAddDisplaySetsForSeries(sopClassHandlerModules, seriesMetadata);

  study.displaySets = studyMetadata.getDisplaySets();
  study.derivedDisplaySets = studyMetadata.getDerivedDatasets({
    Modality: series.Modality,
  });

  updateStudyMetadataManager(study, studyMetadata);
};


const loadRemainingSeries = async (studyMetadata, maxConcurrentMetadataRequests) => {
  const { seriesLoader } = studyMetadata.getData();
  if (!seriesLoader) return;

  const loadNextSeries = async () => {
    const isHasNext = seriesLoader.hasNext();
    if (!isHasNext) return;

    const series = await seriesLoader.next();
    addSeriesToStudy(studyMetadata, series);
    return loadNextSeries();
  };

  const concurrentRequestsAllowed = maxConcurrentMetadataRequests || studyMetadata.getSeriesCount();

  const promises = Array(concurrentRequestsAllowed).fill(null).map(loadNextSeries);
  return await Promise.all(promises);
};


const updateStudyMetadataManager = (study, studyMetadata) => {
  const { StudyInstanceUID } = study;

  if (!studyMetadataManager.get(StudyInstanceUID)) {
    studyMetadataManager.add(studyMetadata);
  }
};


export default function useSeriesMetadata({ studyId, server, mapToThumbnails = true }) {
  const { appConfig = {} } = useContext(AppContext);

  return useQuery({
    queryFn: () => loadStudies(studyId, server, appConfig),
    queryKey: [JSON.stringify(server), studyId],
    enabled: !!JSON.stringify(server) && !!studyId,
    select: (response) => {
      if (mapToThumbnails) {
        return mapStudiesToThumbnails(response);
      }

      return response;
    },
  });
}
