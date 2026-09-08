import moment from 'moment';

// Validation for dates typed into the range picker's own fields.
//
// react-dates applies these rules in `DateRangePickerInputController` when its own inputs are
// typed into. The fields in the open calendar are ours, so they do not go through that controller
// and have to apply the same rules, or a typed value can produce a range the picker itself would
// refuse: an end before the start, or the two ends closer together than `minimumNights`.

export const DISPLAY_FORMAT = 'MM/DD/YYYY';

// react-dates' own default. The picker is not configured with another.
export const DEFAULT_MINIMUM_NIGHTS = 1;

const asMoment = (value) => {
  if (!value) {
    return null;
  }
  const parsed = moment.isMoment(value) ? value : moment(value);
  return parsed.isValid() ? parsed : null;
};

/**
 * Resolve what a typed date means for the range.
 *
 * @param {object} input
 * @param {'start'|'end'} input.which - which field was typed into
 * @param {string} input.text - its current text
 * @param {*} input.startDate - the range's current start
 * @param {*} input.endDate - the range's current end
 * @param {number} [input.minimumNights]
 * @param {(day: object) => boolean} [input.isOutsideRange] - receives a moment
 * @returns {{startDate: *, endDate: *}|null} the range to report, or null to report nothing
 */
export default function applyTypedDate({
  which,
  text,
  startDate,
  endDate,
  minimumNights = DEFAULT_MINIMUM_NIGHTS,
  isOutsideRange,
}) {
  const start = asMoment(startDate);
  const end = asMoment(endDate);

  // An emptied field clears that end of the range and leaves the other alone.
  if (text === '') {
    return which === 'start' ? { startDate: null, endDate: end } : { startDate: start, endDate: null };
  }

  const typed = moment(text, DISPLAY_FORMAT, true);

  // Nothing is reported while the text is incomplete or not a real date, so a half-typed value
  // does not clear the range under the user as they type.
  if (!typed.isValid()) {
    return null;
  }

  // The same rule the calendar applies to clicking, so typing cannot get round it.
  if (typeof isOutsideRange === 'function' && isOutsideRange(typed)) {
    return null;
  }

  if (which === 'start') {
    // A start that would leave the existing end too close, or before it, drops the end -- which is
    // what react-dates does rather than refusing the start.
    const endNowTooEarly = end && end.isBefore(typed.clone().add(minimumNights, 'days'), 'day');
    return { startDate: typed, endDate: endNowTooEarly ? null : end };
  }

  // An end inside the minimum is not a range the picker would accept, so it is not reported.
  if (start && typed.isBefore(start.clone().add(minimumNights, 'days'), 'day')) {
    return null;
  }

  return { startDate: start, endDate: typed };
}
