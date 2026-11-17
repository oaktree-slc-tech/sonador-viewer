// Landmark sets read from a Sonador-SR document, from the groups landmarkGroups.js finds: the
// landmark-set groups, then the legacy point groups. Read-only: nothing here writes a set.
//
// A set:
//   { trackingUid, trackingIdentifier, legacy, concept, label, name, description, sourceSeries,
//     display: { Line?, Text? }, domain: 'patient' | 'image', frameOfReferenceUID, image,
//     landmarks: [{ id, fiducialUid, provisional, ordinal, concept, label, name, description,
//                   type: { kind, code, absent }, point, display }] }
// `name` is the concept's meaning, else the label, else '' for a set and null for a landmark.
// `display` holds the colours the item stores (hex); landmarkColors resolves them role by role. A
// patient-domain point is [x, y, z] in millimetres in `frameOfReferenceUID`; an image-domain point is
// [column, row] on the frame of `image` ({ sopInstanceUID, sopClassUID, frameNumber }).
//
// A landmark item that cannot be read is skipped and the rest of the set is read; a group with no
// readable landmark is not a set. Each case is reported as a diagnostic ({ level, code, trackingUid,
// detail }) with the codes of the client's reader, and never stops the document from loading.

import {
  asArray, codeMatches, codeValueOf, conceptCode, conceptName, conceptNameMatches,
} from '../utils/codedConcept';
import { parseDisplayAttributes } from '../utils/dcmsrDisplayAttributes';
import { propertyCandidates } from '../utils/propertyParent';
import {
  CodeNameCodeSequenceValues, DCM, DCMSR_LANDMARK, DCMSR_LANDMARK_ANATOMIC, DCMSR_LANDMARK_POINT, DCMSR_LANDMARK_REGISTRATION,
  DCMSR_MEASUREMENT_DESCRIPTION, DCMSR_MEASUREMENT_SOURCE_SERIES, DCMSR_MEASUREMENT_TEXT, DCMSR_SCOORD3D, DCMSR_SCOORD3D_ANATOMIC, DCMSR_SCOORD3D_LANDMARK, DCMSR_SCOORD3D_REGISTRATION,
  RELATIONSHIP_TYPE,
} from '../enums';
import { landmarkSetGroupsOf, legacyGroupsOf, trackingIdentifierOf, trackingUidOf } from './landmarkGroups';

const FINDING = { value: CodeNameCodeSequenceValues.Finding, schemeDesignator: DCM };
// The value of a free-text name: the meaning is the label
const FREE_TEXT = { value: CodeNameCodeSequenceValues.CornerstoneFreeText, schemeDesignator: 'CST4' };

export const LANDMARK_TYPES = Object.freeze({ POINT: 'Point', ANATOMIC: 'Anatomic', REGISTRATION: 'Registration', UNKNOWN: 'unknown' });

const TYPE_CODES = [
  [DCMSR_LANDMARK_POINT, LANDMARK_TYPES.POINT],
  [DCMSR_LANDMARK_ANATOMIC, LANDMARK_TYPES.ANATOMIC],
  [DCMSR_LANDMARK_REGISTRATION, LANDMARK_TYPES.REGISTRATION],
];
const LEGACY_TYPE_CODES = [
  [DCMSR_SCOORD3D, LANDMARK_TYPES.POINT],
  [DCMSR_SCOORD3D_LANDMARK, LANDMARK_TYPES.POINT],
  [DCMSR_SCOORD3D_ANATOMIC, LANDMARK_TYPES.ANATOMIC],
  [DCMSR_SCOORD3D_REGISTRATION, LANDMARK_TYPES.REGISTRATION],
];

const COLOR_ROLES = ['Line', 'Text'];

// Whole-slide images are tiled: a coordinate on one without a pixel origin is ambiguous
const VL_WHOLE_SLIDE_MICROSCOPY = '1.2.840.10008.5.1.4.1.1.77.1.6';
const isTiled = instance => Boolean(instance) && (instance.SOPClassUID === VL_WHOLE_SLIDE_MICROSCOPY
  || instance.TotalPixelMatrixColumns !== undefined || instance.TotalPixelMatrixRows !== undefined
  || /^TILED/.test(String(instance.DimensionOrganizationType || '')));


// Codes

const codeOf = code => (code ? { value: codeValueOf(code), schemeDesignator: code.CodingSchemeDesignator, meaning: code.CodeMeaning } : null);
const isCode = (code, expected) => codeMatches(code, { value: expected.value, schemeDesignator: expected.schemeDesignator });

const blankToNull = text => (typeof text === 'string' && text.trim() !== '' ? text : null);

