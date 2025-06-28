import { filesToStudies, fileToStudy } from './fileLoaderService/filesToStudies.js';
import { useViewerStudyErrors } from './useViewerStudyErrors';


const fileLoader = {
  Local: { filesToStudies, fileToStudy, },
};

const store = {
  useViewerStudyErrors,
  fileLoader,
}

export default store;
export { useViewerStudyErrors, fileLoader };