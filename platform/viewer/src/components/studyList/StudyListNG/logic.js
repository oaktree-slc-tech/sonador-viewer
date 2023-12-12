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
