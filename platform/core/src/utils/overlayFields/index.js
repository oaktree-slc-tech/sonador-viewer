// Overlay field catalogue shared by the Viewer Metadata settings picker and the viewport overlay.
//
// A corner item is stored as `{ title, value }`. `value` is either the key of a Standard Field
// below or a tag field `tag:GGGGEEEE` naming a DICOM attribute by hex code. Rendering lives in
// extensions/cornerstone/src/utils/overlayFields; this module holds only the catalogue and the
// pure helpers that both sides need.

export const TAG_FIELD_PREFIX = 'tag:';

const TAG_FIELD_RE = /^tag:[0-9A-F]{8}$/;

/**
 * Normalise a DICOM tag code to eight upper-case hex characters.
 *
 * Accepts `0018,1030`, `(0018,1030)`, `00181030` and `x00181030` in any case.
 *
 * @param {string} input
 * @returns {string|null} `GGGGEEEE`, or null when the input is not a tag code
 */
export function normalizeTagCode(input) {
  if (typeof input !== 'string') {
    return null;
  }

  const hex = input.replace(/^[xX]/, '').replace(/[\s(),]/g, '').toUpperCase();
  return /^[0-9A-F]{8}$/.test(hex) ? hex : null;
}

/**
 * @param {string} code any form accepted by normalizeTagCode
 * @returns {string|null} `(GGGG,EEEE)`
 */
export function punctuateTagCode(code) {
  const hex = normalizeTagCode(code);
  return hex ? `(${hex.slice(0, 4)},${hex.slice(4)})` : null;
}

/**
 * @param {string} code any form accepted by normalizeTagCode
 * @returns {string|null} the stored `value` for a tag field
 */
export function tagFieldValue(code) {
  const hex = normalizeTagCode(code);
  return hex ? `${TAG_FIELD_PREFIX}${hex}` : null;
}

export function isTagFieldValue(value) {
  return typeof value === 'string' && TAG_FIELD_RE.test(value);
}

/**
 * @param {string} value a stored corner item value
 * @returns {string|null} `GGGGEEEE` when the value is a tag field
 */
export function parseTagFieldValue(value) {
  return isTagFieldValue(value) ? value.slice(TAG_FIELD_PREFIX.length) : null;
}

/**
 * Standard Fields, in picker order. `tags` is the ordered fallback chain of attributes a field
 * reads; fields without one are computed from several attributes or from viewport state. The
 * first fourteen keys predate the catalogue and must keep their strings, because they are what
 * saved preferences contain.
 */
export const STANDARD_FIELDS = Object.freeze(
  [
    { value: 'patientName', title: 'Patient Name', tags: ['00100010'] },
    { value: 'patientId', title: 'Patient ID', tags: ['00100020'] },
    { value: 'studyDescription', title: 'Study Description', tags: ['00081030'] },
    { value: 'studyDate-studyTime', title: 'Study Date Time' },
    { value: 'zoomPercentage', title: 'Zoom Percentage' },
    { value: 'wwwc', title: 'WWWC' },
    { value: 'compression', title: 'Compression' },
    { value: 'seriesNumber', title: 'Series Number', tags: ['00200011'] },
    { value: 'Img-instance-number-index-stack-size', title: 'Img instance number index/stack size' },
    { value: 'frameRate-image-info', title: 'Frame Rate Image Info' },
    { value: 'modality', title: 'Modality', tags: ['00080060'] },
    { value: 'seriesInstanceUID', title: 'Series Instance UID', tags: ['0020000E'] },
    { value: 'studyInstanceUID', title: 'Study Instance UID', tags: ['0020000D'] },
    { value: 'accessionNumber', title: 'Accession Number', tags: ['00080050'] },
    { value: 'seriesDescription', title: 'Series Description', tags: ['0008103E', '00120072'] },
    { value: 'protocolName', title: 'Protocol Name', tags: ['00181030', '00189423'] },
    { value: 'echoTrainLength', title: 'Echo Train Length', tags: ['00180091', '00189240', '00189241'] },
    { value: 'laterality', title: 'Laterality', tags: ['00200060', '00200062'] },
    { value: 'fieldOfView', title: 'Field of View' },
    { value: 'reconstructionMatrix', title: 'Reconstruction Matrix' },
    { value: 'acquisitionMatrix', title: 'Acquisition Matrix', tags: ['00181310'] },
    { value: 'pixelSpacing', title: 'Pixel Spacing', tags: ['00280030'] },
    { value: 'sliceSpacing', title: 'Slice Spacing', tags: ['00180088'] },
    { value: 'sliceGap', title: 'Slice Gap' },
  ].map(Object.freeze)
);

const STANDARD_FIELDS_BY_VALUE = new Map(STANDARD_FIELDS.map(field => [field.value, field]));

export function findStandardField(value) {
  return STANDARD_FIELDS_BY_VALUE.get(value) || null;
}

/**
 * Every tag code a Standard Field already renders, primary or fallback. A shared attribute with
 * one of these codes adds nothing the picker does not offer.
 */
export function standardFieldCodes() {
  return new Set(STANDARD_FIELDS.flatMap(field => field.tags || []));
}

/**
 * Whether a stored corner item value is something the overlay can render.
 */
export function isKnownFieldValue(value) {
  return STANDARD_FIELDS_BY_VALUE.has(value) || isTagFieldValue(value);
}

/**
 * The picker title for a stored corner item: the catalogue title for a Standard Field, the
 * stored title for a tag field.
 */
export function fieldTitle(item) {
  if (!item) {
    return '';
  }

  const standard = findStandardField(item.value);
  return standard ? standard.title : item.title || '';
}
