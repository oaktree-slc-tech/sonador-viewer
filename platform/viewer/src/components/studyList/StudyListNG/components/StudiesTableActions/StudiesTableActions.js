import React, { useContext, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useNavigate, useLocation } from 'react-router-dom';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import OHIF, {
  display,
  redux,
  DicomMetadataStore,
  LocalCacheService,
  DownloadManagerService,
  ArchiveDownloadService,
  notifyStudiesQueued,
  notifyArchivesQueued,
} from '@ohif/core';

import { ReactComponent as DownloadIcon } from '@ohif/ui/src/elements/Svg/svgs/cloud-download.svg';
import { ReactComponent as OfflineCacheIcon } from '@ohif/ui/src/elements/Icon/icons/offline-cache.svg';
import { ReactComponent as EyeIcon } from '@ohif/ui/src/elements/Svg/svgs/eye.svg';
import { ReactComponent as UpdateStatusIcon } from '@ohif/ui/src/elements/Svg/svgs/reload-circle.svg';
import { ReactComponent as ViewAndProcessIcon } from '@ohif/ui/src/elements/Svg/svgs/search-circle.svg';
import { ReactComponent as ShareIcon } from '@ohif/ui/src/elements/Svg/svgs/share.svg';

import AppContext from '../../../../../context/AppContext';
import { parseViewerPath } from '../../../../../routes/routesUtil';
import { useWorkListStore } from '../../../../../store/useWorkListStore';
import StudiesTableShareModal from '../StudiesTableShareModal/StudiesTableShareModal';
import {
  _getStudyInstanceUID,
  _getStudyDescriptor,
} from '../SelectAndSettingsAndExpandCell/SelectAndSettingsAndExpandCell.js';

import UpdateWorklistModal from './components/UpdateWorklistModal';

import styles from './StudiesTableActions.module.scss';


