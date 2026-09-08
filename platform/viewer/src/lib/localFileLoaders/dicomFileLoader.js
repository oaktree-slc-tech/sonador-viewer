// Local upload decodes through Cornerstone3D like every other path: the legacy
// cornerstone-wado-image-loader is no longer configured or started, so its wadouri pipeline would
// not resolve a file here. The two packages expose the same `wadouri` surface (`fileManager.add`,
// `loadFileRequest`), so this is a change of provider rather than of behaviour.
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import dcmjs from 'dcmjs';

import OHIF from '@ohif/core';

import FileLoader from './fileLoader';

const metadataProvider = OHIF.cornerstone.metadataProvider;

const DICOMFileLoader = new (class extends FileLoader {
  fileType = 'application/dicom';
  loadFile(file, imageId) {
    return dicomImageLoader.wadouri.loadFileRequest(imageId);
  }

  getDataset(image, imageId) {
    let dataset = {};
    try {
      const dicomData = dcmjs.data.DicomMessage.readFile(image);

      dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomData.dict);

      metadataProvider.addInstance(dataset);

      dataset._meta = dcmjs.data.DicomMetaDictionary.namifyDataset(dicomData.meta);
    } catch (e) {
      console.error('Error reading dicom file', e);
    }
    // Set imageId on dataset to be consumed later on
    dataset.imageId = imageId;

    return dataset;
  }

  getStudies(dataset, imageId) {
    return this.getStudyFromDataset(dataset);
  }

  getStudyFromDataset(dataset = {}) {
    const {
      StudyInstanceUID,
      StudyDate,
      StudyTime,
      AccessionNumber,
      ReferringPhysicianName,
      PatientName,
      PatientID,
      PatientBirthDate,
      PatientSex,
      StudyID,
      StudyDescription,
      SeriesInstanceUID,
      SeriesDescription,
      SeriesNumber,
      imageId,
    } = dataset;

    const instance = {
      metadata: dataset,
      url: imageId,
    };

    const series = {
      SeriesInstanceUID: SeriesInstanceUID,
      SeriesDescription: SeriesDescription,
      SeriesNumber: SeriesNumber,
      instances: [instance],
    };

    const study = {
      StudyInstanceUID,
      StudyDate,
      StudyTime,
      AccessionNumber,
      ReferringPhysicianName,
      PatientName,
      PatientID,
      PatientBirthDate,
      PatientSex,
      StudyID,
      StudyDescription,
      /*
      TODO: in case necessary to uncomment this block, double check every property
      numberOfStudyRelatedSeries: NumberOfStudyRelatedSeries || DICOMWeb.getString(dataset['00201206']),
      numberOfStudyRelatedInstances: NumberOfStudyRelatedInstances || DICOMWeb.getString(dataset['00201208']),
      Modality: Modality || DICOMWeb.getString(dataset['00080060']),
      ModalitiesInStudy: ModalitiesInStudy || DICOMWeb.getString(dataset['00080061']),
      modalities:
      */
      series: [series],
    };

    return study;
  }
})();

export default DICOMFileLoader;
