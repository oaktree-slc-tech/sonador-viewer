import { flatten } from 'lodash';


export const processFileEntry = async (entry) => {
  return new Promise((resolve) => {
    if (entry.isFile) {
      entry.file((file) => {
        file.fullPath = entry.fullPath;
        resolve(file);
      });
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader();
      dirReader.readEntries(async (entries) => {
        const subFiles = await Promise.all(entries.map(processFileEntry));
        resolve(flatten(subFiles));
      });
    }
  });
};


export const getStatusLabel = (failed, processed) => {
  if (!failed && processed) {
    return 'Completed!';
  }

  if (failed) {
    return 'Error/Failed';
  }

  return '';
};


export const retryLimit = 100;
export const notValidDicomFileError = 'This is not a valid DICOM file.';
