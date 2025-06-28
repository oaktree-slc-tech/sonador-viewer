import _ from 'lodash';

import FileLoaderService from './fileLoaderService';
import { DicomMetadataStore } from '../../services/DicomMetadataStore';


const processFile = async (file, options) => {
  // Process the provided file
  
  options = options || {};
  _.defaults(options, {
    mimeType: 'application/dicom',
  });

  // Convert the "file" input to a blob if it is not already one.
  if (!(file instanceof Blob)) {
    
    // Handle TypedArrays: Uint8Array, Int16Array, ...
    if (ArrayBuffer.isView(file)) {
      file = new Blob([file.buffer], { type: options.mimeType });
    } else if (file instanceof ArrayBuffer) {
      file = new Blob([file], { type: options.mimeType });
    } else {
      throw new Error('Unsupported file type. Expected Blob, TypedArray, or ArrayBuffer.');
    }
  }

  try {

    // Initialize file loader service and retrieve JSON version of metadata
    const fileLoaderService = new FileLoaderService(file);
    const imageId = fileLoaderService.addFile(file);
    const image = await fileLoaderService.loadFile(file, imageId);
    const dicomJSONDataset = await fileLoaderService.getDataset(image, imageId);

    // Add instance to DicomMetadataStore
    DicomMetadataStore.addInstance(dicomJSONDataset);

    // Return parsed DICOM JSON data
    return dicomJSONDataset;

  } catch (error) {

    // Unable to proces file, log error
    console.log(error.name, ':Error when trying to load and process local files:', error.message);
  }
};


const fileToStudy = processFile;


export default async function filesToStudies(files) {
  // Load the provided file instances to  

  const processFilesPromises = files.map(processFile);
  const dcm_data = await Promise.all(processFilesPromises);
  
  return dcm_data;
}


export { fileToStudy, filesToStudies };