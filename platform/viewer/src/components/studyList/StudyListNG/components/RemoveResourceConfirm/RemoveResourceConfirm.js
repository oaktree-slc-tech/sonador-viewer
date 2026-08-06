import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import { ReactComponent as TrashBinIcon } from '@ohif/ui/src/elements/Svg/svgs/trash-bin.svg';
import { ReactComponent as CloseIcon } from '@ohif/ui/src/elements/Svg/svgs/close.svg';

import {
  describeSeries,
  describeStudy,
  seriesDetailLines,
  studyDetailLines,
} from './describeRemoval';

import styles from './RemoveResourceConfirm.module.scss';


export default function RemoveResourceConfirm({
  kind,
  descriptor,
  descriptors,
  isRemoving = false,
  contained = false,
  completion = null,
  onConfirm,
  onCancel,
}) {
  // Blocking confirmation for an irreversible removal (ohif-viewers#127, FR-11/AR-6).
  //
  // One component for all three entry points — the drawer's series menu, the study-list row menu,
  // and the bulk toolbar — because three hand-rolled overlays would drift, and the one thing that
  // must not drift is the sentence telling the user the data cannot be recovered.
  //
  // Blocking, not a dismissible popover: the overlay covers its whole container INCLUDING that
  // container's own close control, so nothing else is clickable until the user confirms or
  // cancels. Modelled on the Clear Storage overlay in DownloadManagerModal rather than on
  // UIDialogService, which is a viewer-side pattern with no confirmation content component.
  //
  // Deliberately NOT modelled on the counter-examples nearby: ACL row deletion in
  // StudiesTableShareModal, the per-row Remove Offline Copy, and the remove-offline menu item all
  // delete with no confirmation at all. Those are reversible local operations; this is a hard
  // delete on the imaging server.

  const { t } = useTranslation('StudyList');

  const cancelRef = useRef(null);

  useEffect(() => {
    // Cancel takes focus (FR-11): a stray Enter on an overlay that just appeared must not destroy
    // a study.
    cancelRef.current?.focus();
  }, []);

  // Completion hold: every request has settled and the outcome notification is up. The overlay
  // stays blocking, with no controls at all, while the caller waits out its settle delay -- the
  // point is that nothing else in the study list can be touched, and no refetch can be triggered,
  // until the server has finished cascading the deletes.
  if (completion) {
    const body = (
      <div
        className={classNames(styles.confirmOverlay, { [styles.confirmOverlayFixed]: !contained })}
        role="dialog"
        aria-modal="true"
        aria-live="polite"
      >
        <div className={styles.confirmCard}>
          <p className={styles.confirmPrompt}>{completion.title}</p>
          {completion.message && <p className={styles.confirmSubject}>{completion.message}</p>}
          <p className={styles.confirmNote}>{t('Updating the study list...')}</p>
        </div>
      </div>
    );

    return contained ? body : createPortal(body, document.body);
  }

  const list = kind === 'studies' ? (descriptors || []) : [];

  let heading;
  let subject;
  let details = [];

  if (kind === 'series') {
    heading = t('Remove this series?');
    subject = describeSeries(descriptor);
    details = seriesDetailLines(descriptor);
  } else if (kind === 'studies') {
    heading = t('Remove these studies?');
    subject = `${list.length} ${list.length === 1 ? t('study') : t('studies')}`;
  } else {
    heading = t('Remove this study?');
    subject = describeStudy(descriptor).title;
    details = studyDetailLines(descriptor);
  }

  const overlay = (
    // `contained` anchors the overlay to the caller's own positioned container — right for the
    // drawer, which has a surface of its own to cover. The default covers the viewport, for the
    // callers that do not: a study-list row's action cell is a few pixels wide, and an overlay
    // scoped to it would block nothing. The viewport variant is portalled to <body> so the study
    // table's overflow containment (which pins the row-action column) cannot clip it, the same
    // reason the date popups had to be portalled.
    <div
      className={classNames(styles.confirmOverlay, { [styles.confirmOverlayFixed]: !contained })}
      role="dialog"
      aria-modal="true"
    >
      <div className={styles.confirmCard}>
        <p className={styles.confirmPrompt}>{heading}</p>
        <p className={styles.confirmSubject}>{subject}</p>

        {kind === 'series' && descriptor?.StudyDescription && (
          <p className={styles.confirmContext}>{describeStudy(descriptor).title}</p>
        )}

        {details.length > 0 && (
          <div className={styles.confirmDetails}>
            {details.map(({ label, value }) => (
              <div key={label} className={styles.confirmDetailRow}>
                <span className={styles.confirmDetailLabel}>{t(label)}</span>
                <span className={styles.confirmDetailValue}>{value}</span>
              </div>
            ))}
          </div>
        )}

        {kind === 'studies' && (
          // Enumerated, not just counted: a selection is easy to get wrong, and the count alone
          // gives the user nothing to check it against. Scrolls rather than growing the card.
          <div className={styles.confirmList}>
            {list.map((d) => {
              const { title, subtitle } = describeStudy(d);

              return (
                <div key={d.StudyInstanceUID} className={styles.confirmListRow}>
                  <span className={styles.confirmListTitle}>{title}</span>
                  {subtitle && <span className={styles.confirmListSubtitle}>{subtitle}</span>}
                </div>
              );
            })}
          </div>
        )}

        <p className={styles.confirmWarning}>
          {t('This permanently deletes the data from the imaging server. It cannot be recovered.')}
        </p>

        <div className={styles.confirmActions}>
          <button
            type="button"
            className={styles.removeConfirm}
            // Disabled while a removal is in flight (FR-15), so a double-click issues one request
            // rather than two.
            disabled={isRemoving}
            onClick={onConfirm}
          >
            <TrashBinIcon /> {isRemoving ? t('Removing...') : t('Remove')}
          </button>
          <button
            type="button"
            ref={cancelRef}
            className={styles.removeCancel}
            disabled={isRemoving}
            onClick={onCancel}
          >
            <CloseIcon /> {t('Cancel')}
          </button>
        </div>
      </div>
    </div>
  );

  return contained ? overlay : createPortal(overlay, document.body);
}


RemoveResourceConfirm.propTypes = {
  kind: PropTypes.oneOf(['study', 'series', 'studies']).isRequired,
  // Single-resource kinds ('study', 'series') read `descriptor`; the bulk kind ('studies') reads
  // `descriptors`.
  descriptor: PropTypes.object,
  descriptors: PropTypes.arrayOf(PropTypes.object),
  isRemoving: PropTypes.bool,
  /**
   When set, the overlay drops its prompt and controls and shows this outcome instead, staying up
   and blocking until the caller unmounts it. `{ title, message }`.
   */
  completion: PropTypes.shape({
    title: PropTypes.string,
    message: PropTypes.string,
  }),
  // true: anchor to the caller's positioned container. false (default): cover the viewport,
  // portalled to <body>.
  contained: PropTypes.bool,
  onConfirm: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};
