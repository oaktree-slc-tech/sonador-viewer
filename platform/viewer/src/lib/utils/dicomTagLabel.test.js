// Unit tests for the DICOM attribute label derivation.
//
// The case this module was written for is ServiceEpisodeID: the imaging server's tag cache
// delivers it split as "Service Episode Id s", and that string is what the Select Columns
// dropdown, the filter controls and the table header row all render.

import { dicomTagLabel, splitDicomKeyword } from './dicomTagLabel';

describe('splitDicomKeyword', () => {
  it('keeps a trailing acronym whole', () => {
    // The reported defect: the server's split strands the "D" and lower-cases the run, so the
    // column reads "Service Episode Id s".
    expect(splitDicomKeyword('ServiceEpisodeID')).toEqual(['Service', 'Episode', 'ID']);
  });

  it('keeps a pluralised acronym whole', () => {
    expect(splitDicomKeyword('ServiceEpisodeIDs')).toEqual(['Service', 'Episode', 'IDs']);
  });

  it('separates an acronym from the capitalised word that follows it', () => {
    expect(splitDicomKeyword('SOPClassUID')).toEqual(['SOP', 'Class', 'UID']);
  });

  it('splits ordinary camel case', () => {
    expect(splitDicomKeyword('PatientBirthDate')).toEqual(['Patient', 'Birth', 'Date']);
    expect(splitDicomKeyword('IssuerOfPatientID')).toEqual(['Issuer', 'Of', 'Patient', 'ID']);
  });

  it('handles a keyword that starts lower case', () => {
    expect(splitDicomKeyword('numberOfStudyRelatedSeries')).toEqual([
      'number',
      'Of',
      'Study',
      'Related',
      'Series',
    ]);
  });

  it('answers empty for anything that is not a string', () => {
    expect(splitDicomKeyword(undefined)).toEqual([]);
    expect(splitDicomKeyword(null)).toEqual([]);
    expect(splitDicomKeyword(42)).toEqual([]);
  });
});

describe('dicomTagLabel', () => {
  it('renders Service Episode ID with its ID intact', () => {
    expect(dicomTagLabel('ServiceEpisodeID')).toBe('Service Episode ID');
  });

  it('repairs a label that is only a mis-split of the keyword', () => {
    expect(dicomTagLabel('ServiceEpisodeIDs', 'Service Episode Id s')).toBe('Service Episode IDs');
    expect(dicomTagLabel('ServiceEpisodeID', 'Service Episode Id')).toBe('Service Episode ID');
    expect(dicomTagLabel('StudyInstanceUID', 'Study Instance U ID')).toBe('Study Instance UID');
  });

  it('keeps a label that says anything the keyword does not', () => {
    // A site that named a private attribute is the authority on what it is called; only the
    // keyword-split case is repaired.
    expect(dicomTagLabel('ReferringPhysicianName', 'Referring Practice')).toBe('Referring Practice');
    expect(dicomTagLabel('TrialSiteID', 'Site (research)')).toBe('Site (research)');
    // Punctuation is a difference: a keyword has none, so this is a name, not a split.
    expect(dicomTagLabel('PatientID', "Patient's ID")).toBe("Patient's ID");
    // Same words, different order — not a split of the keyword.
    expect(dicomTagLabel('PatientID', 'ID, Patient')).toBe('ID, Patient');
  });

  it('capitalises a keyword that starts lower case', () => {
    expect(dicomTagLabel('numberOfStudyRelatedSeries')).toBe('Number Of Study Related Series');
    expect(dicomTagLabel('modalities')).toBe('Modalities');
  });

  it('leaves the common study attributes reading as they always have', () => {
    expect(dicomTagLabel('PatientName', 'Patient Name')).toBe('Patient Name');
    expect(dicomTagLabel('PatientID', 'Patient ID')).toBe('Patient ID');
    expect(dicomTagLabel('AccessionNumber', 'Accession Number')).toBe('Accession Number');
    expect(dicomTagLabel('StudyDescription', 'Study Description')).toBe('Study Description');
  });

  it('keeps the server label for an attribute with no keyword to derive one from', () => {
    expect(dicomTagLabel(undefined, 'Referring Practice')).toBe('Referring Practice');
    expect(dicomTagLabel('', 'Referring Practice')).toBe('Referring Practice');
    // A value that already reads as a name is not a keyword, and is passed through untouched.
    expect(dicomTagLabel('Referring Practice', 'Referring Practice')).toBe('Referring Practice');
  });

  it('answers an empty string rather than undefined when it has nothing to work with', () => {
    expect(dicomTagLabel(undefined, undefined)).toBe('');
  });
});
