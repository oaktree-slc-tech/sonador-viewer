// Unit tests for the study/series metadata cache eviction (ohif-viewers#127).
//
// Two bugs live behind this module, and both were "the refetch ran but returned pre-change data":
//
//   - after a successful series DELETE the drawer still showed the deleted series, and clicking it
//     404'd;
//   - after saving an SR document from the viewer tab, the study list's Refresh never surfaced the
//     new series until a full page reload.
//
// Both are `retrieveStudyMetadata`'s module-level promise Map, which react-query cannot see. These
// tests pin which caches each entry point drops, and — just as important — which it leaves alone.

const mockDeleteStudyMetadataPromise = jest.fn();
const mockPurgeStudyMetadataPromises = jest.fn();
const mockManagerRemove = jest.fn();
const mockManagerPurge = jest.fn();
const mockDeleteDisplaySet = jest.fn();
const mockGetDisplaySetsBy = jest.fn(() => []);
const mockGetDisplaySetsForStudy = jest.fn(() => []);

jest.mock('@ohif/core', () => ({
  display: {
    DisplaySetApi: {
      Instance: {
        displaySetService: {
          getDisplaySetsBy: (...args) => mockGetDisplaySetsBy(...args),
          getDisplaySetsForStudy: (...args) => mockGetDisplaySetsForStudy(...args),
          deleteDisplaySet: (...args) => mockDeleteDisplaySet(...args),
        },
      },
    },
  },
  studies: {
    deleteStudyMetadataPromise: (...args) => mockDeleteStudyMetadataPromise(...args),
    purgeStudyMetadataPromises: (...args) => mockPurgeStudyMetadataPromises(...args),
  },
  utils: {
    studyMetadataManager: {
      remove: (...args) => mockManagerRemove(...args),
      purge: (...args) => mockManagerPurge(...args),
    },
  },
}));

import { purgeAllStudyMetadata, purgeRemovedResourceMetadata } from './studyMetadataCache';

const STUDY_UID = '1.2.3.4';
const SERIES_UID = '1.2.3.4.5';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetDisplaySetsBy.mockReturnValue([]);
  mockGetDisplaySetsForStudy.mockReturnValue([]);
});


describe('purgeRemovedResourceMetadata — series', () => {
  it('drops the memoised study promise, so the next fetch reaches the server', () => {
    purgeRemovedResourceMetadata({ StudyInstanceUID: STUDY_UID, SeriesInstanceUID: SERIES_UID });

    expect(mockDeleteStudyMetadataPromise).toHaveBeenCalledWith(STUDY_UID);
    expect(mockManagerRemove).toHaveBeenCalledWith(STUDY_UID);
  });

  it('drops only the removed series display sets, not the whole study', () => {
    mockGetDisplaySetsBy.mockReturnValue([{ displaySetInstanceUID: 'ds-1' }]);

    purgeRemovedResourceMetadata({ StudyInstanceUID: STUDY_UID, SeriesInstanceUID: SERIES_UID });

    expect(mockDeleteDisplaySet).toHaveBeenCalledWith('ds-1');
    expect(mockGetDisplaySetsForStudy).not.toHaveBeenCalled();

    // The comparator really does select by series, not by study.
    const comparator = mockGetDisplaySetsBy.mock.calls[0][0];
    expect(comparator({ SeriesInstanceUID: SERIES_UID })).toBe(true);
    expect(comparator({ SeriesInstanceUID: 'other' })).toBe(false);
  });
});


describe('purgeRemovedResourceMetadata — study', () => {
  it('drops every display set under the study', () => {
    mockGetDisplaySetsForStudy.mockReturnValue([
      { displaySetInstanceUID: 'ds-1' },
      { displaySetInstanceUID: 'ds-2' },
    ]);

    purgeRemovedResourceMetadata({ StudyInstanceUID: STUDY_UID });

    expect(mockDeleteDisplaySet).toHaveBeenCalledWith('ds-1');
    expect(mockDeleteDisplaySet).toHaveBeenCalledWith('ds-2');
    expect(mockGetDisplaySetsBy).not.toHaveBeenCalled();
    expect(mockDeleteStudyMetadataPromise).toHaveBeenCalledWith(STUDY_UID);
    expect(mockManagerRemove).toHaveBeenCalledWith(STUDY_UID);
  });

  it('never purges globally — one removal must not blow away every other study', () => {
    purgeRemovedResourceMetadata({ StudyInstanceUID: STUDY_UID });

    expect(mockPurgeStudyMetadataPromises).not.toHaveBeenCalled();
    expect(mockManagerPurge).not.toHaveBeenCalled();
  });
});


describe('purgeAllStudyMetadata — study-list refresh', () => {
  it('drops every memoised study promise and the whole metadata manager', () => {
    purgeAllStudyMetadata();

    expect(mockPurgeStudyMetadataPromises).toHaveBeenCalled();
    expect(mockManagerPurge).toHaveBeenCalled();
  });

  it('leaves display sets alone — nothing was deleted, and an open drawer still renders from them', () => {
    // The removal path drops display sets because the resource is gone. A refresh must not: it
    // would blank out the Metadata panel's lookups until the refetch landed, to fix nothing.
    purgeAllStudyMetadata();

    expect(mockDeleteDisplaySet).not.toHaveBeenCalled();
    expect(mockGetDisplaySetsBy).not.toHaveBeenCalled();
    expect(mockGetDisplaySetsForStudy).not.toHaveBeenCalled();
  });
});
