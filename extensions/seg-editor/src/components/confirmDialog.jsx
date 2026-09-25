// Confirmation dialog in the OHIF v3 style (a dialog shell with a primary and a secondary footer
// action), shown through the UIDialogService and laid out like the viewer's input dialog
// (callInputDialog): `.content` / `.footer` sections and the dialog's `btn` button classes.

import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';

import { SimpleDialogShell } from '@ohif/ui';
import { FooterAction } from '@ohif/ui-next';


const INTERACTIVE_TAGS = ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'];

function _isInteractive(target) {
  return !!target && (INTERACTIVE_TAGS.includes(target.tagName)
    || !!target.isContentEditable
    || target.getAttribute?.('role') === 'button'
    || !!target.closest?.('button, a, [role="button"], .closeBtn'));
}

/**
 * The dialog's keyboard shortcut for a keydown, or null (the dialog service has no keyboard
 * handling of its own):
 * - Escape cancels.
 * - Enter confirms only when no control has focus (the page, or the dialog's text). On a focused
 *   control -- Cancel, the close control, the primary button -- Enter is left to that control, so
 *   Enter on Cancel cancels and Enter on the primary button confirms once.
 *
 * @param {KeyboardEvent} event
 * @param {HTMLElement} [root] - the dialog element
 * @returns {'confirm'|'cancel'|null}
 */
export function confirmDialogKeyAction(event, root) {
  if (event.key === 'Escape') {
    return 'cancel';
  }
  if (event.key !== 'Enter' || _isInteractive(event.target)) {
    return null;
  }
  const doc = event.target?.ownerDocument;
  const unfocused = !event.target || event.target === doc?.body || event.target === doc?.documentElement;
  return unfocused || root?.contains?.(event.target) ? 'confirm' : null;
}

export function ConfirmDialog({
  headerTitle, message, confirmText, cancelText, onConfirm, onCancel, rootClass = '',
}) {
  const rootRef = useRef(null);

  useEffect(() => {
    const onKeyDown = event => {
      const action = confirmDialogKeyAction(event, rootRef.current);
      if (!action) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      (action === 'cancel' ? onCancel : onConfirm)();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onConfirm, onCancel]);

  return (
    <SimpleDialogShell componentRef={rootRef} headerTitle={headerTitle} onClose={onCancel} rootClass={rootClass}>
      <div className="content">{message}</div>
      <div className="footer">
        <FooterAction>
          <FooterAction.Secondary className="btn btn-default" onClick={onCancel}>
            {cancelText}
          </FooterAction.Secondary>
          <FooterAction.Primary className="btn btn-primary" onClick={onConfirm} data-cy="confirm-dialog-confirm">
            {confirmText}
          </FooterAction.Primary>
        </FooterAction>
      </div>
    </SimpleDialogShell>
  );
}

ConfirmDialog.propTypes = {
  headerTitle: PropTypes.string,
  message: PropTypes.node,
  confirmText: PropTypes.string.isRequired,
  cancelText: PropTypes.string.isRequired,
  onConfirm: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  rootClass: PropTypes.string,
};


/**
 * Ask for confirmation.
 *
 * @param {Object} params
 * @param {Object} params.uiDialogService
 * @param {string} params.id - dialog id
 * @param {string} params.title
 * @param {React.ReactNode} params.message
 * @param {string} params.confirmText
 * @param {string} params.cancelText
 * @returns {Promise<boolean>} true when confirmed
 */
export function callConfirmDialog({ uiDialogService, id, title, message, confirmText, cancelText }) {
  return new Promise(resolve => {
    let settled = false;
    const settle = confirmed => {
      if (!settled) {
        settled = true;
        uiDialogService.dismiss({ id });
        resolve(confirmed);
      }
    };

    uiDialogService.show({
      id,
      content: ConfirmDialog,
      title,
      centralize: true,
      isDraggable: false,
      showOverlay: true,
      contentProps: {
        headerTitle: title,
        message,
        confirmText,
        cancelText,
        rootClass: 'sonadorSimpleInputDialog',
        onConfirm: () => settle(true),
        onCancel: () => settle(false),
      },
    });
  });
}

export default callConfirmDialog;
