// Downloads control for the Studylist toolbar (ohif-viewers#52, FR-4/FR-5/FR-6/FR-7/FR-8).
//
// "Downloads" means ARCHIVE EXPORT — a .zip written to the user's own file system. It is NOT the
// adjacent "Offline Storage" control, which saves a study INTO this browser for offline viewing
// (#52 AR-1). The two sit side by side in the toolbar and must stay legible as different things:
// this menu reads ArchiveDownloadService only, its badge counts archive jobs only, and every string
// here talks about downloading files rather than storing studies.
//
// Radix menu items close their menu on activation, which is exactly wrong for Cancel and Clear —
// acting on one row would dismiss the panel the user is working in. So the panel body is rendered
// as ORDINARY elements inside DropdownMenuContent rather than as DropdownMenuItems (#52 AR-9).
// The trigger, tooltip and content styling follow the Offline Storage launcher next door.
//
// Job state is read straight off the service singleton on each render (cheap), kept live by
// useArchiveDownloadVersion — the same service-to-render bridge the Offline Storage dialog uses.

import React from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';

import OHIF, { ArchiveDownloadService, ARCHIVE_JOB_STATES } from '@ohif/core';
import { Icon } from '@ohif/ui';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@ohif/ui-next';
import { ReactComponent as CloudDownloadIcon } from '@ohif/ui/src/elements/Svg/svgs/cloud-download.svg';

import useArchiveDownloadVersion from '../../hooks/useArchiveDownloadVersion';

import styles from './DownloadsMenu.module.scss';

const formatBytes = OHIF.utils.formatBytes;

const ACTIVE_STATES = [
  ARCHIVE_JOB_STATES.QUEUED,
  ARCHIVE_JOB_STATES.PROCESSING,
  ARCHIVE_JOB_STATES.DOWNLOADING,
];

const TERMINAL_STATES = [
  ARCHIVE_JOB_STATES.COMPLETED,
  ARCHIVE_JOB_STATES.CANCELLED,
  ARCHIVE_JOB_STATES.ERROR,
];

/**
 * Bar geometry and colour for a job (#52 FR-6). Two axes drive it: the job's state, and whether the
 * total size is known — a response with no readable Content-Length still downloads to completion,
 * it just cannot say how far along it is, so the bar runs indeterminate rather than sitting at 0%.
 */
function progressFor(job) {
  switch (job.state) {
    case ARCHIVE_JOB_STATES.QUEUED:
    case ARCHIVE_JOB_STATES.PROCESSING:
      // No request in flight, or no headers yet: nothing to measure against.
      return { indeterminate: true, percent: 0, tone: 'neutral' };

    case ARCHIVE_JOB_STATES.DOWNLOADING:
      if (job.totalBytes) {
        return {
          indeterminate: false,
          percent: Math.min(100, Math.round((job.bytesReceived / job.totalBytes) * 100)),
          tone: 'active',
        };
      }
      return { indeterminate: true, percent: 0, tone: 'active' };

    case ARCHIVE_JOB_STATES.COMPLETED:
      return { indeterminate: false, percent: 100, tone: 'done' };

    default:
      // Cancelled / failed: frozen at whatever it reached, grayed.
      return {
        indeterminate: false,
        percent: job.totalBytes
          ? Math.min(100, Math.round((job.bytesReceived / job.totalBytes) * 100))
          : 0,
        tone: 'inert',
      };
  }
}

/** Status line: the state label, the bytes moved so far, and the reason it failed (#52 FR-6). */
function statusLine(job, t) {
  switch (job.state) {
    case ARCHIVE_JOB_STATES.QUEUED:
      return t('Queued');

    case ARCHIVE_JOB_STATES.PROCESSING:
      return t('Processing');

    case ARCHIVE_JOB_STATES.DOWNLOADING:
      return job.totalBytes
        ? `${t('Downloading')} — ${formatBytes(job.bytesReceived)} ${t('of')} ${formatBytes(job.totalBytes)}`
        : `${t('Downloading')} — ${formatBytes(job.bytesReceived)}`;

    case ARCHIVE_JOB_STATES.COMPLETED:
      return `${t('Completed')} — ${formatBytes(job.totalBytes || job.bytesReceived)}`;

    case ARCHIVE_JOB_STATES.CANCELLED:
      return t('Cancelled');

    case ARCHIVE_JOB_STATES.ERROR:
      return `${t('Failed')} — ${job.error || t('The archive could not be downloaded.')}`;

    default:
      return job.state;
  }
}

