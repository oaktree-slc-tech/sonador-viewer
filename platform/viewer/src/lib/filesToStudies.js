import { flatten } from 'lodash';

import FileLoaderService from './localFileLoaders/fileLoaderService';

const processFile = async (file) => {
  try {
    const fileLoaderService = new FileLoaderService(file);
    const imageId = fileLoaderService.addFile(file);
    const image = await fileLoaderService.loadFile(file, imageId);
    const dataset = await fileLoaderService.getDataset(image, imageId);
    const studies = await fileLoaderService.getStudies(dataset, imageId);

    return studies;
  } catch (error) {
    console.error(error.name, ':Error when trying to load and process local files:', error.message);
  }
};

export default async function filesToStudies(files) {
  const processFilesPromises = files.map(processFile);
  const studies = await Promise.all(processFilesPromises);

  return FileLoaderService.groupSeries(flatten(studies));
}
