import _ from 'lodash';
import { api } from 'dicomweb-client';

import { errorHandler } from '@ohif/core';

import { checkDicomFile, httpErrorToStr } from '../utils/helpers';


class DicomUploadService {
  // DICOMweb upload service: provides methods for transferring files to Sonador / Orthanc
  // and tracking progress.

  async smartUpload(files, url, uploadCallback, cancellationToken, options) {
    // Upload file to the web server
    options = options || {};
    _.defaults(options, { workers: 5, chunk: 1, });

    let filesArray = Array.from(files);
    if (filesArray.length === 0) {
      throw new Error('No files were provided.');
    }

    let parallelJobsCount = Math.min(filesArray.length, options.workers);
    let completed = false;

    const processJob = async (resolve, reject) => {
      
      // Process files in the upload array (queue) until they have all been removed
      while (filesArray.length > 0) {
        
        // Stop all uploads if cancellation token is true
        if (cancellationToken.get()) {
          console.warn('DICOM service upload cancelled: pending-uploads='+filesArray.length);
          return completed;
        }

        // Pull file from queue
        let chunk = filesArray.slice(0, options.chunk);
        filesArray = filesArray.slice(options.chunk);
        let error = null;

        try {
          // Upload file to remote server

          if (chunk.length > 1) throw new Error('DICOMweb upload service does not support parallel uploads');
          if (chunk.length === 1) await this.simpleUpload(chunk[0], url);

        } catch (err) {
          // Catch error and convert to string reprsentation

          // It looks like a stupid bug of Babel that err is not an actual Exception object
          error = httpErrorToStr(err);
        }

        // Invoke callback for each error. FileID, error, and fileArray are all provided
        // to the callback so that files which failed due to transfer errors can be re-queued
        // and re-tried.
        chunk.forEach((file) => uploadCallback(file.fileId, error, filesArray));

        // All files in queue have been processed, exit
        if (!completed && filesArray.length === 0) {
          completed = true;
          if (options.success && _.isFunction(options.success)) {
            options.success();
          }

          resolve();
          return completed;
        }
      }
    };

    await new Promise((resolve) => {
      for (let i = 0; i < parallelJobsCount; i++) {
        processJob(resolve);
      }
    });
  }

  async simpleUpload(file, url) {
    // Uploaded the provided file to the specified URL

    const client = this.getClient(url);
    const loadedFile = await this.readFile(file);
    const content = loadedFile.content;
    if (!checkDicomFile(content)) throw new Error('This is not a valid DICOM file.');

    await client.storeInstances({ datasets: [content] });
  }

  readFile(file) {
    // Read file contents in preparation of upload

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve({
          name: file.name,
          size: file.size,
          type: file.type,
          content: reader.result,
        });
      };
      reader.onerror = (error) => reject(error);
      reader.readAsArrayBuffer(file);
    });
  }

  setRetrieveAuthHeaderFunction(func) {
    this.retrieveAuthHeaderFunc = func;
  }

  getClient(url) {
    const headers = this.retrieveAuthHeaderFunc();
    const errorInterceptor = errorHandler.getHTTPErrorHandler();

    // TODO: a bit weird we are creating a new dicomweb client instance for every upload
    return new api.DICOMwebClient({
      url,
      headers,
    });
  }
}


// Create default instance of the class which can be used by service workers.
// Also export the DicomUploadService class so that it can be used as a batch
// service manager.
const Instance = new DicomUploadService();

export default Instance;
export { Instance, DicomUploadService }
