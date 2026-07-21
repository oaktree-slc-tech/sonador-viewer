// Unit tests for the user-preferences API helpers (sonador#42 FR-8): non-2xx responses
// reject with the HTTP status attached, and section keys map to the as-built URL slugs
// (`windowLevel` -> `window-level`, `viewerMetadata` -> `viewer-meta`).
//
// The sonador helpers and urlUtil are mocked so the tests exercise only this module's
// fetch handling; `fetch` itself is stubbed per test.

jest.mock('./sonador', () => ({
  getAuthToken: () => 'test-token',
  sonadorUrl: (resource) => new URL(resource, 'https://sonador.test'),
}));

jest.mock('@ohif/core/src/utils', () => ({
  urlUtil: { urlJoin: (...parts) => parts.join('') },
}));

import {
  getUserPreferences,
  getUserPreferenceSection,
  updateUserPreferences,
  updateUserPreferenceSection,
} from './preferences';

const jsonResponse = (body, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: () => Promise.resolve(body),
});

beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => {
  delete global.fetch;
});

describe('section endpoint URLs (slug mapping)', () => {
  it.each([
    ['general', '/visionaire/api/user-preferences/general/'],
    ['hotkeys', '/visionaire/api/user-preferences/hotkeys/'],
    ['windowLevel', '/visionaire/api/user-preferences/window-level/'],
    ['viewerMetadata', '/visionaire/api/user-preferences/viewer-meta/'],
    ['studylist', '/visionaire/api/user-preferences/studylist/'],
  ])('maps section %s to %s', async (section, expectedPath) => {
    global.fetch.mockResolvedValue(jsonResponse({ results: { version: '0.4', values: {} } }));

    await getUserPreferenceSection(section);

    const url = global.fetch.mock.calls[0][0];
    expect(url.pathname).toBe(expectedPath);
  });

  it('rejects unknown sections without issuing a request', () => {
    expect(() => getUserPreferenceSection('bogus')).toThrow('Unknown user-preference section');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('passes the requested version as a query parameter', async () => {
    global.fetch.mockResolvedValue(jsonResponse({ results: { version: '0.3', values: {} } }));

    await getUserPreferenceSection('general', '0.3');

    const url = global.fetch.mock.calls[0][0];
    expect(url.searchParams.get('version')).toBe('0.3');
  });
});

describe('non-2xx rejection with status (FR-8)', () => {
  it.each([
    ['getUserPreferences', () => getUserPreferences()],
    ['updateUserPreferences', () => updateUserPreferences({ viewer: {} })],
    ['getUserPreferenceSection', () => getUserPreferenceSection('general')],
    ['updateUserPreferenceSection', () => updateUserPreferenceSection('general', { version: '0.4', values: {} })],
  ])('%s rejects on HTTP 400 with the status attached', async (label, call) => {
    global.fetch.mockResolvedValue(jsonResponse({ errors: {} }, { ok: false, status: 400 }));

    await expect(call()).rejects.toMatchObject({ status: 400 });
  });

  it('attaches 5xx statuses for queue classification (FR-21)', async () => {
    global.fetch.mockResolvedValue(jsonResponse({}, { ok: false, status: 503 }));

    await expect(
      updateUserPreferenceSection('hotkeys', { version: '0.4', values: {} })
    ).rejects.toMatchObject({ status: 503 });
  });
});

describe('guru results envelope handling', () => {
  it('unwraps the BARE document from the whole-document GET (no results envelope)', async () => {
    // Regression: GET /visionaire/api/user-preferences/ (guru GuruApiDetailsMixin ->
    // model_to_dict) returns the model dict directly -- {user, viewer, studylist} -- NOT
    // wrapped in `results`. Treating the body as an envelope made hydration see an empty
    // document and restore nothing in a clean browser profile.
    const document = {
      user: 2,
      viewer: { '0.4': { general: { language: 'en-US' } } },
      studylist: { '0.4': { worklist: { selectedColumns: ['Status'] } } },
    };
    global.fetch.mockResolvedValue(jsonResponse(document));

    await expect(getUserPreferences()).resolves.toEqual(document);
  });

  it('still unwraps `results` from the whole-document GET if it ever gains the envelope', async () => {
    const document = { viewer: { '0.4': {} }, studylist: null };
    global.fetch.mockResolvedValue(jsonResponse({ results: document }));

    await expect(getUserPreferences()).resolves.toEqual(document);
  });

  it('unwraps `results` from section responses', async () => {
    global.fetch.mockResolvedValue(
      jsonResponse({ results: { version: '0.4', values: { language: 'en-US' } } })
    );

    await expect(getUserPreferenceSection('general')).resolves.toEqual({
      version: '0.4',
      values: { language: 'en-US' },
    });
  });

  it('POSTs the payload with bearer auth', async () => {
    global.fetch.mockResolvedValue(jsonResponse({ results: { version: '0.4', values: {} } }));

    await updateUserPreferenceSection('windowLevel', { version: '0.4', values: {} });

    const [, options] = global.fetch.mock.calls[0];
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer test-token');
    expect(JSON.parse(options.body)).toEqual({ version: '0.4', values: {} });
  });
});
