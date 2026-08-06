// Regression tests for the cache eviction that follows a successful removal (ohif-viewers#127).
//
// The bug these exist for: invalidating the react-query key alone left the drawer showing a series
// that had just been deleted. `retrieveStudyMetadata` memoises its promise per StudyInstanceUID in
// a module-level Map and `loadStudies` does not pass `force_fetch`, so the refetch was handed the
// PRE-DELETE promise and rebuilt the identical thumbnail rail. Clicking the ghost series then fired
// thumbnail and comment requests that 404'd.
//
// What the eviction itself does is covered in lib/studyMetadataCache.test.js. These assert the
// wiring: that removal calls it, that it runs BEFORE the invalidation that triggers the refetch,
// and that it does not run when the delete failed.

const mockPurgeRemoved = jest.fn();
const mockInvalidateQueries = jest.fn(() => Promise.resolve());
const mockShow = jest.fn();
const mockRemoveStudy = jest.fn();
const mockRemoveSeries = jest.fn();

// Call order across the module boundary, so "evicted before invalidated" is checkable.
const callLog = [];

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: (...args) => {
      callLog.push('invalidate');
      return mockInvalidateQueries(...args);
    },
  }),
}));

jest.mock('@ohif/core', () => ({
  LocalCacheService: { isStudyCachedSync: () => false, removeStudy: jest.fn() },
  DownloadManagerService: { cancelStudy: jest.fn() },
  uiNotificationService: { show: (...args) => mockShow(...args) },
}));

jest.mock('../../../../lib/studyMetadataCache', () => ({
  purgeRemovedResourceMetadata: (...args) => {
    callLog.push('purge');
    return mockPurgeRemoved(...args);
  },
}));

jest.mock('../../../../hooks/useSeriesMetadata', () => ({
  SERIES_METADATA_QUERY_KEY: 'seriesMetadata',
}));

jest.mock('../../../../api/ext', () => ({
  removeStudy: (...args) => mockRemoveStudy(...args),
  removeSeries: (...args) => mockRemoveSeries(...args),
}));

jest.mock('../../../../hooks/useStudies', () => ({ STUDY_LIST_QUERY_KEY: 'studyList' }));

// The hook only uses useState/useCallback/useQueryClient, none of which need a renderer here --
// invoking it directly under a stubbed React is enough to exercise the removal logic.
jest.mock('react', () => ({
  useState: (initial) => [initial, jest.fn()],
  useCallback: (fn) => fn,
}));

import useRemoveResource from './useRemoveResource';

const SERVER = { wadoRoot: 'https://orthanc.test/dicom-web' };
const STUDY_UID = '1.2.3.4';
const SERIES_UID = '1.2.3.4.5';

beforeEach(() => {
  callLog.length = 0;
  jest.clearAllMocks();
});


describe('series removal', () => {
  it('evicts the cached metadata for the removed series', async () => {
    mockRemoveSeries.mockResolvedValue({ status: 200 });

    const { removeSeriesResource } = useRemoveResource();
    await removeSeriesResource(SERVER, {
      StudyInstanceUID: STUDY_UID,
      SeriesInstanceUID: SERIES_UID,
      SeriesNumber: 2,
      SeriesDescription: 'AXIAL',
    });

    expect(mockPurgeRemoved).toHaveBeenCalledWith({
      StudyInstanceUID: STUDY_UID,
      SeriesInstanceUID: SERIES_UID,
    });
  });

  it('evicts BEFORE invalidating — the other order rebuilds the rail from the stale promise', async () => {
    mockRemoveSeries.mockResolvedValue({ status: 200 });

    const { removeSeriesResource } = useRemoveResource();
    await removeSeriesResource(SERVER, {
      StudyInstanceUID: STUDY_UID,
      SeriesInstanceUID: SERIES_UID,
    });

    expect(callLog.indexOf('purge')).toBeGreaterThanOrEqual(0);
    expect(callLog.indexOf('invalidate')).toBeGreaterThan(callLog.indexOf('purge'));
  });

  it('invalidates the namespaced series-metadata key, so an open drawer refetches', async () => {
    mockRemoveSeries.mockResolvedValue({ status: 200 });

    const { removeSeriesResource } = useRemoveResource();
    await removeSeriesResource(SERVER, {
      StudyInstanceUID: STUDY_UID,
      SeriesInstanceUID: SERIES_UID,
    });

    const keys = mockInvalidateQueries.mock.calls.map(([arg]) => arg.queryKey);
    expect(keys).toContainEqual(['seriesMetadata', JSON.stringify(SERVER), STUDY_UID]);
    // The study list too: removing the last series of a study prunes the study.
    expect(keys).toContainEqual(['studyList']);
  });

  it('does not evict when the delete failed — the resource is still there', async () => {
    mockRemoveSeries.mockRejectedValue(Object.assign(new Error('denied'), { status: 403 }));

    const { removeSeriesResource } = useRemoveResource();
    const ok = await removeSeriesResource(SERVER, {
      StudyInstanceUID: STUDY_UID,
      SeriesInstanceUID: SERIES_UID,
    });

    expect(ok).toBe(false);
    expect(mockPurgeRemoved).not.toHaveBeenCalled();
  });
});


