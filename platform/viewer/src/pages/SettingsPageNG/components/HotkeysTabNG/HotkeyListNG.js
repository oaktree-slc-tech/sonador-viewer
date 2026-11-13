import React from 'react';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import HotkeyFieldNG from '../HotkeyFieldNG/HotkeyFieldNG';

import { splitHotkeys } from './logic';

import styles from './HotkeysTabNG.module.scss';

/**
 * One set of key bindings as two columns of label and key field, each field recording the keys
 * pressed in it. A field whose keys are refused is marked invalid and described by its message.
 */
export default function HotkeyListNG({ hotkeys, errors, onChange, emptyMessage, idPrefix }) {
  if (!Object.keys(hotkeys).length) {
    return <div className={styles.content}>{emptyMessage}</div>;
  }

  return (
    <div className={styles.content}>
      {splitHotkeys(hotkeys).map((column, index) => (
        <div className={styles.column} key={index}>
          {column.map(([name, definition]) => {
            const errorMessage = errors[name];
            const fieldId = `${idPrefix}-${name}`;
            const errorId = `${fieldId}-error`;

            return (
              <div key={name} className={styles.row}>
                <label className={styles.hotKeyLabel} htmlFor={fieldId}>
                  {definition.label}
                </label>
                <div className={classNames(styles.hotFieldContainer, { stateError: !!errorMessage })}>
                  <HotkeyFieldNG
                    id={fieldId}
                    keys={definition.keys}
                    onChange={(keys) => onChange(name, keys)}
                    isError={!!errorMessage}
                    aria-invalid={errorMessage ? 'true' : undefined}
                    aria-describedby={errorMessage ? errorId : undefined}
                  />
                  {errorMessage && (
                    <p id={errorId} className={styles.errorMessage}>
                      {errorMessage}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

HotkeyListNG.propTypes = {
  /** Binding name -> `{ keys: string[], label: string }` */
  hotkeys: PropTypes.object.isRequired,
  /** Binding name -> error message, for the bindings whose keys are not valid */
  errors: PropTypes.object.isRequired,
  /** `(name, keys)` when a field records new keys */
  onChange: PropTypes.func.isRequired,
  /** Shown in place of the list when the set is empty */
  emptyMessage: PropTypes.string,
  /** Prefix of the fields' ids, unique to the set */
  idPrefix: PropTypes.string.isRequired,
};
