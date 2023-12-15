import React from 'react';
import { DateRangePicker } from 'react-dates';
import { useTranslation } from 'react-i18next';
import moment from 'moment';
import PropTypes from 'prop-types';

import { ReactComponent as CalendarIcon } from '@ohif/ui/src/elements/Svg/svgs/calendar.svg';

import 'react-dates/initialize';

import { ReactComponent as ChevronDown } from '../../elements/Svg/svgs/chevron-down.svg';
import { ReactComponent as CloseIcon } from '../../elements/Svg/svgs/close.svg';

import 'react-dates/lib/css/_datepicker.css';
import './DateRangePickerNG.scss';

export default function DateRangePickerNG({
  onDatesChange,
  startDate = '',
  endDate = '',
  onCloseCalendar,
  onFocusChange,
  focusedInput,
  isRightAnchor,
  ...dateRangePickerProps
}) {
  const { t } = useTranslation('DatePicker');

  const addRemoveBodyClassName = (value) => {
    const body = document.getElementById('body');

    if (value === null) {
      body.classList.remove('dateRangePickerNG');
    } else {
      body.classList.add('dateRangePickerNG');
    }
  };

  const handleClickCalendarIcon = () => {
    if (focusedInput === null) {
      addRemoveBodyClassName('startDate');
      onFocusChange('startDate');
    } else {
      addRemoveBodyClassName(null);
      onFocusChange(null);
    }
  };

  const renderDatePresets = () => {
    return (
      <div className="date-range-picker-reset-container">
        <button type="button" className="date-range-picker-reset" onClick={() => onDatesChange('', '')}>
          {t('Reset')}
        </button>
      </div>
    );
  };

  const renderMonthElement = ({ month }) => {
    return (
      <>
        <div className="calendar-header">
          <p className="calendar-header-title">
            Select {/*{dateRangePickerProps.focused === 'startDate' ? 'Start' : 'End'}{' '}*/}
            Date
          </p>
          <CloseIcon fill="#ffffff" onClick={onCloseCalendar} className="close-calendar-icon" />
        </div>
        <div className="start-end-dates">
          <div className="start-date-wrapper">
            <label htmlFor="start-date">Start date</label>
            <input
              id="start-date"
              type="text"
              placeholder="MM/DD/YYYY"
              value={startDate ? moment(startDate).format('MM/DD/YYYY') : ''}
              disabled
            />
          </div>
          <div className="end-date-wrapper">
            <label htmlFor="end-date">End Date</label>
            <input
              id="end-date"
              type="text"
              placeholder="MM/DD/YYYY"
              value={endDate ? moment(endDate).format('MM/DD/YYYY') : ''}
              disabled
            />
          </div>
        </div>
        <div className="calendar-month-year-title">{month.format('MMMM YYYY')}</div>
      </>
    );
  };

  return (
    <div className="dateRangePickerNG">
      <div className="rangeDatesAndCalendarIconContainer">
        <CalendarIcon className="rangeDateCalendarIcon" onClick={handleClickCalendarIcon} />
        <DateRangePicker
          {...dateRangePickerProps}
          focusedInput={focusedInput}
          onFocusChange={(updateVal) => {
            addRemoveBodyClassName(updateVal);
            onFocusChange(updateVal);
          }}
          anchorDirection={isRightAnchor ? 'right' : 'left'}
          startDate={startDate || null}
          endDate={endDate || null}
          renderCalendarInfo={renderDatePresets}
          onDatesChange={onDatesChange}
          renderMonthElement={renderMonthElement}
          enableOutsideDays
          daySize={28}
          noBorder
          startDatePlaceholderText={t('Start Date')}
          endDatePlaceholderText={t('End Date')}
          navPrev={<ChevronDown fill="#ffffff" className="nav-prev-date" />}
          navNext={<ChevronDown fill="#ffffff" className="nav-next-date" />}
          appendToBody
        />
      </div>
    </div>
  );
}

DateRangePickerNG.propTypes = {
  onDatesChange: PropTypes.func.isRequired,
  startDate: PropTypes.oneOfType([PropTypes.instanceOf(Date), PropTypes.string]),
  endDate: PropTypes.oneOfType([PropTypes.instanceOf(Date), PropTypes.string]),
  month: PropTypes.instanceOf(Date),
  onCloseCalendar: PropTypes.func.isRequired,
  onFocusChange: PropTypes.func.isRequired,
  focusedInput: PropTypes.string,
  isRightAnchor: PropTypes.bool,
};
