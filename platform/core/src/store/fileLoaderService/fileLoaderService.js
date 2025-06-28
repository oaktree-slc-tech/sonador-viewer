import dicomImageLoader from '@cornerstonejs/dicom-image-loader';

import FileLoader from './base';
import PDFFileLoader from './pdfFileLoader';
import DICOMFileLoader from './dicomFileLoader';


class FileLoaderService extends FileLoader {
  // File loader service that can be used to manage local file instances.
  // @attr fileType (str): mimetype of the file associated with the service
  // @attr loader (fileLoad instance): loader instance used for parsing
  //  the file to a JSON metadata instance.

  fileType;
  loader;

  constructor(file) {
    super();

    // Determine file file from mime, initialize loader instance
    const fileType = file && file.type;
    this.loader = this.getLoader(fileType);
    this.fileType = this.loader.fileType;
  }

  addFile(file) {
    // Initialize file instance and generate UID

    return dicomImageLoader.wadouri.fileManager.add(file);
  }

  loadFile(file, imageId) {
    // Load file to the service and parse (async)

    return this.loader.loadFile(file, imageId);
  }

  getDataset(image, imageId) {
    // Retrieve file data as JSON object

    return this.loader.getDataset(image, imageId);
  }

  getLoader(fileType) {
    // Determine file loader instance to utilize for the provided file type

    if (fileType === 'application/pdf') {
      return PDFFileLoader;
    } else {
      // Default to dicom loader
      return DICOMFileLoader;
    }
  }
}


export default FileLoaderService;