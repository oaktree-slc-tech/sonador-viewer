// The words for a set and its landmarks: an unnamed set reads "Landmark set"; a landmark's type is
// Point, Anatomic or Registration, a type outside the three its code's meaning, else its code value,
// and a coordinate with no type a Point; an unknown type is drawn as a Point; the second line of a
// named landmark is its label beside a concept, then its description; the breakdown by type keeps
// the three in order and the others after them. Landmarks shaped as readLandmarkSets.js reads them.

import {
  landmarkDetailOf, markerShapeOf, setNameOf, typeBreakdownOf, typeTextOf,
} from './landmarkText';

const code = (value, meaning) => ({ value, schemeDesignator: '99SYNTHETIC', meaning });
const landmark = (type, extra = {}) => ({ name: null, concept: null, label: null, description: null, type, ...extra });
const POINT = landmark({ kind: 'Point', code: code('Sonador-Landmark.Point', 'Point'), absent: false });
const ANATOMIC = landmark({ kind: 'Anatomic', code: code('Sonador-Landmark.Anatomic', 'Anatomic'), absent: false });
const REGISTRATION = landmark({ kind: 'Registration', code: code('Sonador-Landmark.Registration', 'Registration'), absent: false });
// Two unnamed synthetic points: one with no type, one with a type code outside the three
const NO_TYPE = landmark({ kind: 'Point', code: null, absent: true });
const OTHER_TYPE = landmark({ kind: 'unknown', code: code('TRACKER-ORIGIN', 'Tracker origin'), absent: false });

it('names an unnamed set "Landmark set"', () => {
  expect(setNameOf({ name: '' })).toBe('Landmark set');
  expect(setNameOf({ name: 'Pelvic landmarks' })).toBe('Pelvic landmarks');
});

it('gives the text of each type, the code of a type outside the three, and Point for none', () => {
  expect([POINT, ANATOMIC, REGISTRATION, NO_TYPE, OTHER_TYPE].map(typeTextOf))
    .toEqual(['Point', 'Anatomic', 'Registration', 'Point', 'Tracker origin']);
  // An empty meaning gives the code value
  expect(typeTextOf(landmark({ kind: 'unknown', code: code('TRACKER-ORIGIN', '  '), absent: false }))).toBe('TRACKER-ORIGIN');
});

it('draws each type in its shape, and a type outside the three, or none, as a Point', () => {
  expect([POINT, ANATOMIC, REGISTRATION, NO_TYPE, OTHER_TYPE].map(markerShapeOf))
    .toEqual(['Point', 'Anatomic', 'Registration', 'Point', 'Point']);
});

it('gives a named landmark its label beside a concept, then its description; a label alone is the name', () => {
  expect(landmarkDetailOf({ concept: code('ASIS-L', 'Left ASIS'), label: 'ASIS (left)', description: 'Every attribute set' }))
    .toBe('ASIS (left) · Every attribute set');
  expect(landmarkDetailOf({ concept: null, label: 'Label only', description: null })).toBe('');
  expect(landmarkDetailOf({ concept: null, label: 'Tear drop', description: 'Right' })).toBe('Right');
});

it('breaks a set down by type: Point, Anatomic, Registration, then the others in order of appearance', () => {
  const set = { landmarks: [OTHER_TYPE, REGISTRATION, POINT, NO_TYPE, ANATOMIC, POINT] };
  expect(typeBreakdownOf(set)).toEqual([
    { text: 'Point', shape: 'Point', count: 3 },
    { text: 'Anatomic', shape: 'Anatomic', count: 1 },
    { text: 'Registration', shape: 'Registration', count: 1 },
    { text: 'Tracker origin', shape: 'Point', count: 1 },
  ]);
});
