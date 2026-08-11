// Title row shared by the studylist surfaces and the Upload page.
//
// This was not a component until now: the markup lived inline at the top of
// StudyListNG/components/Filters, which is why Studies, Worklist and Shared had the Downloads
// menu, the Offline Storage launcher and the account menu, and Upload -- which renders its own
// bare title and notice, and no Filters -- had none of them. Extracting it is what lets Upload
// have the same row rather than a third hand-written copy of it.
//
// Control order mirrors the Study Viewer header (Header.js): the Investigational Use notice first,
// then the icon controls to its right.
//
// It owns the Offline Storage dialog's open state and renders the dialog, because the launcher
// lives here. The two download surfaces are deliberately distinct and share no state (#52 AR-1):
// DownloadsMenu exports zip archives to the user's file system, while Offline Storage saves
// studies into this browser.

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import { DownloadManagerService, JOB_STATES } from '@ohif/core';
import { Icon } from '@ohif/ui';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@ohif/ui-next';

import UserMenu from '../UserMenu/UserMenu';
import DownloadManagerModal from '../studyList/StudyListNG/components/DownloadManagerModal/DownloadManagerModal';
import DownloadsMenu from '../studyList/StudyListNG/components/DownloadsMenu/DownloadsMenu';
import useLocalCacheVersion from '../studyList/StudyListNG/hooks/useLocalCacheVersion';

import styles from './PageHeaderNG.module.scss';

export default function PageHeaderNG({ title }) {
  const { t } = useTranslation(['StudyList', 'Header']);

  const [isDownloadManagerOpen, setIsDownloadManagerOpen] = useState(false);

  // Reactive count of in-flight downloads for the Offline Storage indicator (ohif-viewers#125,
  // FR-5).
  useLocalCacheVersion();
  const activeDownloadCount = DownloadManagerService
    ? DownloadManagerService.listActiveJobs().filter(
        (j) => j.state === JOB_STATES.QUEUED || j.state === JOB_STATES.DOWNLOADING
      ).length
    : 0;

  return (
    <>
      <div className={styles.pageHeader}>
        <p className={styles.title}>{title}</p>
        <div className={styles.headerRight}>
          <p className={styles.useOnly}>{t('INVESTIGATIONAL USE ONLY')}</p>

          <div className={styles.headerControls}>
            {/* Downloads — zip archives exported to the user's computer (ohif-viewers#52, FR-4).
                Sits immediately LEFT of Offline Storage below, which saves studies into this
                browser instead. Two queues, two badges, no shared state (AR-1). */}
            <DownloadsMenu />

            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={styles.downloadManager}
                    onClick={() => setIsDownloadManagerOpen(true)}
                    aria-label={t('Manage Offline Storage')}
                  >
                    <Icon name="offline-cache" />
                    {activeDownloadCount > 0 && (
                      <span className={styles.downloadBadge}>{activeDownloadCount}</span>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className={styles.tooltipContent}>
                  <div className={styles.tooltipTitle}>{t('Offline Storage')}</div>
                  <div className={styles.tooltipBody}>
                    {t('Save studies for offline viewing. Monitor active transfers. Manage local storage.')}
                    {activeDownloadCount > 0 && (
                      <div className={styles.tooltipCount}>
                        {activeDownloadCount}{' '}
                        {activeDownloadCount === 1 ? t('active download') : t('active downloads')}
                      </div>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Account menu (ohif-viewers#31). Shares its options with the viewer header via
                UserMenu so the two cannot drift apart. */}
            <UserMenu align="end" className={styles.userMenu} />
          </div>
        </div>
      </div>

      {isDownloadManagerOpen && (
        <DownloadManagerModal
          isOpen={isDownloadManagerOpen}
          onClose={() => setIsDownloadManagerOpen(false)}
        />
      )}
    </>
  );
}

PageHeaderNG.propTypes = {
  /** Page title, rendered at the left of the row. */
  title: PropTypes.node,
};
