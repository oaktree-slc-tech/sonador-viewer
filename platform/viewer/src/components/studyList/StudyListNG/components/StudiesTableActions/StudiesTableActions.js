import React, { useContext, useEffect, useRef,useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation,useNavigate } from 'react-router-dom';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import OHIF, {
  ArchiveDownloadService,
  DicomMetadataStore,
  display,
  DownloadManagerService,
  LocalCacheService,
  notifyArchivesQueued,
  notifyStudiesQueued,
  redux,
} from '@ohif/core';
import { ReactComponent as OfflineCacheIcon } from '@ohif/ui/src/elements/Icon/icons/offline-cache.svg';
import { ReactComponent as DownloadIcon } from '@ohif/ui/src/elements/Svg/svgs/cloud-download.svg';
import { ReactComponent as EyeIcon } from '@ohif/ui/src/elements/Svg/svgs/eye.svg';
import { ReactComponent as UpdateStatusIcon } from '@ohif/ui/src/elements/Svg/svgs/reload-circle.svg';
import { ReactComponent as ViewAndProcessIcon } from '@ohif/ui/src/elements/Svg/svgs/search-circle.svg';
import { ReactComponent as ShareIcon } from '@ohif/ui/src/elements/Svg/svgs/share.svg';
import { ReactComponent as TrashBinIcon } from '@ohif/ui/src/elements/Svg/svgs/trash-bin.svg';

import AppContext from '../../../../../context/AppContext';
import { parseViewerPath } from '../../../../../routes/routesUtil';
import { useWorkListStore } from '../../../../../store/useWorkListStore';
import useRemoveResource from '../../hooks/useRemoveResource';
import BulkShareModal from '../BulkShareModal/BulkShareModal';
import { summariseBulkRemoval } from '../RemoveResourceConfirm/describeRemoval';
import RemoveResourceConfirm from '../RemoveResourceConfirm/RemoveResourceConfirm';
import {
  _getRemovalDescriptor,
  _getStudyDescriptor,
  _getStudyInstanceUID,
} from '../SelectAndSettingsAndExpandCell/SelectAndSettingsAndExpandCell.js';
import StudiesTableShareModal from '../StudiesTableShareModal/StudiesTableShareModal';

import UpdateWorklistModal from './components/UpdateWorklistModal';

import styles from './StudiesTableActions.module.scss';