/**
 * Primary line: Patient Name, the Patient ID de-emphasized beside it, and the Service Episode.
 * Matches the Offline Storage dialog's treatment, down to dropping absent values along with their
 * separators. Falls back to the UID only when the caller supplied no descriptor at all.
 */
function renderPrimaryLine(job, t) {
  const pieces = [];

  if (job.PatientName || job.PatientID) {
    pieces.push(
      <span key="patient">
        {job.PatientName}
        {job.PatientID && <span className={styles.rowTitleSecondary}>{job.PatientID}</span>}
      </span>
    );
  }
  if (job.ServiceEpisodeID) {
    pieces.push(<span key="episode">{t('Service Episode')} {job.ServiceEpisodeID}</span>);
  }

  if (!pieces.length) {
    return job.kind === 'series' ? job.SeriesInstanceUID : job.StudyInstanceUID;
  }

  return pieces.map((piece, index) => (
    <React.Fragment key={piece.key}>
      {index > 0 && ' · '}
      {piece}
    </React.Fragment>
  ));
}

/** Series identification, for a series export only. */
function renderSeriesLine(job, t) {
  if (job.kind !== 'series') {
    return null;
  }

  const label = [
    job.SeriesNumber !== undefined && job.SeriesNumber !== null
      ? `${t('Series')} ${job.SeriesNumber}`
      : t('Series'),
    job.SeriesDescription || job.Modality,
  ]
    .filter(Boolean)
    .join(': ');

  return <div className={styles.rowSeries}>{label}</div>;
}

export default function DownloadsMenu() {
  const { t } = useTranslation('StudyList');

  // Bumps on every archive-service event, re-rendering so the lists below (read fresh from the
  // service each render) stay live — including while the panel is open (#52 AC).
  useArchiveDownloadVersion();

  const jobs = ArchiveDownloadService ? ArchiveDownloadService.listJobs() : [];
  const activeCount = jobs.filter(job => ACTIVE_STATES.includes(job.state)).length;
  const terminalCount = jobs.filter(job => TERMINAL_STATES.includes(job.state)).length;

  const renderRow = job => {
    const { indeterminate, percent, tone } = progressFor(job);
    const terminal = TERMINAL_STATES.includes(job.state);

    return (
      <div key={job.id} className={styles.row}>
        <div className={styles.rowMain}>
          <div className={styles.rowTitle}>{renderPrimaryLine(job, t)}</div>
          {job.StudyDescription && (
            <div className={styles.rowDescription}>"{job.StudyDescription}"</div>
          )}
          {renderSeriesLine(job, t)}
          <div className={styles.progressTrack}>
            <div
              className={classNames(styles.progressFill, styles[tone], {
                [styles.indeterminate]: indeterminate,
              })}
              style={indeterminate ? undefined : { width: `${percent}%` }}
            />
          </div>
          <div className={styles.rowSub}>{statusLine(job, t)}</div>
        </div>
        {/* Plain button, NOT a DropdownMenuItem: acting on a row must leave the panel open
            (#52 AR-9). Cancel on an active row, Clear on a terminal one — never both. */}
        <button
          type="button"
          className={styles.actionButton}
          title={terminal ? t('Clear') : t('Cancel')}
          aria-label={terminal ? t('Clear this download') : t('Cancel this download')}
          onClick={() =>
            terminal
              ? ArchiveDownloadService.dismiss(job.id)
              : ArchiveDownloadService.cancel(job.id)
          }
        >
          <Icon name={terminal ? 'trash' : 'times'} />
        </button>
      </div>
    );
  };

  return (
    <DropdownMenu>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={styles.trigger}
                aria-label={t('Downloads')}
              >
                <CloudDownloadIcon />
                {activeCount > 0 && <span className={styles.badge}>{activeCount}</span>}
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <div className={styles.tooltipTitle}>{t('Downloads')}</div>
            <div className={styles.tooltipBody}>
              {t('Export studies as zip archives to this computer. Monitor and cancel transfers in progress.')}
              {activeCount > 0 && (
                <div className={styles.tooltipCount}>
                  {activeCount} {activeCount === 1 ? t('active download') : t('active downloads')}
                </div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <DropdownMenuContent align="end" className={styles.panel}>
        <div className={styles.panelHeader}>
          <span className={styles.panelTitle}>{t('Downloads')}</span>
          <button
            type="button"
            className={styles.clearFinished}
            disabled={terminalCount === 0}
            onClick={() => ArchiveDownloadService.clearTerminal()}
          >
            {t('Clear finished')}
          </button>
        </div>

        <div className={styles.list}>
          {jobs.length ? jobs.map(renderRow) : <p className={styles.empty}>{t('No downloads')}</p>}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
