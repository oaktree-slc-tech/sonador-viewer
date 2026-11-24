import { flatten } from 'lodash';

import { NOT_VALID_DICOM_FILE_ERROR } from '../../../../googleCloud/api/DicomUploadService';


export const processFileEntry = async (entry) => {
  return new Promise((resolve) => {
    if (entry.isFile) {
      entry.file((file) => {
        file.fullPath = entry.fullPath;
        resolve(file);
      });
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader();
      dirReader.readEntries(async (entries) => {
        const subFiles = await Promise.all(entries.map(processFileEntry));
        resolve(flatten(subFiles));
      });
    }
  });
};


// The states a file of a batch passes through, read off the fields the upload callback sets:
// pending (not sent yet, or sent once and not yet answered), warning (a send failed and another
// is coming), error (its attempts are spent, or the failure is not worth repeating), uploaded.
export const FILE_STATES = {
  PENDING: 'pending',
  WARNING: 'warning',
  ERROR: 'error',
  UPLOADED: 'uploaded',
};

export const fileState = (file) => {
  if (file.failed) {
    return FILE_STATES.ERROR;
  }
  if (file.processed) {
    return FILE_STATES.UPLOADED;
  }
  if (file.error) {
    return FILE_STATES.WARNING;
  }
  return FILE_STATES.PENDING;
};

// Re-sends a file has had so far: every send after the first
export const fileRetries = (file) => Math.max(0, (file.attempt || 0) - 1);

/**
 * The counts the batch summary shows: files uploaded, files in the warning state (at least one
 * failed send, still being retried), files that failed for good, and re-sends made so far.
 */
export const batchCounts = (files) => {
  const counts = { total: files.length, completed: 0, warnings: 0, errors: 0, retries: 0 };
  files.forEach((file) => {
    const state = fileState(file);
    if (state === FILE_STATES.UPLOADED) counts.completed += 1;
    if (state === FILE_STATES.WARNING) counts.warnings += 1;
    if (state === FILE_STATES.ERROR) counts.errors += 1;
    counts.retries += fileRetries(file);
  });
  return counts;
};

export const getStatusLabel = (failed, processed) => {
  if (!failed && processed) {
    return 'Completed!';
  }

  if (failed) {
    return 'Error/Failed';
  }

  return '';
};


export const notValidDicomFileError = NOT_VALID_DICOM_FILE_ERROR;
