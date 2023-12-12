import React from 'react';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import { ReactComponent as CloseIcon } from '@ohif/ui/src/elements/Svg/svgs/close.svg';
import { ReactComponent as SearchIcon } from '@ohif/ui/src/elements/Svg/svgs/search.svg';

import styles from './StudyListFilterInputNG.module.scss';

export default function StudyListFilterInputNG({ filter, onChangeFilterValue, filterValue = '' }) {
  const handleChange = (event) => {
    onChangeFilterValue(() => {
      return {
        [filter.tag]: event.target.value,
      };
    });
  };

  const handleClearValue = () => {
    onChangeFilterValue(() => {
      return {
        [filter.tag]: '',
      };
    });
  };

  return (
    <div
      className={classNames(styles.studyListFilterInputNG, {
        [styles.active]: !!filterValue,
      })}
    >
      <input
        type="text"
        placeholder={filter.label}
        value={filterValue}
        onChange={handleChange}
        className={styles.input}
      />
      {filterValue ? (
        <CloseIcon className={classNames(styles.icon, styles.closeIcon)} onClick={handleClearValue} />
      ) : (
        <SearchIcon />
      )}
    </div>
  );
}

StudyListFilterInputNG.propTypes = {
  filter: PropTypes.object.isRequired,
  onChangeFilterValue: PropTypes.func.isRequired,
  filterValue: PropTypes.string,
};