// A property item, matched by coding scheme and value, from candidates in order of precedence
const propertyItem = (candidates, code, valueType) => asArray(candidates).find(item => item.ValueType === valueType
  && conceptNameMatches(item, { value: code.value, schemeDesignator: code.schemeDesignator }));

/**
 * The concept and label of a value slot (a set's Finding or a landmark item): the free-text code
 * means the label is the meaning; the reserved Point code, in a landmark, means no concept; any other
 * code is the concept. A Text property beside a concept is the label.
 */
function nameOf(item, { landmark, text: propertyText, diagnose }) {
  const value = conceptCode(item);
  const text = blankToNull(propertyText);
  if (value && isCode(value, FREE_TEXT)) {
    if (text !== null) {
      diagnose('info', 'landmark-label-duplicate');
    }
    return { concept: null, label: blankToNull(value.CodeMeaning) };
  }
  if (!value || (landmark && isCode(value, DCMSR_LANDMARK_POINT))) {
    return { concept: null, label: text };
  }
  return { concept: codeOf(value), label: text };
}

const shownName = ({ concept, label }) => (concept && blankToNull(concept.meaning)) || label || null;

/** The landmark type of a coordinate item: its concept name, Point when it has none */
function typeOf(coordinate, { legacy }) {
  const name = conceptName(coordinate);
  if (!name) {
    return { kind: LANDMARK_TYPES.POINT, code: null, absent: true };
  }
  const known = (legacy ? LEGACY_TYPE_CODES : TYPE_CODES).find(([code]) => isCode(name, code));
  return { kind: known ? known[1] : LANDMARK_TYPES.UNKNOWN, code: codeOf(name), absent: false };
}


// Properties, with the precedence of the Finding property reader (propertyParent.js): the Finding's
// children, then the group-level items of the flat and legacy layouts

function propertiesOf(groupItems) {
  const candidates = propertyCandidates(groupItems, 'finding');
  const textOf = code => {
    const item = propertyItem(candidates, code, 'TEXT');
    return item ? item.TextValue : undefined;
  };
  const sourceSeries = propertyItem(candidates, DCMSR_MEASUREMENT_SOURCE_SERIES, 'UIDREF');
  const read = {};
  parseDisplayAttributes(groupItems, read, { propertyParent: 'finding', path: 'displayAttributes' });
  const color = (read.displayAttributes && read.displayAttributes.Color) || {};
  const display = {};
  COLOR_ROLES.forEach(role => {
    if (color[role]) {
      display[role] = color[role];
    }
  });
  return {
    description: blankToNull(textOf(DCMSR_MEASUREMENT_DESCRIPTION)),
    text: textOf(DCMSR_MEASUREMENT_TEXT),
    sourceSeries: (sourceSeries && sourceSeries.UID) || null,
    display,
  };
}

// A landmark item's properties are its own children: read as those of a Finding
const landmarkPropertiesOf = item => propertiesOf([{ ConceptNameCodeSequence: [{ CodeValue: FINDING.value, CodingSchemeDesignator: DCM }],
  ContentSequence: asArray(item.ContentSequence) }]);


// Geometry

const graphicDataOf = coordinate => Array.from(coordinate.GraphicData || [], Number);
const hasFiniteValues = (values, size) => values.length === size && values.every(Number.isFinite);

function frameNumbersOf(reference) {
  const value = reference && reference.ReferencedFrameNumber;
  return asArray(value).flatMap(number => String(number).split('\\')).map(Number).filter(Number.isFinite);
}

/**
 * The position of a 0.3 landmark item, or the code of the reason it cannot be read:
 * { domain, point, frameOfReferenceUID } | { domain, point, image } | { problem }
 */
