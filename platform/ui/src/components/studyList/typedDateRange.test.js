// The range picker's in-calendar fields are ours, so they do not pass through react-dates'
// `DateRangePickerInputController` and have to reproduce the rules it applies to typed input.
// These pin the two that matter: a typed start that crosses the existing end, and a typed end
// inside the minimum separation.

import moment from 'moment';

import applyTypedDate, { DEFAULT_MINIMUM_NIGHTS } from './typedDateRange';

const day = (text) => moment(text, 'MM/DD/YYYY', true);
const iso = (value) => (value ? moment(value).format('MM/DD/YYYY') : value);

describe('applyTypedDate', () => {
  it('reports a typed start and keeps an end that is still far enough away', () => {
    const result = applyTypedDate({
      which: 'start',
      text: '03/01/2026',
      startDate: null,
      endDate: day('03/10/2026'),
    });

    expect(iso(result.startDate)).toBe('03/01/2026');
    expect(iso(result.endDate)).toBe('03/10/2026');
  });

  it('drops an end the typed start has crossed', () => {
    // react-dates clears the end rather than refusing the start; refusing it would leave the
    // field showing a date the range does not contain.
    const result = applyTypedDate({
      which: 'start',
      text: '03/15/2026',
      startDate: day('03/01/2026'),
      endDate: day('03/10/2026'),
    });

    expect(iso(result.startDate)).toBe('03/15/2026');
    expect(result.endDate).toBeNull();
  });

  it('drops an end that the typed start leaves inside the minimum', () => {
    // Same day as the start: one night short of the default minimum.
    const result = applyTypedDate({
      which: 'start',
      text: '03/10/2026',
      startDate: day('03/01/2026'),
      endDate: day('03/10/2026'),
    });

    expect(iso(result.startDate)).toBe('03/10/2026');
    expect(result.endDate).toBeNull();
  });

  it('refuses a typed end that falls before the start', () => {
    // Reporting it would send a reversed range to the study query.
    expect(
      applyTypedDate({
        which: 'end',
        text: '02/20/2026',
        startDate: day('03/01/2026'),
        endDate: null,
      })
    ).toBeNull();
  });

  it('refuses a typed end inside the minimum separation', () => {
    expect(DEFAULT_MINIMUM_NIGHTS).toBe(1);

    // Equal to the start, so zero nights.
    expect(
      applyTypedDate({
        which: 'end',
        text: '03/01/2026',
        startDate: day('03/01/2026'),
        endDate: null,
      })
    ).toBeNull();

    // One night is the minimum, so this is the first acceptable end.
    const ok = applyTypedDate({
      which: 'end',
      text: '03/02/2026',
      startDate: day('03/01/2026'),
      endDate: null,
    });
    expect(iso(ok.endDate)).toBe('03/02/2026');
  });

  it('honours a configured minimum', () => {
    const args = {
      which: 'end',
      text: '03/03/2026',
      startDate: day('03/01/2026'),
      endDate: null,
      minimumNights: 5,
    };

    expect(applyTypedDate(args)).toBeNull();
    expect(iso(applyTypedDate({ ...args, text: '03/06/2026' }).endDate)).toBe('03/06/2026');
  });

  it('applies the calendar\'s own out-of-range rule to typed dates', () => {
    // Otherwise typing gets round a restriction clicking cannot.
    const noFutureDates = (d) => d.isAfter(moment(), 'day');

    expect(
      applyTypedDate({
        which: 'start',
        text: moment().add(1, 'day').format('MM/DD/YYYY'),
        startDate: null,
        endDate: null,
        isOutsideRange: noFutureDates,
      })
    ).toBeNull();
  });

  it('reports nothing while the text is incomplete or not a real date', () => {
    // A half-typed value must not clear the range under the user as they type.
    for (const text of ['0', '03/', '03/1', '13/01/2026', '02/31/2026', 'nonsense']) {
      expect(
        applyTypedDate({ which: 'start', text, startDate: day('03/01/2026'), endDate: null })
      ).toBeNull();
    }
  });

  it('clears only the field that was emptied', () => {
    const clearedStart = applyTypedDate({
      which: 'start',
      text: '',
      startDate: day('03/01/2026'),
      endDate: day('03/10/2026'),
    });
    expect(clearedStart.startDate).toBeNull();
    expect(iso(clearedStart.endDate)).toBe('03/10/2026');

    const clearedEnd = applyTypedDate({
      which: 'end',
      text: '',
      startDate: day('03/01/2026'),
      endDate: day('03/10/2026'),
    });
    expect(iso(clearedEnd.startDate)).toBe('03/01/2026');
    expect(clearedEnd.endDate).toBeNull();
  });
});
