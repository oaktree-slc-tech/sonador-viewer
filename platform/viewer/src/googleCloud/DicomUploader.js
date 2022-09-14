import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { Line } from 'rc-progress';
import { withTranslation } from 'react-i18next';

import { formatFileSize } from './utils/helpers';
import CancellationToken from './utils/CancellationToken';
import dicomUploader from './api/DicomUploadService';

// Icons
import {
  ChevronRightIcon, ChevronDownIcon, CheckIcon, ShieldExclamationIcon, XCircleIcon,
} from '@heroicons/react/24/solid';

// Upload button SVG files
import buttonFile from './icons/button-file.svg';
import buttonFolder from './icons/button-folder.svg';

// General and uploader styling
import '../styles/global-viewer.css';
import './googleCloud.css';
import './styles/dicom-uploader.css';


// Retry limit
const retryLimit = 100;
const notValidDicomFileError = 'This is not a valid DICOM file.'


class DicomUploader extends Component {
  // DICOM uploader: provides tools to transfer files to a DICOMweb server

  state = {
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
    uploadContext: null, // this is probably not needed, but we use this variable to distinguish between different downloads
    uploadDetailsVisible: false,
  };

  static propTypes = {
    id: PropTypes.string,
    event: PropTypes.string,
    url: PropTypes.string,
    retrieveAuthHeaderFunction: PropTypes.func,
  };

  filesLeft() {
    // Number of files left in the transfer queue
    // @returns str
    return (
      this.state.uploadedList.length + this.props.t(' of ') + this.state.totalCount + this.props.t(' files')
    );
  }

  volumeLeft() {
    // Size of transfer remaining
    // @returns str
    let left = formatFileSize(this.state.uploadedVolume);
    return left + this.props.t(' of ') + this.state.wholeVolumeStr;
  }

  percentsFloat() {
    // Progress of uploads
    // @returns float
    return (100 * this.state.uploadedList.length) / Object.keys(this.state.files).length;
  }

  percents() {
    // Progress of uploads
    // @returns int
    return parseInt(this.percentsFloat());
  }

  isFinished() {
    // Has the active upload finished processing

    return (
      this.state.isCancelled ||
      Object.keys(this.state.files).length === this.state.uploadedList.length
    );
  }

  errorsMessage() {
    const errors = this.state.errorsCount === 1 ? ' error' : ' errors';
    return (
      this.state.errorsCount + errors + this.props.t(' while uploading, click for more info')
    );
  }

  uploadFiles = files => {
    // Upload files to DICOMweb server

    // Index files by their position in the upload iterable
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
    const wholeVolume = filesArray.map(f => f.size).reduce((a, b) => a + b);
    const uploadContext = Math.random();

    // Set initial state properties in preparation for uploading files to the server.
    this.setState({
      status: 'Uploading...',
      files: filesDict,
      uploadedList: [],
      uploadedVolume: 0,
      lastFile: filesArray[0].name,
      totalCount: filesArray.length,
      wholeVolumeStr: formatFileSize(wholeVolume),
      uploadContext: uploadContext,
      cancellationToken: new CancellationToken(),
    });

    // Create state token that allows for the user to terminate uploads early.
    const cancellationToken = new CancellationToken();
    const uploadCallback = (fileId, error, filesArray) =>
      uploadContext === this.state.uploadContext &&
      this.uploadCallback.call(this, fileId, error, filesArray);

    // Configure DICOM upload service and begin upload of files
    dicomUploader.setRetrieveAuthHeaderFunction(this.props.retrieveAuthHeaderFunction);
    dicomUploader.smartUpload(files.target.files, this.props.url, uploadCallback, cancellationToken);
  };

  uploadCallback(fileId, error, filesArray) {
    // Callback invoked on the completion of a file upload. Updates error list
    // and adds details about the transfer to the log. If there was an error in transfer
    // and the retry limit has not yet been reached, re-queue for transfer.

    // Retrieve reference to file and mark as processed
    const file = this.state.files[fileId];

    if (!error) {
      // File uploaded successfully

      // Set file state properites
      file.processed = true;
      file.error = null;

      let uploadedVolume = this.state.uploadedVolume + file.size;
      this.setState({ uploadedVolume });
      this.setState({ successCount: this.state.successCount + 1 });

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
        this.setState({ errorsCount: this.state.errorsCount + 1 });
      }
    }

