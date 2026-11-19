// The timepoint of a document is read from the item of Referenced Performed Procedure Step Sequence
// with the timepoint class UID, at any position, from a single object or an array; series-level
// values alone are never one. Malformed items are read leniently with a warning, and the order of
// timepoints follows the contract: dated before undated, date, time, description, UID.

const mockWarnings = [];
jest.mock('../../log', () => ({
  __esModule: true,
  default: { info: () => {}, debug: () => {}, warn: (...args) => mockWarnings.push(args.join(' ')), error: () => {} },
}));

import { TIMEPOINT_CLASS_UID } from '../constants/timepoint';
import {
  DIAGNOSTICS, compareTimepoints, isValidDate, isValidTime, optionalTextOf, timeKeyOf, timepointIdFor, timepointOf, timepointValuesEqual,
} from './timepoint';

const MPPS_ITEM = { ReferencedSOPClassUID: '1.2.840.10008.3.1.2.3.3', ReferencedSOPInstanceUID: '1.2.3.4.5' };
const item = (overrides = {}) => ({
  ReferencedSOPClassUID: TIMEPOINT_CLASS_UID,
  ReferencedSOPInstanceUID: '2.25.151286667574101141145491442274872811985',
  PerformedProcedureStepID: 'TP-POSTOP-6W',
  PerformedProcedureStepStartDate: '20261104',
  PerformedProcedureStepStartTime: '093000',
  PerformedProcedureStepDescription: 'Post-operative review, 6 weeks',
  ...overrides,
});
const EXPECTED = {
  uid: '2.25.151286667574101141145491442274872811985', id: 'TP-POSTOP-6W', date: '20261104', time: '093000',
  description: 'Post-operative review, 6 weeks', dateValid: true, timeValid: true,
};

beforeEach(() => { mockWarnings.length = 0; });