describe('study removal', () => {
  it('evicts the whole study, with no series scoping', async () => {
    mockRemoveStudy.mockResolvedValue({ status: 200 });

    const { removeStudyResource } = useRemoveResource();
    await removeStudyResource(SERVER, { StudyInstanceUID: STUDY_UID, PatientName: 'DOE^JANE' });

    expect(mockPurgeRemoved).toHaveBeenCalledWith({ StudyInstanceUID: STUDY_UID });
  });

  it('does not evict when the delete failed', async () => {
    mockRemoveStudy.mockRejectedValue(Object.assign(new Error('denied'), { status: 403 }));

    const { removeStudyResource } = useRemoveResource();
    const ok = await removeStudyResource(SERVER, { StudyInstanceUID: STUDY_UID });

    expect(ok).toBe(false);
    expect(mockPurgeRemoved).not.toHaveBeenCalled();
  });
});


describe('bulk removal', () => {
  // The study list was crashing when a refetch landed while the server was still cascading N
  // deletes. The toolbar now owns the timing, so the hook must not refresh behind its back.
  const DESCRIPTORS = [
    { StudyInstanceUID: '1.1' },
    { StudyInstanceUID: '1.2' },
    { StudyInstanceUID: '1.3' },
  ];

  it('refreshes the study list itself by default', async () => {
    mockRemoveStudy.mockResolvedValue({ status: 200 });

    const { removeStudiesResource } = useRemoveResource();
    await removeStudiesResource(SERVER, DESCRIPTORS);

    const keys = mockInvalidateQueries.mock.calls.map(([arg]) => arg.queryKey);
    expect(keys).toContainEqual(['studyList']);
  });

  it('issues NO invalidation when the caller defers the refresh', async () => {
    mockRemoveStudy.mockResolvedValue({ status: 200 });

    const { removeStudiesResource } = useRemoveResource();
    await removeStudiesResource(SERVER, DESCRIPTORS, { deferRefresh: true });

    expect(mockInvalidateQueries).not.toHaveBeenCalled();
  });

  it('still deletes and evicts every study when deferring — only the refetch is held', async () => {
    mockRemoveStudy.mockResolvedValue({ status: 200 });

    const { removeStudiesResource } = useRemoveResource();
    await removeStudiesResource(SERVER, DESCRIPTORS, { deferRefresh: true });

    expect(mockRemoveStudy).toHaveBeenCalledTimes(3);
    expect(mockPurgeRemoved).toHaveBeenCalledTimes(3);
  });

  it('returns both counts so the caller can report and time the rest', async () => {
    mockRemoveStudy
      .mockResolvedValueOnce({ status: 200 })
      .mockRejectedValueOnce(Object.assign(new Error('denied'), { status: 403 }))
      .mockResolvedValueOnce({ status: 200 });

    const { removeStudiesResource } = useRemoveResource();
    const outcome = await removeStudiesResource(SERVER, DESCRIPTORS, { deferRefresh: true });

    expect(outcome).toEqual({ removed: 2, total: 3 });
  });

  it('commits the successes on a partial failure rather than rolling back', async () => {
    mockRemoveStudy
      .mockResolvedValueOnce({ status: 200 })
      .mockRejectedValueOnce(Object.assign(new Error('denied'), { status: 403 }))
      .mockResolvedValueOnce({ status: 200 });

    const { removeStudiesResource } = useRemoveResource();
    await removeStudiesResource(SERVER, DESCRIPTORS, { deferRefresh: true });

    // Two purges, not three: the study that 403'd is still on the server.
    expect(mockPurgeRemoved).toHaveBeenCalledTimes(2);
  });

  it('exposes refreshStudyList so a deferring caller can run it later', async () => {
    const { refreshStudyList } = useRemoveResource();

    await refreshStudyList();

    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['studyList'] });
  });
});
