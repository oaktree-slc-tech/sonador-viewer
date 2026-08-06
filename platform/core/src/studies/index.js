import { QIDO, WADO } from './services/';
import getStudyBoxData from './getStudyBoxData';
import retrieveStudiesMetadata from './retrieveStudiesMetadata.js';
import {
  deleteStudyMetadataPromise,
  purgeStudyMetadataPromises,
  retrieveStudyMetadata,
} from './retrieveStudyMetadata.js';
import searchStudies from './searchStudies';
import sortStudy from './sortStudy';

const studies = {
  services: {
    QIDO,
    WADO,
  },
  loadingDict: {},
  retrieveStudyMetadata,
  deleteStudyMetadataPromise,
  purgeStudyMetadataPromises,
  retrieveStudiesMetadata,
  getStudyBoxData,
  searchStudies,
  sortStudy,
};

export default studies;
