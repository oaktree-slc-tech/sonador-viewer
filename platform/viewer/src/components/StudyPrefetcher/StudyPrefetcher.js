import { useEffect } from 'react';
import cs from 'cornerstone-core';
import PropTypes from 'prop-types';

import { classes, utils } from '@ohif/core';

import { useAppContext } from '../../context/AppContext';

import './StudyPrefetcher.css';

const StudyPrefetcher = ({ studies }) => {
  const {
    appConfig: { studyPrefetcher: options },
  } = useAppContext();

  useEffect(() => {
    if (options?.enabled) {
      const studyPrefetcher = classes.StudyPrefetcher.getInstance(studies, options);
      const studiesMetadata = studies.map((s) => utils.studyMetadataManager.get(s.StudyInstanceUID));
      studyPrefetcher.setStudies(studiesMetadata);

      const onNewImage = ({ detail }) => {
        /**
         * When images are cached the viewport will load instantly and
         * the display sets will not be available at this point in time.
         *
         * This code add display sets and updates the study prefetcher metadata.
         */
        const studiesMetadata = studies.map((s) => {
          const studyMetadata = utils.studyMetadataManager.get(s.StudyInstanceUID);
          const displaySets = studyMetadata.getDisplaySets();
          if (!displaySets || displaySets.length < 1) {
            s.displaySets.forEach((ds) => studyMetadata.addDisplaySet(ds));
          }
          return studyMetadata;
        });
        studyPrefetcher.setStudies(studiesMetadata);

        const study = studyPrefetcher.getStudy(detail.image);
        const series = studyPrefetcher.getSeries(study, detail.image);
        const instance = studyPrefetcher.getInstance(series, detail.image);

        if (study.displaySets && study.displaySets.length > 0) {
          const { displaySetInstanceUID } = studyPrefetcher.getDisplaySetBySOPInstanceUID(study.displaySets, instance);
          studyPrefetcher.prefetch(detail.element, displaySetInstanceUID);
        }
      };

      const onElementEnabled = ({ detail }) => {
        detail.element.addEventListener(cs.EVENTS.NEW_IMAGE, onNewImage);
      };

      cs.events.addEventListener(cs.EVENTS.ELEMENT_ENABLED, onElementEnabled);

      return () => {
        cs.events.removeEventListener(cs.EVENTS.ELEMENT_ENABLED, onElementEnabled);
        studyPrefetcher.destroy();
      };
    }
  }, [options, studies]);

  return null;
};

StudyPrefetcher.propTypes = {
  studies: PropTypes.array.isRequired,
};

export default StudyPrefetcher;
