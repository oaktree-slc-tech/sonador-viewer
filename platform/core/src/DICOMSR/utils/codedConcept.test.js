import { sr as dcmjsSr } from 'dcmjs';

import {
  codeMatches,
  codeValueAttribute,
  codeValueOf,
  codedConcept,
  conceptCodeValue,
  conceptNameMatches,
  conceptNameValue,
} from './codedConcept';

const { TextContentItem } = dcmjsSr.valueTypes;

const code = value => codedConcept({ value, meaning: 'Meaning', schemeDesignator: 'Sonador-SR' });


describe('codedConcept', () => {
  it('writes values of up to 16 characters as CodeValue and longer ones as LongCodeValue', () => {
    const short = code('a'.repeat(16));
    expect(short.CodeValue).toBe('a'.repeat(16));
    expect(short.LongCodeValue).toBeUndefined();

    const long = code('a'.repeat(17));
    expect(long.LongCodeValue).toBe('a'.repeat(17));
    expect(long.CodeValue).toBeUndefined();
  });

  it('writes URNs and URLs as URNCodeValue whatever their length', () => {
    const urn = code('urn:x:1');
    expect(urn.URNCodeValue).toBe('urn:x:1');
    expect(urn.CodeValue).toBeUndefined();

    const url = 'https://terminology.example.org/codes/sonador/img-qc/metal-artifact';
    const long = code(url);
    expect(long.URNCodeValue).toBe(url);
    expect(long.CodeValue).toBeUndefined();
    expect(long.LongCodeValue).toBeUndefined();

    expect(codeValueAttribute('img-qc.metal-artifact')).toBe('LongCodeValue');
    expect(codeValueAttribute('Sonador:not-a-url')).toBe('LongCodeValue');
  });

  it('writes the meaning verbatim at any length', () => {
    const meaning = 'm'.repeat(120);
    expect(codedConcept({ value: 'x', meaning, schemeDesignator: 'S' }).CodeMeaning).toBe(meaning);
  });

  it('omits CodingSchemeVersion when the code has none', () => {
    expect(codedConcept({ value: 'x', meaning: 'X', schemeDesignator: 'S', schemeVersion: '0.2' }).CodingSchemeVersion)
      .toBe('0.2');
    [undefined, null, ''].forEach(schemeVersion => {
      expect(codedConcept({ value: 'x', meaning: 'X', schemeDesignator: 'S', schemeVersion }))
        .not.toHaveProperty('CodingSchemeVersion');
    });
  });

  it('can name a dcmjs content item', () => {
    const item = new TextContentItem({ name: code('Sonador-Measurement.Text'), value: 'text', relationshipType: 'CONTAINS' });
    expect(item.ConceptNameCodeSequence[0].LongCodeValue).toBe('Sonador-Measurement.Text');
  });
});


describe('code value readers', () => {
  it('read any of the three value attributes', () => {
    expect(codeValueOf({ CodeValue: 'img-qc.metal-artifact' })).toBe('img-qc.metal-artifact');
    expect(codeValueOf({ LongCodeValue: 'img-qc.metal-artifact' })).toBe('img-qc.metal-artifact');
    expect(codeValueOf({ URNCodeValue: 'urn:x:1' })).toBe('urn:x:1');
    expect(codeValueOf(undefined)).toBeUndefined();
  });

  it('accept single-object and array sequences', () => {
    const asObject = { ConceptNameCodeSequence: { CodeValue: '121071' }, ConceptCodeSequence: { LongCodeValue: 'a'.repeat(20) } };
    const asArray = { ConceptNameCodeSequence: [{ CodeValue: '121071' }], ConceptCodeSequence: [{ URNCodeValue: 'urn:x:1' }] };

    expect(conceptNameValue(asObject)).toBe('121071');
    expect(conceptCodeValue(asObject)).toBe('a'.repeat(20));
    expect(conceptNameValue(asArray)).toBe('121071');
    expect(conceptCodeValue(asArray)).toBe('urn:x:1');
    expect(conceptNameValue({})).toBeUndefined();
  });
});


describe('code identity', () => {
  const finding = { CodeValue: '121071', CodingSchemeDesignator: 'DCM' };

  it('matches value and designator in any value attribute, against either code form', () => {
    expect(codeMatches({ LongCodeValue: '121071', CodingSchemeDesignator: 'DCM' }, finding)).toBe(true);
    expect(codeMatches({ CodeValue: '121071', CodingSchemeDesignator: 'DCM' }, { value: '121071', schemeDesignator: 'DCM' }))
      .toBe(true);
    expect(codeMatches({ CodeValue: '121071', CodingSchemeDesignator: '99LOCAL' }, finding)).toBe(false);
    expect(codeMatches(undefined, finding)).toBe(false);
  });

  it('matches a content item concept name in object or array form, against any of several codes', () => {
    const old = { CodeValue: 'G-C0E3', CodingSchemeDesignator: 'SRT' };
    expect(conceptNameMatches({ ConceptNameCodeSequence: [{ URNCodeValue: 'urn:x:1', CodingSchemeDesignator: 'X' }] },
      { value: 'urn:x:1', schemeDesignator: 'X' })).toBe(true);
    expect(conceptNameMatches({ ConceptNameCodeSequence: { ...old } }, finding, old)).toBe(true);
    expect(conceptNameMatches({}, finding)).toBe(false);
  });
});
