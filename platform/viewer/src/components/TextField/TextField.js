import React from 'react';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import { ReactComponent as CloseIcon } from '@ohif/ui/src/elements/Svg/svgs/close.svg';
import { ReactComponent as SearchIcon } from '@ohif/ui/src/elements/Svg/svgs/search.svg';

import styles from './TextField.module.scss';

export default function TextField({ placeholder, value, onHandleClearValue, onHandleChange  }) {


  return (
    <div
      className={classNames(styles.studyListFilterInputNG, {
        [styles.active]: !!value,
      })}
    >
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={onHandleChange}
        className={styles.input}
      />
      {value && onHandleClearValue ? (
        <CloseIcon className={classNames(styles.icon, styles.closeIcon)} onClick={onHandleClearValue} />
      ) : (
        <SearchIcon />
      )}
    </div>
  );
}

TextField.propTypes = {
  value: PropTypes.object.isRequired,
  onHandleClearValue: PropTypes.func.isRequired,
  onHandleChange: PropTypes.func.isRequired,
  placeholder: PropTypes.string,
};
