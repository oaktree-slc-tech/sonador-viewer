import React from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import { Tooltip, TooltipContent, TooltipTrigger } from '@ohif/ui-next';

import styles from './TabFooterNG.module.scss';

// A hover text on a footer button, when the page gives one (the settings page provides the
// kit's TooltipProvider)
function Hint({ text, children }) {
  if (!text) {
    return children;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" className={styles.tooltip}>
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

Hint.propTypes = { text: PropTypes.string, children: PropTypes.node };

/**
 * The settings pages' footer: Reset Defaults on the left and, on the right, Save and a Cancel that
 * puts the page back to its saved values. A page that reports `changesPending` shows Save and
 * Cancel only while it holds changes the user has not saved (the settings console's pattern, as on
 * the Series Tags and Viewer Metadata pages): they appear with the first change and go with the
 * save or the revert. A page that does not report it always shows Save, and no Cancel.
 */
export default function TabFooterNG({ onReset, onSave, onCancel, changesPending, hasErrors, resetHint, saveHint, cancelHint }) {
  const { t } = useTranslation('UserPreferencesModal');

  return (
    <div className={styles.footer}>
      <Hint text={resetHint}>
        <button type="button" className={styles.reset} onClick={onReset} data-cy="settings-reset">
          {t('Reset Defaults')}
        </button>
      </Hint>
      <div className={styles.right}>
        {changesPending && onCancel && (
          <Hint text={cancelHint}>
            <button type="button" className={styles.cancel} onClick={onCancel} data-cy="settings-cancel">
              {t('Cancel')}
            </button>
          </Hint>
        )}
        {changesPending !== false && (
          <Hint text={saveHint}>
            <button type="button" className={styles.save} disabled={hasErrors} onClick={onSave} data-cy="settings-save">
              {t('Save')}
            </button>
          </Hint>
        )}
      </div>
    </div>
  );
}

TabFooterNG.propTypes = {
  onReset: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
  /** Puts the page back to its saved values; shown only while `changesPending` */
  onCancel: PropTypes.func,
  /** Whether the page holds changes the user has not saved; Save and Cancel follow it. Left
   *  out, Save is always shown */
  changesPending: PropTypes.bool,
  hasErrors: PropTypes.bool,
  /** Hover text for Reset Defaults: what it resets, and that nothing is saved until Save */
  resetHint: PropTypes.string,
  /** Hover text for Save: where the settings go and when they take effect */
  saveHint: PropTypes.string,
  /** Hover text for Cancel: what it puts back */
  cancelHint: PropTypes.string,
};
