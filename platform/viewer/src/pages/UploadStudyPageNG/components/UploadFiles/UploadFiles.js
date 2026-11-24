// File uploader for Sonador Study List. Provides components to create "batches" 
// of files with progress reporting, state management, and the abiltiy to cancel upload.
//
// A failed transfer is retried by the upload service from the back of the batch's queue, up to
// the attempt budget the Uploads preference sets (imaging-development-env#103). Each file carries
// what the service reports -- sends made, last error, whether another send is coming -- and the
// batch shows the resulting warning, error and retry counts and each file's message.

import { flatten, isFunction } from 'lodash';

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import OHIF, { UPLOAD_ATTEMPTS_DEFAULT, UPLOAD_ATTEMPTS_PREFERENCE_KEY, UserPreferencesService } from '@ohif/core';
import ModalNG from '@ohif/ui/src/components/ModalNG/ModalNG';
import { ReactComponent as ErrorIcon } from '@ohif/ui/src/elements/Svg/svgs/error.svg';
import { ReactComponent as FileIcon } from '@ohif/ui/src/elements/Svg/svgs/file.svg';
import { ReactComponent as UploadIcon } from '@ohif/ui/src/elements/Svg/svgs/upload-cloud.svg';

import dicomUploader from '../../../../googleCloud/api/DicomUploadService';
import CancellationToken from '../../../../googleCloud/utils/CancellationToken';
import { useDeviceStore } from '../../../../store/useDeviceStore';

import { processFileEntry } from './logic';
import UploadBatch from './UploadBatch';

import styles from './UploadFiles.module.scss';


const _fileUploadItems = (batchId, files) => {
  // Add file identifiers and other metadata needed by the DICOM upload service
  return files.map((f, idx) => {

    // Add batchId and array index as ID for the file
    f.batchId = batchId;
    f.fileId = idx;

    // Transfer state, set by the upload callback
    f.attempt = 0;
    f.error = null;
    f.processed = false;
    f.failed = false;
    
    return f;
  });
}

// The attempt budget per file, as the user set it (Settings > General > Uploads), read when a
// batch starts so a change never alters a batch already running
const _uploadAttempts = () =>
  UserPreferencesService?.getGeneral?.(UPLOAD_ATTEMPTS_PREFERENCE_KEY) ?? UPLOAD_ATTEMPTS_DEFAULT;


