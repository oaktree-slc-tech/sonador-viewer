import _ from 'lodash';
import { api } from 'dicomweb-client';

import { errorHandler } from '@ohif/core';

import { checkDicomFile, httpErrorToStr } from '../utils/helpers';

// The message a file that is not a DICOM Part 10 object fails with. Such a file is never retried:
// sending it again cannot change what it is.
export const NOT_VALID_DICOM_FILE_ERROR = 'This is not a valid DICOM file.';

// Attempts per file when the caller names no budget, and the base of the delay before a retry:
// the n-th retry waits n times this, so a server that is down is asked again at a widening pace
// rather than hammered (imaging-development-env#103).
export const DEFAULT_UPLOAD_ATTEMPTS = 10;
export const UPLOAD_RETRY_DELAY_MS = 500;

// HTTP client errors that describe the request's moment rather than the request: worth another
// attempt, unlike the other 4xx codes.
const RETRYABLE_CLIENT_STATUSES = new Set([408, 429]);

/**
 * Whether a failed transfer is worth repeating. Network failures (no status) and server errors
 * are; a file that is not DICOM is not, and neither is a client error other than a timeout or a
 * rate limit -- the same request would be refused the same way.
 */
export function isRetryableUploadError(error) {
  if (!error) {
    return false;
  }
  const message = error.message || String(error);
  if (message.includes(NOT_VALID_DICOM_FILE_ERROR)) {
    return false;
  }
  const status = Number(error.status);
  if (status >= 400 && status < 500) {
    return RETRYABLE_CLIENT_STATUSES.has(status);
  }
  return true;
}

/** The message shown for a failed transfer: the HTTP status when there is one, then the detail. */
export function describeUploadError(error) {
  if (!error) {
    return 'Unknown error';
  }
  const detail = httpErrorToStr(error);
  const status = Number(error.status);
  if (status > 0) {
    const text = detail && detail !== 'request failed' ? `: ${detail}` : '';
    return `HTTP ${status}${text}`;
  }
  if (error.status === 0 || detail === 'request failed') {
    // The request never got an answer: the server could not be reached, or the connection dropped
    return 'Network error: the server could not be reached.';
  }
  return detail;
}


class DicomUploadService {
  // DICOMweb upload service: provides methods for transferring files to Sonador / Orthanc
  // and tracking progress.

  async smartUpload(files, url, uploadCallback, cancellationToken, options) {
    // Upload files to the web server, retrying each failed transfer from the back of the queue
    // up to `options.attempts` sends per file.
    //
    // `uploadCallback(fileId, error, queue, status)` is invoked after every send. `error` is the
    // message of a failed send (null on success) and `status` says where the file stands:
    // `{ attempt, attempts, willRetry, retryDelayMs }` -- `attempt` the sends made so far,
    // `willRetry` whether another is scheduled. `queue` is the pending array, as before.
    options = options || {};
    _.defaults(options, {
      workers: 5, chunk: 1, attempts: DEFAULT_UPLOAD_ATTEMPTS, retryDelayMs: UPLOAD_RETRY_DELAY_MS,
    });
    const attempts = Math.max(1, Math.floor(Number(options.attempts) || DEFAULT_UPLOAD_ATTEMPTS));

    let filesArray = Array.from(files);
    if (filesArray.length === 0) {
      throw new Error('No files were provided.');
    }
    filesArray.forEach((file) => { file.attempt = 0; });

    const parallelJobsCount = Math.min(filesArray.length, options.workers);
    let completed = false;
    let inFlight = 0;
    let retriesPending = 0;
    const timers = new Set();

    // Workers idle on this while a retry is waiting out its delay
    let wake = null;
    const sleepUntilWoken = () => new Promise((resolve) => { wake = resolve; });
    const wakeWorkers = () => { if (wake) { const w = wake; wake = null; w(); } };

    const cancelled = () => cancellationToken && cancellationToken.get();

    const scheduleRetry = (file) => {
      retriesPending += 1;
      const delay = options.retryDelayMs * file.attempt;
      const timer = setTimeout(() => {
        timers.delete(timer);
        retriesPending -= 1;
        if (!cancelled()) {
          filesArray.push(file);
        }
        wakeWorkers();
      }, delay);
      timers.add(timer);
      return delay;
    };

    const finish = (resolve) => {
      if (!completed) {
        completed = true;
        if (!cancelled() && options.success && _.isFunction(options.success)) {
          options.success();
        }
        resolve();
      }
    };

    const processJob = async (resolve) => {
      // Process files until the queue is empty and no retry or transfer is outstanding
      for (;;) {
        if (cancelled()) {
          timers.forEach((timer) => clearTimeout(timer));
          timers.clear();
          retriesPending = 0;
          console.warn('DICOM service upload cancelled: pending-uploads=' + filesArray.length);
          wakeWorkers();
          if (inFlight === 0) {
            finish(resolve);
          }
          return;
        }

        const file = filesArray.shift();
        if (!file) {
          if (inFlight === 0 && retriesPending === 0) {
            finish(resolve);
            return;
          }
          await sleepUntilWoken();
          continue;
        }

        inFlight += 1;
        file.attempt += 1;
        let error = null;
        let cause = null;
        try {
          await this.simpleUpload(file, url);
        } catch (err) {
          cause = err;
          error = describeUploadError(err);
        }
        inFlight -= 1;

        const willRetry = !!error && !cancelled() && file.attempt < attempts && isRetryableUploadError(cause);
        const status = { attempt: file.attempt, attempts, willRetry, retryDelayMs: 0 };
        if (willRetry) {
          status.retryDelayMs = scheduleRetry(file);
        }
        uploadCallback(file.fileId, error, filesArray, status);

        // A finished transfer may be the last thing an idle worker was waiting for
        wakeWorkers();
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
    if (!checkDicomFile(content)) throw new Error(NOT_VALID_DICOM_FILE_ERROR);

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
