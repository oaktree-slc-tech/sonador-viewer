// Unit tests for the shared resource-ACL request de-duplication (ohif-viewers#127 follow-up).
//
// The viewer renders one series-actions menu per thumbnail, so without sharing, mounting a
// twelve-series sidepanel would fire twelve identical study `resource-acl` requests. These pin the
// sharing and the key scoping, and the OR rule the menus gate on.

const mockFetchStudy = jest.fn();
const mockFetchSeries = jest.fn();

jest.mock('../api/ext', () => ({
  fetchStudyAclPermissions: (...args) => mockFetchStudy(...args),
  fetchSeriesAclPermissions: (...args) => mockFetchSeries(...args),
}));

jest.mock('@ohif/core', () => ({
  DicomMetadataStore: {
    getStudyMetadata: () => undefined,
    updateStudyMetadata: jest.fn(),
  },
}));

jest.mock('react', () => ({
  useState: (init) => [typeof init === 'function' ? init() : init, jest.fn()],
  useEffect: jest.fn(),
  useCallback: (fn) => fn,
  useRef: (init) => ({ current: init }),
}));

import useResourceAclPermissions, { __inFlightForTests } from './useResourceAclPermissions';

const SERVER = { wadoRoot: 'https://orthanc.test/dicom-web', perms: {} };
const STUDY_UID = '1.2.3.4';
const SERIES_UID = '1.2.3.4.5';

beforeEach(() => {
  jest.clearAllMocks();
  __inFlightForTests.clear();
});


describe('effective permissions', () => {
  it.each([
    ['no grant anywhere', {}, false, false],
    ['server wildcard view', { view: true }, true, false],
    ['server wildcard remove', { remove: true }, false, true],
    ['both server grants', { view: true, remove: true }, true, true],
  ])('%s', (_label, perms, expectView, expectRemove) => {
    const { aclView, aclRemove } = useResourceAclPermissions({
      server: { ...SERVER, perms },
      StudyInstanceUID: STUDY_UID,
      SeriesInstanceUID: SERIES_UID,
    });

    expect(aclView).toBe(expectView);
    expect(aclRemove).toBe(expectRemove);
  });
});


describe('series ACL request sharing', () => {
  it('issues ONE request for concurrent callers on the same series', async () => {
    mockFetchSeries.mockResolvedValue({ perms: { View: true } });

    const a = useResourceAclPermissions({ server: SERVER, StudyInstanceUID: STUDY_UID, SeriesInstanceUID: SERIES_UID });
    const b = useResourceAclPermissions({ server: SERVER, StudyInstanceUID: STUDY_UID, SeriesInstanceUID: SERIES_UID });

    a.resolveSeriesAcl();
    b.resolveSeriesAcl();

    expect(mockFetchSeries).toHaveBeenCalledTimes(1);
  });

  it('does not share across servers — one server must not answer for another', async () => {
    mockFetchSeries.mockResolvedValue({ perms: {} });

    useResourceAclPermissions({ server: SERVER, StudyInstanceUID: STUDY_UID, SeriesInstanceUID: SERIES_UID })
      .resolveSeriesAcl();
    useResourceAclPermissions({
      server: { wadoRoot: 'https://other.test/dicom-web', perms: {} },
      StudyInstanceUID: STUDY_UID,
      SeriesInstanceUID: SERIES_UID,
    }).resolveSeriesAcl();

    expect(mockFetchSeries).toHaveBeenCalledTimes(2);
  });

  it('releases the shared entry once settled, so a later menu open can retry', async () => {
    mockFetchSeries.mockResolvedValue({ perms: {} });

    useResourceAclPermissions({ server: SERVER, StudyInstanceUID: STUDY_UID, SeriesInstanceUID: SERIES_UID })
      .resolveSeriesAcl();

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(__inFlightForTests.size).toBe(0);
  });

  it('a failed lookup grants nothing rather than rejecting into the caller', async () => {
    mockFetchSeries.mockRejectedValue(new Error('403'));

    const { resolveSeriesAcl } = useResourceAclPermissions({
      server: SERVER, StudyInstanceUID: STUDY_UID, SeriesInstanceUID: SERIES_UID,
    });

    expect(() => resolveSeriesAcl()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
});
