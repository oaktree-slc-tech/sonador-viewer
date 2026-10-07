import { STANDARD_FIELDS } from './index';
import { catalogueLabel, sharedAttributeOptions, mergeOverlayFieldOptions } from './mergeOptions';

const catalogue = {
  Study: { '0008,0080': { code: '0008,0080', tag: 'InstitutionName', label: 'Institution Name' } },
  Series: { '0018,0087': { code: '0018,0087', tag: 'MagneticFieldStrength', label: 'Magnetic Field Strength' } },
  Instance: { '0043,102d': { code: '0043,102d', tag: 'GEFilter' } },
};

const tags = [
  { Code: '0008,0080', Tag: 'InstitutionName', Label: null, Group: { id: 1, name: 'alpha' } },
  { Code: '0018,0087', Tag: 'MagneticFieldStrength', Label: 'Field Strength', Group: { id: 2, name: 'beta' } },
  { Code: '0043,102D', Tag: 'GEFilter', Label: null, Group: { id: 2, name: 'beta' } },
  { Code: '0018,1030', Tag: 'ProtocolName', Label: 'Protocol', Group: { id: 1, name: 'alpha' } },
  { Code: '0008,0080', Tag: 'InstitutionName', Label: 'Site', Group: { id: 2, name: 'beta' } },
  { Code: 'bogus', Tag: null, Label: null, Group: { id: 1, name: 'alpha' } },
];

describe('catalogueLabel', () => {
  it('finds a label by code at any level, ignoring code formatting', () => {
    expect(catalogueLabel(catalogue, '00080080')).toBe('Institution Name');
    expect(catalogueLabel(catalogue, '(0043,102D)')).toBe('GEFilter');
  });

  it('returns null for an unknown code or no catalogue', () => {
    expect(catalogueLabel(catalogue, '00181030')).toBeNull();
    expect(catalogueLabel(undefined, '00080080')).toBeNull();
    expect(catalogueLabel(catalogue, 'nope')).toBeNull();
  });
});

describe('sharedAttributeOptions', () => {
  it('maps records to tag-field options with the best available title', () => {
    expect(sharedAttributeOptions(tags, catalogue)).toEqual([
      { title: 'Institution Name', value: 'tag:00080080' },
      { title: 'Field Strength', value: 'tag:00180087' },
      { title: 'GEFilter', value: 'tag:0043102D' },
    ]);
  });

  it('omits codes that a Standard Field already renders', () => {
    const values = sharedAttributeOptions(tags, catalogue).map(option => option.value);

    expect(values).not.toContain('tag:00181030');
  });

  it('falls back to the hex code without a catalogue', () => {
    expect(sharedAttributeOptions([{ Code: '0043,102D', Tag: null, Label: null }])).toEqual([
      { title: '0043102D', value: 'tag:0043102D' },
    ]);
  });

  it('is empty for no records', () => {
    expect(sharedAttributeOptions(undefined)).toEqual([]);
    expect(sharedAttributeOptions([])).toEqual([]);
  });
});

describe('mergeOverlayFieldOptions', () => {
  it('returns only the Standard Fields, unheaded, when there are no shared attributes', () => {
    const options = mergeOverlayFieldOptions([], catalogue);

    expect(options).toHaveLength(STANDARD_FIELDS.length);
    expect(options.every(option => !option.heading)).toBe(true);
    expect(options[0]).toEqual({ title: 'Patient Name', value: 'patientName' });
  });

  it('adds headings and the shared attributes when present', () => {
    const options = mergeOverlayFieldOptions(tags, catalogue);

    expect(options[0]).toEqual({ heading: 'Standard' });
    expect(options[STANDARD_FIELDS.length + 1]).toEqual({ heading: 'Shared' });
    expect(options.slice(STANDARD_FIELDS.length + 2).map(option => option.value)).toEqual([
      'tag:00080080',
      'tag:00180087',
      'tag:0043102D',
    ]);
  });

  it('carries no extra keys on standard entries', () => {
    mergeOverlayFieldOptions([], catalogue).forEach(option => {
      expect(Object.keys(option).sort()).toEqual(['title', 'value']);
    });
  });
});
