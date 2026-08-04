// Per-row "available offline" indicator for the study results table (ohif-viewers#125).
//
// Occupies its own narrow column immediately right of the selector/actions column, so the badge
// sits just inside the rule that separates the row controls from the DICOM tag values. Nothing is
// rendered for studies that are not locally cached, so the column collapses to its padding when no
// study on the page is available offline.
//
// Hovering shows the same details panel the Offline Storage dialog uses (StudyOfflineDetailsCard),
// fed by the study's summary from the local cache index.

import React from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import { LocalCacheService } from '@ohif/core';
import { Icon } from '@ohif/ui';
import { HoverCard, HoverCardTrigger } from '@ohif/ui-next';

import StudyOfflineDetailsCard from '../StudyOfflineDetailsCard/StudyOfflineDetailsCard';

import styles from './OfflineIndicatorCell.module.scss';

// Column id, shared with StudiesTable so it can squeeze the column and exempt its header from the
// sort/label treatment the DICOM tag headers get.
export const OFFLINE_INDICATOR_COLUMN_ID = 'offline-cache';

export default function OfflineIndicatorCell({ row }) {
  const { t } = useTranslation('StudyList');

  // No cache subscription here: StudiesTable already carries useLocalCacheVersion and re-renders
  // every cell on a cache event, so the badge appears/disappears without one subscription per row.

  // Both the study list and the worklist carry the study UID on the row as a {value, label} pair
  // (the worklist keys its rows by worklist entry id instead, so row.id is not usable here).
  const StudyInstanceUID = row?.original?.StudyInstanceUID?.value;

  if (!LocalCacheService?.isStudyCachedSync(StudyInstanceUID)) {
    return null;
  }

  const summary = LocalCacheService.getStudySummary(StudyInstanceUID);

  return (
    <HoverCard openDelay={300}>
      <HoverCardTrigger asChild>
        <span
          className={styles.indicator}
          role="img"
          aria-label={t('Available offline')}
          // The row toggles its drawer on click; keep hovering the badge from collapsing the row
          // out from under the panel the user is reading.
          onClick={event => event.stopPropagation()}
        >
          <Icon name="offline-cache" />
        </span>
      </HoverCardTrigger>
      <StudyOfflineDetailsCard item={summary || { StudyInstanceUID }} />
    </HoverCard>
  );
}

OfflineIndicatorCell.propTypes = {
  row: PropTypes.object.isRequired,
};
