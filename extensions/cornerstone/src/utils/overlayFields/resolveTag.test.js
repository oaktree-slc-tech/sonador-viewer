import { formatTagValue, readTagValue, resolveTagText, tagDefinition } from './resolveTag';

const instance = {
  ProtocolName: 'T1 AX',
  PatientName: { Alphabetic: 'Doe^Jane^Q' },
  StudyDate: '20240131',
  StudyTime: '134512.123',
  AcquisitionDateTime: '20240131134512',
  SliceThickness: 2.5,
  PixelSpacing: [0.5, 0.75],
  ImageType: ['ORIGINAL', 'PRIMARY'],
  EchoTrainLength: 0,
  SeriesDescription: '',
  Laterality: null,
  ReferencedImageSequence: [{ ReferencedSOPInstanceUID: '1.2.3' }],
  PixelData: { BulkDataURI: 'http://example/bulk' },
  '0043102D': 'W',
  '00190010': 'GEMS_PARM_01',
  _vrMap: { '0043102D': 'SH' },
};

describe('tagDefinition', () => {
  it('maps a standard code to its keyword and VR', () => {
    expect(tagDefinition('00181030')).toEqual({ keyword: 'ProtocolName', vr: 'LO' });
    expect(tagDefinition('(0010,0010)')).toEqual({ keyword: 'PatientName', vr: 'PN' });
  });

  it('returns nulls for a private or malformed code', () => {
    expect(tagDefinition('0043102D')).toEqual({ keyword: null, vr: null });
    expect(tagDefinition('nope')).toEqual({ keyword: null, vr: null });
  });
});

describe('readTagValue', () => {
  it('reads a standard attribute by keyword', () => {
    expect(readTagValue(instance, '0018,1030')).toEqual({ value: 'T1 AX', vr: 'LO' });
  });

  it('reads a private attribute by hex key with the VR from _vrMap', () => {
    expect(readTagValue(instance, '(0043,102D)')).toEqual({ value: 'W', vr: 'SH' });
  });

  it('keeps a numeric zero', () => {
    expect(readTagValue(instance, '00180091')).toEqual({ value: 0, vr: 'IS' });
  });

  it('returns null for absent, empty and null attributes', () => {
    expect(readTagValue(instance, '00189423')).toBeNull();
    expect(readTagValue(instance, '0008103E')).toBeNull();
    expect(readTagValue(instance, '00200060')).toBeNull();
    expect(readTagValue(undefined, '00181030')).toBeNull();
    expect(readTagValue(instance, 'bogus')).toBeNull();
  });
});

describe('formatTagValue', () => {
  it.each([
    ['LO string', 'T1 AX', 'LO', 'T1 AX'],
    ['PN object', { Alphabetic: 'Doe^Jane^Q' }, 'PN', 'Doe, Jane Q'],
    ['DA', '20240131', 'DA', 'Jan 31, 2024'],
    ['TM', '134512.123', 'TM', '13:45:12'],
    ['DT', '20240131134512', 'DT', 'Jan 31, 2024 13:45:12'],
    ['DS number', 2.5, 'DS', '2.5'],
    ['DS string', '2.50', 'DS', '2.5'],
    ['DS integer-valued', 3.0, 'DS', '3'],
    ['DS rounding', 0.123456, 'DS', '0.12'],
    ['multi-valued DS', [0.5, 0.75], 'DS', '0.5\\0.75'],
    ['multi-valued CS', ['ORIGINAL', 'PRIMARY'], 'CS', 'ORIGINAL\\PRIMARY'],
    ['IS zero', 0, 'IS', '0'],
    ['unknown VR number', 42, null, '42'],
    ['unknown VR string', ' x ', null, 'x'],
  ])('formats %s', (_, value, vr, expected) => {
    expect(formatTagValue(value, vr)).toBe(expected);
  });

  it('renders sequences, binary and bulk data as empty', () => {
    expect(formatTagValue([{ ReferencedSOPInstanceUID: '1.2.3' }], 'SQ')).toBe('');
    expect(formatTagValue([{ ReferencedSOPInstanceUID: '1.2.3' }], null)).toBe('');
    expect(formatTagValue({ BulkDataURI: 'http://example/bulk' }, 'OW')).toBe('');
    expect(formatTagValue({ InlineBinary: 'AAAA' }, null)).toBe('');
    expect(formatTagValue(null, 'LO')).toBe('');
  });

  it('falls back to the raw text for an unparsable date', () => {
    expect(formatTagValue('not-a-date', 'DA')).toBe('not-a-date');
  });
});

describe('resolveTagText', () => {
  it('returns the first attribute in the chain that renders', () => {
    expect(resolveTagText(instance, ['00189423', '00181030'])).toBe('T1 AX');
  });

  it('skips present-but-empty attributes', () => {
    expect(resolveTagText(instance, ['0008103E', '00120072'])).toBe('');
    expect(resolveTagText({ ...instance, ClinicalTrialSeriesDescription: 'Trial' }, ['0008103E', '00120072'])).toBe('Trial');
  });

  it('returns empty for a missing instance or chain', () => {
    expect(resolveTagText(undefined, ['00181030'])).toBe('');
    expect(resolveTagText(instance, undefined)).toBe('');
  });
});
