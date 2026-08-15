// Unit tests for the study-list sort state machine (ohif-viewers#96).
//
// Clicking a header label cycles the column; clicking one of its carets asks for that direction
// outright. The cycle's third state clears the sort so the list returns to its default order,
// which the query paths rely on to drop OrderBy rather than send an empty one.

const mockSetSorting = jest.fn();

let mockSortingState = { fieldName: 'Modified', direction: 'desc' };

jest.mock('react', () => ({
  useState: () => [mockSortingState, mockSetSorting],
}));

jest.mock('react-redux', () => ({
  // No server is active in these tests; the sort machinery does not consult one
  useSelector: () => undefined,
}));

jest.mock('react-router-dom', () => ({
  useLocation: () => ({ search: '' }),
  useNavigate: () => jest.fn(),
}));

jest.mock('@ohif/ui', () => ({
  useDebounce: (value) => value,
}));

import useStudiesTable from './useStudiesTable';

beforeEach(() => {
  mockSetSorting.mockClear();
});

const handleSorting = () => useStudiesTable().handleSorting;

describe('handleSorting: header label', () => {
  it('sorts a new column ascending', () => {
    mockSortingState = { fieldName: 'Modified', direction: 'desc' };
    handleSorting()('PatientName');

    expect(mockSetSorting).toHaveBeenCalledWith({ fieldName: 'PatientName', direction: 'asc' });
  });

  it('turns an ascending column around', () => {
    mockSortingState = { fieldName: 'PatientName', direction: 'asc' };
    handleSorting()('PatientName');

    expect(mockSetSorting).toHaveBeenCalledWith({ fieldName: 'PatientName', direction: 'desc' });
  });

  it('takes the sort off on the third click', () => {
    // Back to the order the list arrived in, which no column header is marked for
    mockSortingState = { fieldName: 'PatientName', direction: 'desc' };
    handleSorting()('PatientName');

    expect(mockSetSorting).toHaveBeenCalledWith({ fieldName: 'Modified', direction: 'desc' });
  });
});

describe('handleSorting: direction carets', () => {
  it('applies the direction asked for regardless of the current sort', () => {
    mockSortingState = { fieldName: 'Modified', direction: 'desc' };
    handleSorting()('PatientName', 'desc');

    // Descending is reached directly: the caret names an order, it does not advance the cycle
    expect(mockSetSorting).toHaveBeenCalledWith({ fieldName: 'PatientName', direction: 'desc' });
  });

  it('takes the sort off when the direction in force is clicked again', () => {
    // The carets toggle: removing a sort must not mean cycling through the opposite direction
    mockSortingState = { fieldName: 'PatientName', direction: 'desc' };
    handleSorting()('PatientName', 'desc');

    expect(mockSetSorting).toHaveBeenCalledWith({ fieldName: 'Modified', direction: 'desc' });
  });

  it('turns a column around when the opposite direction is clicked', () => {
    mockSortingState = { fieldName: 'PatientName', direction: 'asc' };
    handleSorting()('PatientName', 'desc');

    expect(mockSetSorting).toHaveBeenCalledWith({ fieldName: 'PatientName', direction: 'desc' });
  });

  it('does not clear a different column sorted the same way', () => {
    mockSortingState = { fieldName: 'StudyDate', direction: 'desc' };
    handleSorting()('PatientName', 'desc');

    expect(mockSetSorting).toHaveBeenCalledWith({ fieldName: 'PatientName', direction: 'desc' });
  });
});
