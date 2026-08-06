// Series actions menu for the viewer's study browser thumbnails (ohif-viewers#127 follow-up).
//
// Exposes the study list's series-scoped capabilities where the user actually reads the images:
// Download Series (zip export through the tracked archive queue) and Remove Series (permanent
// deletion from the imaging server, behind the same blocking confirmation).
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

import { display, redux } from '@ohif/core';
import { ReactComponent as DownloadIcon } from '@ohif/ui/src/elements/Svg/svgs/cloud-download.svg';
import { ReactComponent as TrashBinIcon } from '@ohif/ui/src/elements/Svg/svgs/trash-bin.svg';

import { fetchDownloadSeries } from '../../api/ext';
import useResourceAclPermissions from '../../hooks/useResourceAclPermissions';
import RemoveResourceConfirm from '../studyList/StudyListNG/components/RemoveResourceConfirm/RemoveResourceConfirm';
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
