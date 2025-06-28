// Provides a local fileLoader service which can be used to parse and load
// DICOM data to the DicomMetadataService.

import { fileToStudy, filesToStudies } from './filesToStudies.js';


const Local = {
  fileToStudy,
  filesToStudies,
}


export default Local;
export { Local, };