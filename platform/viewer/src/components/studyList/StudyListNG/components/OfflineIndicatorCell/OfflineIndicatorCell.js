// Per-row "available offline" indicator for the study results table (ohif-viewers#125).
//
// Occupies its own narrow column immediately right of the selector/actions column, so the badge
// sits just inside the rule that separates the row controls from the DICOM tag values. Nothing is
// rendered for studies that are not locally cached, so the column collapses to its padding when no
// study on the page is available offline.
//
// The badge opens the same details panel the Offline Storage dialog uses (StudyOfflineDetailsCard),
// fed by the study's summary from the local cache index.

import React from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import { LocalCacheService, DownloadManagerService } from '@ohif/core';
import { Icon } from '@ohif/ui';
import { Popover, PopoverTrigger } from '@ohif/ui-next';

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

  // The per-series removal control from the Offline Storage dialog is offered here too
  // (ohif-viewers#130, §5.2): it is the same card over the same data, and withholding the control
  // on one copy of it would make the two behave differently for no reason a user could infer.
  const handleRemoveSeries = (studyUID, SeriesInstanceUID) => {
    LocalCacheService.removeSeries(studyUID, SeriesInstanceUID);
  };

  // No control for a series a transfer is still writing (#130 FR-8) -- the same rule the Offline
  // Storage dialog and both series menus apply.
  const isSeriesRemovable = SeriesInstanceUID =>
    !DownloadManagerService?.isSeriesTransferInFlight(StudyInstanceUID, SeriesInstanceUID);

  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* A button, not a `<span role="img">`: the card it opens carries a removal control, and
            PopoverTrigger needs a real interactive element both to be operable by keyboard and to
            be the element focus returns to when the popover closes. */}
        <button
          type="button"
          className={styles.indicator}
          aria-label={t('Available offline')}
          data-cy="offline-indicator"
          // The row toggles its drawer on click; keep activating the badge from collapsing the
          // row out from under the panel the user is reading. stopPropagation only -- Radix
          // composes the open/close toggle into this same handler and a preventDefault would
          // swallow it.
          onClick={event => event.stopPropagation()}
        >
          <Icon name="offline-cache" />
        </button>
      </PopoverTrigger>
      <StudyOfflineDetailsCard
        item={summary || { StudyInstanceUID }}
        onRemoveSeries={handleRemoveSeries}
        isSeriesRemovable={isSeriesRemovable}
      />
    </Popover>
  );
}

OfflineIndicatorCell.propTypes = {
  row: PropTypes.object.isRequired,
};
