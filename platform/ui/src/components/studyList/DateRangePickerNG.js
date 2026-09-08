import React, { useEffect, useState } from 'react';
import { DateRangePicker } from 'react-dates';
import { useTranslation } from 'react-i18next';
import moment from 'moment';
import PropTypes from 'prop-types';

import { ReactComponent as CalendarIcon } from '@ohif/ui/src/elements/Svg/svgs/calendar.svg';

import 'react-dates/initialize';

import { ReactComponent as ChevronDown } from '../../elements/Svg/svgs/chevron-down.svg';
import { ReactComponent as CloseIcon } from '../../elements/Svg/svgs/close.svg';

import 'react-dates/lib/css/_datepicker.css';
import applyTypedDate, { DEFAULT_MINIMUM_NIGHTS, DISPLAY_FORMAT } from './typedDateRange';

import './DateRangePickerNG.scss';

export default function DateRangePickerNG({
  onDatesChange,
  startDate = '',
  endDate = '',
  onCloseCalendar,
  onFocusChange,
  focusedInput,
  isRightAnchor,
  isOutsideRange,
  minimumNights = DEFAULT_MINIMUM_NIGHTS,
  ...dateRangePickerProps
}) {
  const { t } = useTranslation('DatePicker');

  // Each field holds its own text while it is being edited and reports a date only once that text
  // denotes a real one, so a half-typed value does not reset the range.
  const [startText, setStartText] = useState('');
  const [endText, setEndText] = useState('');

  const asText = (value) => (value ? moment(value).format(DISPLAY_FORMAT) : '');

  useEffect(() => setStartText(asText(startDate)), [startDate]);
  useEffect(() => setEndText(asText(endDate)), [endDate]);

  const handleTypedDate = (which, text) => {
    if (which === 'start') {
      setStartText(text);
    } else {
      setEndText(text);
    }

    // The fields here are ours, so they bypass react-dates' own input controller and have to apply
    // its ordering and minimum-nights rules themselves.
    const range = applyTypedDate({
      which,
      text,
      startDate,
      endDate,
      minimumNights,
      isOutsideRange,
    });

    if (range) {
      onDatesChange(range);
    }
  };

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
              placeholder={DISPLAY_FORMAT}
              value={startText}
              onChange={(event) => handleTypedDate('start', event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
            />
          </div>
          <div className="end-date-wrapper">
            <label htmlFor="end-date">End Date</label>
            <input
              id="end-date"
              type="text"
              placeholder={DISPLAY_FORMAT}
              value={endText}
              onChange={(event) => handleTypedDate('end', event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
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
          isOutsideRange={isOutsideRange}
          minimumNights={minimumNights}
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
  /** Predicate receiving a moment; true means the day cannot be picked. */
  isOutsideRange: PropTypes.func,
  /** Nights that must separate the two ends, as react-dates defines it. */
  minimumNights: PropTypes.number,
};
