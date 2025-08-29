

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
      { id: 'AccessionNumber', label: 'Accession Number', isSelected: true },
      { id: 'modalities', label: 'Modalities in Study', isSelected: true, },
      { id: 'StudyDate', label: 'Study Date', isSelected: true },
      { id: 'StudyTime', label: 'Study Time', isSelected: true },
      { id: 'StudyID', label: 'Study ID', isSelected: true },
      { id: 'StudyDescription', label: 'Study Description', isSelected: true }, 
    ],
  },
  { title: 'Series', options: [
      { id: 'numberOfStudyRelatedSeries', label: 'Number of Series', isSelected: true },
      { id: 'SeriesInstanceUID', label: 'Series Instance UID', isSelected: true },
      { id: 'SeriesDescription', label: 'Series Description', isSelected: true },
      { id: 'Modality', label: 'Modality', isSelected: true },
      { id: 'SeriesNumber', label: 'Series Number', isSelected: true },
    ]
  },
];