// How long the confirmation holds its outcome before closing and letting the study list refetch.
// Not a cosmetic pause: Orthanc's cascade delete and the Sonador change-callback pipeline that
// prunes the cache both run after the DELETE returns, and a refetch that lands mid-cascade was
// taking the study list down.
const BULK_REMOVAL_SETTLE_MS = 3500;


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

  const [bulkShareStudies, setBulkShareStudies] = useState(null);

  const handleClickShare = () => {
    // One study opens the per-study editor, which is the only place existing policies can be seen
    // and revoked. Two or more open the bulk dialog, which composes ONE policy and writes it across
    // the selection -- previously the button was simply disabled here, with a tooltip saying only
    // one resource could be shared at a time.
    if (selectedRows.length === 1) {
      setIsOpenedShareModal(true);
      return;
    }

    const descriptors = [];

    selectedRows.forEach(row => {
      const StudyInstanceUID = _getStudyInstanceUID({ row, worklist: pathname.includes('worklist') });

      if (!StudyInstanceUID) {
        return;
      }

      descriptors.push(
        _getStudyDescriptor({
          row,
          StudyInstanceUID,
          studyMeta: DicomMetadataStore.getStudyMetadata(StudyInstanceUID),
        })
      );
    });

    if (descriptors.length) {
      setBulkShareStudies(descriptors);
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

  const [pendingRemoval, setPendingRemoval] = useState(null);
  const [removalOutcome, setRemovalOutcome] = useState(null);
  // Held for the WHOLE sequence, not just the requests. `isRemoving` drops the moment the last
  // DELETE resolves, one render before the outcome is set, which would briefly re-enable the
  // Remove button on a dialog that is mid-commit.
  const [committing, setCommitting] = useState(false);
  const { isRemoving, removeStudiesResource, refreshStudyList } = useRemoveResource();

  // Cleared on unmount so a settle timer cannot fire into a dead component.
  const settleTimer = useRef(null);
  useEffect(() => () => clearTimeout(settleTimer.current), []);

  const handleRemoveSelectedStudies = () => {
    // Collect the selection and open the confirmation (ohif-viewers#127, FR-7). Nothing is issued
    // here — the DELETEs happen on confirm.
    //
    // NOT the same operation as Save Offline Copy / Remove Offline Copy in this toolbar and the
    // row menu, which move data in and out of THIS BROWSER's cache. This permanently destroys the
    // studies on the imaging server, for everyone (AR-9).
    const descriptors = [];

    selectedRows.forEach(row => {
      const StudyInstanceUID = _getStudyInstanceUID({ row, worklist: pathname.includes('worklist') });

      if (!StudyInstanceUID) {
        return;
      }

      descriptors.push(
        _getRemovalDescriptor({
          row,
          StudyInstanceUID,
          studyMeta: DicomMetadataStore.getStudyMetadata(StudyInstanceUID),
        })
      );
    });

    if (descriptors.length) {
      setPendingRemoval(descriptors);
    }
  };

  const handleConfirmRemoveSelectedStudies = async () => {
    // Sequenced deliberately, because refetching while N cascade deletes were still settling
    // server-side was crashing the study list:
    //
    //   1. every DELETE (and its offline-cache eviction) settles, with the overlay still up and
    //      blocking -- nothing in the list is clickable and no refetch can be provoked;
    //   2. the outcome notification goes out, raised inside removeStudiesResource;
    //   3. the overlay holds for BULK_REMOVAL_SETTLE_MS showing that outcome, which is slack for
    //      the server's cascade and the change-callback pipeline to finish pruning;
    //   4. the overlay closes and the selection clears;
    //   5. ONLY THEN the study list refetches.
    //
    // Step 5 is why `deferRefresh` exists: left to itself the hook invalidates as soon as the
    // last DELETE resolves, which is the middle of step 1.
    if (committing) {
      return;
    }
    setCommitting(true);

    const outcome = await removeStudiesResource(activeServer, pendingRemoval, { deferRefresh: true });

    setRemovalOutcome({
      title: summariseBulkRemoval(outcome),
      message: outcome.removed === outcome.total
        ? undefined
        : 'Some studies could not be removed. See the individual errors for details.',
    });

    settleTimer.current = setTimeout(() => {
      setPendingRemoval(null);
      setRemovalOutcome(null);
      setCommitting(false);

      // Commit-clears-selection, matching the other bulk actions. Unconditional: on a partial
      // failure the rows that did succeed are gone, and the ones that did not are reported
      // individually, so leaving a half-valid selection checked would be worse than clearing it.
      clearSelection();

      refreshStudyList();
    }, BULK_REMOVAL_SETTLE_MS);
  };

  // Permissions
  const aclShare = activeServer?.perms?.acl;
  // Bulk removal gates on the SERVER permission only. Per-study refinement is impractical for a
  // selection of arbitrary size — it would be one resource-acl request per selected row before the
  // button could even render. Documented consequence (FR-10): a user holding only scoped `remove`
  // grants does not see this button and removes studies one at a time from the row menu, which
  // does refine per resource. The server is the authority either way; an individual 403 is
  // surfaced per study.
  const aclRemove = activeServer?.perms?.remove;

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
              <button className={styles.action} disabled={!selectedRows.length} onClick={handleClickShare}>
                <ShareIcon />
                Share
              </button>
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
        {/* Permanently remove the selected studies from the imaging server (ohif-viewers#127,
            FR-7). Deliberately last and visually distinct from the two offline-cache actions it
            sits beside — those move data in and out of this browser, this destroys it on the
            server. Not offered on the worklist, where the selection is worklist items. */}
        {!isWorkList && aclRemove && (
          <button
            className={classNames(styles.action, styles.destructiveAction)}
            disabled={!selectedRows.length}
            onClick={handleRemoveSelectedStudies}
          >
            <TrashBinIcon />
            {t('Remove')}
          </button>
        )}
      </div>
      {pendingRemoval && (
        <RemoveResourceConfirm
          kind="studies"
          descriptors={pendingRemoval}
          isRemoving={isRemoving || committing}
          completion={removalOutcome}
          onConfirm={handleConfirmRemoveSelectedStudies}
          onCancel={() => setPendingRemoval(null)}
        />
      )}
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
      {bulkShareStudies && (
        <BulkShareModal
          isOpen
          studies={bulkShareStudies}
          setIsOpen={(open) => {
            // Clear on close, matching the other bulk dialogs -- the modal reads `studies` while it
            // is up, and the descriptors were snapshotted off the rows when it opened.
            if (!open) {
              setBulkShareStudies(null);
              clearSelection();
            }
          }}
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
