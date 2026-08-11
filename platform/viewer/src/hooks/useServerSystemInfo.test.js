// Tests for the guard that keeps a system report tied to the server it came from.
//
// `reportForServer` is pure, so the case that matters most -- the render between an active server
// changing and the effect reloading for it -- is exercised directly, without needing a renderer.

// The module under test imports @ohif/core, whose built bundle expects a browser global. Only the
// hook uses it; the pure helpers exercised here do not.
jest.mock('@ohif/core', () => ({ sonador: { fetchServerSystemInfo: jest.fn() } }));

import { reportForServer, serverKeyOf } from './useServerSystemInfo';

const ORTHANC_A = { rootUrl: 'https://pacs-a.example.com' };
const ORTHANC_B = { rootUrl: 'https://pacs-b.example.com' };

const reportFor = (server, fields = {}) => ({
  key: serverKeyOf(server),
  sysInfo: undefined,
  isLoading: false,
  error: null,
  ...fields,
});


describe('reportForServer', () => {
  it('returns a report fetched for the server being asked about', () => {
    const sysInfo = { Version: '1.12.4', SonadorVersion: '0.4.1' };

    expect(reportForServer(reportFor(ORTHANC_A, { sysInfo }), ORTHANC_A)).toEqual({
      sysInfo,
      isLoading: false,
      error: null,
    });
  });

  it('never reports one server’s versions against another', () => {
    // The active server changing commits a render before the reloading effect runs. Without this
    // guard that render pairs server B's URL with server A's Orthanc and plugin versions.
    const loaded = reportFor(ORTHANC_A, { sysInfo: { Version: '1.12.4', SonadorVersion: '0.4.1' } });

    expect(reportForServer(loaded, ORTHANC_B)).toEqual({
      sysInfo: undefined,
      isLoading: true,
      error: null,
    });
  });

  it('does not carry a failure across a server change either', () => {
    const failed = reportFor(ORTHANC_A, { error: new Error('HTTP 502') });

    expect(reportForServer(failed, ORTHANC_B)).toEqual({
      sysInfo: undefined,
      isLoading: true,
      error: null,
    });
  });

  it('prefers the copy cached on the server, so a second consumer does not refetch', () => {
    const cached = { Version: '1.12.4', SonadorVersion: '0.4.1' };
    const server = { ...ORTHANC_A, sysInfo: cached };

    expect(reportForServer(reportFor(null), server)).toEqual({
      sysInfo: cached,
      isLoading: false,
      error: null,
    });
  });

  it('reports nothing, and nothing in flight, when there is no active server', () => {
    expect(reportForServer(reportFor(ORTHANC_A, { sysInfo: {} }), undefined)).toEqual({
      sysInfo: undefined,
      isLoading: false,
      error: null,
    });
  });

  it('surfaces a failure for the server it belongs to', () => {
    const error = new Error('HTTP 502');

    expect(reportForServer(reportFor(ORTHANC_A, { error }), ORTHANC_A)).toEqual({
      sysInfo: undefined,
      isLoading: false,
      error,
    });
  });
});


describe('serverKeyOf', () => {
  it('identifies a server by root URL, falling back to its token', () => {
    expect(serverKeyOf(ORTHANC_A)).toBe('https://pacs-a.example.com');
    expect(serverKeyOf({ token: 'orthanc-dev' })).toBe('orthanc-dev');
    expect(serverKeyOf(undefined)).toBeNull();
  });
});
