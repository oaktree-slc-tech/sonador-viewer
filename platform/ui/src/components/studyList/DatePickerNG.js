import React from 'react';
import { isInclusivelyBeforeDay, SingleDatePicker } from 'react-dates';
import moment from 'moment';
import PropTypes from 'prop-types';

import { ReactComponent as ChevronDown } from '../../elements/Svg/svgs/chevron-down.svg';
import { ReactComponent as CloseIcon } from '../../elements/Svg/svgs/close.svg';

import './DatePickerNG.scss';

export default function DatePickerNG({ onCloseCalendar, onFocusChange, ...datePickerProps }) {
  const renderMonthElement = ({ month }) => {
    return (
      <>
        <div className="calendar-header">
          <p className="calendar-header-title">Select Date</p>
          <CloseIcon fill="#ffffff" onClick={onCloseCalendar} className="close-calendar-icon" />
        </div>
        <div className="calendar-month-year-title">{month.format('MMMM YYYY')}</div>
      </>
    );
  };

  const renderCalendarInfo = () => {
    return (
      <div className="date-range-picker-reset-container">
        <button onClick={() => datePickerProps.onDateChange('')} className="date-range-picker-reset">
          Reset
        </button>
      </div>
    );
  };

  return (
    <div className="singleDatePickerNG">
      <SingleDatePicker
        {...datePickerProps}
        onFocusChange={(updateVal) => {
          const body = document.getElementById('body');

          if (updateVal.focused) {
            body.classList.add('singleDatePickerNG');
          } else {
            body.classList.remove('singleDatePickerNG');
          }

          onFocusChange(updateVal);
        }}
        noBorder
        numberOfMonths={1}
        daySize={28}
        hideKeyboardShortcutsPanel
        enableOutsideDays
        isOutsideRange={(day) => !isInclusivelyBeforeDay(day, moment())}
        renderMonthElement={renderMonthElement}
        navPrev={<ChevronDown fill="#ffffff" className="nav-prev-date" />}
        navNext={<ChevronDown fill="#ffffff" className="nav-next-date" />}
        renderCalendarInfo={renderCalendarInfo}
        appendToBody
      />
    </div>
  );
}

DatePickerNG.propTypes = {
  date: PropTypes.oneOfType([PropTypes.instanceOf(Date), PropTypes.string]),
  onDateChange: PropTypes.func.isRequired,
  focused: PropTypes.bool.isRequired,
  onFocusChange: PropTypes.func.isRequired,
  id: PropTypes.string.isRequired,
  onCloseCalendar: PropTypes.func.isRequired,
  month: PropTypes.instanceOf(Date),
};
