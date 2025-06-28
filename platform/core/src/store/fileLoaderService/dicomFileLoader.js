import dcmjs from 'dcmjs';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import FileLoader from './base';


const DICOMFileLoader = new (class extends FileLoader {
  // File loader instance which is able to load and parse DICOM file instances.
  // IMPORTANT: this loader class works on local DICOM data.

  fileType = 'application/dicom';

  loadFile(file, imageId) {
    // Parse the provided DICOM file

    return dicomImageLoader.wadouri.loadFileRequest(imageId);
  }

  getDataset(dcm, imageId) {
    //  Parse the provided DICOM image to a dataset.
    
    //  @input dcm (dcm.js) DCM.js compatible data which can be read via `readFile`.
    //  @input imageId (str or uuid): unique identifier to be associated with the dataset.
    //    Will be attached to the dataset instance via the `url` attribute.
    //  @returns dicomDataset

    // Parse data inst
    const dicomData = dcmjs.data.DicomMessage.readFile(dcm);
    const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomData.dict);

    // Attach imageId to dataset via url property
    dataset.url = imageId;

    // Parse meta and transfer properties
    dataset._meta = dcmjs.data.DicomMetaDictionary.namifyDataset(dicomData.meta);
    dataset.AvailableTransferSyntaxUID =
      dataset.AvailableTransferSyntaxUID || dataset._meta.TransferSyntaxUID?.Value?.[0];

    return dataset;
  }
})();


export default DICOMFileLoader;