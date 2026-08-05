/**
 * Human-readable identification of a study or a series, for user-facing messages.
 *
 * A notification about background work ("archive downloaded", "study saved for offline use") is
 * only actionable if the user can tell WHICH study it refers to -- several transfers may be in
 * flight at once, and the notification commonly arrives long after the click that started it.
 * These helpers compose the identifiers a reader actually recognises, in the same order the
 * Download Manager cards present them, and drop absent values along with their separators.
 *
 * Descriptors are accepted in whatever shape the caller already has: a DicomMetadataStore study
 * metadata object, a DownloadManagerService job, or naturalized DICOM. Person names may therefore
 * arrive as a string, a `{ Alphabetic }` object, or an array of either.
 *
 * `describeStudyFilename` / `describeSeriesFilename` apply the same field selection to the name of
 * a file handed to the user, so a downloaded archive is as recognisable in the Downloads folder as
 * it was in the toast that announced it.
 */

import moment from 'moment';

import formatPN from './formatPN';

const SEPARATOR = ' · ';

/** DICOM DA (`20260314`) rendered the way the study list renders it. */
function _studyDate(value) {
  if (!value) {
    return undefined;
  }
  // Parsed strictly and against known formats only. moment's permissive path falls back to the
  // Date constructor and logs a deprecation warning for every unrecognised string, and these
  // values come straight off DICOM, where anything is possible.
  const date =
    value instanceof Date
      ? moment(value)
      : /^\d{8}$/.test(String(value))
        ? moment(String(value), 'YYYYMMDD', true)
        : moment(String(value), moment.ISO_8601, true);

  return date.isValid() ? date.format('MMM D, YYYY') : undefined;
}

/** `ModalitiesInStudy` arrives as an array, a backslash-delimited string, or a joined summary. */
function _modalities({ modalities, ModalitiesInStudy, Modality } = {}) {
  const value = modalities || ModalitiesInStudy || Modality;

  if (Array.isArray(value)) {
    return value.join('/') || undefined;
  }

  return value ? String(value).replace(/\\/g, '/') : undefined;
}

function _personName(value) {
  if (!value) {
    return undefined;
  }
  // Naturalized PN values are typically an array of person-name objects.
  if (Array.isArray(value)) {
    return _personName(value[0]);
  }

  return formatPN(value) || undefined;
}

function _join(pieces) {
  return pieces.filter(Boolean).join(SEPARATOR);
}

/** "Doe, Jane (MRN0042)" -- whichever of the two is present, or undefined if neither is. */
function _patient({ PatientName, PatientID } = {}) {
  const name = _personName(PatientName);

  if (name && PatientID) {
    return `${name} (${PatientID})`;
  }

  return name || PatientID || undefined;
}

/**
 * @param {object} descriptor { PatientName, PatientID, StudyDescription, ModalitiesInStudy,
 *   StudyDate, AccessionNumber, StudyInstanceUID }
 * @returns {string} e.g. "Doe, Jane (MRN0042) · CT CHEST W CONTRAST · Mar 14, 2026 · Accession A99813"
 */
export function describeStudy(descriptor = {}) {
  const { StudyDescription, AccessionNumber, StudyInstanceUID } = descriptor;

  const label = _join([
    _patient(descriptor),
    // The modality stands in when a study carries no description, which is common enough on
    // outside studies that falling straight through to the date reads as anonymous.
    StudyDescription || _modalities(descriptor),
    _studyDate(descriptor.StudyDate),
    AccessionNumber && `Accession ${AccessionNumber}`,
  ]);

  if (label) {
    return label;
  }

  // Last resort only: every viewer path feeds this from a study-list row, a download job, or
  // viewport data, all of which carry patient and study attributes. A bare UID here means the
  // caller found no metadata at all -- unfriendly, but unambiguous for a support conversation.
  return StudyInstanceUID ? `Study ${StudyInstanceUID}` : 'this study';
}

/**
 * @param {object} descriptor { PatientName, PatientID, SeriesNumber, SeriesDescription, Modality, SeriesInstanceUID }
 * @returns {string} e.g. "Doe, Jane (MRN0042) · Series 4 · AXIAL 1.25MM · CT"
 */
export function describeSeries(descriptor = {}) {
  const { SeriesNumber, SeriesDescription, Modality, SeriesInstanceUID } = descriptor;

  const label = _join([
    _patient(descriptor),
    SeriesNumber !== undefined && SeriesNumber !== null && `Series ${SeriesNumber}`,
    SeriesDescription,
    Modality,
  ]);

  if (label) {
    return label;
  }

  return SeriesInstanceUID ? `Series ${SeriesInstanceUID}` : 'this series';
}

// -- Filenames --------------------------------------------------------------------------------

/** Longest slug we will build. Long enough for a full name plus a study description. */
const MAX_SLUG_LENGTH = 120;

/**
 * Join descriptor pieces into a conservative filename slug: ASCII words separated by hyphens,
 * fields separated by underscores. Deliberately narrow — this string reaches a filesystem, and
 * DICOM text fields can hold anything.
 */
function _slug(pieces, fallback) {
  const slug = pieces
    .filter(Boolean)
    .map(piece =>
      String(piece)
        .normalize('NFKD')
        .replace(/[^A-Za-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
    )
    .filter(Boolean)
    .join('_')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/[-_]+$/, '');

  return slug || fallback;
}

/**
 * @returns {string} e.g. "Doe-Jane_CT-CHEST-W-CONTRAST_20260314.zip", falling back to the UID.
 */
export function describeStudyFilename(descriptor = {}, extension = 'zip') {
  const { StudyDescription, StudyDate, StudyInstanceUID } = descriptor;

  const slug = _slug(
    [
      _personName(descriptor.PatientName) || descriptor.PatientID,
      StudyDescription || _modalities(descriptor),
      StudyDate,
    ],
    StudyInstanceUID || 'study'
  );

  return `${slug}.${extension}`;
}

/**
 * @returns {string} e.g. "Doe-Jane_Series-4_AXIAL-1-25MM.zip", falling back to the UID.
 */
export function describeSeriesFilename(descriptor = {}, extension = 'zip') {
  const { SeriesNumber, SeriesDescription, SeriesInstanceUID } = descriptor;

  const slug = _slug(
    [
      _personName(descriptor.PatientName) || descriptor.PatientID,
      SeriesNumber !== undefined && SeriesNumber !== null && `Series-${SeriesNumber}`,
      SeriesDescription || descriptor.Modality,
    ],
    SeriesInstanceUID || 'series'
  );

  return `${slug}.${extension}`;
}

export default describeStudy;
