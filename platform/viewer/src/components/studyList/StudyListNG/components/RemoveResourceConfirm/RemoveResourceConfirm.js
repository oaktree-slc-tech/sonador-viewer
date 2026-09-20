import React, { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import PropTypes from 'prop-types';
import { Dialog } from 'radix-ui';

import { ReactComponent as CloseIcon } from '@ohif/ui/src/elements/Svg/svgs/close.svg';
import { ReactComponent as TrashBinIcon } from '@ohif/ui/src/elements/Svg/svgs/trash-bin.svg';

import {
  commentDetailLines,
  describeComment,
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
  fallbackFocusRef = null,
  onConfirm,
  onCancel,
}) {
  // Blocking confirmation for an irreversible removal (ohif-viewers#127, FR-11/AR-6).
  //
  // One component for every entry point (the drawer's series menu, the study-list row menu, the
  // bulk toolbar, the drawer's comment panel), so the sentence telling the user the data cannot
  // be recovered is written once.
  //
  // Built on the Radix Dialog the rest of the study list already uses for its menus and popovers:
  // it keeps keyboard focus inside the card, makes the rest of the page inert, names the dialog
  // for assistive technology, and returns focus to the control that opened it. Escape cancels,
  // except while a removal is in flight. Clicking the backdrop does not dismiss: the overlay
  // exists to block everything behind it until the user decides.
  //
  // Reversible local operations nearby (Remove Offline Copy and friends) deliberately have no
  // confirmation; this one is for hard deletes on the imaging server.

  const { t } = useTranslation('StudyList');
  const titleId = useId();
  const descriptionId = useId();

  const cancelRef = useRef(null);

  // The control that had focus when the dialog opened, captured during the first render, before
  // the dialog's own focus management moves it.
  const openerRef = useRef(null);
  if (openerRef.current === null && typeof document !== 'undefined') {
    openerRef.current = document.activeElement;
  }

  const handleOpenAutoFocus = (event) => {
    // Cancel takes focus (FR-11): a stray Enter on a dialog that just appeared must not destroy
    // a study. The completion hold has no controls, so Radix focuses the card itself.
    if (cancelRef.current) {
      event.preventDefault();
      cancelRef.current.focus();
    }
  };

  const handleCloseAutoFocus = (event) => {
    // Focus goes back to the control that opened the dialog. Radix would look for a Dialog.Trigger,
    // which this component does not use, so restoration is done here. After a successful removal
    // the opening control may be gone with the thing it removed; the caller can name a surviving
    // control to land on instead.
    const opener = openerRef.current;
    const fallback = fallbackFocusRef?.current;
    const openerSurvives = opener && opener !== document.body && document.contains(opener);

    event.preventDefault();

    if (openerSurvives) {
      opener.focus();
    } else if (fallback) {
      fallback.focus();
    }
  };

  const blockWhileRemoving = (event) => {
    if (isRemoving || completion) {
      event.preventDefault();
    }
  };

  const preventDismiss = (event) => {
    event.preventDefault();
  };

  const overlayClassName = classNames(styles.confirmOverlay, { [styles.confirmOverlayFixed]: !contained });

  // `contained` anchors the overlay to the caller's own positioned container, which is right for
  // the drawer, which has a surface of its own to cover. The default covers the viewport for the
  // callers that do not: a study-list row's action cell is a few pixels wide. The viewport variant
  // is portalled to <body> so the study table's overflow containment cannot clip it.
  const wrap = (content) => (contained ? content : <Dialog.Portal>{content}</Dialog.Portal>);

  // Completion hold: every request has settled and the outcome notification is up. The dialog
  // stays blocking, with no controls at all, while the caller waits out its settle delay, so
  // nothing in the study list can be touched and no refetch can be triggered until the server has
  // finished cascading the deletes.
  if (completion) {
    return (
      <Dialog.Root open modal>
        {wrap(
          <Dialog.Overlay className={overlayClassName}>
            <Dialog.Content
              className={styles.confirmCard}
              aria-modal="true"
              aria-live="polite"
              aria-describedby={undefined}
              onOpenAutoFocus={handleOpenAutoFocus}
              onCloseAutoFocus={handleCloseAutoFocus}
              onEscapeKeyDown={preventDismiss}
              onPointerDownOutside={preventDismiss}
              onInteractOutside={preventDismiss}
            >
              <Dialog.Title className={styles.confirmPrompt}>{completion.title}</Dialog.Title>
              {completion.message && <p className={styles.confirmSubject}>{completion.message}</p>}
              <p className={styles.confirmNote}>{t('Updating the study list...')}</p>
            </Dialog.Content>
          </Dialog.Overlay>
        )}
      </Dialog.Root>
    );
  }

  const list = kind === 'studies' ? (descriptors || []) : [];

  let heading;
  let subject;
  let details = [];

  if (kind === 'series') {
    heading = t('Remove this series?');
    subject = describeSeries(descriptor);
    details = seriesDetailLines(descriptor);
  } else if (kind === 'comment') {
    heading = t('Remove this comment?');
    subject = describeComment(descriptor).title;
    details = commentDetailLines(descriptor);
  } else if (kind === 'studies') {
    heading = t('Remove these studies?');
    subject = `${list.length} ${list.length === 1 ? t('study') : t('studies')}`;
  } else {
    heading = t('Remove this study?');
    subject = describeStudy(descriptor).title;
    details = studyDetailLines(descriptor);
  }

  const warning = kind === 'comment'
    ? t('This permanently deletes the comment from the imaging server. It cannot be recovered.')
    : t('This permanently deletes the data from the imaging server. It cannot be recovered.');

  return (
    <Dialog.Root
      open
      modal
      onOpenChange={(open) => {
        if (!open && !isRemoving) {
          onCancel();
        }
      }}
    >
      {wrap(
        <Dialog.Overlay className={overlayClassName}>
          <Dialog.Content
            className={styles.confirmCard}
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            onOpenAutoFocus={handleOpenAutoFocus}
            onCloseAutoFocus={handleCloseAutoFocus}
            onEscapeKeyDown={blockWhileRemoving}
            onPointerDownOutside={preventDismiss}
            onInteractOutside={preventDismiss}
          >
            <Dialog.Title id={titleId} className={styles.confirmPrompt}>{heading}</Dialog.Title>
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

            <Dialog.Description id={descriptionId} className={styles.confirmWarning}>
              {warning}
            </Dialog.Description>

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
          </Dialog.Content>
        </Dialog.Overlay>
      )}
    </Dialog.Root>
  );
}


RemoveResourceConfirm.propTypes = {
  kind: PropTypes.oneOf(['study', 'series', 'studies', 'comment']).isRequired,
  // Single-resource kinds ('study', 'series', 'comment') read `descriptor`; the bulk kind
  // ('studies') reads `descriptors`.
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
  // Control to focus when the dialog closes and the control that opened it is no longer in the
  // document (it was removed along with the resource).
  fallbackFocusRef: PropTypes.shape({ current: PropTypes.any }),
  onConfirm: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};