    // Update component state: last file and uploaded file list
    this.setState({ lastFile: file.name });
    let uploadedList = this.state.uploadedList;
    if (uploadedList.indexOf(file) == -1) {
      
      // Add file to uploaded list (if not already a member)
      uploadedList.push(file);
    }
    this.setState({ uploadedList });
  }

  renderTableRow = file => {
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

      message = <span className="warning spacer-left-3rem vertical-top font-light">{this.props.t('Error & Retry')}</span>;
      error = <span className="spacer-left-05rem vertical-top">{file.error}</span>;
      if (file.retry) {
        rmessage = <span className="spacer-left-2rem vertical-top">{file.retry}/{retryLimit}</span>;
      }

    } else if (file.error !== null) {
      // File upload failed

      message = <span className="error spacer-left-3rem vertical-top font-light">{this.props.t('Error/Failed')}</span>;
      error = <span className="spacer-left-3rem vertical-top">{file.error}</span>;
      if (file.retry) {
        rmessage = <span className="error spacer-left-2rem vertical-top">{file.retry}/{retryLimit}</span>;
      }
    } else {
      // File transfer successful

      message = <span className="spacer-left-3rem font-light vertical-top">{this.props.t('Successful')}</span>;      
    }

    return (
      <tr key={file.id}><td>{sicon}
        <span className="spacer-left-2rem vertical-top">{file.name}</span>
        {message}{error}{rmessage}
      </td></tr>
    );
  };

  render() {
    const { t } = this.props;

    if (this.state.files === null) {

      // Upload Controls      
      return (
        <div className="dicom-uploader">
          <div className="button">
            <label htmlFor="file">{React.createElement(buttonFile)}</label>
            <input id="file" className="invisible-input" type="file"
              onChange={this.uploadFiles}
              multiple />
          </div>

          <div className="button">
            <label htmlFor="folder">{React.createElement(buttonFolder)}</label>
            <input id="folder" className="invisible-input" type="file"
              onChange={this.uploadFiles}
              webkitdirectory="true" mozdirectory="true"
              multiple />
          </div>
        </div>
      );
    }

    // Upload Progress
    return (<>
      {(this.state.errorsCount || this.state.successCount) ? (
        <div className="upload-summary columns">
          <div className="push-right"></div>
          {this.state.successCount ? (
            <div className="success-count">
              <span className="success">{this.state.successCount}</span>
              <span className="success font-light spacer-left-025rem">{t('Uploaded Successfully')}</span>
            </div>
          ): null}
          {this.state.errorsCount ? (
            <div className="error-count">
              <span className="error">{this.state.errorsCount}</span>
              <span className="error font-light spacer-left-025rem">{t('Errors')}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Progress Bar */}
      <Line percent={this.percentsFloat()} strokeWidth={4} strokeColor='#0BBDE2' />
      
      {/* Progress Summary */}
      <div className="upload-progress columns">
        {this.state.uploadDetailsVisible ? (
          <div className="toggle-details flush-left cursor-pointer" 
              onClick={() => this.setState({ uploadDetailsVisible : false})}>
            <ChevronDownIcon className="icon-size-20" />
            <span className="font-light vertical-top spacer-left-025rem">{t('Hide Details')}</span>
          </div>
        ) : (
          <div className="toggle-details flush-left cursor-pointer" 
              onClick={() => this.setState({ uploadDetailsVisible : true})}>
            <ChevronRightIcon className="icon-size-20" />
            <span className="font-light vertical-top spacer-left-025rem">{t('Show Details')}</span>
          </div>
        )}
        <div className="files-remaining push-right font-light">{this.filesLeft()}</div>
        <div className="progress no-spacer-right">{this.percents()}%</div>
      </div>

      {/* File Transfer List */}
      {this.state.uploadDetailsVisible ? (
        <table id="tblProjectList" className="noselect upload-file-list">
          <tbody id="ProjectList">{this.state.uploadedList.map(this.renderTableRow)}</tbody>
        </table>
      ) : null}      
    </>);
  }
}


export default withTranslation('Common')(DicomUploader);