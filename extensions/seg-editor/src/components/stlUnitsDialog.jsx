// The unit declaration of a model import (ohif-viewers#151 FR-5), in the shell and layout of the
// editor's confirmation dialog (confirmDialog.jsx): the question, one radio per unit with nothing
// pre-selected, the comparison of each model with the image as a suggestion beneath the choice,
// and Cancel / Import in the footer. Import is disabled until a unit is chosen: a declaration is
// made, never defaulted. Escape cancels; Enter imports once a unit is chosen and no control has
// focus, as in the confirmation dialog.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';

import { SimpleDialogShell } from '@ohif/ui';
import { FooterAction } from '@ohif/ui-next';

import { confirmDialogKeyAction } from './confirmDialog';


export function StlUnitsDialog({
  headerTitle, message, options, suggestions = [], confirmText, cancelText, onConfirm, onCancel,
  radioName = 'stl-units', rootClass = '',
}) {
  const rootRef = useRef(null);
  const [choice, setChoice] = useState(null);
  const choiceRef = useRef(null);
  choiceRef.current = choice;

  const confirm = useCallback(() => {
    if (choiceRef.current) {
      onConfirm(choiceRef.current);
    }
  }, [onConfirm]);
  const cancel = useCallback(() => onCancel(), [onCancel]);

  useEffect(() => {
    const onKeyDown = event => {
      const action = confirmDialogKeyAction(event, rootRef.current);
      if (!action) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      (action === 'cancel' ? cancel : confirm)();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [confirm, cancel]);

  return (
    <SimpleDialogShell componentRef={rootRef} headerTitle={headerTitle} onClose={cancel} rootClass={rootClass}>
      <div className="content">
        {message}
        <div role="radiogroup" aria-label={headerTitle} data-cy="stl-units-options">
          {options.map(option => (
            <label className="dialogOption" htmlFor={`${radioName}-${option.value}`} key={option.value}>
              <input
                id={`${radioName}-${option.value}`}
                type="radio"
                name={radioName}
                value={option.value}
                checked={choice === option.value}
                onChange={() => setChoice(option.value)}
                data-cy={`stl-units-${option.value}`}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        {suggestions.length > 0 && (
          <ul className="dialogNotes" data-cy="stl-units-suggestions">
            {suggestions.map(text => <li key={text}>{text}</li>)}
          </ul>
        )}
      </div>
      <div className="footer">
        <FooterAction>
          <FooterAction.Secondary className="btn btn-default" onClick={cancel}>
            {cancelText}
          </FooterAction.Secondary>
          <FooterAction.Primary className="btn btn-primary" onClick={confirm} disabled={!choice} data-cy="stl-units-confirm">
            {confirmText}
          </FooterAction.Primary>
        </FooterAction>
      </div>
    </SimpleDialogShell>
  );
}

StlUnitsDialog.propTypes = {
  headerTitle: PropTypes.string,
  message: PropTypes.node,
  /** The units offered, in order; `value` is what onConfirm receives */
  options: PropTypes.arrayOf(PropTypes.shape({ value: PropTypes.string.isRequired, label: PropTypes.string.isRequired })).isRequired,
  /** What each model looks like against the image: advice, not a choice */
  suggestions: PropTypes.arrayOf(PropTypes.string),
  confirmText: PropTypes.string.isRequired,
  cancelText: PropTypes.string.isRequired,
  /** Called with the chosen option's value */
  onConfirm: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  radioName: PropTypes.string,
  rootClass: PropTypes.string,
};


/**
 * Ask which unit the models were saved in.
 *
 * @param {Object} params
 * @param {Object} params.uiDialogService
 * @param {string} params.id
 * @param {string} params.title
 * @param {React.ReactNode} params.message
 * @param {Array<{ value: string, label: string }>} params.options
 * @param {string[]} [params.suggestions]
 * @param {string} params.confirmText
 * @param {string} params.cancelText
 * @returns {Promise<string|null>} the chosen option's value, or null when cancelled
 */
export function callStlUnitsDialog({
  uiDialogService, id, title, message, options, suggestions = [], confirmText, cancelText,
}) {
  return new Promise(resolve => {
    let settled = false;
    const settle = value => {
      if (!settled) {
        settled = true;
        uiDialogService.dismiss({ id });
        resolve(value);
      }
    };

    uiDialogService.show({
      id,
      content: StlUnitsDialog,
      title,
      centralize: true,
      isDraggable: false,
      showOverlay: true,
      contentProps: {
        headerTitle: title,
        message,
        options,
        suggestions,
        confirmText,
        cancelText,
        radioName: `${id}-unit`,
        rootClass: 'sonadorSimpleInputDialog',
        onConfirm: value => settle(value),
        onCancel: () => settle(null),
      },
    });
  });
}

export default callStlUnitsDialog;