export default function UploadFiles({ onUpload }) {
  // File upload manager for the Sonador Viewer. Provides drag/drop canvas and controls
  // to queue files for upload. Each interaction with the file viewer creates a "Batch"
  // for upload.

  const { t } = useTranslation();

  // Server and authentication
  const activeServer = useSelector((state) =>
    state.servers.servers.find((s) => s.active)
  );
  dicomUploader.setRetrieveAuthHeaderFunction(() => OHIF.DICOMWeb.getAuthorizationHeader(activeServer));

  const { isLarge, isDesktop } = useDeviceStore();

  // Local UI state (no upload orchestration here)
  const [dragging, setDragging] = useState(false);

  // Uploads being managed by the uploader
  const [uploadQueue, setUploadQueue] = useState([]);
  
  // Upload details to be displayed in the modal "details" view
  const [isOpenedViewAllModal, setIsOpenedViewAllModal] = useState(false);
  const [modalSelectedUpload, setModalSelectedUpload] = useState(null);
  
  const handleFileUpload = (batchUid, fileIdx, error, status) => {
    // Callback function used by the DICOM file upload service, after every send of a file.
    // `status` says how many sends the file has had and whether another one is scheduled.

    const { attempt = 0, attempts = 0, willRetry = false } = status || {};

    // Update upload queue
    setUploadQueue((prevState) => {
      return prevState.map((u) => {

        // Update status of file
        if (u.uid && u.uid == batchUid) {

          // Update file upload status attributes. A failed send that will be retried leaves the
          // file pending, with its last message; a send that will not be repeated settles it.
          const file = u.files[fileIdx];
          file.attempt = attempt;
          file.attempts = attempts;
          file.error = error || null;
          file.processed = !willRetry;
          file.failed = !!error && !willRetry;
        }

        return u;
      })
    });

    // The details modal shows the same batch object: re-render it with the updated files
    setModalSelectedUpload((prevState) => (
      prevState && prevState.uid == batchUid ? { ...prevState } : prevState
    ));
  }

  const handleFileUploadComplete = (batchUid) => {
    // Mark upload state as complete

    // Update the state of the upload job in the queue
    setUploadQueue((prevState) => {
      return prevState.map((u) => {
        if (u.uid == batchUid) { u.complete = true; }
        return u;
      });
    });

    // Update the state of the job in the modal (if one is selected)
    if (modalSelectedUpload && modalSelectedUpload.uid == batchUid) {
      setModalSelectedUpload((prevState) => {
        prevState.complete = true;
        return prevState;
      });
    }

    // Trigger onUpload callback for the upload files component
    if (onUpload && isFunction(onUpload)) {
      onUpload();
    }
  }

  const handleDragEnter = (e) => {
    // State handler for the drag/drop canvas: enter
    e.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = () => {
    // State handler for the drag/drop canvas: leave
    setDragging(false);
  };

  const handleDrop = async (e) => {
    // Unpack files dropped on the canvas and prepare a file batch
    e.preventDefault();
    setDragging(false);

    const items = e.dataTransfer.items;
    const processedFiles = await Promise.all(
      Array.from(items).map((item) => {
        if (item.webkitGetAsEntry) {
          const entry = item.webkitGetAsEntry();
          if (entry) {
            return processFileEntry(entry);
          }
        }
        
        return Promise.resolve(null);
      })
    );

    startBatch(flatten(processedFiles).filter(Boolean));
  };

  const startBatch = (selected) => {
    // Create state object for managing the upload and begin the transfer

    const uid = OHIF.utils.guid();
    const files = _fileUploadItems(uid, selected);
    const cancelUpload = new CancellationToken();
    const attempts = _uploadAttempts();
    const uploadCallback = (fileId, error, queue, status) => handleFileUpload(uid, fileId, error, status);

    // Begin file upload
    const job = dicomUploader.smartUpload(
      files, activeServer && activeServer.qidoRoot, uploadCallback, cancelUpload, {
        attempts,
        success: () => handleFileUploadComplete(uid),
      });

    setUploadQueue((prevState) => {
      return [
        ...prevState,
        { uid, files, attempts, cancelUpload, uploadCallback, job, complete: false, },
      ]
    });
  };

  const handlePickFilesOrFolder = async (e) => {
    // Group selected files/folder into ONE batch list
    const selected = Array.from(e.target.files || []);
    if (selected.length) {
      startBatch(selected);
    }
  };

  const handleCancel = (_uid) => {
    // Cancel the file upload and remove it from the upload queue
    
    const _upload = uploadQueue.find((u) => u.uid == _uid);
    if (_upload) {
      _upload.cancelUpload.set(true);

      setUploadQueue((prevState) => {

        // Update queue to trigger re-render of upload controls
        return prevState.map((u) => {
          if (u.uid == _uid) {
            return _upload;
          }

          return u;
        });
      });
    }
  }

  const handleClose = (_uid) => {
    // Close the file upload and remove it from the upload queue

    setUploadQueue((prevState) => {
      return prevState.filter((u) => u.uid != _uid);
    });
  }

  const handleViewDetails = (_uid) => {
    // Display the details of the specified batch by opening it in the modal dialog
    
    const _upload = uploadQueue.find((u) => u.uid == _uid);
    if (_upload) {
      setModalSelectedUpload(_upload);
      setIsOpenedViewAllModal(true);
    }
  }

  const handleModalRemove = (_uid) => {
    // Close the modal dialog and remove the upload from the queue
    
    setModalSelectedUpload(null);
    setIsOpenedViewAllModal(false);
    handleClose(_uid);
  }


  return (
    <>
      <div className={styles.uploadContainer}>
        
        {/* File Upload Controls: Browse Files, Browse Folders, Drag/Drop */}
        <div className={styles.upload}>
          <div
            className={classNames(styles.noFile, { [styles.dragging]: dragging })}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <UploadIcon fill="#D3D3D3" className={styles.uploadIcon} />
            <p className={styles.dropHereLabel}>{t('Drop files here for immediate upload.')}</p>
            <p className={styles.orLabel}>{t('OR')}</p>
            <div className={styles.inputsContainer}>
              <label htmlFor="file" className={styles.inputFileLabel}>
                {t('Browse Files')}
              </label>
              <input
                type="file"
                id="file"
                multiple
                onChange={handlePickFilesOrFolder}
                className={styles.inputFile}
              />

              <label htmlFor="folder" className={styles.inputFileLabel}>
                {t('Browse Folders')}
              </label>
              <input
                type="file"
                id="folder"
                multiple
                onChange={handlePickFilesOrFolder}
                className={styles.inputFile}
                webkitdirectory="true"
                mozdirectory="true"
                directory="true"
              />
            </div>
          </div>
        </div>

        {/* Upload Queue */}
        {!!uploadQueue.length && (
          <div className={styles.uploadedFilesContainer}>
            <div className={styles.uploadedFilesHeader}>
              <p className={styles.uploadedFilesLabel}>{t('File Uploads')}</p>
            </div>
            <>
            {uploadQueue.map(({ uid, files, cancelUpload, complete }, idx) => (
              <UploadBatch key={idx}
                uid={uid} files={files} complete={complete} cancelled={cancelUpload}
                onUploadCancel={handleCancel} onUploadClose={handleClose} onViewDetails={handleViewDetails}
                isLarge={isLarge} isDesktop={isDesktop}
              />
            ))}
            </>
          </div>
        )}
      </div>

      {/* File Upload Modal */}
      {isOpenedViewAllModal && modalSelectedUpload && (
        <ModalNG
          isOpen={isOpenedViewAllModal}
          onClose={() => setIsOpenedViewAllModal(false)}
          title="Uploaded Files"
          classes={{ content: styles.modalContent }}
        >
          <UploadBatch key={modalSelectedUpload.uid}
            {...modalSelectedUpload}
            cancelled={modalSelectedUpload.cancelUpload}
            onUploadCancel={handleCancel} onUploadClose={handleModalRemove} onViewDetails={() => null}
            isLarge={isLarge} isDesktop={isDesktop}
            variant="modal"
          />
        </ModalNG>
      )}
    </>
  );
}


UploadFiles.propTypes = {
  onUpload: PropTypes.func,
}