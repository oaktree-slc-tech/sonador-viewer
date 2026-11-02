// Coded concepts for DICOM-SR content items (PS3.3 Table 8.8-1a). Every Sonador writer builds its
// codes here so that one convention applies: a URN or URL is written as URNCodeValue, any other
// value as CodeValue up to 16 characters and LongCodeValue beyond. This is a writer convention,
// not a validator: values and meanings are written verbatim, at any length. Readers accept any of
// the three value attributes, whatever the length of the value found there.

import _ from 'lodash';

import { sr as dcmjsSr } from 'dcmjs';

const { CodedConcept } = dcmjsSr.coding;

const CODE_VALUE_MAX_LENGTH = 16;
const URN_PATTERN = /^urn:/i;
const URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

const CODE_VALUE_ATTRIBUTES = ['CodeValue', 'LongCodeValue', 'URNCodeValue'];


function codeValueAttribute(value) {
  const text = _.toString(value);
  if (URN_PATTERN.test(text) || URL_PATTERN.test(text)) {
    return 'URNCodeValue';
  }
  return text.length > CODE_VALUE_MAX_LENGTH ? 'LongCodeValue' : 'CodeValue';
}


function codedConcept({ value, meaning, schemeDesignator, schemeVersion }) {
  // A dcmjs CodedConcept (content items require that type) with the value in the attribute the
  // convention selects. CodingSchemeVersion is Type 1C: omitted when the code has no version.
  const concept = new CodedConcept({ value, meaning, schemeDesignator });
  const attribute = codeValueAttribute(value);
  if (attribute !== 'CodeValue') {
    concept[attribute] = concept.CodeValue;
    delete concept.CodeValue;
  }
  if (!_.isNil(schemeVersion) && schemeVersion !== '') {
    concept.CodingSchemeVersion = schemeVersion;
  }
  return concept;
}


// Naturalized datasets hold a one-item sequence as an object and a longer one as an array
const asArray = value => (_.isNil(value) ? [] : _.isArray(value) ? value : [value]);
const firstItem = sequence => asArray(sequence)[0];

const codeValueOf = code => {
  if (!code) {
    return undefined;
  }
  const attribute = CODE_VALUE_ATTRIBUTES.find(a => !_.isNil(code[a]) && code[a] !== '');
  return attribute ? code[attribute] : undefined;
};

const conceptName = contentItem => firstItem(contentItem && contentItem.ConceptNameCodeSequence);
const conceptCode = contentItem => firstItem(contentItem && contentItem.ConceptCodeSequence);
const conceptNameValue = contentItem => codeValueOf(conceptName(contentItem));
const conceptCodeValue = contentItem => codeValueOf(conceptCode(contentItem));

// Code identity is the value and the scheme designator. `expected` codes may be written either as
// dcmjs-style attributes ({ CodeValue, CodingSchemeDesignator }) or as Sonador enum entries
// ({ value, schemeDesignator }).
const codeMatches = (code, expected) => {
  if (!code || !expected) {
    return false;
  }
  const value = codeValueOf(expected) || expected.value;
  const designator = expected.CodingSchemeDesignator || expected.schemeDesignator;
  return codeValueOf(code) === value && (!designator || code.CodingSchemeDesignator === designator);
};
const conceptNameMatches = (contentItem, ...expected) =>
  expected.some(code => codeMatches(conceptName(contentItem), code));


export {
  CODE_VALUE_MAX_LENGTH,
  asArray,
  codeValueAttribute,
  codeMatches,
  codeValueOf,
  codedConcept,
  conceptCode,
  conceptCodeValue,
  conceptName,
  conceptNameMatches,
  conceptNameValue,
  firstItem,
};
