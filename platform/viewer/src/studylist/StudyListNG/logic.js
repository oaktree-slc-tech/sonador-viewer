export const getDateEntryFromRange = (today, numOfDays, edge = 'start') => {
  if (typeof numOfDays !== 'number') {
    return;
  }

  if (edge === 'end') {
    return today;
  } else {
    today.subtract(numOfDays, 'days');
  }
};

export const DEFAULT_COLUMNS = [
  { id: 'PatientName', label: 'PatientName', type: 'search' },
  { id: 'PatientID', label: 'MRN', type: 'search' },
  { id: 'AccessionNumber', label: 'AccessionNumber', type: 'search' },
  { id: 'StudyDate', label: 'StudyDate', type: 'date' },
  { id: 'modalities', label: 'Modality', type: 'search' },
  { id: 'StudyDescription', label: 'StudyDescription', type: 'search' },
];

export const DEFAULT_COLUMNS_IDS = [
  'PatientName',
  'PatientID',
  'AccessionNumber',
  'StudyDate',
  'modalities',
  'StudyDescription',
];

export const metadataArr = [
  {
    title: 'Patient',
    options: [
      { id: 'PatientName', label: 'Patient Name', isSelected: true },
      { id: 'PatientBirthdate', label: 'Birth Date', isSelected: true },
      { id: 'PatientID', label: 'Patient ID', isSelected: true },
      { id: 'PatientSex', label: 'Patient Sex', isSelected: true },
      { id: 'PatientAge', label: 'Patient Age', isSelected: true },
    ],
  },
  {
    title: 'Study',
    options: [
      { id: 'modalities', label: 'Modality', isSelected: true },
      { id: 'StudyDate', label: 'Study Date', isSelected: true },
      { id: 'StudyTime', label: 'Study Time', isSelected: true },
      { id: 'studyId', label: 'Study ID', isSelected: true },
    ],
  },
  { title: 'Series', options: [{ id: 'numberOfStudyRelatedSeries', label: 'Number of Series', isSelected: true }] },
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

export const DEFAULT_FILTERS = ['PatientBirthDate', 'PatientID', 'Modality', 'StudyDescription', 'SeriesDescription'];
