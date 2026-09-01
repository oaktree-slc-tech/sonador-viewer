// Details card for a locally cached study (ohif-viewers#125).
//
// Extracted from DownloadManagerModal so the Offline Storage dialog and the study-results table's
// per-row offline indicator show the exact same panel: study identifiers plus a per-series
// breakdown (instances / size on disk) read live from the local cache index.
//
// Two later additions, both driven from the parent rather than from the service (#129, #130):
//   - `job`: while a transfer is running there is nothing in the cache index for a series that has
//     not landed yet, so an archive-mode job's own per-series detail is merged in. That is what
//     makes a stalled series identifiable from the dialog (#129 FR-8, AC "a stalled or failed
//     series is identifiable without opening the console").
//   - `onRemoveSeries`: an optional action column for evicting one series' local copy (#130 FR-6).
//     Optional so any consumer that does not pass it keeps today's five-column, read-only card.
//
// Renders a Radix PopoverContent, so it must be placed inside a <Popover> alongside a
// <PopoverTrigger>.
//
// POPOVER, NOT HOVER CARD, and the removal control is why. Radix documents hover-card content as
// unreachable for keyboard users -- it is a mouse-only affordance for supplementary information,
// and making its trigger focusable does not change that. Once the card carries an interactive
// control (#130 FR-6) the primitive has to be one with a keyboard interaction model, so this opens
// on click, closes on Escape, and returns focus to its trigger.
//
// The card is portaled to document.body. Popover content renders in place by default, which put
// the study-table copy inside the row's own <td> — where the table's descendant rules
// (`.row td { padding: 25px ...; background-color: #1e1f23 }`) reached this card's series-table
// cells and wrecked its spacing, background, and inherited type. It also let the Offline Storage
// dialog's `overflow: auto` list clip the card. Portaling is what the z-index below always assumed.

import React from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import OHIF, { LocalCacheService, SERIES_TRANSFER_STATES } from '@ohif/core';
import { Icon } from '@ohif/ui';
import { PopoverContent, PopoverPortal } from '@ohif/ui-next';

import styles from './StudyOfflineDetailsCard.module.scss';

const formatBytes = OHIF.utils.formatBytes;

// Per-series transfer states, as displayed. Keys are the service's values (#129 FR-6); the labels
// go through i18n like every other string in this dialog.
const SERIES_STATE_LABELS = {
  [SERIES_TRANSFER_STATES.QUEUED]: 'Queued',
  [SERIES_TRANSFER_STATES.DOWNLOADING]: 'Downloading',
  [SERIES_TRANSFER_STATES.EXTRACTING]: 'Extracting',
  [SERIES_TRANSFER_STATES.COMPLETE]: 'Complete',
  [SERIES_TRANSFER_STATES.FAILED]: 'Failed',
  [SERIES_TRANSFER_STATES.CANCELLED]: 'Cancelled',
};

/**
 * Merge what is stored (the cache index) with what is in flight (an archive job's series detail).
 *
 * A series still transferring has no index entry until its first instance lands, so the two are
 * unioned on SeriesInstanceUID rather than one replacing the other: the stored figures stay
 * authoritative for size and instance count, and the job supplies the transfer state.
 */
function mergeSeriesRows(stored, job) {
  const rows = new Map();

  stored.forEach(series => rows.set(series.SeriesInstanceUID, { ...series }));

  (job?.series || []).forEach(transfer => {
    const existing = rows.get(transfer.SeriesInstanceUID) || {
      SeriesInstanceUID: transfer.SeriesInstanceUID,
      SeriesNumber: transfer.SeriesNumber,
      SeriesDescription: transfer.SeriesDescription,
      Modality: transfer.Modality,
      instanceCount: 0,
      totalBytes: 0,
    };

    rows.set(transfer.SeriesInstanceUID, {
      ...existing,
      SeriesNumber: existing.SeriesNumber ?? transfer.SeriesNumber,
      SeriesDescription: existing.SeriesDescription || transfer.SeriesDescription,
      Modality: existing.Modality || transfer.Modality,
      transfer,
    });
  });

  return Array.from(rows.values()).sort(
    (a, b) => Number(a.SeriesNumber || 0) - Number(b.SeriesNumber || 0)
  );
}

