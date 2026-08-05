import { filesToStudies, fileToStudy } from './fileLoaderService/filesToStudies.js';


const fileLoader = {
  Local: { filesToStudies, fileToStudy, },
};

const store = {
  fileLoader,
}

export default store;
export { fileLoader };