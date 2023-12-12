import React, { useState } from 'react';
import classNames from 'classnames';
import moment from 'moment';
import PropTypes from 'prop-types';

import DatePickerNG from '@ohif/ui/src/components/studyList/DatePickerNG';
import { ReactComponent as ChevronDown } from '@ohif/ui/src/elements/Svg/svgs/chevron-down.svg';
import { ReactComponent as CloseIcon } from '@ohif/ui/src/elements/Svg/svgs/close.svg';

import './StudyListFilterDatePickerNG.scss';

export default function StudyListFilterDatePickerNG({ filter, onChangeFilterValue, filterValue = '' }) {
  const [focusedDatePicker, setFocusedDatePicker] = useState(false);

  const handleChangeDate = (date) => {
    onChangeFilterValue(() => {
      return {
        [filter.tag]: date,
      };
    });
  };

  return (
    <div className="studyFilterDatePickerWrapper">
      <button className={classNames('studyFilterContainer', { active: !!filterValue })}>
        {filterValue ? moment(filterValue).format('DD/MM/YYYY') : filter.label}
        {filterValue ? (
          <CloseIcon
            className="resetIcon"
            onClick={(event) => {
              event.stopPropagation();
              onChangeFilterValue(() => {
                return {
                  [filter.tag]: '',
                };
              });
            }}
          />
        ) : (
          <ChevronDown className={classNames({ chevronUp: focusedDatePicker })} />
        )}
      </button>
      <DatePickerNG
        date={filterValue}
        onDateChange={handleChangeDate}
        onFocusChange={({ focused }) => setFocusedDatePicker(focused)}
        focused={focusedDatePicker}
        id={filter.tag}
        onCloseCalendar={() => setFocusedDatePicker(false)}
      />
    </div>
  );
}

StudyListFilterDatePickerNG.propTypes = {
  filter: PropTypes.shape({
    tag: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
    type: PropTypes.string.isRequired,
    options: PropTypes.arrayOf(PropTypes.string),
  }).isRequired,
  onChangeFilterValue: PropTypes.func.isRequired,
  filterValue: PropTypes.any,
};