export default function StudiesTableActions({  selectedRows, isWorkList }) {
  // Sonador study list viewer actions

  const { t } = useTranslation('StudyList');
  const { activeServer } = useSelector(redux.selectors.activeOhifServer);
  const { appConfig } = useContext(AppContext);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [openUpdateWorklistModal, setOpenUpdateWorklistModal] = useState(false);

  const [isOpenedShareModal, setIsOpenedShareModal] = useState(false);
  const { setWorkListSelectedStudies } = useWorkListStore();

  const clearSelection = () => {
    // Commit-clears-selection: resetting the checkmarks signals the bulk action has been
    // committed (selectedRows are react-table Row instances).
    selectedRows.forEach(row => row.toggleSelected?.(false));
  };

  const handleViewAllSelectedStudies = () => {
    selectedRows.forEach(({ id }) => {
      const _id = _getStudyInstanceUID({ row: { id, }, worklist: pathname.includes('worklist') });
      const link = parseViewerPath(appConfig, activeServer, {
        studyInstanceUIDs: _id,
      });

      window.open(link, '_blank');
    });

    clearSelection();
  };

  const handleClickShare = () => {
    if (selectedRows.length === 1) {
      setIsOpenedShareModal(true);
    }
  };

  const handleDownloadSelectedStudies = () => {
    // Queue a zip-archive export of every selected study (ohif-viewers#52, FR-1). This is the
    // defect the issue was raised for: the button rendered with an icon and a label and NO onClick
    // handler at all, so selecting studies and pressing Download did nothing.
    //
    // Distinct from handleSaveOfflineSelectedStudies below in destination as well as in queue:
    // this writes .zip files to the user's own file system through ArchiveDownloadService, while
    // that one caches instances into this browser through DownloadManagerService (AR-1). N selected
    // studies produce N separate archives — there is no combined multi-study archive, which would
    // need a new gateway endpoint (#52 §8).
    const queued = [];
    let alreadyQueued = 0;

    selectedRows.forEach(row => {
      const StudyInstanceUID = _getStudyInstanceUID({ row, worklist: pathname.includes('worklist') });

      if (!StudyInstanceUID) {
        return;
      }
      // De-duplicated by the service too, but counted here so the notice can say so (FR-14).
      if (ArchiveDownloadService.getActiveJobForResource(StudyInstanceUID)) {
        alreadyQueued += 1;
        return;
      }

      queued.push(
        ArchiveDownloadService.enqueueStudy({
          server: activeServer,
          StudyInstanceUID,
          // Patient/study attributes come off the row, not the store: a study-list row is
          // registered with the DicomMetadataStore carrying no metadata, so reading them from the
          // store leaves every Downloads row, notification and saved filename identified only by
          // UID.
          descriptor: _getStudyDescriptor({
            row,
            StudyInstanceUID,
            studyMeta: DicomMetadataStore.getStudyMetadata(StudyInstanceUID),
          }),
        })
      );
    });

    // One notice for the batch when it is large, individual notices when it is small (FR-10) —
    // the threshold lives in notifyArchivesQueued so every call site agrees on it.
    notifyArchivesQueued({ queued, alreadyQueued });

    // Clear the checkmarks once the batch is queued.
    clearSelection();
  };

  const handleSaveOfflineSelectedStudies = () => {
    // Queue every selected study for offline caching (ohif-viewers#125). Already-cached studies are
    // skipped, and DownloadManagerService de-dupes any study with a job already in flight (AC-4),
    // so re-running the bulk action is harmless.
    //
    // The skip counts are tallied rather than discarded so the batch raises a SINGLE notice that
    // accounts for the whole selection ("3 studies queued... 2 studies are already saved offline"),
    // instead of one toast per study or — as before — no feedback whatsoever.
    const queued = [];
    let alreadyCached = 0;
    let alreadyDownloading = 0;

    selectedRows.forEach(row => {
      const StudyInstanceUID = _getStudyInstanceUID({ row, worklist: pathname.includes('worklist') });

      if (!StudyInstanceUID) {
        return;
      }
      if (LocalCacheService?.isStudyCachedSync(StudyInstanceUID)) {
        alreadyCached += 1;
        return;
      }
      if (DownloadManagerService.isStudyDownloading(StudyInstanceUID)) {
        alreadyDownloading += 1;
        return;
      }

      queued.push(
        DownloadManagerService.enqueueStudy({
          server: activeServer,
          StudyInstanceUID,
          // Patient/study attributes come off the row: a study-list row is registered with the
          // DicomMetadataStore carrying no metadata, so reading them from the store leaves every
          // Download Manager entry and notification identified only by UID.
          descriptor: _getStudyDescriptor({
            row,
            StudyInstanceUID,
            studyMeta: DicomMetadataStore.getStudyMetadata(StudyInstanceUID),
          }),
        })
      );
    });

    notifyStudiesQueued({ queued, alreadyCached, alreadyDownloading });

    // Clear the checkmarks once the batch is queued.
    clearSelection();
  };

  // Permissions
  const aclShare = activeServer?.perms?.acl;

  return (
    <>
      <div className={styles.tableActions}>
        <span
          className={classNames(styles.selectedRows, {
            [styles.noSelectedRows]: !selectedRows.length,
          })}
        >
          {selectedRows.length} Studies Selected
        </span>
        {activeServer?.perms?.view && (
          <button className={styles.action} disabled={!selectedRows.length} onClick={handleViewAllSelectedStudies}>
            <EyeIcon />
            View
          </button>
        )}
        {isWorkList ? (
          <button
            className={styles.action}
            disabled={!selectedRows.length}
            onClick={() => {
              setWorkListSelectedStudies(selectedRows);
              clearSelection(); // safe: the store above holds its own reference to the rows
              navigate(`/worklist/viewer/`);
            }}
          >
            <ViewAndProcessIcon />
            View and Process
          </button>
        ) : (
          // Bulk zip-archive export (ohif-viewers#52). Gated on the same view permission as View
          // and Save Offline Copy in this toolbar — it was previously the only action here with no
          // permission gate at all (FR-2).
          activeServer?.perms?.view && (
            <button
              className={styles.action}
              disabled={!selectedRows.length}
              onClick={handleDownloadSelectedStudies}
            >
              <DownloadIcon />
              {t('Download')}
            </button>
          )
        )}
        {isWorkList ? (
          <button onClick={() => {
            setOpenUpdateWorklistModal(true);
          }} className={styles.action} disabled={!selectedRows.length}>
            <UpdateStatusIcon />
            Update Status
          </button>
        ) : (
          <div className={styles.shareContainer}>
            {aclShare && (
              <button className={styles.action} disabled={selectedRows.length !== 1} onClick={handleClickShare}>
                <ShareIcon />
                Share
              </button>
            )}
            {selectedRows.length > 1 && (
              <span className={styles.tooltipText}>Only one resource at a time can be shared</span>
            )}
          </div>
        )}
        {/* Bulk offline caching (ohif-viewers#125): queues every selected study into the Download
            Manager. Gated on the same view permission as the per-row action (AR-7); distinct from
            the zip-export 'Download' button above (AR-6). */}
        {activeServer?.perms?.view && (
          <button
            className={styles.action}
            disabled={!selectedRows.length}
            onClick={handleSaveOfflineSelectedStudies}
          >
            <OfflineCacheIcon width={15} height={15} />
            {t('Save Offline Copy')}
          </button>
        )}
      </div>
      {isOpenedShareModal && (
        <StudiesTableShareModal
          isOpenedShareModal={isOpenedShareModal}
          setIsOpenedShareModal={(open) => {
            // Clear on close, not on open — the modal reads selectedRows[0] while it is up.
            setIsOpenedShareModal(open);
            if (!open) {
              clearSelection();
            }
          }}
          selectedStudy={selectedRows[0]}
        />
      )}
      {isWorkList && openUpdateWorklistModal &&
        <UpdateWorklistModal
          isOpen={openUpdateWorklistModal} selectedWorklists={selectedRows}
          setIsOpen={(open) => {
            // Clear on close, not on open — the modal consumes selectedWorklists while it is up.
            setOpenUpdateWorklistModal(open);
            if (!open) {
              clearSelection();
            }
          }} />}
    </>
  );
}


StudiesTableActions.propTypes = {
  server: PropTypes.object,
  selectedRows: PropTypes.arrayOf(PropTypes.object),
  isWorkList: PropTypes.bool,
};
