// The arrow annotation in DICOM-SR: a tip, a tail and a text, with no value. One measurement group
// per arrow, tracking identifier `cornerstoneTools@^4.0.0:ArrowAnnotate` (the Cornerstone3D prefix
// accepted on read), and one Finding CODE item (121071, DCM, "Finding") and no NUM item. The Finding
// carries the geometry and the properties:
//
// * its value is (CORNERSTONEFREETEXT, CST4, <text>), the code value written in LongCodeValue (it is
//   19 characters) and read in either attribute: the user's text is the Code Meaning, verbatim at any
//   length. A Finding of any other code is a coded finding: carried verbatim, its meaning shown but
//   never taken as the user's text;
// * INFERRED FROM one POLYLINE of two points, tip then tail: a SCOORD (column, row) SELECTED FROM the
//   image (image domain) or a SCOORD3D in patient millimetres with its Frame of Reference (patient
//   domain). An arrow read with a tip only (a POINT) has no stored tail: one is derived for display,
//   and the POINT is written back while the arrow is unchanged;
// * HAS PROPERTIES: description, text, location, View, the display colours (Line, Text) and, in the
//   patient domain, Source-Series and Drawing-Plane (propertyParent.js: the arrow is a Finding-parent
//   tool).
//
// Two older forms are read into the same arrow: the Viewer's (a NUM "Center" of value 0 around a
// one-point POINT, the label in the Finding) and the stock Cornerstone3D form (a NUM "label" around a
// two-point POLYLINE, the label in the Finding, or in a group-level Comment when the group has no
// Finding). The stock carrier is the unqualified NUM (111010, DCM) of value 0 in UCUM `1`, and nothing
// else: no other NUM's geometry is taken for an arrow's. A re-save writes the form above. The classic tool is
// cornerstone-tools `ArrowAnnotate` (handles `start` the tip, `end` the tail, the text in `text`);
// the Cornerstone3D tool is `ArrowAnnotateTool` with `arrowFirst` (points[0] the tip, points[1] the
// tail, the text in `data.text`).

import _ from 'lodash';

import { asArray, codeValueOf, conceptNameMatches, firstItem } from './codedConcept';

export const ARROW_TOOL = 'ArrowAnnotate';
export const HANDLE_NAMES = Object.freeze(['start', 'end']);

// A tip and tail closer than this (mm; pixels on an uncalibrated image) are degenerate: kept with a
// warning on read, refused on write
export const MIN_ARROW_LENGTH = 0.01;

export const FREE_TEXT_VALUE = 'CORNERSTONEFREETEXT';
export const FREE_TEXT_SCHEME = 'CST4';

const FINDING = Object.freeze({ value: '121071', schemeDesignator: 'DCM' });
const FINDING_SITES = [Object.freeze({ value: '363698007', schemeDesignator: 'SCT' }), Object.freeze({ value: 'G-C0E3', schemeDesignator: 'SRT' })];

const isArrowTool = toolType => toolType === ARROW_TOOL;

/** The free-text Finding code of a text, as the Cornerstone adapters write it */
const freeTextCode = text => ({ LongCodeValue: FREE_TEXT_VALUE, CodingSchemeDesignator: FREE_TEXT_SCHEME, CodeMeaning: text });

/** Whether a code is the free-text code (CORNERSTONEFREETEXT, CST4), in either code-value attribute */
const isFreeTextCode = code => !!code && codeValueOf(code) === FREE_TEXT_VALUE && code.CodingSchemeDesignator === FREE_TEXT_SCHEME;

/** Whether a string holds a character outside ASCII */
const isNonAscii = value => _.isString(value) && Array.from(value).some(character => character.charCodeAt(0) > 0x7f);

const findingOf = groupItems => asArray(groupItems).find(item => conceptNameMatches(item, FINDING));
// The stock adapters' geometry carrier, (111010, DCM) "Center" or "label", and the label of a stock
// annotation with no Finding, a group-level Comment (121106, DCM)
const STOCK_CARRIER = Object.freeze({ value: '111010', schemeDesignator: 'DCM' });
const COMMENT = Object.freeze({ value: '121106', schemeDesignator: 'DCM' });

const hasQualifier = item => asArray(item && item.NumericValueQualifierCodeSequence).length > 0;
const isNumericZero = value => {
  const text = _.isNumber(value) ? String(value) : (_.isString(value) ? value.trim() : '');
  return text !== '' && Number(text) === 0;
};

/**
 * Whether a NUM is the stock arrow carrier: (111010, DCM), a present numeric value of 0 (not blank),
 * unit (1, UCUM), and no Numeric Value Qualifier
 */
