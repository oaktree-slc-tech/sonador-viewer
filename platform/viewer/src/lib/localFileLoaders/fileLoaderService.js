// Local upload decodes through Cornerstone3D like every other path: the legacy
// cornerstone-wado-image-loader is no longer configured or started, so its wadouri pipeline would
// not resolve a file here. The two packages expose the same `wadouri` surface (`fileManager.add`,
// `loadFileRequest`), so this is a change of provider rather than of behaviour.
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';

import DICOMFileLoader from './dicomFileLoader';
import FileLoader from './fileLoader';
import PDFFileLoader from './pdfFileLoader';

class FileLoaderService extends FileLoader {
  fileType;
  loader;
  constructor(file) {
    super();
    const fileType = file && file.type;
    this.loader = this.getLoader(fileType);
    this.fileType = this.loader.fileType;
  }

  static groupSeries(studies) {
    const groupBy = (list, groupByKey, listKey) => {
      let nonKeyCounter = 1;

      return list.reduce((acc, obj) => {
        let key = obj[groupByKey];
        const list = obj[listKey];

        // in case key not found, group it using counter
        key = key ? key : '' + nonKeyCounter++;

        if (!acc[key]) {
          acc[key] = { ...obj };
          acc[key][listKey] = [];
        }

        acc[key][listKey].push(...list);

        return acc;
      }, {});
    };

    const studiesGrouped = Object.values(groupBy(studies, 'StudyInstanceUID', 'series'));

    const result = studiesGrouped.map((studyGroup) => {
      const seriesGrouped = groupBy(studyGroup.series, 'SeriesInstanceUID', 'instances');
      studyGroup.series = Object.values(seriesGrouped);

      return studyGroup;
    });

    return result;
  }

  addFile(file) {
    return dicomImageLoader.wadouri.fileManager.add(file);
  }

  loadFile(file, imageId) {
    return this.loader.loadFile(file, imageId);
  }

  getDataset(image, imageId) {
    return this.loader.getDataset(image, imageId);
  }

  getStudies(dataset, imageId) {
    return this.loader.getStudies(dataset, imageId);
  }

  getLoader(fileType) {
    if (fileType === 'application/pdf') {
      return PDFFileLoader;
    } else {
      // Default to dicom loader
      return DICOMFileLoader;
    }
  }
}

export default FileLoaderService;