describe('timepointOf', () => {
  it('reads the item first, last and between other items, and from a single object', () => {
    expect(timepointOf({ ReferencedPerformedProcedureStepSequence: [item(), MPPS_ITEM] })).toEqual(EXPECTED);
    expect(timepointOf({ ReferencedPerformedProcedureStepSequence: [MPPS_ITEM, item()] })).toEqual(EXPECTED);
    expect(timepointOf({ ReferencedPerformedProcedureStepSequence: [MPPS_ITEM, item(), { ...MPPS_ITEM, ReferencedSOPInstanceUID: '9' }] })).toEqual(EXPECTED);
    expect(timepointOf({ ReferencedPerformedProcedureStepSequence: item() })).toEqual(EXPECTED);
    expect(mockWarnings).toEqual([]);
  });

  it('gives null without a timepoint item, and for series-level values alone', () => {
    expect(timepointOf({})).toBeNull();
    expect(timepointOf(undefined)).toBeNull();
    expect(timepointOf({ ReferencedPerformedProcedureStepSequence: [] })).toBeNull();
    expect(timepointOf({ ReferencedPerformedProcedureStepSequence: [MPPS_ITEM] })).toBeNull();
    expect(timepointOf({
      PerformedProcedureStepID: 'TP-1', PerformedProcedureStepStartDate: '20261104', PerformedProcedureStepDescription: 'Series copy',
    })).toBeNull();
  });

  it('uses the first of several timepoint items and warns', () => {
    const second = item({ ReferencedSOPInstanceUID: '2.25.2', PerformedProcedureStepID: 'TP-2' });
    expect(timepointOf({ ReferencedPerformedProcedureStepSequence: [item(), second] })).toEqual(EXPECTED);
    expect(mockWarnings.some(line => line.includes(DIAGNOSTICS.MULTIPLE_ITEMS))).toBe(true);
  });

  it('gives null for a first item without a UID, warns, and does not use a later item', () => {
    const later = item({ ReferencedSOPInstanceUID: '2.25.2' });
    expect(timepointOf({ ReferencedPerformedProcedureStepSequence: [item({ ReferencedSOPInstanceUID: '' }), later] })).toBeNull();
    expect(timepointOf({ ReferencedPerformedProcedureStepSequence: [item({ ReferencedSOPInstanceUID: undefined }), later] })).toBeNull();
    expect(mockWarnings.filter(line => line.includes(DIAGNOSTICS.MISSING_UID))).toHaveLength(2);
  });

  it('keeps an invalid date or time as text, warns, and marks it invalid', () => {
    const invalidDate = timepointOf({ ReferencedPerformedProcedureStepSequence: [item({ PerformedProcedureStepStartDate: '2026-11-04' })] });
    expect(invalidDate).toMatchObject({ date: '2026-11-04', dateValid: false, timeValid: true });
    const invalidTime = timepointOf({ ReferencedPerformedProcedureStepSequence: [item({ PerformedProcedureStepStartTime: '9:30' })] });
    expect(invalidTime).toMatchObject({ time: '9:30', dateValid: true, timeValid: false });
    expect(mockWarnings.filter(line => line.includes(DIAGNOSTICS.INVALID_DATE))).toHaveLength(2);
  });

  it('keeps the presence and the text of the optional attributes: absent, held without a value, or as written', () => {
    const read = overrides => timepointOf({ ReferencedPerformedProcedureStepSequence: [item(overrides)] });
    // Held without a value: the empty string, which is not absent and counts as no date or time
    expect(read({ PerformedProcedureStepID: '', PerformedProcedureStepStartDate: '', PerformedProcedureStepStartTime: [], PerformedProcedureStepDescription: null }))
      .toEqual({ uid: EXPECTED.uid, id: '', date: '', time: '', description: '', dateValid: true, timeValid: true });
    expect(mockWarnings).toEqual([]);
    // Text as naturalized, untrimmed
    expect(read({ PerformedProcedureStepDescription: ' Leading', PerformedProcedureStepID: 'TP ' })).toMatchObject({ description: ' Leading', id: 'TP ' });
    expect(read({ PerformedProcedureStepDescription: '   ' })).toMatchObject({ description: '   ' });
    // A padded date is not eight digits
    expect(read({ PerformedProcedureStepStartDate: ' 20261104' })).toMatchObject({ date: ' 20261104', dateValid: false });
    expect(optionalTextOf({}, 'PerformedProcedureStepID')).toBeNull();
    expect(optionalTextOf({ PerformedProcedureStepID: undefined }, 'PerformedProcedureStepID')).toBe('');
    expect(optionalTextOf({ PerformedProcedureStepID: ['A', 'B'] }, 'PerformedProcedureStepID')).toBe('A');
  });

  it('reads optional attributes as null when absent, and never throws', () => {
    const bare = timepointOf({ ReferencedPerformedProcedureStepSequence: [{ ReferencedSOPClassUID: TIMEPOINT_CLASS_UID, ReferencedSOPInstanceUID: '2.25.7' }] });
    expect(bare).toEqual({ uid: '2.25.7', id: null, date: null, time: null, description: null, dateValid: true, timeValid: true });
    expect(timepointOf({ ReferencedPerformedProcedureStepSequence: [null, 42, 'text'] })).toBeNull();
    expect(timepointOf({ get ReferencedPerformedProcedureStepSequence() { throw new Error('bad'); } })).toBeNull();
  });
});

