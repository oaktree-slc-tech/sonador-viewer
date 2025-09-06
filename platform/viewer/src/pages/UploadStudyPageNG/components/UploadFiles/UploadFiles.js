import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import classNames from 'classnames';
import { flatten } from 'lodash';

import OHIF from '@ohif/core';
import ModalNG from '@ohif/ui/src/components/ModalNG/ModalNG';
import { ReactComponent as ErrorIcon } from '@ohif/ui/src/elements/Svg/svgs/error.svg';
import { ReactComponent as FileIcon } from '@ohif/ui/src/elements/Svg/svgs/file.svg';
import { ReactComponent as UploadIcon } from '@ohif/ui/src/elements/Svg/svgs/upload-cloud.svg';

import dicomUploader from '../../../../googleCloud/api/DicomUploadService';
import CancellationToken from '../../../../googleCloud/utils/CancellationToken';
import { useDeviceStore } from '../../../../store/useDeviceStore';

import { getStatusLabel, notValidDicomFileError, processFileEntry, retryLimit } from './logic';

import styles from './UploadFiles.module.scss';

export default function UploadFiles() {
  const { t } = useTranslation();

  const activeServer = useSelector((state) => state.servers.servers.find((s) => s.active));

  const { isLarge, isDesktop } = useDeviceStore();

  const [allFiles, setAllFiles] = useState([]);
  const [uploadedList, setUploadedList] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [isOpenedViewAllModal, setIsOpenedViewAllModal] = useState(false);

  const handleDragEnter = (e) => {
    e.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = () => {
    setDragging(false);
  };

  const handleDrop = async (e) => {
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

    uploadFiles(flatten(processedFiles), true);
  };

  const uploadFiles = (files, isDropped = false) => {
    const filesArray = isDropped ? files : Array.from(files.target.files);
    const uploadedFilesLength = allFiles.length;

    const newFiles = filesArray.map((file, i) => {
      file.fileId = uploadedFilesLength + i;

      return {
        id: uploadedFilesLength + i,
        name: file.name,
        path: file.webkitRelativePath || file.name,
        size: file.size,
        error: null,
        processed: false,
        processedInUI: false,
        ref: file,
      };
    });
    setAllFiles((prevState) => [...prevState, ...newFiles]);
    const cancellationToken = new CancellationToken();

    dicomUploader.setRetrieveAuthHeaderFunction(() => OHIF.DICOMWeb.getAuthorizationHeader(activeServer));
    dicomUploader.smartUpload(
      isDropped ? files : files.target.files,
      activeServer && activeServer.qidoRoot,
      (fileId, error, filesArray) => {
        const file = newFiles[fileId - uploadedFilesLength];

        if (!error) {
          file.processed = true;
          file.error = null;
        } else {
          file.error = error;

          if ((file.retry || 0) < retryLimit && !(error || '').includes(notValidDicomFileError)) {
            file.retry = (file.retry || 0) + 1;
            filesArray.unshift(file.ref);
          } else {
            file.failed = true;
          }
        }

        if (uploadedList.indexOf(file) === -1) {
          setUploadedList((prevState) => [...prevState, file]);
        }
      },
      cancellationToken
    );
  };

  return (
    <>
      <div className={styles.header}>
        <p className={styles.headerLabel}>{t('Upload')}</p>
        <p className={styles.investigational}>{t('INVESTIGATIONAL USE ONLY')}</p>
      </div>
      <div className={styles.uploadContainer}>
        <div className={styles.upload}>
          <div
            className={classNames(styles.noFile, {
              [styles.dragging]: dragging,
            })}
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
              <input type="file" id="file" multiple onChange={uploadFiles} className={styles.inputFile} />
              <label htmlFor="folder" className={styles.inputFileLabel}>
                {t('Browse Folders')}
              </label>
              <input
                type="file"
                id="folder"
                multiple
                onChange={uploadFiles}
                className={styles.inputFile}
                webkitdirectory="true"
                mozdirectory="true"
                directory="true"
              />
            </div>
          </div>
        </div>
        {!!allFiles.length && (
          <div className={styles.uploadedFilesContainer}>
            <div className={styles.uploadedFilesHeader}>
              <p className={styles.uploadedFilesLabel}>{t('Uploaded Files')}</p>
              <button className={styles.viewAll} onClick={() => setIsOpenedViewAllModal(true)}>
                {t('View All')}
              </button>
            </div>
            <div className={styles.uploadedFiles}>
              {allFiles.map(({ name, id }) => {
                const { failed = false, processed = false } = uploadedList.find((uploaded) => uploaded.id === id) || {};

                return (
                  <div key={id} className={styles.uploadedFile}>
                    {(isLarge || isDesktop) && <FileIcon />}
                    <div className={styles.uploadedFileInfo}>
                      <div className={styles.uploadedFileHeader}>
                        <p className={styles.filename}>
                          {name} {failed ? '' : `(${processed ? 100 : 0}%)`}
                        </p>
                        <p
                          className={classNames(styles.statusLabel, {
                            [styles.completed]: !failed && processed,
                            [styles.error]: failed,
                          })}
                        >
                          {(processed || failed) && getStatusLabel(failed, processed)}
                        </p>
                      </div>
                      <div className={styles.progressBarWrapper}>
                        <div
                          style={{ width: processed || failed ? `100%` : 0 }}
                          className={classNames(styles.progressBar, {
                            [styles.completed]: !failed && processed,
                            [styles.error]: failed,
                          })}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {isOpenedViewAllModal && (
        <ModalNG
          isOpen={isOpenedViewAllModal}
          onClose={() => setIsOpenedViewAllModal(false)}
          title="Uploaded Files"
          classes={{ content: styles.modalContent }}
        >
          <table className={styles.modalTable}>
            <thead>
              <tr className={styles.modalTableHeader}>
                <th>#</th>
                <th>File Name</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {allFiles.map(({ name, id }) => {
                const { failed = false, processed = false } = uploadedList.find((uploaded) => uploaded.id === id) || {};

                return (
                  <tr
                    key={id}
                    className={classNames(styles.modalTableRow, {
                      [styles.error]: failed,
                    })}
                  >
                    <td>{id + 1}</td>
                    <td>{name}</td>
                    <td
                      className={classNames(styles.status, {
                        [styles.success]: processed && !failed,
                      })}
                    >
                      {failed ? (
                        <div className={styles.tableItemStatusError}>
                          <ErrorIcon />
                          <span>Error</span>
                        </div>
                      ) : processed ? (
                        'Successful'
                      ) : (
                        ''
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ModalNG>
      )}
    </>
  );
}
