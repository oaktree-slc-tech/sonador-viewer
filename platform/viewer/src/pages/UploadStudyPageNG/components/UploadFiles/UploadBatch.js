import React, { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import OHIF, { utils } from '@ohif/core';

import { ReactComponent as CaretIcon } from '@ohif/ui/src/elements/Svg/svgs/caret-down.svg';
import { ReactComponent as ChevronDown } from '@ohif/ui/src/elements/Svg/svgs/chevron-down.svg';
import { ReactComponent as CloseIcon } from '@ohif/ui/src/elements/Icon/icons/times.svg';

import { ReactComponent as FileIcon } from '@ohif/ui/src/elements/Svg/svgs/file.svg';

import { FILE_STATES, batchCounts, fileState } from './logic';

import styles from './UploadFiles.module.scss';


// What a file's row says about it: its state, and the message of its last failed send
const fileStatusText = (file, t) => {
  switch (fileState(file)) {
    case FILE_STATES.UPLOADED:
      return t('Uploaded');
    case FILE_STATES.WARNING:
      return t('Retrying') + ` ${file.attempt}/${file.attempts}`;
    case FILE_STATES.ERROR:
      return t('Failed') + (file.attempt > 1 ? ` ${file.attempt}/${file.attempts}` : '');
    default:
      return t('Pending');
  }
};


function UploadBatch({ uid, files, onUploadCancel, onUploadClose, onViewDetails, isLarge, isDesktop, complete=false, variant='drawer' }) {
  // Manage the upload state of the upload batch

  const { t } = useTranslation();

  // Batch progress: files settled one way or the other drive the bar; the counts beside it say
  // how many are retrying (warnings), how many are lost (errors) and how many re-sends it took
  const { total, completed, warnings, errors, retries } = batchCounts(files);
  const settled = completed + errors;
  const pct = total ? Math.floor((settled / total) * 100) : 0;

  // Upload file tracking
  const [isExpanded, setIsExpanded] = useState(false);
  const [batchState, setBatchState] = useState(complete || (total === settled) ? 'complete' : 'pending');

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

    // Mark the state of the upload as complete once every file is settled: uploaded or failed.
    if (complete || (total == settled)) {
      setBatchState('complete');
    }
  }, [settled, complete])


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
            <span className={styles.metaValue}>{completed}</span>
            <span className={styles.metaLabel}>{t('completed')}</span>
          </div>
          {/* Warnings, errors and retries are shown only while there are any: a zero says nothing */}
          {warnings > 0 && (
            <div className={classNames(styles.metaStat, styles.warning)} title={t('Files with a failed send that are being retried')}>
              <span className={styles.metaValue}>{warnings}</span>
              <span className={styles.metaLabel}>{t('warnings')}</span>
            </div>
          )}
          {errors > 0 && (
            <div className={classNames(styles.metaStat, styles.error)} title={t('Files that could not be uploaded')}>
              <span className={styles.metaValue}>{errors}</span>
              <span className={styles.metaLabel}>{t('errors')}</span>
            </div>
          )}
          {retries > 0 && (
            <div className={styles.metaStat} title={t('Sends repeated after a failure')}>
              <span className={styles.metaValue}>{retries}</span>
              <span className={styles.metaLabel}>{t('retries')}</span>
            </div>
          )}
        </div>

        <div className={styles.progressInline}>
          <div className={styles.progressBarWrapper}>
            <div
              className={classNames(styles.progressBar, {
                [styles.completed]: pct === 100 && errors === 0,
                [styles.error]: pct === 100 && errors > 0,
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
            {/* Icon leads the label per Apple HIG for Cancel/Close actions */}
            <CloseIcon className={styles.closeIcon} />
            <span className={styles.cancelText}>{!complete && batchState === 'pending' ? t('Cancel') : t('Close') }</span>
          </button>
        </div>
      </section>

      {isExpanded && (
        <div className={styles.uploadedFiles}>
        {files.map((f) => {
          const state = fileState(f);
          return (
          <div key={f.fileId} className={styles.uploadedFile}>
            {(isLarge || isDesktop) && <FileIcon />}
            <div className={styles.uploadedFileInfo}>
              <div className={styles.uploadedFileHeader}>
                <p className={styles.filename}>
                  {f.name} {state === FILE_STATES.ERROR ? '' : `(${f.processed ? 100 : 0}%)`}
                </p>
                <p
                  className={classNames(styles.statusLabel, {
                    [styles.completed]: state === FILE_STATES.UPLOADED,
                    [styles.warning]: state === FILE_STATES.WARNING,
                    [styles.error]: state === FILE_STATES.ERROR,
                  })}
                >
                  {fileStatusText(f, t)}
                </p>
              </div>

              <div className={styles.progressBarWrapper}>
                <div
                  style={{ width: f.processed ? '100%' : 0 }}
                  className={classNames(styles.progressBar, {
                    [styles.completed]: state === FILE_STATES.UPLOADED,
                    [styles.error]: state === FILE_STATES.ERROR,
                  })}
                />
              </div>

              {/* The last failed send's message, while the file is retried and once it has failed */}
              {f.error && (state === FILE_STATES.WARNING || state === FILE_STATES.ERROR) && (
                <p className={classNames(styles.fileMessage, { [styles.error]: state === FILE_STATES.ERROR })}>
                  {f.error}
                </p>
              )}
            </div>
          </div>
          );
        })}
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
          <th>Message</th>
        </tr>
      </thead>
      <tbody>
        {files.map((f) => {
          const state = fileState(f);
          return (
          <tr
            key={f.fileId}
            className={classNames(styles.modalTableRow, {
              [styles.warning]: state === FILE_STATES.WARNING,
              [styles.error]: state === FILE_STATES.ERROR,
            })}
          >
            <td>{f.fileId+1}</td>
            <td>{f.name}</td>
            <td>{utils.formatBytes(f.size)}</td>
            <td
              className={classNames(styles.status, {
                [styles.success]: state === FILE_STATES.UPLOADED,
                [styles.warning]: state === FILE_STATES.WARNING,
                [styles.error]: state === FILE_STATES.ERROR,
              })}
            >
              {fileStatusText(f, t)}
            </td>
            <td className={styles.message}>
              {(state === FILE_STATES.WARNING || state === FILE_STATES.ERROR) ? f.error : ''}
            </td>
          </tr>
          );
        })}
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