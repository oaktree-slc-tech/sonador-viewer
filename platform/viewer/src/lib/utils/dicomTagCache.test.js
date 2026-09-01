// The tag-cache transform behind useTags: this is where every study-list attribute label is
// decided, so the grouping, the de-duplication and the label normalisation are covered together.

import { normalizeTagCache } from './dicomTagCache';

const tag = (code, keyword, label, extra = {}) => ({
  code,
  tag: keyword,
  label,
  vr: { code: 'LO', name: 'Long String' },
  ...extra,
});

describe('normalizeTagCache', () => {
  it('groups by resource level and keys by tag code', () => {
    const result = normalizeTagCache({
      Study: { '0008,0050': tag('0008,0050', 'AccessionNumber', 'Accession Number') },
      Series: { '0008,0060': tag('0008,0060', 'Modality', 'Modality') },
    });

    expect(Object.keys(result)).toEqual(['Study', 'Series']);
    expect(result.Study['0008,0050'].label).toBe('Accession Number');
    expect(result.Series['0008,0060'].label).toBe('Modality');
  });

  it('keeps one definition per tag code across resource levels', () => {
    const result = normalizeTagCache({
      Study: { '0010,0020': tag('0010,0020', 'PatientID', 'Patient ID') },
      Series: { '0010,0020': tag('0010,0020', 'PatientID', 'Patient ID') },
    });

    expect(result.Series).toBeUndefined();
    expect(result.Study['0010,0020'].label).toBe('Patient ID');
  });

  it('carries the rest of the definition through untouched', () => {
    const result = normalizeTagCache({
      Study: {
        '0038,0060': tag('0038,0060', 'ServiceEpisodeID', 'Service Episode Id', {
          private: false,
          options: ['A', 'B'],
        }),
      },
    });

    expect(result.Study['0038,0060']).toEqual({
      code: '0038,0060',
      tag: 'ServiceEpisodeID',
      label: 'Service Episode ID',
      vr: { code: 'LO', name: 'Long String' },
      private: false,
      options: ['A', 'B'],
    });
  });

  it('repairs a label whose acronym the server split apart', () => {
    const result = normalizeTagCache({
      Study: {
        '0038,0060': tag('0038,0060', 'ServiceEpisodeID', 'Service Episode Id'),
        '0038,0061': tag('0038,0061', 'ServiceEpisodeIDs', 'Service Episode Id s'),
        '0020,000D': tag('0020,000D', 'StudyInstanceUID', 'Study Instance U ID'),
      },
    });

    expect(result.Study['0038,0060'].label).toBe('Service Episode ID');
    expect(result.Study['0038,0061'].label).toBe('Service Episode IDs');
    expect(result.Study['0020,000D'].label).toBe('Study Instance UID');
  });

  it('leaves ordinary labels exactly as the server sent them', () => {
    const result = normalizeTagCache({
      Study: {
        '0008,0020': tag('0008,0020', 'StudyDate', 'Study Date'),
        '0008,1030': tag('0008,1030', 'StudyDescription', 'Study Description'),
        '0010,0010': tag('0010,0010', 'PatientName', 'Patient Name'),
      },
    });

    expect(result.Study['0008,0020'].label).toBe('Study Date');
    expect(result.Study['0008,1030'].label).toBe('Study Description');
    expect(result.Study['0010,0010'].label).toBe('Patient Name');
  });

  it('preserves a label a site authored for a private attribute', () => {
    // The keyword is present, but the label says something the keyword does not -- so it is a name
    // someone chose, not a split, and normalisation must keep out of it.
    const result = normalizeTagCache({
      Study: {
        '0009,1001': tag('0009,1001', 'ReferringPhysicianName', 'Referring Practice', {
          private: true,
        }),
        '0009,1002': tag('0009,1002', 'PatientID', "Patient's ID"),
        '0009,1003': tag('0009,1003', 'TrialSiteID', 'Site (research)'),
      },
    });

    expect(result.Study['0009,1001'].label).toBe('Referring Practice');
    expect(result.Study['0009,1002'].label).toBe("Patient's ID");
    expect(result.Study['0009,1003'].label).toBe('Site (research)');
  });

  it('handles consecutive acronyms and digits', () => {
    const result = normalizeTagCache({
      Instance: {
        '0008,0016': tag('0008,0016', 'SOPClassUID', 'SOP Class U ID'),
        '0018,1152': tag('0018,1152', 'Exposure2', 'Exposure 2'),
        '0018,9328': tag('0018,9328', 'ExposureTimeInms', 'Exposure Time Inms'),
      },
    });

    expect(result.Instance['0008,0016'].label).toBe('SOP Class UID');
    expect(result.Instance['0018,1152'].label).toBe('Exposure 2');
    // No word break is invented where the keyword has none: DICOM really does spell this one
    // `ExposureTimeInms`, and splitting it further would be guessing.
    expect(result.Instance['0018,9328'].label).toBe('Exposure Time Inms');
  });

  it('falls back to the keyword when the server sent no label at all', () => {
    const result = normalizeTagCache({
      Study: { '0038,0060': { code: '0038,0060', tag: 'ServiceEpisodeID' } },
    });

    expect(result.Study['0038,0060'].label).toBe('Service Episode ID');
  });

  it('answers an empty map for an empty or absent response', () => {
    expect(normalizeTagCache({})).toEqual({});
    expect(normalizeTagCache(undefined)).toEqual({});
  });
});
