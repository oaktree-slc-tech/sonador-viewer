// Tests for the mapping between the three sources the About panel reads from and the values it
// reports. Loading and staleness live in `useServerSystemInfo`, which is mocked here and covered
// by its own tests.

const mockState = { activeServer: undefined, appConfig: {}, systemInfo: {} };
const mockSystemInfo = jest.fn();

jest.mock('react-redux', () => ({
  useSelector: (selector) => selector({ servers: { servers: [] } }),
}));

jest.mock('@ohif/core', () => ({
  redux: {
    selectors: {
      activeOhifServer: () => ({ activeServer: mockState.activeServer }),
    },
  },
}));

jest.mock('../context/AppContext', () => ({
  useAppContext: () => ({ appConfig: mockState.appConfig }),
}));

jest.mock('./useServerSystemInfo', () => ({
  __esModule: true,
  default: (server) => {
    mockSystemInfo(server);
    return { sysInfo: undefined, isLoading: false, error: null, ...mockState.systemInfo };
  },
}));

import usePlatformVersions from './usePlatformVersions';

beforeEach(() => {
  jest.clearAllMocks();
  mockState.activeServer = undefined;
  mockState.appConfig = {};
  mockState.systemInfo = {};
  delete global.window;
});


describe('Sonador web application', () => {
  it('reports the URL and API version from the app configuration document', () => {
    mockState.appConfig = { sonadorUrl: 'https://sonador.example.com/', sonadorVersion: '0.4.0' };

    expect(usePlatformVersions()).toMatchObject({
      sonadorUrl: 'https://sonador.example.com/',
      sonadorVersion: '0.4.0',
    });
  });

  it('falls back to the viewer shell host when the configuration omits the URL', () => {
    // The Django viewer shell sets `window.sonador.host` independently of the config document.
    global.window = { sonador: { host: 'https://sonador.example.com/' } };

    expect(usePlatformVersions().sonadorUrl).toBe('https://sonador.example.com/');
  });

  it('reports no API version rather than guessing when the deployment predates the setting', () => {
    expect(usePlatformVersions().sonadorVersion).toBeUndefined();
  });
});


describe('imaging server', () => {
  it('reads Orthanc and cloud plugin versions from the system report', () => {
    mockState.activeServer = { rootUrl: 'https://pacs.example.com' };
    mockState.systemInfo = { sysInfo: { Version: '1.12.4', SonadorVersion: '0.4.1' } };

    expect(usePlatformVersions()).toMatchObject({
      imagingServerUrl: 'https://pacs.example.com',
      imagingServerVersion: '1.12.4',
      cloudPluginVersion: '0.4.1',
    });
  });

  it('asks for the report belonging to the active server', () => {
    mockState.activeServer = { rootUrl: 'https://pacs.example.com' };

    usePlatformVersions();

    expect(mockSystemInfo).toHaveBeenCalledWith(mockState.activeServer);
  });

  it('passes the loading and failure states through to the panel', () => {
    const error = new Error('HTTP 502');
    mockState.activeServer = { rootUrl: 'https://pacs.example.com' };
    mockState.systemInfo = { isLoading: true, error };

    expect(usePlatformVersions()).toMatchObject({ isLoading: true, error });
  });

  it('reports nothing rather than throwing when there is no active server', () => {
    expect(usePlatformVersions()).toMatchObject({
      activeServer: undefined,
      imagingServerUrl: undefined,
      imagingServerVersion: undefined,
      cloudPluginVersion: undefined,
    });
  });
});
