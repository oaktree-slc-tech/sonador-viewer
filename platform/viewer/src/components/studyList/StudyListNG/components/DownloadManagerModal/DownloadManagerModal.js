// Download Manager dialog for the local/offline study cache (ohif-viewers#125, FR-5).
//
// Built on ModalNG following the StudiesTableShareModal precedent (AR-10): a debounced search plus
// two tabs — "Active Transfers" (per-job cancel/dismiss) and "Locally Stored" (per-entry remove).
// Both tabs search across Study UID, Series UID, Patient Name, PatientID, Study Description, Series
// Description, and Accession Number (AC-9). Data comes from the DownloadManagerService and
// LocalCacheService module singletons; useLocalCacheVersion keeps the view reactive to their events.

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import OHIF, {
  LocalCacheService,
  DownloadManagerService,
  JOB_STATES,
  clearOfflineStorageWithNotice,
} from '@ohif/core';
import { useDebounce, Icon } from '@ohif/ui';
import {
  HoverCard,
  HoverCardTrigger,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@ohif/ui-next';
import ModalNG from '@ohif/ui/src/components/ModalNG/ModalNG';
import { ReactComponent as RefreshIcon } from '@ohif/ui/src/elements/Svg/svgs/refresh.svg';
import { ReactComponent as SearchIcon } from '@ohif/ui/src/elements/Svg/svgs/search.svg';

import StudyOfflineDetailsCard from '../StudyOfflineDetailsCard/StudyOfflineDetailsCard';
import useLocalCacheVersion from '../../hooks/useLocalCacheVersion';

import styles from './DownloadManagerModal.module.scss';

const formatBytes = OHIF.utils.formatBytes;

const TABS = {
  ACTIVE: 'active',
  STORED: 'stored',
};

// Fields available on a download job for the Active Transfers search (series-level fields are not
// known until instances are cached, so they simply do not match there — AC-9 across both tabs).
function jobMatchesSearch(job, needle) {
  if (!needle) {
    return true;
  }
  return [
    job.StudyInstanceUID,
    job.PatientName,
    job.PatientID,
    job.StudyDescription,
    job.AccessionNumber,
    job.ServiceEpisodeID,
  ]
    .filter(Boolean)
    .some(value => String(value).toLowerCase().includes(needle));
}

function jobPercent(job) {
  const { total, completed } = job.progress || {};
  if (!total) {
    return 0;
  }
  return Math.min(100, Math.round((completed / total) * 100));
}

// Primary line for a download card: Patient Name, (Patient ID) as de-emphasized secondary text,
// and Service Episode ID. The study description gets its own line below (renderDescriptionLine) —
// all three identifiers plus a description on one line was too crowded. Absent values are simply
// omitted, along with their bullet dividers. Falls back to the StudyInstanceUID when nothing else
// is available.
function renderPrimaryLine(item, t, styles) {
  const pieces = [];

  if (item.PatientName || item.PatientID) {
    pieces.push(
      <span key="patient">
        {item.PatientName}
        {item.PatientID && <span className={styles.rowTitleSecondary}>{item.PatientID}</span>}
      </span>
    );
  }
  if (item.ServiceEpisodeID) {
    pieces.push(<span key="episode">{t('Service Episode')} {item.ServiceEpisodeID}</span>);
  }

  if (!pieces.length) {
    return item.StudyInstanceUID;
  }

  return pieces.map((piece, index) => (
    <React.Fragment key={piece.key}>
      {index > 0 && ' · '}
      {piece}
    </React.Fragment>
  ));
}

// Quoted study description on its own line (quoting marks it as a single DICOM attribute).
function renderDescriptionLine(item, styles) {
  if (!item.StudyDescription) {
    return null;
  }
  return <div className={styles.rowDescription}>"{item.StudyDescription}"</div>;
}

export default function DownloadManagerModal({ isOpen, onClose }) {
  const { t } = useTranslation('StudyList');

  // Bumps on every LocalCacheService / DownloadManagerService event, re-rendering the modal so the
  // lists below (read fresh from the services each render) stay live.
  useLocalCacheVersion();

  const [activeTab, setActiveTab] = useState(TABS.ACTIVE);
  const [searchValue, setSearchValue] = useState('');
  const [confirmingClear, setConfirmingClear] = useState(false);
  const debouncedSearch = useDebounce(searchValue, 300);
  const needle = (debouncedSearch || '').trim().toLowerCase();

  // Read directly from the service singletons on each render (cheap; kept reactive via
  // useLocalCacheVersion) rather than memoising, which would go stale on cache events.
  const activeJobs = (DownloadManagerService?.listActiveJobs() || []).filter(job =>
    jobMatchesSearch(job, needle)
  );
  const storedStudies = LocalCacheService ? LocalCacheService.searchCachedStudies(debouncedSearch) : [];

  const renderActiveTab = () => {
    if (!activeJobs.length) {
      return <p className={styles.empty}>{t('No active transfers')}</p>;
    }

    return activeJobs.map(job => {
      const percent = jobPercent(job);
      const terminal = [JOB_STATES.COMPLETED, JOB_STATES.CANCELLED, JOB_STATES.ERROR].includes(job.state);

      return (
        <div key={job.id} className={styles.row}>
          <HoverCard openDelay={300}>
            <HoverCardTrigger asChild>
              <div className={styles.rowMain}>
                <div className={styles.rowTitle}>{renderPrimaryLine(job, t, styles)}</div>
                {renderDescriptionLine(job, styles)}
                <div className={styles.progressTrack}>
                  <div className={styles.progressFill} style={{ width: `${percent}%` }} />
                </div>
                <div className={styles.rowSub}>
                  {t(_stateLabel(job))} · {job.progress?.completed || 0}/{job.progress?.total || 0}
                  {job.error ? ` · ${job.error}` : ''}
                </div>
              </div>
            </HoverCardTrigger>
            <StudyOfflineDetailsCard item={job} />
          </HoverCard>
          <button
            type="button"
            className={styles.actionButton}
            title={terminal ? t('Dismiss') : t('Cancel')}
            onClick={() => (terminal ? DownloadManagerService.dismiss(job.id) : DownloadManagerService.cancel(job.id))}
          >
            <Icon name="trash" />
          </button>
        </div>
      );
    });
  };

  const handleClearAll = () => {
    // Stop anything still writing into the cache before wiping it, so a mid-flight job can't
    // repopulate entries behind the clear. The wipe itself is queued fire-and-forget: the overlay
    // drops immediately (restoring the Clear Storage button) and the lists empty reactively as
    // deletion events land.
    //
    // Known transient: cancellation is cooperative (checked between instances), so a putInstance
    // already in flight can land AFTER clearAll() and briefly resurrect its study in the stored
    // list. The cancelled job's own cleanup then removes exactly what it stored, so the state
    // converges — the flicker is cosmetic, not a leak.
    //
    // Wrapped so the user gets told what is being removed and, once the device is clear, how much
    // space it freed. The wrapper reads those counts before the wipe destroys them and mutes the
    // per-transfer cancel notices that cancelAllActive would otherwise raise.
    const summaries = LocalCacheService?.getAllStudySummaries() || [];
    const inFlight = (DownloadManagerService?.listActiveJobs() || []).filter(
      job => job.state === JOB_STATES.QUEUED || job.state === JOB_STATES.DOWNLOADING
    );

    clearOfflineStorageWithNotice({
      studyCount: summaries.length,
      byteCount: summaries.reduce((bytes, summary) => bytes + (summary.totalBytes || 0), 0),
      activeTransfers: inFlight.length,
      clear: () => {
        DownloadManagerService?.cancelAllActive();
        return LocalCacheService.clearAll();
      },
    }).catch(() => {
      // Reported to the user by the wrapper; nothing further to do here.
    });

    setConfirmingClear(false);
  };

  const totalCachedCount = LocalCacheService ? LocalCacheService.getCachedStudyUIDsSync().length : 0;
  const activeTransferCount = (DownloadManagerService?.listActiveJobs() || []).filter(
    job => job.state === JOB_STATES.QUEUED || job.state === JOB_STATES.DOWNLOADING
  ).length;

  const renderTabAction = () => {
    // Per-tab bulk control rendered inline with the search box. Always visible on its tab —
    // disabled (not hidden) when there is nothing to act on, so the control stays discoverable.
    if (activeTab === TABS.STORED) {
      // "Clear Storage" empties the whole local cache; confirmation takes over the dialog in a
      // blocking overlay (see confirmOverlay below) rather than expanding inline. The refresh
      // control re-reads the cache index from IndexedDB: the backing stores are shared across
      // tabs/windows, so this list can go stale with no event reaching this context.
      return (
        <>
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={styles.refreshButton}
                  onClick={() => LocalCacheService?.rehydrate()}
                  aria-label={t('Refresh offline study list')}
                >
                  {/* babel-plugin-inline-react-svg's SVGO pass strips the viewBox, so CSS sizing
                      clips the 25x23 drawing instead of scaling it; restore it via props. */}
                  <RefreshIcon viewBox="0 0 25 23" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className={styles.tooltipContent}>
                <div className={styles.tooltipBody}>
                  {t('Reload the list of studies saved in local storage on this device.')}
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <button
            type="button"
            className={styles.clearAllButton}
            disabled={totalCachedCount === 0}
            onClick={() => setConfirmingClear(true)}
          >
            <Icon name="trash" /> {t('Clear Storage')}
          </button>
        </>
      );
    }

    // Active Transfers: cancel every queued/downloading job; each cancelled job removes its own
    // partial downloads from local storage.
    return (
      <button
        type="button"
        className={styles.clearAllButton}
        disabled={activeTransferCount === 0}
        onClick={() => DownloadManagerService.cancelAllActive()}
      >
        <Icon name="times" /> {t('Cancel Transfers')}
      </button>
    );
  };

  const renderStoredTab = () => {
    if (!storedStudies.length) {
      return <p className={styles.empty}>{t('No studies stored offline')}</p>;
    }

    return storedStudies.map(summary => (
      <div key={summary.StudyInstanceUID} className={styles.row}>
        <HoverCard openDelay={300}>
          <HoverCardTrigger asChild>
            <div className={styles.rowMain}>
              <div className={styles.rowTitle}>{renderPrimaryLine(summary, t, styles)}</div>
              {renderDescriptionLine(summary, styles)}
              <div className={styles.rowSub}>
                {summary.seriesCount} {t('series')} · {summary.instanceCount} {t('instances')}
                {summary.modalities ? <> · {summary.modalities}</> : null} · {formatBytes(summary.totalBytes)}
              </div>
            </div>
          </HoverCardTrigger>
          <StudyOfflineDetailsCard item={summary} />
        </HoverCard>
        <button
          type="button"
          className={styles.actionButton}
          title={t('Remove Offline Copy')}
          onClick={() => LocalCacheService.removeStudy(summary.StudyInstanceUID)}
        >
          <Icon name="trash" />
        </button>
      </div>
    ));
  };

  return (
    <ModalNG
      isOpen={isOpen}
      title={t('Offline Storage')}
      onClose={onClose}
      classes={{ content: styles.modal }}
    >
      <div className={styles.tabs}>
        <button
          type="button"
          className={activeTab === TABS.ACTIVE ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab(TABS.ACTIVE)}
        >
          {t('Active Transfers')}
        </button>
        <button
          type="button"
          className={activeTab === TABS.STORED ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab(TABS.STORED)}
        >
          {t('Offline Studies')}
        </button>
      </div>

      <div className={styles.searchRow}>
        <div className={styles.searchBox}>
          <SearchIcon />
          <input
            type="search"
            placeholder={t('Search by Patient, Study, Series, Accession, Service Episode, or UID')}
            value={searchValue}
            onChange={e => setSearchValue(e.target.value)}
            className={styles.searchInput}
          />
        </div>
        {renderTabAction()}
      </div>

      <div className={styles.list}>
        {activeTab === TABS.ACTIVE ? renderActiveTab() : renderStoredTab()}
      </div>

      {/* Blocking confirmation for Clear Storage: covers the whole dialog (including its close
          control) so nothing else is clickable until the user confirms or cancels. */}
      {confirmingClear && (
        <div className={styles.confirmOverlay}>
          <div className={styles.confirmCard}>
            <p className={styles.confirmPrompt}>
              {t('Remove all offline studies?')} ({totalCachedCount})
            </p>
            <div className={styles.confirmActions}>
              <button type="button" className={styles.clearAllConfirm} onClick={handleClearAll}>
                <Icon name="trash" /> {t('Clear All')}
              </button>
              <button type="button" className={styles.clearAllCancel} onClick={() => setConfirmingClear(false)}>
                <Icon name="times" /> {t('Cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ModalNG>
  );
}

function _stateLabel(job) {
  switch (job.state) {
    case JOB_STATES.QUEUED:
      return 'Queued';
    case JOB_STATES.DOWNLOADING:
      return 'Downloading';
    case JOB_STATES.COMPLETED:
      return 'Completed';
    case JOB_STATES.CANCELLED:
      return 'Cancelled';
    case JOB_STATES.ERROR:
      return 'Error';
    default:
      return job.state;
  }
}

DownloadManagerModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
};
