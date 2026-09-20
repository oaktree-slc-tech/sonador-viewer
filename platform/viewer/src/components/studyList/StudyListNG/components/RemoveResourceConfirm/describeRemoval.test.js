// Unit tests for the removal-confirmation descriptor formatting (ohif-viewers#127, §5.4).
//
// The component itself is markup and there is no React renderer in this repo's jest setup, so the
// part that can be got wrong — which resource the overlay names, and which attributes it claims
// will be destroyed — lives in describeRemoval.js and is tested here.

import {
  commentDetailLines,
  commentExcerpt,
  describeComment,
  describeSeries,
  describeStudy,
  formatCommentDate,
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


describe('formatCommentDate', () => {
  it('trims the microseconds and renders to the second', () => {
    expect(formatCommentDate('2026-09-19T14:03:27.123456')).toBe('2026-09-19 14:03:27');
  });

  it('passes an unparseable value through rather than rendering "Invalid date"', () => {
    expect(formatCommentDate('yesterday')).toBe('yesterday');
  });

  it('is undefined for a missing value', () => {
    expect(formatCommentDate(undefined)).toBeUndefined();
    expect(formatCommentDate('')).toBeUndefined();
  });
});


describe('commentExcerpt', () => {
  it('collapses whitespace so a multi-line comment reads as one line', () => {
    expect(commentExcerpt('First line\n\n  second   line ')).toBe('First line second line');
  });

  it('cuts long text with an ellipsis at the requested length', () => {
    const text = 'x'.repeat(200);

    expect(commentExcerpt(text, 160)).toBe(`${'x'.repeat(160)}…`);
    expect(commentExcerpt('short', 160)).toBe('short');
  });

  it('is an empty string for a missing comment', () => {
    expect(commentExcerpt(undefined)).toBe('');
  });
});


describe('describeComment', () => {
  it('names the author by display name and the posting time', () => {
    const descriptor = {
      ID: '0f3c5c2e-1d7a-4b9c-9a1e-5d2f6b8c4a10',
      User: { first_name: 'Ada', last_name: 'Lovelace', username: 'ada' },
      LastUpdate: '2026-09-19T14:03:27.123456',
      Text: 'Looks fine.',
    };

    expect(describeComment(descriptor)).toEqual({ title: 'Ada Lovelace', subtitle: '2026-09-19 14:03:27' });
  });

  it('falls back to the username or email, then to a placeholder, when no name is set', () => {
    expect(describeComment({ User: { username: 'ada' } }).title).toBe('ada');
    expect(describeComment({ User: { email: 'ada@example.org' } }).title).toBe('ada@example.org');
    expect(describeComment({}).title).toBe('an unknown user');
  });
});


describe('commentDetailLines', () => {
  it('lists the posting time and an excerpt of the text, dropping absent values', () => {
    expect(commentDetailLines({ LastUpdate: '2026-09-19T14:03:27.1', Text: 'Looks fine.' })).toEqual([
      { label: 'Posted', value: '2026-09-19 14:03:27' },
      { label: 'Comment', value: 'Looks fine.' },
    ]);

    expect(commentDetailLines({})).toEqual([]);
  });
});