function positionOf(item, { instanceOf }) {
  const children = asArray(item.ContentSequence).filter(child => child.RelationshipType === RELATIONSHIP_TYPE.INFERRED_FROM);
  const coordinates = children.filter(child => child.ValueType === 'SCOORD' || child.ValueType === 'SCOORD3D');
  if (coordinates.length > 1) {
    return { problem: 'landmark-point-ambiguous' };
  }
  const [coordinate] = coordinates;
  if (!coordinate || coordinate.GraphicType !== 'POINT') {
    return { problem: 'landmark-without-point' };
  }

  const values = graphicDataOf(coordinate);
  if (coordinate.ValueType === 'SCOORD3D') {
    if (!hasFiniteValues(values, 3)) {
      return { problem: 'landmark-point-invalid', coordinate };
    }
    if (!coordinate.ReferencedFrameOfReferenceUID) {
      return { problem: 'landmark-frame-missing', coordinate };
    }
    return { coordinate, domain: 'patient', point: values, frameOfReferenceUID: coordinate.ReferencedFrameOfReferenceUID };
  }

  if (!hasFiniteValues(values, 2)) {
    return { problem: 'landmark-point-invalid', coordinate };
  }
  const images = asArray(coordinate.ContentSequence)
    .filter(child => child.ValueType === 'IMAGE' && child.RelationshipType === RELATIONSHIP_TYPE.SELECTED_FROM);
  if (!images.length) {
    return { problem: 'landmark-image-reference-missing', coordinate };
  }
  const references = images.flatMap(image => asArray(image.ReferencedSOPSequence));
  const frames = references.length === 1 ? frameNumbersOf(references[0]) : [];
  if (images.length > 1 || references.length !== 1 || frames.length > 1) {
    return { problem: 'landmark-image-reference-ambiguous', coordinate };
  }
  const [reference] = references;
  if (!reference.ReferencedSOPInstanceUID) {
    return { problem: 'landmark-image-reference-missing', coordinate };
  }
  // FRAME, or absent on an image that is not tiled (when its metadata is cached, a tiled one)
  const origin = coordinate.PixelOriginInterpretation || undefined;
  if (origin !== 'FRAME' && (origin !== undefined || isTiled(instanceOf(reference.ReferencedSOPInstanceUID)))) {
    return { problem: 'landmark-pixel-origin-unsupported', coordinate };
  }
  return {
    coordinate,
    domain: 'image',
    point: values,
    image: { sopInstanceUID: reference.ReferencedSOPInstanceUID, sopClassUID: reference.ReferencedSOPClassUID, frameNumber: frames[0] },
  };
}

/** The frame or image a position is in, as one comparable key */
const placeOf = position => (position.domain === 'patient'
  ? `patient:${position.frameOfReferenceUID || ''}`
  : `image:${position.image.sopInstanceUID}:${position.image.frameNumber || ''}`);


// Identity

function assignIdentities(landmarks, diagnose) {
  // A landmark is identified by its Fiducial UID, else by its position in the set
  const seen = new Set();
  landmarks.forEach((landmark) => {
    if (!landmark.fiducialUid) {
      landmark.id = `position:${landmark.ordinal}`;
      landmark.provisional = true;
      return;
    }
    if (seen.has(landmark.fiducialUid)) {
      diagnose('warning', 'duplicate-fiducial-uid', landmark.fiducialUid);
      landmark.id = `${landmark.fiducialUid}#${landmark.ordinal}`;
    } else {
      landmark.id = landmark.fiducialUid;
    }
    seen.add(landmark.fiducialUid);
  });
}


// The 0.3 groups

function readLandmarkSetGroup(group, report, options) {
  const items = asArray(group.ContentSequence);
  const trackingUid = trackingUidOf(items);
  const trackingIdentifier = trackingIdentifierOf(items);
  const diagnose = (level, code, detail) => report({ level, code, trackingUid, detail });
  if (!trackingUid) {
    diagnose('warning', 'landmark-set-without-tracking-uid');
    return null;
  }

  const landmarkItems = items.filter(item => item.ValueType === 'CODE' && conceptNameMatches(item, DCMSR_LANDMARK));
  if (!landmarkItems.length) {
    diagnose('warning', 'landmark-set-empty');
    diagnose('warning', 'landmark-set-read-as-group');
    return null;
  }

  let place;
  const landmarks = [];
  landmarkItems.forEach((item, index) => {
    const position = positionOf(item, options);
    if (position.problem) {
      diagnose('warning', position.problem, `landmark item ${index + 1}`);
      return;
    }
    const key = placeOf(position);
    if (place === undefined) {
      place = { key, position };
    } else if (place.key !== key) {
      diagnose('warning', 'landmark-set-mixed-frames', `landmark item ${index + 1}`);
      return;
    }

    const type = typeOf(position.coordinate, { legacy: false });
    if (type.absent) {
      diagnose('info', 'landmark-type-absent', `landmark item ${index + 1}`);
    } else if (type.kind === LANDMARK_TYPES.UNKNOWN) {
      diagnose('info', 'landmark-type-unknown', `landmark item ${index + 1}`);
    }
    const fiducialUid = position.coordinate.FiducialUID || null;
    if (!fiducialUid) {
      diagnose('info', 'landmark-identity-provisional', `landmark item ${index + 1}`);
    }
    const { text, description, display } = landmarkPropertiesOf(item);
    const name = nameOf(item, { landmark: true, text, diagnose });
    landmarks.push({
      ordinal: landmarks.length + 1, fiducialUid, ...name, name: shownName(name), description, type, point: position.point, display,
    });
  });

  if (!landmarks.length) {
    diagnose('warning', 'landmark-set-read-as-group');
    return null;
  }
  assignIdentities(landmarks, diagnose);

  const finding = items.find(item => conceptNameMatches(item, FINDING));
  const { text, ...properties } = propertiesOf(items);
  const name = finding ? nameOf(finding, { landmark: false, text, diagnose }) : { concept: null, label: null };
  const set = {
    trackingUid,
    trackingIdentifier,
    legacy: false,
    ...name,
    name: shownName(name) || '',
    ...properties,
    domain: place.position.domain,
    frameOfReferenceUID: place.position.domain === 'patient' ? place.position.frameOfReferenceUID || null : null,
    image: place.position.domain === 'image' ? place.position.image : null,
    landmarks,
  };
  if (!set.name) {
    diagnose('warning', 'landmark-set-without-name');
  }
  return set;
}


