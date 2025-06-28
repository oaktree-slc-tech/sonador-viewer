import dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import FileLoader from './base';


const PDFFileLoader = new (class extends FileLoader {
  // Provides a file loader class which is able to read and export DICOM PDF instances.

  fileType = 'application/pdf';
  loadFile(file, imageId) {
    return dicomImageLoader.wadouri.loadFileRequest(imageId);
  }

  getDataset(image, imageId) {
    const dataset = {};
    dataset.imageId = image.imageId || imageId;
    return dataset;
  }
})();


export default PDFFileLoader;