function isStockCarrier(num) {
  if (!num || num.ValueType !== 'NUM' || !conceptNameMatches(num, STOCK_CARRIER) || hasQualifier(num)) {
    return false;
  }
  const measured = firstItem(num.MeasuredValueSequence);
  const unit = measured && firstItem(measured.MeasurementUnitsCodeSequence);
  return !!measured && !hasQualifier(measured) && isNumericZero(firstItem(measured.NumericValue))
    && !!unit && codeValueOf(unit) === '1' && unit.CodingSchemeDesignator === 'UCUM';
}
const coordinateTypes = ['SCOORD', 'SCOORD3D'];
const geometryChildOf = item => asArray(item && item.ContentSequence)
  .find(child => coordinateTypes.includes(child.ValueType) && (!child.RelationshipType || child.RelationshipType === 'INFERRED FROM'));

/**
 * The geometry of an arrow group: { item (the SCOORD / SCOORD3D), carrier ('finding' or 'num'), num
 * (the legacy NUM carrier) }, or undefined. The geometry under the Finding (the Sonador form), else
 * under the stock carrier NUM (the two legacy forms); a POINT or POLYLINE only.
 */
function arrowGeometryOf(groupItems) {
  const items = asArray(groupItems);
  const isShape = item => !!item && ['POINT', 'POLYLINE'].includes(item.GraphicType);
  const underFinding = geometryChildOf(findingOf(items));
  if (isShape(underFinding)) {
    return { item: underFinding, carrier: 'finding' };
  }
  const num = items.find(item => isStockCarrier(item) && isShape(geometryChildOf(item)));
  return num ? { item: geometryChildOf(num), carrier: 'num', num } : undefined;
}

/**
 * The label of an arrow group: { label, finding, coded, source }. `finding` is the Finding's code as
 * read (verbatim, undefined without a Finding); `label` the user's text: the meaning of a free-text
 * Finding ('' when it has none); without a Finding, the meaning of a free-text Finding Site, else
 * the text of a group-level Comment (the stock Cornerstone3D form of a labelled annotation), the order
 * Sonador IO reads them in. A coded finding's meaning is not a label ('' and `coded`). `source` is
 * 'finding', 'finding-site', 'comment' or 'none'.
 */
function arrowLabelOf(groupItems) {
  const items = asArray(groupItems);
  const findingItem = findingOf(items);
  const finding = findingItem ? firstItem(findingItem.ConceptCodeSequence) : undefined;
  if (finding && isFreeTextCode(finding)) {
    return { label: _.isString(finding.CodeMeaning) ? finding.CodeMeaning : '', finding, coded: false, source: 'finding' };
  }
  if (finding) {
    return { label: '', finding, coded: true, source: 'finding' };
  }
  const site = items.find(item => conceptNameMatches(item, ...FINDING_SITES) && isFreeTextCode(firstItem(item.ConceptCodeSequence)));
  if (site) {
    const code = firstItem(site.ConceptCodeSequence);
    return { label: _.isString(code.CodeMeaning) ? code.CodeMeaning : '', finding: undefined, coded: false, source: 'finding-site' };
  }
  const comment = items.find(item => item.ValueType === 'TEXT' && conceptNameMatches(item, COMMENT));
  if (comment) {
    return { label: _.isString(comment.TextValue) ? comment.TextValue : '', finding: undefined, coded: false, source: 'comment' };
  }
  return { label: '', finding: undefined, coded: false, source: 'none' };
}

const toVector = point => (_.isArray(point) ? Array.from(point, Number)
  : [point.x, point.y, point.z].filter(value => !_.isNil(value)).map(Number));

/** The distance from tip to tail (2D or 3D points, arrays or `{ x, y[, z] }`) */
function arrowLength(tip, tail) {
  const a = toVector(tip);
  const b = toVector(tail);
  return Math.sqrt(a.reduce((sum, value, i) => sum + (b[i] - value) ** 2, 0));
}

/**
 * The tail shown for an arrow read with a tip only (image points): a tenth of the image away down and
 * to the right, as the Cornerstone adapters place it (10 pixels without the image size).
 */
function derivedImageTail([x, y], { columns, rows } = {}) {
  return [x + (columns > 0 ? columns / 10 : 10), y + (rows > 0 ? rows / 10 : 10)];
}

/** The text an arrow shows: its own, else the meaning of a coded finding it was read with */
function arrowDisplayText(text, codedFinding) {
  if (_.isString(text) && text !== '') {
    return text;
  }
  return codedFinding && _.isString(codedFinding.CodeMeaning) ? codedFinding.CodeMeaning : '';
}


export {
  arrowDisplayText, arrowGeometryOf, arrowLabelOf, arrowLength, derivedImageTail, freeTextCode, isArrowTool, isFreeTextCode,
  isNonAscii, isStockCarrier,
};
