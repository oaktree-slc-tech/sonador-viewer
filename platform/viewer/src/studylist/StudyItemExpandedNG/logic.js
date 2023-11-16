import { useContext } from 'react';
import { useQuery } from '@tanstack/react-query';

import { log, metadata, studies, utils } from '@ohif/core';

import { extensionManager } from '../../App';
import AppContext from '../../context/AppContext';
const { OHIFStudyMetadata, OHIFSeriesMetadata } = metadata;
const { retrieveStudiesMetadata } = studies;
const { studyMetadataManager } = utils;

const loadStudies = async (studyId, server, appConfig) => {
  try {
    const retrieveParams = [server, [studyId]];

    if (appConfig.splitQueryParameterCalls || appConfig.enableGoogleCloudAdapter) {
      retrieveParams.push(true);
    }

    const result = await retrieveStudiesMetadata(...retrieveParams);

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
      const studyMetadata = new OHIFStudyMetadata(study, study.StudyInstanceUID);

      return {
        ...study,
        displaySets: studyMetadata.createDisplaySets(sopClassHandlerModules),
      };
    });
  } catch (error) {
    log.error(error);
  }
};

export const useSeriesMetadata = ({ studyId, server }) => {
  const { appConfig = {} } = useContext(AppContext);

  return useQuery({
    queryFn: () => loadStudies(studyId, server, appConfig),
    queryKey: [JSON.stringify(server), studyId],
    enabled: !!JSON.stringify(server) && !!studyId,
    select: mapStudiesToThumbnails,
  });
};

const processThumbnail = (study, displaySet) => {
  const {
    displaySetInstanceUID,
    SeriesDescription,
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

export const commentsArr = [
  {
    author: 'Macaulay Culkin',
    date: '7/23/2023 6:16pm',
    comment:
      "I'm baby green juice humblebrag distillery hoodie vegan. Etsy austin vinyl locavore tbh, pitchfork hoodie lomo bruh 90's jawn heirloom jean shorts. Literally godard lyft 3 wolf moon, solarpunk fashion axe photo booth coloring book vice pickled swag 8-bit brunch ramps yr. Retro plaid etsy tonx, microdosing keytar distillery schlitz bitters try-hard celiac ramps. Small batch poke bodega boys etsy cornhole Brooklyn.",
  },
  {
    author: 'Frankie Muniz',
    date: '7/23/2023 6:16pm',
    comment:
      '@Macaulay Culkin & @Jonathan Taylor Thomas Literally godard lyft 3 wolf moon, solarpunk fashion axe photo booth coloring book vice pickled swag 8-bit brunch ramps yr. Retro plaid etsy tonx, microdosing keytar distillery schlitz bitters try-hard celiac ramps.',
  },
  {
    author: 'Jonathan Taylor Thomas',
    date: '7/23/2023 6:16pm',
    comment: 'Small batch poke bodega boys etsy cornhole Brooklyn.',
  },
];
