// Unit tests for the study-list Refresh control (ohif-viewers#127 follow-up).
//
// The bug: saving an SR document from the viewer (which opens in its own tab) added a series that
// the study list's Refresh never surfaced. Only a full page reload did — the tell that the
// staleness was module state, not the server. `refreshApp` re-seeded `isForce` for the row query,
// which `searchStudies` honours, but the drawer's series come from `retrieveStudyMetadata`'s
// memoised promise Map, which nothing cleared.

const mockPurgeAll = jest.fn();
const mockInvalidateQueries = jest.fn();
const mockSetState = jest.fn();

const callLog = [];

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: (...args) => {
      callLog.push('invalidate');
      return mockInvalidateQueries(...args);
    },
  }),
}));

jest.mock('../lib/studyMetadataCache', () => ({
  purgeAllStudyMetadata: (...args) => {
    callLog.push('purge');
    return mockPurgeAll(...args);
  },
}));

jest.mock('./useSeriesMetadata', () => ({ SERIES_METADATA_QUERY_KEY: 'seriesMetadata' }));

jest.mock('react', () => ({
  useState: (init) => [typeof init === 'function' ? init() : init, mockSetState],
  useCallback: (fn) => fn,
}));

import useStudyListRefresh from './useStudyListRefresh';

beforeEach(() => {
  callLog.length = 0;
  jest.clearAllMocks();
});


describe('refreshApp', () => {
  it('purges the memoised study metadata, which a plain re-seed never did', () => {
    useStudyListRefresh().refreshApp();

    expect(mockPurgeAll).toHaveBeenCalled();
  });

  it('purges BEFORE invalidating — otherwise the refetch resolves against the same stale promise', () => {
    useStudyListRefresh().refreshApp();

    expect(callLog.indexOf('purge')).toBeGreaterThanOrEqual(0);
    expect(callLog.indexOf('invalidate')).toBeGreaterThan(callLog.indexOf('purge'));
  });

  it('invalidates the drawer queries by namespace, not the entire client', () => {
    // `invalidateQueries()` with no filter would also refetch tags and every comment query.
    useStudyListRefresh().refreshApp();

    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['seriesMetadata'] });
  });

  it('still re-seeds the row query, so QIDO is re-run too', () => {
    useStudyListRefresh().refreshApp();

    expect(mockSetState).toHaveBeenCalled();
  });

  it('exposes a forceRerender seed for useStudies({ isForce })', () => {
    expect(typeof useStudyListRefresh().forceRerender).toBe('number');
  });
});
