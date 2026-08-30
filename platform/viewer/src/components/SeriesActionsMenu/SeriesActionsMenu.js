// Series actions menu for the viewer's study browser thumbnails (ohif-viewers#127 follow-up).
//
// Exposes the study list's series-scoped capabilities where the user actually reads the images:
// Download Series (zip export through the tracked archive queue), Save Series Offline / Remove
// Offline Storage (this browser's cached copy, ohif-viewers#130) and Remove Series (permanent
// deletion from the imaging server, behind the same blocking confirmation).
//
// NAMING, and it is the whole design risk of #130: this menu now carries BOTH "Remove Offline
// Storage" and "Remove Series". The first evicts a copy from this browser and is reversible; the
// second destroys the data on the imaging server and is not. They are kept apart by grouping (the
// offline pair sits with Download Series, the server removal is last), by icon (offline-cache vs
// trash), by styling (only the server removal is destructive), by the absence of the word "Delete"
// on the offline item, and by the confirmation only the server removal raises (#130 AR-1).
//
// VIEWER ONLY. It reaches the thumbnail through an optional `renderSeriesActions` slot on
// StudyBrowser, and only ConnectedStudyBrowser — the viewer's left sidepanel — supplies one. The
// study list's drawer uses ImageThumbnailNG and has its own menu; the quick-switch SeriesList
// reuses the same Thumbnail component and passes no slot, so no menu appears there either.

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import { DropdownMenu } from 'radix-ui';
import { DotsVerticalIcon } from '@radix-ui/react-icons';

import {
  display,
  redux,
  LocalCacheService,
  DownloadManagerService,
  notifySeriesQueued,
} from '@ohif/core';
import { ReactComponent as DownloadIcon } from '@ohif/ui/src/elements/Svg/svgs/cloud-download.svg';
import { ReactComponent as OfflineCacheIcon } from '@ohif/ui/src/elements/Icon/icons/offline-cache.svg';
import { ReactComponent as TrashBinIcon } from '@ohif/ui/src/elements/Svg/svgs/trash-bin.svg';

import { fetchDownloadSeries } from '../../api/ext';
import useResourceAclPermissions from '../../hooks/useResourceAclPermissions';
import RemoveResourceConfirm from '../studyList/StudyListNG/components/RemoveResourceConfirm/RemoveResourceConfirm';
import useLocalCacheVersion from '../studyList/StudyListNG/hooks/useLocalCacheVersion';
import useRemoveResource from '../studyList/StudyListNG/hooks/useRemoveResource';

import radixStyles from '../../styles/radixUi.module.scss';
import styles from './SeriesActionsMenu.module.scss';


