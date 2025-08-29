import React from 'react';
import classnames from 'classnames';
import moment from 'moment';
import PropTypes from 'prop-types';

import MultiRangeSliderDropdownNG from '@ohif/ui/src/components/RangeDropdownNG/MultiRangeSliderDropdownNG';
import TimePickerNG from '@ohif/ui/src/components/TimePickerNG/TimePickerNG';
import { ReactComponent as ChevronDown } from '@ohif/ui/src/elements/Svg/svgs/chevron-down.svg';

import StudyListFilterDatePickerNG from './components/StudyListFilterDatePickerNG/StudyListFilterDatePickerNG';
import StudyListFilterInputNG from './components/StudyListFilterInputNG/StudyListFilterInputNG';
import StudyListFilterSelectNG from './components/StudyListFilterSelectNG/StudyListFilterSelectNG';

import styles from './StudyListFilterNG.module.scss';

export default function StudyListFilterNG({ filter, onChangeFilterValue, filterValue }) {
  if (filter.type === 'select') {
    return (
      <StudyListFilterSelectNG
        filter={filter}
        selectedOptions={filterValue}
        onChangeFilterValue={onChangeFilterValue}
      />
    );
  } else if (filter.type === 'date') {
    return (
      <StudyListFilterDatePickerNG
        filter={filter}
        filterValue={!filterValue ? '' : typeof filterValue === 'string' ? moment(filterValue) : filterValue}
        onChangeFilterValue={onChangeFilterValue}
      />
    );
  } else if (filter.type === 'range') {
    return (
      <MultiRangeSliderDropdownNG
        min={0}
        max={100}
        title={filter.label}
        Button={() => (
          <button className={classnames(styles.studyFilterContainer)}>
            {filter.label}
            <ChevronDown />
          </button>
        )}
      />
    );
  } else if (filter.type === 'time') {
    return (
      <TimePickerNG
        title={filter.label}
        Button={() => (
          <button className={classnames(styles.studyFilterContainer)}>
            {filter.label}
            <ChevronDown />
          </button>
        )}
      />
    );
  }
  return <StudyListFilterInputNG filter={filter} filterValue={filterValue} onChangeFilterValue={onChangeFilterValue} />;
}

StudyListFilterNG.propTypes = {
  filter: PropTypes.shape({
    tag: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
    type: PropTypes.oneOf(['search', 'date', 'time', 'select']).isRequired,
    options: PropTypes.arrayOf(PropTypes.string),
  }).isRequired,
  onChangeFilterValue: PropTypes.func.isRequired,
  filterValue: PropTypes.any,
};
