// Regression tests for the worklist StudyInstanceUID resolver (ohif-viewers#127 follow-up).
//
// `_getStudyInstanceUID` runs during RENDER, once per row. On the worklist path it looks the study
// up in DicomMetadataStore and used to dereference the result unguarded. A worklist row can
// outlive its study in the store — most sharply right after a bulk removal, where the rows are
// still in the table until the query refetches but the studies are gone — so the lookup returned
// undefined and the dereference threw a TypeError mid-render, taking the whole study list down.

const mockFindStudy = jest.fn();

jest.mock('@ohif/core', () => ({
  DicomMetadataStore: {
    findStudy: (...args) => mockFindStudy(...args),
  },
}));

const { _getStudyInstanceUID } = require('./studyRowDescriptors');

beforeEach(() => {
  jest.clearAllMocks();
});


describe('_getStudyInstanceUID', () => {
  it('returns the row id directly off the worklist path', () => {
    expect(_getStudyInstanceUID({ row: { id: '1.2.3' }, worklist: false })).toBe('1.2.3');
    expect(mockFindStudy).not.toHaveBeenCalled();
  });

  it('resolves through the store on the worklist path', () => {
    mockFindStudy.mockReturnValue({ StudyInstanceUID: '1.2.3' });

    expect(_getStudyInstanceUID({ row: { id: 'wl-1' }, worklist: true })).toBe('1.2.3');
  });

  it('returns undefined instead of throwing when the study is gone', () => {
    // The removal case. Callers already treat a missing UID as "skip this row"; throwing here
    // unmounts the study list.
    mockFindStudy.mockReturnValue(undefined);

    expect(() => _getStudyInstanceUID({ row: { id: 'wl-1' }, worklist: true })).not.toThrow();
    expect(_getStudyInstanceUID({ row: { id: 'wl-1' }, worklist: true })).toBeUndefined();
  });
});
