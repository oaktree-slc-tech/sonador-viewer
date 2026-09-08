// Local upload decodes through Cornerstone3D like every other path: the legacy
// cornerstone-wado-image-loader is no longer configured or started, so its wadouri pipeline would
// not resolve a file here. The two packages expose the same `wadouri` surface (`fileManager.add`,
// `loadFileRequest`), so this is a change of provider rather than of behaviour.
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';

import FileLoader from './fileLoader';

const PDFFileLoader = new (class extends FileLoader {
  fileType = 'application/pdf';
  loadFile(file, imageId) {
    return dicomImageLoader.wadouri.loadFileRequest(imageId);
  }

  getDataset(image, imageId) {
    const dataset = {};
    dataset.imageId = image.imageId || imageId;
    return dataset;
  }

  getStudies(dataset, imageId) {
    return this.getDefaultStudy(imageId);
  }

  getDefaultStudy(imageId) {
    const study = {
      StudyInstanceUID: '',
      StudyDate: '',
      StudyTime: '',
      AccessionNumber: '',
      ReferringPhysicianName: '',
      PatientName: '',
      PatientID: '',
      PatientBirthdate: '',
      PatientSex: '',
      StudyId: '',
      StudyDescription: '',
      series: [
        {
          SeriesInstanceUID: '',
          SeriesDescription: '',
          SeriesNumber: '',
          instances: [
            {
              metadata: {
                SOPInstanceUID: '',
                SOPClassUID: '1.2.840.10008.5.1.4.1.1.104.1',
                Rows: '',
                Columns: '',
                NumberOfFrames: 0,
                InstanceNumber: 1,
              },
              getImageId: () => imageId,
              isLocalFile: true,
            },
          ],
        },
      ],
    };

    return study;
  }
})();

export default PDFFileLoader;
