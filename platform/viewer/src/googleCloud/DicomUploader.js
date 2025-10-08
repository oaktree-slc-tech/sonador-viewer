import React, { createElement, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ShieldExclamationIcon,
  XCircleIcon,
} from '@heroicons/react/24/solid';
import PropTypes from 'prop-types';

import dicomUploader from './api/DicomUploadService';
import buttonFile from './icons/button-file.svg';
import buttonFolder from './icons/button-folder.svg';
import CancellationToken from './utils/CancellationToken';
import { formatFileSize } from './utils/helpers';

import '../styles/global-viewer.css';
import './googleCloud.css';
import './styles/dicom-uploader.css';

const retryLimit = 100;
const notValidDicomFileError = 'This is not a valid DICOM file.';


const DicomUploader = ({ url, retrieveAuthHeaderFunction }) => {
  const { t } = useTranslation('Common');

  const [state, setState] = useState({
    status: 'Upload',
    isCancelled: false,
    errorsCount: 0,
    successCount: 0,
    files: null,
    uploadedVolume: null,
    wholeVolumeStr: null,
    isFilesListHidden: true,
    timeLeft: null,
    uploadedList: null,
    totalCount: 0,
    successfullyUploadedCount: 0,
    lastFile: '',
    uploadContext: null,
    uploadDetailsVisible: false,
  });

  const filesLeft = () => {
    return `${state.uploadedList.length} ${t(' of ')} ${state.totalCount} ${t(' files')}`;
  };

  const percentsFloat = () => {
    return (100 * state.uploadedList.length) / Object.keys(state.files).length;
  };

  const percents = () => {
    return parseInt(percentsFloat());
  };

  const uploadCallback = (fileId, error, filesArray) => {
    // Callback invoked on the completion of a file upload. Updates error list
    // and adds details about the transfer to the log. If there was an error in transfer
    // and the retry limit has not yet been reached, re-queue for transfer.

    // Retrieve reference to file and mark as processed
    const file = state.files[fileId];

    if (!error) {
      // File uploaded successfully

      // Set file state properites
      file.processed = true;
      file.error = null;

      let uploadedVolume = state.uploadedVolume + file.size;
      setState((prevState) => ({ ...prevState, uploadedVolume }));
      setState((prevState) => ({ ...prevState, successCount: state.successCount + 1 }));
    } else {
      // File upload encountered an error

      file.error = error;

      if ((file.retry || 0) < retryLimit && !(error || '').includes(notValidDicomFileError)) {
        // Retry limit not yet exceeded, re-queue for transfer. Files which failed because
        // they are not valid DICOM files are skipped.

        file.retry = (file.retry || 0) + 1;
        filesArray.unshift(file.ref);
      } else {
        // Number of retries exceeded, increment transfer error count

        file.failed = true;
        setState((prevState) => ({ ...prevState, errorsCount: state.errorsCount + 1 }));
      }
    }

    // Update component state: last file and uploaded file list
    setState((prevState) => ({ ...prevState, lastFile: file.name }));
    let uploadedList = state.uploadedList;
    if (uploadedList.indexOf(file) === -1) {
      uploadedList.push(file);
    }
    setState((prevState) => ({ ...prevState, uploadedList }));
  };

  const uploadFiles = (files) => {
    const filesArray = Array.from(files.target.files);
    const filesDict = {};
    filesArray.forEach((file, i) => {
      const fileDesc = {
        id: i,
        name: file.name,
        path: file.webkitRelativePath || file.name,
        size: file.size,
        error: null,
        processed: false,
        processedInUI: false,
        ref: file,
      };
      filesDict[i] = fileDesc;
      file.fileId = i;
    });
    const wholeVolume = filesArray.map((f) => f.size).reduce((a, b) => a + b);
    const uploadContext = Math.random();

    setState((prevState) => ({
      ...prevState,
      status: 'Uploading...',
      files: filesDict,
      uploadedList: [],
      uploadedVolume: 0,
      lastFile: filesArray[0].name,
      totalCount: filesArray.length,
      wholeVolumeStr: formatFileSize(wholeVolume),
      uploadContext: uploadContext,
      cancellationToken: new CancellationToken(),
    }));

    const cancellationToken = new CancellationToken();
    const uploadCb = (fileId, error, filesArray) =>
      uploadContext === state.uploadContext && uploadCallback(fileId, error, filesArray);

    dicomUploader.setRetrieveAuthHeaderFunction(retrieveAuthHeaderFunction);
    dicomUploader.smartUpload(files.target.files, url, uploadCb, cancellationToken);
  };

  const renderTableRow = (file) => {
    // Render completion of a single file transfer. Notify user that file has been processed.
    // Show warnings and errors that happened during transfer.

    let sicon = null;
    let error = null;
    let message = null;
    let rmessage = null;

    // Render status icon
    if (file.processed) {
      // File processed successfully

      sicon = <CheckIcon className="success icon-size-16 spacer-left-1rem" />;
    } else if (file.error !== null && (file.retry || 0) < retryLimit) {
      // File experienced upload error, but has been requeued for retry

      sicon = <ShieldExclamationIcon className="warning icon-size-16 spacer-left-1rem" />;
    } else {
      // File uploaded failed

      sicon = <XCircleIcon className="error icon-size-16 spacer-left-1rem" />;
    }

    // File status message and error details
    if (file.error !== null && (file.retry || 0) < retryLimit) {
      // File experienced an upload error, but has been re-queued for retry
      message = <span className="warning spacer-left-3rem vertical-top font-light">{t('Error & Retry')}</span>;
      error = <span className="spacer-left-05rem vertical-top">{file.error}</span>;
      if (file.retry) {
        rmessage = (
          <span className="spacer-left-2rem vertical-top">
            {file.retry}/{retryLimit}
          </span>
        );
      }
    } else if (file.error !== null) {
      // File upload failed
      message = <span className="error spacer-left-3rem vertical-top font-light">{t('Error/Failed')}</span>;
      error = <span className="spacer-left-3rem vertical-top">{file.error}</span>;
      if (file.retry) {
        rmessage = (
          <span className="error spacer-left-2rem vertical-top">
            {file.retry}/{retryLimit}
          </span>
        );
      }
    } else {
      // File transfer successful
      message = <span className="spacer-left-3rem font-light vertical-top">{t('Successful')}</span>;
    }

    return (
      <tr key={file.id}>
        <td>
          {sicon}
          <span className="spacer-left-2rem vertical-top">{file.name}</span>
          {message}
          {error}
          {rmessage}
        </td>
      </tr>
    );
  };

  return (
    <>
      {state.files === null ? (
        <div className="dicom-uploader">
          <div className="button">
            <label htmlFor="file">{createElement(buttonFile)}</label>
            <input id="file" className="invisible-input" type="file" onChange={uploadFiles} multiple />
          </div>

          <div className="button">
            <label htmlFor="folder">{createElement(buttonFolder)}</label>
            <input
              id="folder"
              className="invisible-input"
              type="file"
              onChange={uploadFiles}
              webkitdirectory="true"
              mozdirectory="true"
              multiple
            />
          </div>
        </div>
      ) : (
        <>
          {state.errorsCount || state.successCount ? (
            <div className="upload-summary columns">
              <div className="push-right"></div>
              {state.successCount ? (
                <div className="success-count">
                  <span className="success">{state.successCount}</span>
                  <span className="success font-light spacer-left-025rem">{t('Uploaded Successfully')}</span>
                </div>
              ) : null}
              {state.errorsCount ? (
                <div className="error-count">
                  <span className="error">{state.errorsCount}</span>
                  <span className="error font-light spacer-left-025rem">{t('Errors')}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="progressBarContainer">
            <div className="progressBar" style={{ width: `${percentsFloat()}%` }} />
          </div>

          <div className="upload-progress columns">
            {state.uploadDetailsVisible ? (
              <div
                className="toggle-details flush-left cursor-pointer"
                onClick={() => setState((prevState) => ({ ...prevState, uploadDetailsVisible: false }))}
              >
                <ChevronDownIcon className="icon-size-20" />
                <span className="font-light vertical-top spacer-left-025rem">{t('Hide Details')}</span>
              </div>
            ) : (
              <div
                className="toggle-details flush-left cursor-pointer"
                onClick={() => setState((prevState) => ({ ...prevState, uploadDetailsVisible: true }))}
              >
                <ChevronRightIcon className="icon-size-20" />
                <span className="font-light vertical-top spacer-left-025rem">{t('Show Details')}</span>
              </div>
            )}
            <div className="files-remaining push-right font-light">{filesLeft()}</div>
            <div className="progress no-spacer-right">{percents()}%</div>
          </div>

          {state.uploadDetailsVisible ? (
            <table id="tblProjectList" className="noselect upload-file-list">
              <tbody id="ProjectList">{state.uploadedList.map(renderTableRow)}</tbody>
            </table>
          ) : null}
        </>
      )}
    </>
  );
};

DicomUploader.propTypes = {
  id: PropTypes.string,
  event: PropTypes.string,
  url: PropTypes.string,
  retrieveAuthHeaderFunction: PropTypes.func,
};

export default DicomUploader;