export default function SeriesActionsMenu({
  StudyInstanceUID,
  SeriesInstanceUID,
  SeriesNumber,
  SeriesDescription,
  displaySetInstanceUID,
  numImageFrames,
  onSeriesRemoved,
}) {
  const { t } = useTranslation('StudyList');
  const { activeServer } = useSelector(redux.selectors.activeOhifServer);

  const { aclView, aclRemove, resolveSeriesAcl } = useResourceAclPermissions({
    server: activeServer,
    StudyInstanceUID,
    SeriesInstanceUID,
  });

  const [confirming, setConfirming] = useState(false);
  const { isRemoving, removeSeriesResource } = useRemoveResource();

  // Offline-cache state for this series (ohif-viewers#130, AR-3). Read synchronously at render --
  // both of these exist precisely so a render path never has to await IndexedDB -- and kept live
  // by useLocalCacheVersion rather than by local state anyone has to remember to invalidate.
  useLocalCacheVersion();
  const isSeriesCached = !!LocalCacheService?.isSeriesCachedSync(SeriesInstanceUID);
  const isSeriesTransferring = !!DownloadManagerService?.isSeriesDownloading(SeriesInstanceUID);
  // FR-8: a study transfer still writing this series would silently re-cache it a moment after a
  // removal, so the removal is withheld until nothing is transferring it.
  const isTransferInFlight = !!DownloadManagerService?.isSeriesTransferInFlight(
    StudyInstanceUID,
    SeriesInstanceUID
  );

  // The descriptor the archive queue and the confirmation both read. Modality comes off the
  // display set, the same lookup the study-list drawer uses -- the thumbnail does not carry it.
  // The study-level patient attributes the study list pulls off its row are not available here, so
  // the notifications identify the series rather than the patient; SeriesInstanceUID is what the
  // export itself needs.
  const displaySet = displaySetInstanceUID
    ? display.DisplaySetApi.Instance?.displaySetService?.getDisplaySetByUID(displaySetInstanceUID)
    : undefined;

  const descriptor = {
    StudyInstanceUID,
    SeriesInstanceUID,
    SeriesNumber,
    SeriesDescription,
    Modality: displaySet?.Modality,
    numberOfSeriesRelatedInstances: displaySet?.images?.length ?? numImageFrames,
  };

  const handleDownload = () => {
    fetchDownloadSeries(activeServer, SeriesInstanceUID, descriptor);
  };

  const handleSaveOffline = () => {
    // Queue THIS series for offline storage, or cancel the transfer if one is already running
    // (#130 FR-1/FR-2). The queue de-duplicates on the Series UID, so a double-click is harmless.
    if (isSeriesTransferring) {
      DownloadManagerService.cancelSeries(SeriesInstanceUID);
      return;
    }

    const job = DownloadManagerService.enqueueSeries({
      server: activeServer,
      StudyInstanceUID,
      SeriesInstanceUID,
      descriptor,
    });

    // Queueing is otherwise invisible until the thumbnail badge changes; completion and failure are
    // announced by the DownloadManagerService subscription (see downloadNotifications).
    notifySeriesQueued({ job });
  };

  const handleRemoveOffline = () => {
    // Evicts this browser's copy only. Reversible, so no confirmation (#130 FR-5) -- deliberately
    // unlike Remove Series below.
    LocalCacheService.removeSeries(StudyInstanceUID, SeriesInstanceUID);
  };

  const handleConfirmRemove = async () => {
    const ok = await removeSeriesResource(activeServer, descriptor);

    setConfirming(false);

    if (ok && onSeriesRemoved) {
      onSeriesRemoved(SeriesInstanceUID);
    }
  };

  const actions = [];

  if (aclView) {
    actions.push({
      id: 'download-series',
      label: t('Download Series'),
      Icon: DownloadIcon,
      onSelect: handleDownload,
    });

    // Same `view` gate as the export above, resolved through the same lazy ACL call -- no second
    // fetch (#130 FR-1). Three states, and only two of them show an item:
    //   - this series has its own transfer running -> Cancel Transfer (FR-2)
    //   - nothing is transferring it and it is not cached -> Save Series Offline
    //   - already cached, or already being written by the STUDY transfer -> nothing to offer.
    // The last case matters: queueing a series a study job is already downloading would start a
    // second transfer of the same images.
    if (isSeriesTransferring || (!isSeriesCached && !isTransferInFlight)) {
      actions.push({
        id: 'save-series-offline',
        // Cloud-check icon: the offline-feature vocabulary, distinct from the export's
        // cloud-download and from the trash the server removal uses (AR-1).
        label: isSeriesTransferring ? t('Cancel Transfer') : t('Save Series Offline'),
        Icon: OfflineCacheIcon,
        onSelect: handleSaveOffline,
      });
    }
  }

  // NOT gated on the server `remove` grant (#130 FR-4): this deletes data from this browser, not
  // from the imaging server, and a user who can see a series can always drop their own local copy
  // of it. It follows the same visibility rule as the menu itself.
  if (isSeriesCached && !isTransferInFlight) {
    actions.push({
      id: 'remove-series-offline',
      label: t('Remove Offline Storage'),
      Icon: OfflineCacheIcon,
      onSelect: handleRemoveOffline,
    });
  }

  if (aclRemove) {
    actions.push({
      id: 'remove-series',
      label: t('Remove Series'),
      Icon: TrashBinIcon,
      destructive: true,
      onSelect: () => setConfirming(true),
    });
  }

  // No permitted action means no trigger at all — not a disabled button, not an empty menu.
  if (!SeriesInstanceUID || !actions.length) {
    return null;
  }

  return (
    <>
      <DropdownMenu.Root
        onOpenChange={(open) => {
          if (open) {
            resolveSeriesAcl();
          }
        }}
      >
        <DropdownMenu.Trigger asChild>
          <button
            className={classNames(radixStyles.IconButton, styles.trigger)}
            aria-label={t('Series Actions')}
            // The thumbnail itself is a click target that loads the series into the active
            // viewport; opening its menu must not also change what the user is looking at.
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <DotsVerticalIcon height={16} width={16} />
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className={classNames(radixStyles.Content, styles.content)}
            align="end"
            sideOffset={4}
            onClick={(e) => e.stopPropagation()}
          >
            {actions.map(({ id, label, Icon, destructive, onSelect }) => (
              <DropdownMenu.Item
                key={id}
                className={classNames(radixStyles.DropdownItem, styles.item, {
                  [styles.itemDestructive]: destructive,
                })}
                onSelect={onSelect}
              >
                <Icon className={classNames(radixStyles.icon15x, radixStyles.DropDownSvgIcon)} />
                <span>{label}</span>
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {confirming && (
        <RemoveResourceConfirm
          kind="series"
          descriptor={descriptor}
          isRemoving={isRemoving}
          onConfirm={handleConfirmRemove}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}


SeriesActionsMenu.propTypes = {
  StudyInstanceUID: PropTypes.string,
  SeriesInstanceUID: PropTypes.string,
  SeriesNumber: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  SeriesDescription: PropTypes.string,
  displaySetInstanceUID: PropTypes.string,
  numImageFrames: PropTypes.number,
  /** Called after a confirmed removal so the viewer can rebuild its study. */
  onSeriesRemoved: PropTypes.func,
};
