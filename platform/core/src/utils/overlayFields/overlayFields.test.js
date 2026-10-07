import {
  fieldTitle,
  findStandardField,
  isKnownFieldValue,
  isTagFieldValue,
  normalizeTagCode,
  parseTagFieldValue,
  punctuateTagCode,
  STANDARD_FIELDS,
  standardFieldCodes,
  TAG_FIELD_PREFIX,
  tagFieldValue,
} from './index';

// Every value key that a saved preference could contain before the catalogue existed.
const LEGACY_VALUES = [
  'patientName',
  'patientId',
  'studyDescription',
  'studyDate-studyTime',
  'zoomPercentage',
  'wwwc',
  'compression',
  'seriesNumber',
  'Img-instance-number-index-stack-size',
  'frameRate-image-info',
  'modality',
  'seriesInstanceUID',
  'studyInstanceUID',
  'accessionNumber',
];

describe('normalizeTagCode', () => {
  it.each([
    ['0018,1030', '00181030'],
    ['(0018,1030)', '00181030'],
    ['00181030', '00181030'],
    ['x0018103e', '0018103E'],
    [' (0043,102d) ', '0043102D'],
  ])('normalises %s', (input, expected) => {
    expect(normalizeTagCode(input)).toBe(expected);
  });

  it.each([['0018103'], ['001810300'], ['ProtocolName'], [''], [null], [undefined], [12345678]])(
    'rejects %p',
    input => {
      expect(normalizeTagCode(input)).toBeNull();
    }
  );
});

describe('tag field values', () => {
  it('round-trips a code through the stored value', () => {
    const value = tagFieldValue('(0018,1030)');

    expect(value).toBe(`${TAG_FIELD_PREFIX}00181030`);
    expect(isTagFieldValue(value)).toBe(true);
    expect(parseTagFieldValue(value)).toBe('00181030');
    expect(punctuateTagCode(parseTagFieldValue(value))).toBe('(0018,1030)');
  });

  it('returns null for a malformed code', () => {
    expect(tagFieldValue('bogus')).toBeNull();
    expect(punctuateTagCode('bogus')).toBeNull();
  });

  it('does not treat standard keys or loose strings as tag fields', () => {
    expect(isTagFieldValue('patientName')).toBe(false);
    expect(isTagFieldValue('tag:0018103')).toBe(false);
    expect(isTagFieldValue('tag:0018103g')).toBe(false);
    expect(parseTagFieldValue('patientName')).toBeNull();
  });
});

describe('STANDARD_FIELDS', () => {
  it('keeps every legacy value key', () => {
    LEGACY_VALUES.forEach(value => expect(findStandardField(value)).toBeTruthy());
  });

  it('has unique values and non-empty titles', () => {
    const values = STANDARD_FIELDS.map(field => field.value);

    expect(new Set(values).size).toBe(values.length);
    STANDARD_FIELDS.forEach(field => expect(field.title).toBeTruthy());
  });

  it('declares fallback chains as normalised hex codes', () => {
    STANDARD_FIELDS.filter(field => field.tags).forEach(field => {
      field.tags.forEach(code => expect(normalizeTagCode(code)).toBe(code));
    });
  });

  it('no longer offers the warning pseudo-fields', () => {
    expect(findStandardField('inconsistencyWarnings-warning')).toBeNull();
    expect(findStandardField('SRLabels-warning')).toBeNull();
  });

  it('reports every chain code as rendered by a Standard Field', () => {
    const codes = standardFieldCodes();

    expect(codes.has('00100010')).toBe(true);
    expect(codes.has('00189423')).toBe(true);
    expect(codes.has('00080080')).toBe(false);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(STANDARD_FIELDS)).toBe(true);
    expect(Object.isFrozen(STANDARD_FIELDS[0])).toBe(true);
  });
});

describe('isKnownFieldValue / fieldTitle', () => {
  it('accepts standard keys and tag fields only', () => {
    expect(isKnownFieldValue('patientName')).toBe(true);
    expect(isKnownFieldValue('tag:00181030')).toBe(true);
    expect(isKnownFieldValue('inconsistencyWarnings-warning')).toBe(false);
    expect(isKnownFieldValue(null)).toBe(false);
  });

  it('prefers the catalogue title for a standard field and the stored title for a tag field', () => {
    expect(fieldTitle({ title: 'Old Label', value: 'patientName' })).toBe('Patient Name');
    expect(fieldTitle({ title: 'Protocol', value: 'tag:00181030' })).toBe('Protocol');
    expect(fieldTitle({ value: 'tag:00181030' })).toBe('');
    expect(fieldTitle(null)).toBe('');
  });
});
