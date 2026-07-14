export const DEFAULT_COLUMNS_IDS = [
  'PatientName',
  'PatientID',
  'AccessionNumber',
  'StudyDate',
  'modalities',
  'StudyDescription',
];
export const WORK_LIST_DEFAULT_COLUMNS_IDS = [
  'AssignedUser',
  'GroupName',
  'PatientName',
  'Status',
  'ReasonForReview',
  'mrn',
  'AccessionNumber',
  'StudyDate',
  'modalities',
  'series',
  'StudyDescription',
];
export const DEFAULT_FILTERS = ['PatientBirthDate', 'PatientID', 'Modality', 'StudyDescription', 'SeriesDescription'];

export const DEFAULT_COLUMNS = [
  { id: 'PatientName', label: 'PatientName', type: 'search' },
  { id: 'PatientID', label: 'MRN', type: 'search' },
  { id: 'AccessionNumber', label: 'AccessionNumber', type: 'search' },
  { id: 'StudyDate', label: 'StudyDate', type: 'date' },
  { id: 'modalities', label: 'Modality', type: 'search' },
  { id: 'StudyDescription', label: 'StudyDescription', type: 'search' },
];

export const FILTER_TYPES = {
  'Code String': 'search',
  Date: 'date',
  Time: 'time',
  'Unique Identifier (UID)': 'search',
  'Integer String': 'search',
  'Decimal String': 'search',
  'Long Text': 'search',
  'Unsigned Short': 'search',
  'Person Name': 'search',
  'Long String': 'search',
  'Short String': 'search',
  'Sequence of Items': 'search',
  'Short Text': 'search',
  'Floating Point Double': 'search',
};
