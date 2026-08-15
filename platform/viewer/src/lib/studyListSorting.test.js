// Unit tests for study-list sort resolution (ohif-viewers#96).
//
// Sorting is applied by the imaging server, so a column is only sortable when its id names a field
// the study cache can order on. Getting that wrong is not a cosmetic problem: a header the server
// holds no field for is rejected outright, so the table would offer a control that returns an
// error instead of a sorted page.

import { getOrderByParam, getSortField, isSortableColumn } from './studyListSorting';

describe('getSortField', () => {
  it('orders DICOM tag columns by their own header', () => {
    expect(getSortField('PatientName')).toBe('PatientName');
    expect(getSortField('StudyDate')).toBe('StudyDate');
    expect(getSortField('AccessionNumber')).toBe('AccessionNumber');
  });

  it('maps columns the API names differently', () => {
    // The worklist's MRN column carries PatientID, and modalities are ordered on the list
    // aggregated onto the study row
    expect(getSortField('mrn')).toBe('PatientID');
    expect(getSortField('modalities')).toBe('ModalitiesInStudy');
  });

  it('sorts a worklist item by its state', () => {
    expect(getSortField('Status')).toBe('Status');
  });

  it('returns null for columns with no orderable field', () => {
    // Assigned user and group are account/group IDs resolved to names outside the imaging cache
    expect(getSortField('AssignedUser')).toBeNull();
    expect(getSortField('GroupName')).toBeNull();
    expect(getSortField('ReasonForReview')).toBeNull();
    expect(getSortField('RequestedProcedure')).toBeNull();
    expect(getSortField('series')).toBeNull();
  });

  it('returns null when no column is given', () => {
    expect(getSortField(null)).toBeNull();
    expect(getSortField(undefined)).toBeNull();
    expect(getSortField('')).toBeNull();
  });
});

describe('isSortableColumn', () => {
  it('reports which columns offer a sort control', () => {
    expect(isSortableColumn('PatientName')).toBe(true);
    expect(isSortableColumn('mrn')).toBe(true);
    expect(isSortableColumn('AssignedUser')).toBe(false);
  });
});

describe('getOrderByParam', () => {
  it('prefixes descending sorts with a hyphen', () => {
    expect(getOrderByParam({ fieldName: 'StudyDate', direction: 'asc' })).toBe('StudyDate');
    expect(getOrderByParam({ fieldName: 'StudyDate', direction: 'desc' })).toBe('-StudyDate');
  });

  it('applies the column mapping to the ordered field', () => {
    expect(getOrderByParam({ fieldName: 'mrn', direction: 'desc' })).toBe('-PatientID');
  });

  it('is null when the list carries no sort', () => {
    // Cleared sort: the query drops OrderBy entirely rather than sending an empty one
    expect(getOrderByParam({ fieldName: null, direction: null })).toBeNull();
    expect(getOrderByParam(undefined)).toBeNull();
  });

  it('is null for a column the server cannot order on', () => {
    expect(getOrderByParam({ fieldName: 'AssignedUser', direction: 'asc' })).toBeNull();
  });
});
