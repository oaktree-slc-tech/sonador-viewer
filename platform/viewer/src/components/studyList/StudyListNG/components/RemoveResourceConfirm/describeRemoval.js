// Descriptor formatting for the removal confirmation (ohif-viewers#127, FR-11).
//
// Pure functions, deliberately separate from the component: a confirmation for an irreversible
// delete has to name the right resource, and "the overlay showed the wrong patient" is a defect
// worth a unit test. There is no React renderer in this repo's jest setup, so the logic that can
// be got wrong lives here where it can be tested, and the component stays markup.

import moment from 'moment';


export const formatStudyDate = (StudyDate) => {
  // Study dates arrive as DICOM DA (YYYYMMDD). Anything else is passed through rather than
  // rendered as "Invalid date" — a confirmation is the wrong place to lose information.

  if (!StudyDate) {
    return undefined;
  }

  const parsed = moment(String(StudyDate), 'YYYYMMDD', true);

  return parsed.isValid() ? parsed.format('MMM DD, YYYY') : String(StudyDate);
};


export const describeStudy = (descriptor = {}) => {
  // Identify a study to a reader: who it belongs to and which study it is. Never a bare UID —
  // a UID is not something a reader can check against the patient in front of them.

  return {
    title: descriptor.PatientName || descriptor.PatientID || descriptor.StudyInstanceUID || '',
    subtitle: descriptor.StudyDescription || '',
  };
};


export const describeSeries = (descriptor = {}) => {
  // "Series {SeriesNumber}: {SeriesDescription}", matching how the Downloads menu names a series
  // job, so the same series reads the same way in both surfaces. Falls back through Modality and
  // then the UID when the series carries no description.

  const label = descriptor.SeriesDescription || descriptor.Modality || descriptor.SeriesInstanceUID || '';

  return descriptor.SeriesNumber !== undefined && descriptor.SeriesNumber !== null
    ? `Series ${descriptor.SeriesNumber}: ${label}`
    : label;
};


const _line = (label, value) => (
  value === undefined || value === null || value === '' ? null : { label, value: String(value) }
);


export const studyDetailLines = (descriptor = {}) => {
  // Attribute lines for a study removal. Absent attributes are dropped rather than rendered
  // empty: a row of blank values reads as data loss in a dialog whose entire job is to make the
  // user confident about what is being destroyed.

  return [
    _line('MRN', descriptor.PatientID),
    _line('Description', descriptor.StudyDescription),
    _line('Accession #', descriptor.AccessionNumber),
    _line('Study Date', formatStudyDate(descriptor.StudyDate)),
    _line('Series', descriptor.numberOfStudyRelatedSeries),
    _line('Instances', descriptor.numberOfStudyRelatedInstances),
  ].filter(Boolean);
};


export const seriesDetailLines = (descriptor = {}) => {
  // Attribute lines for a series removal: the same study identification, plus what distinguishes
  // this series from the others in it.

  return [
    _line('MRN', descriptor.PatientID),
    _line('Study', descriptor.StudyDescription),
    _line('Study Date', formatStudyDate(descriptor.StudyDate)),
    _line('Modality', descriptor.Modality),
    _line('Instances', descriptor.numberOfSeriesRelatedInstances),
  ].filter(Boolean);
};


export const summariseBulkRemoval = ({ removed = 0, total = 0 } = {}) => {
  // "{n} of {m} studies removed" (FR-13). Always states both numbers, including when they match:
  // a partial failure and a clean run must not be distinguishable only by what the message
  // omits.

  return `${removed} of ${total} ${total === 1 ? 'study' : 'studies'} removed`;
};
