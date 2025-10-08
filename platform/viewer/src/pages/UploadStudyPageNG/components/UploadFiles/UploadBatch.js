import React, { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import OHIF, { utils } from '@ohif/core';

import { ReactComponent as CaretIcon } from '@ohif/ui/src/elements/Svg/svgs/caret-down.svg';
import { ReactComponent as ChevronDown } from '@ohif/ui/src/elements/Svg/svgs/chevron-down.svg';
import { ReactComponent as CloseIcon } from '@ohif/ui/src/elements/Icon/icons/times.svg';

import { ReactComponent as FileIcon } from '@ohif/ui/src/elements/Svg/svgs/file.svg';

import styles from './UploadFiles.module.scss';


function UploadBatch({ uid, files, onUploadCancel, onUploadClose, onViewDetails, isLarge, isDesktop, complete=false, variant='drawer' }) {
  // Manage the upload state of the upload batch

  const { t } = useTranslation();

  // Batch progress
  const total = files.length;
  const completed = !complete ? files.filter(f => f.processed && !f.failed).length : total;
  const pct = total ? Math.floor((completed / total) * 100) : 0;

  // Upload file tracking
  const [isExpanded, setIsExpanded] = useState(false);
  const [batchState, setBatchState] = useState(complete || (total === completed) ? 'complete' : 'pending');

  const handleClose = (evt) => {
    // Cancel all downloads and remove the batch from the list
    
    if (batchState == 'pending') {

      // Cancel the upload
      onUploadCancel(uid);
      setBatchState('cancelled');

    } else if (batchState == 'complete' || batchState == 'cancelled') {

      // Close upload and remove from queue
      onUploadClose(uid);
    }
  }

  const handleViewDetails = (evt) => {
    // Trigger onViewDetails event handler

    onViewDetails(uid);
  }

  useEffect(() => {

    // Mark the state of the upload as complete if all files have been uploaded.
    if (complete || (total == completed)) {
      setBatchState('complete');
    }
  }, [completed, complete])


  // Drawer layout: upload overview and files detail
  if (variant === 'drawer') {
    return (
      <>
      <section className={classNames(styles.uploadBatchMeta)}>
        
        <div className={styles.summaryLeft} onClick={() => setIsExpanded(!isExpanded)}>
          <ChevronDown
            className={classNames(styles.expanderIcon, { [styles.expanded]: isExpanded })}
          />
          <div className={styles.metaStat}>
            <span className={styles.metaValue}>{total}</span>
            <span className={styles.metaLabel}>{t('files')}</span>
          </div>
          <div className={styles.metaStat}>
            <span className={styles.metaValue}>{complete ? total : completed}</span>
            <span className={styles.metaLabel}>{t('completed')}</span>
          </div>
        </div>

        <div className={styles.progressInline}>
          <div className={styles.progressBarWrapper}>
            <div
              className={classNames(styles.progressBar, {
                [styles.completed]: pct === 100,
              })}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className={styles.progressPct}>{pct}%</span>
        </div>

        <div className={styles.summaryRight}>
          <button className={styles.viewAll} onClick={handleViewDetails}>
            {t('Details')}
          </button>
          <button type="button" className={styles.cancelBtn} onClick={handleClose}>
            <span className={styles.cancelText}>{!complete && batchState === 'pending' ? t('Cancel') : t('Close') }</span>
            <CloseIcon className={styles.closeIcon} />
          </button>
        </div>
      </section>

      {isExpanded && (
        <div className={styles.uploadedFiles}>
        {files.map((f) => (
          <div key={f.fileId} className={styles.uploadedFile}>
            {(isLarge || isDesktop) && <FileIcon />}
            <div className={styles.uploadedFileInfo}>
              <div className={styles.uploadedFileHeader}>
                <p className={styles.filename}>
                  {f.name} {f.failed ? '' : `(${f.processed ? 100 : 0}%)`}
                </p>
                <p
                  className={classNames(styles.statusLabel, {
                    [styles.completed]: !f.failed && f.processed,
                    [styles.error]: f.failed,
                  })}
                >
                  {/* Stub: no status text yet */}
                </p>
              </div>

              <div className={styles.progressBarWrapper}>
                <div
                  style={{ width: f.processed || f.failed ? '100%' : 0 }}
                  className={classNames(styles.progressBar, {
                    [styles.completed]: !f.failed && f.processed,
                    [styles.error]: f.failed,
                  })}
                />
              </div>
            </div>
          </div>
        ))}
        </div>
      )}
      </>
    );
  }

  // Modal variant: file and upload details
  return (
    <>
    <div className={styles.modalContentWrapper}>
    <table className={styles.modalTable}>
      <thead>
        <tr className={styles.modalTableHeader}>
          <th>#</th>
          <th>File Name</th>
          <th>File Size</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {files.map((f) => (
          <tr
            key={f.fileId}
            className={classNames(styles.modalTableRow, {
              [styles.error]: f.failed,
            })}
          >
            <td>{f.fileId+1}</td>
            <td>{f.name}</td>
            <td>{utils.formatBytes(f.size)}</td>
            <td
              className={classNames(styles.status, {
                [styles.success]: f.processed && !f.failed,
              })}
            >
              {f.processed && !f.error && t('Uploaded')}
              {f.processed && !f.error && t(f.error)}
              {!f.processed && t('Pending')}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
    </>
  );
}

UploadBatch.propTypes = {
  uid: PropTypes.string.isRequired,
  files: PropTypes.array.isRequired,
  complete: PropTypes.bool.isRequired,
  onUploadCancel: PropTypes.func.isRequired,
  onUploadClose: PropTypes.func.isRequired,
  onViewDetails: PropTypes.func.isRequired,
  isLarge: PropTypes.bool,
  isDesktop: PropTypes.bool,
  variant: PropTypes.oneOf(['drawer', 'modal']),
};

export default UploadBatch;