export default function StudyOfflineDetailsCard({
  item,
  job,
  onRemoveSeries,
  isSeriesRemovable,
  side = 'top',
  align = 'start',
}) {
  const { t } = useTranslation('StudyList');

  const stored = LocalCacheService
    ? LocalCacheService.getStudySeriesSummaries(item?.StudyInstanceUID)
    : [];
  const seriesSummaries = mergeSeriesRows(stored, job);
  const showActions = typeof onRemoveSeries === 'function';
  // #130 FR-8, decided the same way the series menus decide it: a series a transfer is still
  // writing has no removal control, because the job would re-cache it moments later. The predicate
  // comes from the parent so the service stays out of this card (AR-5).
  const canRemove = series =>
    typeof isSeriesRemovable === 'function' ? isSeriesRemovable(series.SeriesInstanceUID) : true;

  return (
    <PopoverPortal>
      <PopoverContent
        side={side}
        align={align}
        className={styles.detailsCard}
        data-cy="offline-details-card"
      >
        {(item?.PatientName || item?.PatientID) && (
          <div className={styles.detailsTitle}>
            {item.PatientName}
            {item.PatientID && <span className={styles.rowTitleSecondary}>{item.PatientID}</span>}
          </div>
        )}
        {item?.StudyDescription && <div className={styles.detailsDescription}>"{item.StudyDescription}"</div>}
        {item?.AccessionNumber && (
          <div className={styles.detailsAttr}>
            {t('AccessionNumber')} {item.AccessionNumber}
          </div>
        )}
        {item?.ServiceEpisodeID && (
          <div className={styles.detailsAttr}>
            {t('Service Episode ID')} {item.ServiceEpisodeID}
          </div>
        )}
        {seriesSummaries.length > 0 ? (
          <table className={styles.detailsTable}>
            <thead>
              <tr>
                <th>{t('Series #')}</th>
                <th>{t('StudyDescription')}</th>
                <th>{t('Modality')}</th>
                <th>{t('Instances')}</th>
                <th>{t('Size')}</th>
                {job && <th>{t('Transfer')}</th>}
                {/* Empty header, like the study table's offline-indicator column. */}
                {showActions && <th />}
              </tr>
            </thead>
            <tbody>
              {seriesSummaries.map(series => (
                <tr key={series.SeriesInstanceUID}>
                  <td>{series.SeriesNumber ?? ''}</td>
                  <td>{series.SeriesDescription || ''}</td>
                  <td>{series.Modality || ''}</td>
                  <td>{series.instanceCount}</td>
                  <td>{formatBytes(series.totalBytes)}</td>
                  {job && <td>{renderTransferCell(series.transfer, t)}</td>}
                  {showActions && (
                    <td>
                      {series.instanceCount > 0 && canRemove(series) && (
                        <button
                          type="button"
                          className={styles.seriesRemoveButton}
                          data-cy="offline-series-remove"
                          data-series-uid={series.SeriesInstanceUID}
                          title={t('Remove Offline Storage')}
                          aria-label={t('Remove this series from offline storage')}
                          // The row underneath a study-table card toggles its drawer; keep it
                          // from reacting to a click meant for this control (AR-5).
                          onClick={event => {
                            event.stopPropagation();
                            onRemoveSeries(item?.StudyInstanceUID, series.SeriesInstanceUID);
                          }}
                        >
                          <Icon name="trash" />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className={styles.detailsAttr}>{t('No series cached yet')}</div>
        )}
      </PopoverContent>
    </PopoverPortal>
  );
}

// Transfer state for one series, with its byte progress when the server reported a size and the
// retrieval path when it was not the archive it started as (#129 FR-9).
function renderTransferCell(transfer, t) {
  if (!transfer) {
    return '';
  }

  const label = t(SERIES_STATE_LABELS[transfer.state] || transfer.state);
  const bytes =
    transfer.totalBytes
      ? ` ${formatBytes(transfer.bytesReceived)} / ${formatBytes(transfer.totalBytes)}`
      : transfer.bytesReceived
        ? ` ${formatBytes(transfer.bytesReceived)}`
        : '';

  return (
    <>
      <span className={transfer.state === SERIES_TRANSFER_STATES.FAILED ? styles.transferFailed : undefined}>
        {label}
      </span>
      {bytes}
      {transfer.path === 'instances' && ` · ${t('per image')}`}
    </>
  );
}

StudyOfflineDetailsCard.propTypes = {
  /** Study summary, as returned by LocalCacheService.getStudySummary (or a download job). */
  item: PropTypes.object,
  /** The in-flight download job for this study, when there is one. Supplies per-series transfer
   * state for archive-mode transfers; omit for a purely stored-state card. */
  job: PropTypes.object,
  /** Removes one series' local copy. When absent the action column is not rendered. */
  onRemoveSeries: PropTypes.func,
  /** `(SeriesInstanceUID) => boolean`. False withholds that row's control -- used to hide it while
   * a transfer is still writing the series (#130 FR-8). Absent means every row may be removed. */
  isSeriesRemovable: PropTypes.func,
  side: PropTypes.string,
  align: PropTypes.string,
};
