// Unit tests for the removal-confirmation descriptor formatting (ohif-viewers#127, §5.4).
//
// The component itself is markup and there is no React renderer in this repo's jest setup, so the
// part that can be got wrong — which resource the overlay names, and which attributes it claims
// will be destroyed — lives in describeRemoval.js and is tested here.

import {
  describeSeries,
  describeStudy,
  formatStudyDate,
  seriesDetailLines,
  studyDetailLines,
  summariseBulkRemoval,
} from './describeRemoval';


describe('describeStudy', () => {
  it('names the study by patient', () => {
    expect(describeStudy({ PatientName: 'DOE^JANE', StudyDescription: 'CT CHEST' })).toEqual({
      title: 'DOE^JANE',
      subtitle: 'CT CHEST',
    });
  });

  it('falls back through MRN to the UID rather than rendering nothing', () => {
    expect(describeStudy({ PatientID: 'MRN-42' }).title).toBe('MRN-42');
    expect(describeStudy({ StudyInstanceUID: '1.2.3' }).title).toBe('1.2.3');
    expect(describeStudy({}).title).toBe('');
  });
});


describe('describeSeries', () => {
  it('matches how the Downloads menu names a series job', () => {
    expect(describeSeries({ SeriesNumber: 3, SeriesDescription: 'AXIAL' })).toBe('Series 3: AXIAL');
  });

  it('falls back to modality then UID when the series has no description', () => {
    expect(describeSeries({ SeriesNumber: 3, Modality: 'CT' })).toBe('Series 3: CT');
    expect(describeSeries({ SeriesNumber: 3, SeriesInstanceUID: '1.2.3' })).toBe('Series 3: 1.2.3');
  });

  it('omits the "Series N:" prefix when there is no series number', () => {
    // SeriesNumber 0 is a real series number and must NOT be treated as absent.
    expect(describeSeries({ SeriesDescription: 'AXIAL' })).toBe('AXIAL');
    expect(describeSeries({ SeriesNumber: 0, SeriesDescription: 'AXIAL' })).toBe('Series 0: AXIAL');
  });
});


describe('formatStudyDate', () => {
  it('renders a DICOM DA date', () => {
    expect(formatStudyDate('20240117')).toBe('Jan 17, 2024');
  });

  it('passes anything else through instead of rendering "Invalid date"', () => {
    expect(formatStudyDate('2024-01-17')).toBe('2024-01-17');
    expect(formatStudyDate(undefined)).toBeUndefined();
  });
});


describe('studyDetailLines', () => {
  it('states what will be destroyed', () => {
    const lines = studyDetailLines({
      PatientID: 'MRN-42',
      StudyDescription: 'CT CHEST',
      AccessionNumber: 'ACC-9',
      StudyDate: '20240117',
      numberOfStudyRelatedSeries: '4',
      numberOfStudyRelatedInstances: '812',
    });

    expect(lines).toEqual([
      { label: 'MRN', value: 'MRN-42' },
      { label: 'Description', value: 'CT CHEST' },
      { label: 'Accession #', value: 'ACC-9' },
      { label: 'Study Date', value: 'Jan 17, 2024' },
      { label: 'Series', value: '4' },
      { label: 'Instances', value: '812' },
    ]);
  });

  it('drops absent attributes rather than rendering them blank', () => {
    expect(studyDetailLines({ PatientID: 'MRN-42' })).toEqual([{ label: 'MRN', value: 'MRN-42' }]);
    expect(studyDetailLines({})).toEqual([]);
  });
});


describe('seriesDetailLines', () => {
  it('carries the study identification plus the modality and instance count', () => {
    expect(seriesDetailLines({
      PatientID: 'MRN-42',
      StudyDescription: 'CT CHEST',
      StudyDate: '20240117',
      Modality: 'CT',
      numberOfSeriesRelatedInstances: 203,
    })).toEqual([
      { label: 'MRN', value: 'MRN-42' },
      { label: 'Study', value: 'CT CHEST' },
      { label: 'Study Date', value: 'Jan 17, 2024' },
      { label: 'Modality', value: 'CT' },
      { label: 'Instances', value: '203' },
    ]);
  });
});


describe('summariseBulkRemoval', () => {
  it('states both numbers, including on a clean run (FR-13)', () => {
    expect(summariseBulkRemoval({ removed: 5, total: 5 })).toBe('5 of 5 studies removed');
    expect(summariseBulkRemoval({ removed: 3, total: 5 })).toBe('3 of 5 studies removed');
    expect(summariseBulkRemoval({ removed: 0, total: 5 })).toBe('0 of 5 studies removed');
  });

  it('singularises a one-study selection', () => {
    expect(summariseBulkRemoval({ removed: 1, total: 1 })).toBe('1 of 1 study removed');
  });
});
