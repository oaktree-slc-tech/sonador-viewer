// Unit tests for the comment mutations' wiring: which client each calls, and which react-query
// keys each invalidates on success. The rollup query behind the thumbnail comment counts is keyed
// on the series array, so a per-UID invalidation never matched it; these pin the namespace form.

const mockInvalidateQueries = jest.fn(() => Promise.resolve());
const mockCreateSeriesComment = jest.fn();
const mockCreateStudyComment = jest.fn();
const mockRemoveSeriesComment = jest.fn();
const mockRemoveStudyComment = jest.fn();
const mockUpdateSeriesComment = jest.fn();
const mockUpdateStudyComment = jest.fn();

jest.mock('@tanstack/react-query', () => ({
  useQuery: (options) => options,
  // Returns the options so a test can drive mutationFn/onSuccess directly; no renderer is needed.
  useMutation: (options) => options,
  useQueryClient: () => ({ invalidateQueries: (...args) => mockInvalidateQueries(...args) }),
}));

jest.mock('../../../../../api/ext', () => ({
  createSeriesComment: (...args) => mockCreateSeriesComment(...args),
  createStudyComment: (...args) => mockCreateStudyComment(...args),
  fetchSeriesComments: jest.fn(),
  fetchStudyComments: jest.fn(),
  fetchStudyWorklists: jest.fn(),
  removeSeriesComment: (...args) => mockRemoveSeriesComment(...args),
  removeStudyComment: (...args) => mockRemoveStudyComment(...args),
  updateSeriesComment: (...args) => mockUpdateSeriesComment(...args),
  updateStudyComment: (...args) => mockUpdateStudyComment(...args),
}));

import {
  ALL_SERIES_COMMENTS_QUERY_KEY,
  SERIES_COMMENTS_QUERY_KEY,
  STUDY_COMMENTS_QUERY_KEY,
  useCreateSeriesComment,
  useCreateStudyComment,
  useRemoveSeriesComment,
  useRemoveStudyComment,
  useUpdateSeriesComment,
  useUpdateStudyComment,
} from './logic';

const SERVER = { wadoRoot: 'https://orthanc.test/dicom-web' };
const SERIES = { SeriesInstanceUID: '1.2.826.0.1.3680043.8.1055.1.20111103111148288.98361414.79379639' };
const STUDY_UID = '1.2.826.0.1.3680043.8.1055.1.20111102150758591.92402465.76095170';
const COMMENT_ID = '0f3c5c2e-1d7a-4b9c-9a1e-5d2f6b8c4a10';

const invalidatedKeys = () => mockInvalidateQueries.mock.calls.map(([arg]) => arg.queryKey);

beforeEach(() => {
  jest.clearAllMocks();
});


describe('useRemoveSeriesComment', () => {
  it('removes through the series client and refreshes the series list and the study rollup', async () => {
    const onSuccess = jest.fn();
    const mutation = useRemoveSeriesComment(SERVER, SERIES, onSuccess);

    mutation.mutationFn(COMMENT_ID);
    expect(mockRemoveSeriesComment).toHaveBeenCalledWith(SERVER, SERIES, COMMENT_ID);

    await mutation.onSuccess();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(invalidatedKeys()).toEqual([
      [ALL_SERIES_COMMENTS_QUERY_KEY],
      [SERIES_COMMENTS_QUERY_KEY, SERIES.SeriesInstanceUID],
    ]);
  });

  it('tolerates a missing success callback', async () => {
    await expect(useRemoveSeriesComment(SERVER, SERIES).onSuccess()).resolves.toBeUndefined();
  });
});


describe('useRemoveStudyComment', () => {
  it('removes through the study client and refreshes the study list', async () => {
    const mutation = useRemoveStudyComment(SERVER, STUDY_UID);

    mutation.mutationFn(COMMENT_ID);
    expect(mockRemoveStudyComment).toHaveBeenCalledWith(SERVER, STUDY_UID, COMMENT_ID);

    await mutation.onSuccess();
    expect(invalidatedKeys()).toEqual([[STUDY_COMMENTS_QUERY_KEY, STUDY_UID]]);
  });
});


describe('create mutations', () => {
  it('a new series comment refreshes the rollup by namespace, not by series UID', async () => {
    await useCreateSeriesComment(SERVER, SERIES).onSuccess();

    expect(invalidatedKeys()).toEqual([
      [ALL_SERIES_COMMENTS_QUERY_KEY],
      [SERIES_COMMENTS_QUERY_KEY, SERIES.SeriesInstanceUID],
    ]);
  });

  it('a new study comment refreshes the study list', async () => {
    await useCreateStudyComment(SERVER, STUDY_UID).onSuccess();

    expect(invalidatedKeys()).toEqual([[STUDY_COMMENTS_QUERY_KEY, STUDY_UID]]);
  });
});


describe('update mutations', () => {
  it('a series comment edit goes through the series client and refreshes list and rollup', async () => {
    const mutation = useUpdateSeriesComment(SERVER, SERIES);

    mutation.mutationFn({ commentId: COMMENT_ID, text: 'Revised.' });
    expect(mockUpdateSeriesComment).toHaveBeenCalledWith(SERVER, SERIES, COMMENT_ID, 'Revised.');

    await mutation.onSuccess();
    expect(invalidatedKeys()).toEqual([
      [ALL_SERIES_COMMENTS_QUERY_KEY],
      [SERIES_COMMENTS_QUERY_KEY, SERIES.SeriesInstanceUID],
    ]);
  });

  it('a study comment edit goes through the study client and refreshes the study list', async () => {
    const onSuccess = jest.fn();
    const mutation = useUpdateStudyComment(SERVER, STUDY_UID, onSuccess);

    mutation.mutationFn({ commentId: COMMENT_ID, text: 'Revised.' });
    expect(mockUpdateStudyComment).toHaveBeenCalledWith(SERVER, STUDY_UID, COMMENT_ID, 'Revised.');

    await mutation.onSuccess();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(invalidatedKeys()).toEqual([[STUDY_COMMENTS_QUERY_KEY, STUDY_UID]]);
  });
});
