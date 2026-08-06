import _ from 'lodash';

import React, { useContext, useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';
import { ChatBubbleLeftIcon } from '@heroicons/react/24/solid';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import OHIF, {
  redux,
  DicomMetadataStore,
  LocalCacheService,
  DownloadManagerService,
  notifyStudiesQueued,
} from '@ohif/core';
import { Icon } from '@ohif/ui';

import CheckboxNG from '@ohif/ui/src/components/CheckboxNG/CheckboxNG';
import Dropdown from '@ohif/ui/src/components/Dropdown/Dropdown';
import { ReactComponent as ChevronDown } from '@ohif/ui/src/elements/Svg/svgs/chevron-down.svg';
import { ReactComponent as DownloadIcon } from '@ohif/ui/src/elements/Svg/svgs/cloud-download.svg';
import { ReactComponent as OfflineCacheIcon } from '@ohif/ui/src/elements/Icon/icons/offline-cache.svg';
import { ReactComponent as TrashBinIcon } from '@ohif/ui/src/elements/Svg/svgs/trash-bin.svg';
import { ReactComponent as DotsIcon } from '@ohif/ui/src/elements/Svg/svgs/dots.svg';
import { ReactComponent as EyeIcon } from '@ohif/ui/src/elements/Svg/svgs/eye.svg';
import { ReactComponent as ShareIcon } from '@ohif/ui/src/elements/Svg/svgs/share.svg';

import { fetchDownloadStudies, fetchStudyAclPermissions } from '../../../../../api/ext';
import AppContext from '../../../../../context/AppContext';
import * as RoutesUtil from '../../../../../routes/routesUtil';
import { useDeviceStore } from '../../../../../store/useDeviceStore';
import CreateWorklistModal from '../CreateWorklistModal/CreateWorklistModal';
import RemoveResourceConfirm from '../RemoveResourceConfirm/RemoveResourceConfirm';
import StudiesTableShareModal from '../StudiesTableShareModal/StudiesTableShareModal';
import useLocalCacheVersion from '../../hooks/useLocalCacheVersion';
import useRemoveResource from '../../hooks/useRemoveResource';
import {
  _getStudyInstanceUID,
  _getStudyDescriptor,
  _getRemovalDescriptor,
} from './studyRowDescriptors';

import tableStyles from '../StudiesTable/StudiesTable.module.scss';
import styles from './SelectAndSettingsAndExpandCell.module.scss';


export default function SelectAndSettingsAndExpandCell({ row  }) {
  // Studylist selection control and actions menu

  const { t } = useTranslation('StudyList');
  const { pathname } = useLocation();

  // Retrieve StudyInstanceUID
  const StudyInstanceUID = _getStudyInstanceUID({ row, worklist: pathname.includes('worklist') });

  const isExpanded = row.getIsExpanded();
  const { activeServer } = useSelector(redux.selectors.activeOhifServer); 

  // Retrieve study metadata. Guarded on the UID: a worklist row whose study has been removed
  // resolves to undefined (see _getStudyInstanceUID), and registering `{ StudyInstanceUID:
  // undefined }` would put a junk entry in the store that later lookups would match against.
  const _study = StudyInstanceUID ? DicomMetadataStore.getStudy(StudyInstanceUID) : undefined;
  if (StudyInstanceUID && !_study) {
    DicomMetadataStore.addStudy({ StudyInstanceUID, });
  }
  const studyMeta = DicomMetadataStore.getStudyMetadata(StudyInstanceUID);

  // Patient/study attributes for the archive and offline-download notifications, and for the
  // Download Manager rows. Read from the row, not the store — see _getStudyDescriptor.
  const studyDescriptor = _getStudyDescriptor({ row, StudyInstanceUID, studyMeta });

  // The same attributes plus the series/instance counts, for the removal confirmation.
  const removalDescriptor = _getRemovalDescriptor({ row, StudyInstanceUID, studyMeta });

  // Study action permissions
  const canWorkInWorklist = activeServer?.perms?.worklist;
  const [aclDownload, setAclDownload] = useState(activeServer?.perms?.view || studyMeta?.perms?.View || false);
  const [aclShare, setAclShare] = useState(activeServer?.perms?.acl || studyMeta?.perms?.ACL || false);
  // Permission to permanently delete this study from the imaging server. `activeServer.perms.remove`
  // is wildcard-only — true for a superuser or a `resource: '*'` group policy and nothing else —
  // so a user holding a per-study grant reads false here and is refined by the resource-acl fetch
  // on menu open (FR-8). Not to be confused with 'remove-offline' below, which evicts this
  // browser's cached copy and needs no server permission at all.
  const [aclRemove, setAclRemove] = useState(activeServer?.perms?.remove || studyMeta?.perms?.Remove || false);
  const [resourceAclLoaded, setResourceAclLoaded] = useState(() => false);
  const [createWorklistModalOpen, setCreateWorklistModalOpen] = useState(false);
  const [isOpenedShareModal, setIsOpenedShareModal] = useState(false);
  const [confirmingRemoveStudy, setConfirmingRemoveStudy] = useState(false);

  const { isRemoving, removeStudyResource } = useRemoveResource();

  const { appConfig } = useContext(AppContext);

  const { isDesktop } = useDeviceStore();

  // Local/offline cache state for this study (ohif-viewers#125, FR-6/FR-7). useLocalCacheVersion
  // forces a re-render whenever the cache or a download job changes, so these stay reactive.
  useLocalCacheVersion();
  const isCached = LocalCacheService?.isStudyCachedSync(StudyInstanceUID);
  const isDownloading = DownloadManagerService?.isStudyDownloading(StudyInstanceUID);

  const link = RoutesUtil.parseViewerPath(appConfig, activeServer, {
    studyInstanceUIDs: StudyInstanceUID,
  });

  const options = [
    {
      id: 'download',
      Label: () => (
        <div className={styles.rowDotsOption}>
          <DownloadIcon />
          <span>Download</span>
        </div>
      ),
      onClick: () => {
        // The row's attributes ride along so the archive notifications — and the name of the
        // saved file — identify the study by patient and description rather than by UID.
        fetchDownloadStudies(activeServer, StudyInstanceUID, studyDescriptor);
      },
    },
    {
      // Queue this study for offline caching (ohif-viewers#125, FR-7). Distinct id/command from the
      // 'download' (zip export) item above (AR-6). Clicking while a job is in flight cancels it.
      id: 'go-offline',
      Label: () => (
        <div className={styles.rowDotsOption}>
          {/* Cloud-check icon: same asset as the Download Manager launcher and the sidebar cache
              badge, for a unified offline-feature presentation (distinct from the zip-export
              'Download' item's cloud-download icon above, AR-6). */}
          <OfflineCacheIcon width={15} height={15} />
          <span>{isDownloading ? t('Cancel Download') : t('Save Offline Copy')}</span>
        </div>
      ),
      onClick: () => {
        if (isDownloading) {
          DownloadManagerService.cancelStudy(StudyInstanceUID);
        } else {
          const job = DownloadManagerService.enqueueStudy({
            server: activeServer,
            StudyInstanceUID,
            descriptor: studyDescriptor,
          });

          // Queueing is otherwise invisible until the row badge changes; completion and failure are
          // announced by the DownloadManagerService subscription (see downloadNotifications).
          notifyStudiesQueued({ queued: [job] });
        }
      },
    },
    {
      // Remove this study's locally cached copy (shown only when cached, FR-7).
      id: 'remove-offline',
      Label: () => (
        <div className={styles.rowDotsOption}>
          <TrashBinIcon />
          <span>{t('Remove Offline Copy')}</span>
        </div>
      ),
      onClick: () => {
        DownloadManagerService.cancelStudy(StudyInstanceUID);
        LocalCacheService.removeStudy(StudyInstanceUID);
      },
    },
    {
      id: 'share',
      Label: () => (
        <div className={styles.rowDotsOption}>
          <ShareIcon />
          <span>Share</span>
        </div>
      ),
      onClick: () => {
        setIsOpenedShareModal(true);
      },
    },
    ...(canWorkInWorklist
      ? [{
        id: 'create-worklist',
        Label: () => (
          <div className={styles.rowDotsOption}>
            <ChatBubbleLeftIcon width={16} />
            <span>Request review</span>
          </div>
        ),
        onClick: () => {
          setCreateWorklistModalOpen(true);
        },
      }]
      : []),
    {
      // Permanently delete this study from the imaging server (ohif-viewers#127, FR-6). Last in
      // the menu, after share and create-worklist: it is irreversible and should not sit under
      // the cursor's resting position.
      //
      // AR-9 — 'remove-study' is a deliberately distinct id from 'remove-offline' above, and the
      // two labels are the place this feature is most likely to be misread. "Remove Offline Copy"
      // evicts this browser's cached copy; "Remove Study" destroys the data on the server. Both
      // can appear in this menu at the same time.
      id: 'remove-study',
      Label: () => (
        <div className={classNames(styles.rowDotsOption, styles.rowDotsOptionDestructive)}>
          <TrashBinIcon />
          <span>{t('Remove Study')}</span>
        </div>
      ),
      onClick: () => {
        setConfirmingRemoveStudy(true);
      },
    },
  ];

  const filteredOptions = useMemo(() => {
    // Filter menu options by permissions

    return options.filter(option => {
      if (option.id === 'create-worklist') {
        return canWorkInWorklist && !pathname.includes('worklist');
      } else if (option.id == 'download') {
        return aclDownload;
      } else if (option.id == 'go-offline') {
        // Gate offline caching on the same view permission as download (AR-7); hide once cached.
        return aclDownload && !isCached;
      } else if (option.id == 'remove-offline') {
        return isCached;
      } else if (option.id == 'share') {
        return aclShare;
      } else if (option.id == 'remove-study') {
        return aclRemove;
      }

      return true;
    });
  }, [aclDownload, aclShare, aclRemove, isCached, isDownloading])

  const onDropdownClick = async (e) => {
    // Retrieve resource permissions for study
    e.stopPropagation();

    // The short-circuit widens to include the new remove signal: without `!aclRemove` here, a user
    // who already has download and share from the server flags would never trigger the fetch, and
    // a per-study `remove` grant would stay invisible (FR-8). Same single fetch, one more reader.
    if (activeServer && StudyInstanceUID && !resourceAclLoaded && (!aclDownload || !aclShare || !aclRemove)) {
      const resourcePerms = await fetchStudyAclPermissions(activeServer, StudyInstanceUID);
      DicomMetadataStore.updateStudyMetadata(_.omit(resourcePerms, 'Level'));

      // Set permission for download
      if (!aclDownload && resourcePerms?.perms?.View) {
        setAclDownload(resourcePerms.perms.View);
      }

      // Set permission for ACL management
      if (!aclShare && resourcePerms?.perms?.ACL) {
        setAclShare(resourcePerms.perms.ACL);
      }

      // Set permission for removal from the imaging server
      if (!aclRemove && resourcePerms?.perms?.Remove) {
        setAclRemove(resourcePerms.perms.Remove);
      }

      // Mark resource ACL as loaded to prevent repeated API calls
      setResourceAclLoaded(true);      
    }
  }

  return (
    <>
      <div className={classNames(styles.selectorExpanderColumn, isDesktop && styles.desktop)}>
        <ChevronDown className={classNames(styles.expander, { [styles.expanded]: isExpanded })} />
        {isDesktop && (
          <>
            <Dropdown
              onClick={onDropdownClick}
              Button={() => <DotsIcon className={styles.dotsIcon} />}
              options={filteredOptions}
            />
            <CheckboxNG checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} />
          </>
        )}
        {activeServer?.perms.view && (
          <EyeIcon
            className={classNames(styles.rowEyeIcon, tableStyles.rowEyeIcon)}
            onClick={(e) => {
              e.stopPropagation();
              window.open(link, '_blank');
            }}
          />
        )}
      </div>
      {createWorklistModalOpen && (
        <CreateWorklistModal isOpen={createWorklistModalOpen} setIsOpen={setCreateWorklistModalOpen}
          studyInstanceUIDs={StudyInstanceUID} />
      )}
      {isOpenedShareModal && (
        <StudiesTableShareModal
          isOpenedShareModal={isOpenedShareModal}
          setIsOpenedShareModal={setIsOpenedShareModal}
          server={activeServer}
          selectedStudy={{ id: StudyInstanceUID }}
        />
      )}
      {confirmingRemoveStudy && (
        <RemoveResourceConfirm
          kind="study"
          descriptor={removalDescriptor}
          isRemoving={isRemoving}
          onConfirm={async () => {
            const ok = await removeStudyResource(activeServer, removalDescriptor);

            setConfirmingRemoveStudy(false);

            // A selection that includes a study that no longer exists would carry it into the
            // next bulk action (FR-12).
            if (ok && row.getIsSelected?.()) {
              row.toggleSelected?.(false);
            }
          }}
          onCancel={() => setConfirmingRemoveStudy(false)}
        />
      )}

    </>
  );
}


SelectAndSettingsAndExpandCell.propTypes = {
  row: PropTypes.object.isRequired,
};


export { _getStudyInstanceUID, _getStudyDescriptor, _getRemovalDescriptor };