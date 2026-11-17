// The words the panel and the renderers use for a landmark set and its landmarks, from a set of
// readLandmarkSets.js. A landmark without a name is shown by its type alone, never by a word for the
// missing name; a set without a name reads "Landmark set".

import { LANDMARK_TYPES } from './landmarkTypes';

const UNNAMED_SET = 'Landmark set';
const SHAPES = [LANDMARK_TYPES.POINT, LANDMARK_TYPES.ANATOMIC, LANDMARK_TYPES.REGISTRATION];

/** The name a set is listed by */
const setNameOf = set => (set && set.name) || UNNAMED_SET;

/** The marker shape of a landmark: Point, Anatomic or Registration; an unknown type is drawn as a Point */
const markerShapeOf = landmark => {
  const kind = landmark && landmark.type && landmark.type.kind;
  return SHAPES.includes(kind) ? kind : LANDMARK_TYPES.POINT;
};

/**
 * The text of a landmark's type: Point, Anatomic or Registration; for a type outside the three, its
 * code's meaning, else its code value; Point for a coordinate with no type
 */
function typeTextOf(landmark) {
  const type = (landmark && landmark.type) || {};
  if (SHAPES.includes(type.kind) || type.absent || !type.code) {
    return SHAPES.includes(type.kind) ? type.kind : LANDMARK_TYPES.POINT;
  }
  const meaning = type.code.meaning && String(type.code.meaning).trim();
  return meaning || type.code.value || LANDMARK_TYPES.POINT;
}

/** The second line of a named landmark: its label when a concept names it, then its description */
const landmarkDetailOf = landmark => [landmark && landmark.concept ? landmark.label : null, landmark && landmark.description]
  .filter(value => value !== undefined && value !== null && String(value).trim() !== '')
  .join(' · ');

/**
 * The landmarks of a set by type, in the order Point, Anatomic, Registration, then the other types in
 * the order they first appear: [{ text, shape, count }]
 */
function typeBreakdownOf(set) {
  const counts = new Map();
  (set && set.landmarks ? set.landmarks : []).forEach((landmark) => {
    const text = typeTextOf(landmark);
    const known = counts.get(text) || { text, shape: markerShapeOf(landmark), count: 0 };
    known.count += 1;
    counts.set(text, known);
  });
  const rank = text => (SHAPES.includes(text) ? SHAPES.indexOf(text) : SHAPES.length);
  return [...counts.values()].sort((a, b) => rank(a.text) - rank(b.text));
}


export { landmarkDetailOf, markerShapeOf, setNameOf, typeBreakdownOf, typeTextOf, UNNAMED_SET };