// Legacy point groups

function readLegacyGroup(group, report) {
  const items = asArray(group.ContentSequence);
  const trackingUid = trackingUidOf(items);
  const trackingIdentifier = trackingIdentifierOf(items);
  const diagnose = (level, code, detail) => report({ level, code, trackingUid, detail });
  if (!trackingUid) {
    diagnose('warning', 'landmark-set-without-tracking-uid');
    return null;
  }

  let frameOfReferenceUID;
  let mixed = false;
  const landmarks = [];
  items.filter(item => item.ValueType === 'SCOORD3D' && ['POINT', 'MULTIPOINT'].includes(item.GraphicType)).forEach((item) => {
    const values = graphicDataOf(item);
    const readable = values.length >= 3 && values.length % 3 === 0 && values.every(Number.isFinite)
      && (item.GraphicType === 'MULTIPOINT' || values.length === 3);
    if (!readable) {
      diagnose('warning', 'landmark-point-invalid');
      return;
    }
    const frame = item.ReferencedFrameOfReferenceUID;
    if (!frame) {
      diagnose('warning', 'landmark-frame-missing');
      return;
    }
    if (frameOfReferenceUID === undefined) {
      frameOfReferenceUID = frame;
    } else if (frame !== frameOfReferenceUID) {
      mixed = true;
      return;
    }
    const type = typeOf(item, { legacy: true });
    for (let offset = 0; offset < values.length; offset += 3) {
      landmarks.push({
        ordinal: landmarks.length + 1,
        // A POINT item's Fiducial UID is its landmark's; the points of a MULTIPOINT share no identity
        fiducialUid: item.GraphicType === 'POINT' ? item.FiducialUID || null : null,
        concept: null, label: null, name: null, description: null, type, point: values.slice(offset, offset + 3), display: {},
      });
    }
  });
  if (mixed) {
    diagnose('warning', 'landmark-set-mixed-frames');
  }
  if (!landmarks.length) {
    diagnose('warning', 'landmark-set-read-as-group');
    return null;
  }
  assignIdentities(landmarks, diagnose);
  diagnose('info', 'landmark-legacy-collection');

  return {
    trackingUid, trackingIdentifier, legacy: true, concept: null, label: blankToNull(trackingIdentifier),
    name: blankToNull(trackingIdentifier) || '', description: null, sourceSeries: null, display: {},
    domain: 'patient', frameOfReferenceUID: frameOfReferenceUID || null, image: null, landmarks,
  };
}

/**
 * The landmark sets of a naturalized SR document, in document order: the 0.3 groups, then the legacy
 * point groups.
 *
 * @param {object} dataset
 * @param {object} [options]
 * @param {Function} [options.instanceOf] - the cached metadata of an instance by SOP Instance UID, or
 *   undefined: tells a tiled image, whose coordinates need an explicit pixel origin
 * @returns {{ sets: object[], diagnostics: object[] }}
 */
export default function readLandmarkSets(dataset, { instanceOf = () => undefined } = {}) {
  const diagnostics = [];
  const report = diagnostic => diagnostics.push(diagnostic);
  const sets = [];
  if (!dataset) {
    return { sets, diagnostics };
  }

  const read = (group, reader) => {
    try {
      const set = reader(group, report, { instanceOf });
      if (set) {
        sets.push(set);
      }
    } catch (error) {
      report({ level: 'warning', code: 'landmark-set-unreadable', trackingUid: trackingUidOf(group.ContentSequence), detail: error.message });
    }
  };
  landmarkSetGroupsOf(dataset).forEach(group => read(group, readLandmarkSetGroup));
  legacyGroupsOf(dataset).forEach(group => read(group, readLegacyGroup));
  return { sets, diagnostics };
}

export { readLandmarkSets };
