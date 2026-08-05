// Unit tests for the study/series label used in user-facing notifications (ohif-viewers#84).
//
// The interesting cases are all "what does the user see when the metadata is incomplete", because
// study-list rows, viewport data, and download jobs each carry a different subset of these fields
// and a notification must stay readable with any of them.

import {
  describeStudy,
  describeSeries,
  describeStudyFilename,
  describeSeriesFilename,
} from './describeStudy';

describe('describeStudy', () => {
  it('composes patient, description, date, and accession', () => {
    expect(
      describeStudy({
        PatientName: [{ Alphabetic: 'Doe^Jane' }],
        PatientID: 'MRN0042',
        StudyDescription: 'CT CHEST',
        StudyDate: '20260314',
        AccessionNumber: 'A99813',
        StudyInstanceUID: '1.2.3',
      })
    ).toBe('Doe, Jane (MRN0042) · CT CHEST · Mar 14, 2026 · Accession A99813');
  });

  it('stands the modality in for a study with no description', () => {
    expect(describeStudy({ PatientID: 'MRN0042', modalities: 'CT/SR' })).toBe('MRN0042 · CT/SR');
    expect(describeStudy({ PatientID: 'MRN0042', ModalitiesInStudy: ['CT', 'SR'] })).toBe(
      'MRN0042 · CT/SR'
    );
  });

  it('ignores an unparseable study date rather than emitting "Invalid date"', () => {
    expect(describeStudy({ PatientID: 'MRN0042', StudyDate: 'not-a-date' })).toBe('MRN0042');
  });

  it('accepts a person name as a plain string or a bare Alphabetic object', () => {
    expect(describeStudy({ PatientName: 'Doe^Jane' })).toBe('Doe, Jane');
    expect(describeStudy({ PatientName: { Alphabetic: 'Doe^Jane' } })).toBe('Doe, Jane');
  });

  it('drops absent fields along with their separators', () => {
    expect(describeStudy({ PatientID: 'MRN0042', StudyDescription: 'MR BRAIN' })).toBe(
      'MRN0042 · MR BRAIN'
    );
    expect(describeStudy({ PatientName: [{ Alphabetic: 'Doe^Jane' }] })).toBe('Doe, Jane');
  });

  it('falls back to the UID when a row carries no identifying metadata yet', () => {
    expect(describeStudy({ StudyInstanceUID: '1.2.3' })).toBe('Study 1.2.3');
    expect(describeStudy({})).toBe('this study');
    expect(describeStudy()).toBe('this study');
  });
});

describe('describeSeries', () => {
  it('composes patient, series number, description, and modality', () => {
    expect(
      describeSeries({
        PatientName: [{ Alphabetic: 'Doe^Jane' }],
        SeriesNumber: 4,
        SeriesDescription: 'AXIAL 1.25MM',
        Modality: 'CT',
      })
    ).toBe('Doe, Jane · Series 4 · AXIAL 1.25MM · CT');
  });

  it('keeps series 0 rather than dropping it as falsy', () => {
    expect(describeSeries({ SeriesNumber: 0, Modality: 'SR' })).toBe('Series 0 · SR');
  });

  it('falls back to the UID', () => {
    expect(describeSeries({ SeriesInstanceUID: '1.2.3.4' })).toBe('Series 1.2.3.4');
  });
});

describe('filenames', () => {
  it('names a study archive for its patient, description, and date', () => {
    expect(
      describeStudyFilename({
        PatientName: [{ Alphabetic: 'Doe^Jane' }],
        StudyDescription: 'CT CHEST W/CONTRAST',
        StudyDate: '20260314',
        StudyInstanceUID: '1.2.3',
      })
    ).toBe('Doe-Jane_CT-CHEST-W-CONTRAST_20260314.zip');
  });

  it('keeps filesystem-hostile characters out of the name', () => {
    expect(describeStudyFilename({ PatientID: '../../etc/passwd' })).toBe('etc-passwd.zip');
  });

  it('falls back to the UID when the descriptor is empty', () => {
    expect(describeStudyFilename({ StudyInstanceUID: '1.2.3' })).toBe('1.2.3.zip');
    expect(describeSeriesFilename({ SeriesInstanceUID: '1.2.3.4' })).toBe('1.2.3.4.zip');
  });

  it('names a series archive for its number and description', () => {
    expect(
      describeSeriesFilename({
        PatientName: 'Doe^Jane',
        SeriesNumber: 4,
        SeriesDescription: 'AXIAL 1.25MM',
      })
    ).toBe('Doe-Jane_Series-4_AXIAL-1-25MM.zip');
  });
});
