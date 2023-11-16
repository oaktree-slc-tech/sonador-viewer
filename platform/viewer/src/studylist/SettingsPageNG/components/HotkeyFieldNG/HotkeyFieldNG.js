import React from 'react';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import { hotkeys } from '@ohif/core';
import { ReactComponent as ErrorIcon } from '@ohif/ui/src/elements/Svg/svgs/error.svg';

import { formatKeysForInput, getKeys } from './logic';

import styles from './HotkeyFieldNG.module.scss';

export default function HotkeyFieldNG({ keys, onChange, isError }) {
  const inputValue = formatKeysForInput(keys);

  const onInputKeyDown = (event) => {
    event.stopPropagation();
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

  return (
    <div className={styles.wrapper}>
      <input
        readOnly
        type="text"
        value={inputValue}
        className={classNames(styles.input, {
          [styles.error]: isError,
        })}
        onKeyDown={onInputKeyDown}
        onFocus={onFocus}
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
