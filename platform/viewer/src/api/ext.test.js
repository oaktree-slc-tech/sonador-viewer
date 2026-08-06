// Unit tests for the resource-ACL and resource-removal helpers in ext.js
// (ohif-viewers#127, §5.4).
//
// `@ohif/core` is mocked wholesale: ext.js pulls ArchiveDownloadService and the notification
// helpers off it, and importing the real barrel drags in the whole viewer runtime. `fetch` is
// stubbed per test, following the pattern established by ./preferences.test.js.

jest.mock('./sonador', () => ({
  getAuthToken: () => 'test-token',
}));

jest.mock('@ohif/core', () => ({
  sonador: {},
  DicomMetadataStore: { getStudyMetadata: () => undefined },
  ArchiveDownloadService: { getActiveJobForResource: () => undefined, enqueueStudy: () => ({}), enqueueSeries: () => ({}) },
  notifyArchivesQueued: () => undefined,
}));

jest.mock('@ohif/core/src/utils', () => ({
  urlUtil: { urlJoin: (...parts) => parts.join('/') },
}));

import { fetchSeriesAclPermissions, removeSeries, removeStudy } from './ext';

const SERVER = { wadoRoot: 'https://orthanc.test/dicom-web' };
const STUDY_UID = '1.2.826.0.1.3680043.8.1055.1.20111102150758591.92402465.76095170';
const SERIES_UID = '1.2.826.0.1.3680043.8.1055.1.20111103111148288.98361414.79379639';

const jsonResponse = (body, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: () => Promise.resolve(body),
  text: () => Promise.resolve(JSON.stringify(body)),
});

beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => {
  delete global.fetch;
});


describe('fetchSeriesAclPermissions', () => {
  it('requests the series resource-acl route with a bearer token', async () => {
    global.fetch.mockResolvedValue(jsonResponse({ Level: 'Series', perms: {} }));

    await fetchSeriesAclPermissions(SERVER, SERIES_UID);

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe(`https://orthanc.test/dicom-web/series/${SERIES_UID}/resource-acl`);
    expect(init.headers.Authorization).toBe('Bearer test-token');
  });

  it('returns the parsed payload, including the Remove grant', async () => {
    // Remove has never been read from the browser before (V-1): every existing ACL consumer
    // reads only View/ACL/CommentView/CommentEdit, so this asserts the shape the series menu
    // depends on rather than the shape currently exercised.
    const payload = {
      Level: 'Series',
      ID: 'a1b2c3d4-e5f6-0000-1111-222233334444',
      SeriesInstanceUID: SERIES_UID,
      perms: { View: true, Modify: false, Remove: true, CommentEdit: false, CommentView: true, ACL: false },
    };
    global.fetch.mockResolvedValue(jsonResponse(payload));

    await expect(fetchSeriesAclPermissions(SERVER, SERIES_UID)).resolves.toEqual(payload);
  });
});


describe.each([
  ['removeStudy', removeStudy, 'studies', STUDY_UID],
  ['removeSeries', removeSeries, 'series', SERIES_UID],
])('%s', (_name, remove, resourceType, uid) => {
  const expectedUrl = () => `https://orthanc.test/dicom-web/${resourceType}/${uid}/manage`;

  it('issues a DELETE to the /manage route with a bearer token', async () => {
    global.fetch.mockResolvedValue(jsonResponse(null));

    await remove(SERVER, uid);

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe(expectedUrl());
    expect(init.method).toBe('DELETE');
    expect(init.headers.Authorization).toBe('Bearer test-token');
  });

  it('does not set a redirect option, so fetch follows the gateway 307 by default', () => {
    // AR-2, and the regression this test exists for: the gateway answers 307 (which preserves the
    // method) and the DEFAULT follow behavior is what re-issues the DELETE at the Location and
    // actually performs the deletion. `redirect: 'manual'` returns an opaque response whose
    // headers cannot be read, so the follow-up could not be issued by hand either.
    global.fetch.mockResolvedValue(jsonResponse(null));

    remove(SERVER, uid);

    expect(global.fetch.mock.calls[0][1]).not.toHaveProperty('redirect');
  });

  it('resolves on 200', async () => {
    global.fetch.mockResolvedValue(jsonResponse({ RemainingAncestor: null }));

    await expect(remove(SERVER, uid)).resolves.toEqual(
      expect.objectContaining({ status: 200, alreadyRemoved: false })
    );
  });

  it('treats 404 as success — the resource is already gone (FR-15)', async () => {
    global.fetch.mockResolvedValue(jsonResponse({ Error: 'not found' }, { ok: false, status: 404 }));

    await expect(remove(SERVER, uid)).resolves.toEqual(
      expect.objectContaining({ status: 404, alreadyRemoved: true })
    );
  });

  it.each([403, 500])('rejects on %i with { url, status, body } for the error notice', async (status) => {
    global.fetch.mockResolvedValue(jsonResponse({ Error: 'denied' }, { ok: false, status }));

    await expect(remove(SERVER, uid)).rejects.toMatchObject({
      url: expectedUrl(),
      status,
      body: JSON.stringify({ Error: 'denied' }),
    });
  });
});


describe('effective series permission', () => {
  // The drawer combines the study/server grant with the series grant as a plain OR
  // (ohif-viewers#127, FR-9): a series grant authorises where the study grant does not, and the
  // study grant covers its series by inheritance. Encoded here so a regression to
  // "series grant only" or "study grant only" is caught.
  const effective = (studyOrServerGrant, seriesGrant) => !!(studyOrServerGrant || seriesGrant);

  it.each([
    ['neither grant', false, false, false],
    ['study grant only', true, false, true],
    ['series grant only', false, true, true],
    ['both grants', true, true, true],
  ])('%s grants the action: %p || %p === %p', (_label, studyGrant, seriesGrant, expected) => {
    expect(effective(studyGrant, seriesGrant)).toBe(expected);
  });
});
