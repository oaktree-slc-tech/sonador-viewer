import React from 'react';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import { hotkeys } from '@ohif/core';
import { ReactComponent as ErrorIcon } from '@ohif/ui/src/elements/Svg/svgs/error.svg';

import { formatKeysForInput, getKeys } from './logic';

import styles from './HotkeyFieldNG.module.scss';

export default function HotkeyFieldNG({ keys, onChange, isError, ...inputProps }) {
  const inputValue = formatKeysForInput(keys);

  // The keypress is kept from the browser but left to propagate: the recorder listens on the
  // document, above React's root, and a keydown stopped here never reaches it.
  const onInputKeyDown = (event) => {
    event.preventDefault();

    hotkeys.record((sequence) => {
      const keys = getKeys(sequence);
      hotkeys.unpause();
      onChange(keys);
    });
  };

  const onFocus = () => {
    hotkeys.pause();
    hotkeys.startRecording();
  };

  // Leaving the field without pressing a key ends the recording it started
  const onBlur = () => {
    hotkeys.stopRecord();
    hotkeys.unpause();
  };

  return (
    <div className={styles.wrapper}>
      <input
        {...inputProps}
        readOnly
        type="text"
        value={inputValue}
        className={classNames(styles.input, {
          [styles.error]: isError,
        })}
        onKeyDown={onInputKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      {isError && <ErrorIcon className={styles.errorIcon} />}
    </div>
  );
}

HotkeyFieldNG.propTypes = {
  keys: PropTypes.array.isRequired,
  onChange: PropTypes.func.isRequired,
  isError: PropTypes.bool.isRequired,
};