describe('date and time', () => {
  it('validates a DICOM DA and the forms of a TM, each component in its range', () => {
    expect(isValidDate('20261104')).toBe(true);
    expect(isValidDate('2026110')).toBe(false);
    ['09', '0930', '093000', '093000.5', '093000.123456', '23', '2359', '235960', '000000'].forEach(time => expect(`${time}: ${isValidTime(time)}`).toBe(`${time}: true`));
    ['9', '093000.1234567', '09:30', '', '24', '1260', '120061', '2460', '126000', '245959'].forEach(time => expect(`${time}: ${isValidTime(time)}`).toBe(`${time}: false`));
  });

  it('keeps an out-of-range time as text, warns, and orders it as no time', () => {
    const read = time => timepointOf({ ReferencedPerformedProcedureStepSequence: [item({ PerformedProcedureStepStartTime: time })] });
    const outOfRange = read('1260');
    expect(outOfRange).toMatchObject({ time: '1260', timeValid: false });
    expect(mockWarnings.filter(line => line.includes(DIAGNOSTICS.INVALID_DATE))).toHaveLength(1);
    expect(timeKeyOf(outOfRange)).toBe('000000000000');
    // Ordered as a timepoint without a time: level with midnight, before one second past it
    expect(compareTimepoints(outOfRange, read('000000'))).toBe(0);
    expect(compareTimepoints(outOfRange, read('000001'))).toBeLessThan(0);
  });

  it('keys a time as twelve digits, padded on the right; absent or invalid as zeros', () => {
    expect(timeKeyOf({ time: '0930' })).toBe('093000000000');
    expect(timeKeyOf({ time: '093000.5' })).toBe('093000500000');
    expect(timeKeyOf({ time: null })).toBe('000000000000');
    expect(timeKeyOf({ time: '9:30', timeValid: false })).toBe('000000000000');
  });
});

describe('compareTimepoints', () => {
  const tp = (uid, date, time, description) => ({ uid, date, time, description, dateValid: !date || isValidDate(date), timeValid: !time || isValidTime(time) });

  it('orders dated before undated, then by date, time, description and UID', () => {
    const list = [
      tp('2.25.9', null, null, 'Undated B'),
      tp('2.25.8', null, null, 'Undated A'),
      tp('2.25.3', '20261104', '0930', 'Later in the day'),
      tp('2.25.2', '20261104', '0900', 'Same day, earlier'),
      tp('2.25.4', '20261104', null, 'No time'),
      tp('2.25.5', '20261104', null, 'No time'),
      tp('2.25.1', '20260101', '120000', 'First'),
      tp('2.25.6', '2026-11-04', '0800', 'Invalid date counts as undated'),
    ];
    const ordered = list.slice().sort(compareTimepoints).map(entry => entry.uid);
    // The time key applies to undated timepoints too: one with a time follows those without
    expect(ordered).toEqual(['2.25.1', '2.25.4', '2.25.5', '2.25.2', '2.25.3', '2.25.8', '2.25.9', '2.25.6']);
  });

  it('compares descriptions by code unit, with an absent description as the empty string', () => {
    expect(compareTimepoints(tp('a', '20260101', null, null), tp('b', '20260101', null, 'A'))).toBeLessThan(0);
    expect(compareTimepoints(tp('a', '20260101', null, 'b'), tp('b', '20260101', null, 'B'))).toBeGreaterThan(0);
  });
});

describe('identity and values', () => {
  it('names a defined timepoint by its study and UID together', () => {
    expect(timepointIdFor('1.2.3', '2.25.7')).toBe('timepoint:1.2.3:2.25.7');
    expect(timepointIdFor('1.2.3', '2.25.7')).not.toBe(timepointIdFor('1.2.4', '2.25.7'));
  });

  it('compares identifier, date, time and description with presence: absent and held-empty differ', () => {
    const a = { uid: 'u', id: 'TP', date: '20261104', time: '0930', description: 'D' };
    expect(timepointValuesEqual(a, { ...a, uid: 'other' })).toBe(true);
    expect(timepointValuesEqual(a, { ...a, time: '0931' })).toBe(false);
    expect(timepointValuesEqual(a, { ...a, time: null })).toBe(false);
    expect(timepointValuesEqual({ ...a, description: null }, { ...a, description: undefined })).toBe(true);
    expect(timepointValuesEqual({ ...a, description: null }, { ...a, description: '' })).toBe(false);
    expect(timepointValuesEqual({ ...a, description: 'D' }, { ...a, description: ' D' })).toBe(false);
  });
});
