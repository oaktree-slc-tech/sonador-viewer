// Hover-details card for a locally cached study (ohif-viewers#125).
//
// Extracted from DownloadManagerModal so the Offline Storage dialog and the study-results table's
// per-row offline indicator show the exact same panel: study identifiers plus a per-series
// breakdown (instances / size on disk) read live from the local cache index.
//
// Renders a Radix HoverCardContent, so it must be placed inside a <HoverCard> alongside a
// <HoverCardTrigger>.
//
// The card is portaled to document.body. ui-next's HoverCardContent renders in place by default,
// which put the study-table copy inside the row's own <td> — where the table's descendant rules
// (`.row td { padding: 25px ...; background-color: #1e1f23 }`) reached this card's series-table
// cells and wrecked its spacing, background, and inherited type. It also let the Offline Storage
// dialog's `overflow: auto` list clip the card. Portaling is what the z-index below always assumed.

import React from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import OHIF, { LocalCacheService } from '@ohif/core';
import { HoverCardContent, HoverCardPortal } from '@ohif/ui-next';

import styles from './StudyOfflineDetailsCard.module.scss';

const formatBytes = OHIF.utils.formatBytes;

export default function StudyOfflineDetailsCard({ item, side = 'top', align = 'start' }) {
  const { t } = useTranslation('StudyList');

  const seriesSummaries = LocalCacheService
    ? LocalCacheService.getStudySeriesSummaries(item?.StudyInstanceUID)
    : [];

  return (
    <HoverCardPortal>
      <HoverCardContent side={side} align={align} className={styles.detailsCard}>
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
            {t('Service Episode')} {item.ServiceEpisodeID}
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
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className={styles.detailsAttr}>{t('No series cached yet')}</div>
        )}
      </HoverCardContent>
    </HoverCardPortal>
  );
}

StudyOfflineDetailsCard.propTypes = {
  /** Study summary, as returned by LocalCacheService.getStudySummary (or a download job). */
  item: PropTypes.object,
  side: PropTypes.string,
  align: PropTypes.string,
};
