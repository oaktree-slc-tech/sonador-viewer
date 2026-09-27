// A general-section write made on the user's behalf (a dialog's "don't ask again") against
// startup hydration and the write queue: it must never replace the user's stored or queued
// settings with anything older. The production initializer, service, composer and write queue
// run together; the transport, runtime holders and browser globals are stubbed.

import { LOCKED_MODELS_WARNING_PREFERENCE_KEY as WARN } from '@ohif/core';

jest.mock('@ohif/i18n', () => ({ language: 'en-US', changeLanguage: jest.fn(function (l) { this.language = l; }) }));
jest.mock('@ohif/core', () => {
  const service = jest.requireActual('../../../core/src/services/UserPreferencesService/UserPreferencesService');
  return {
    redux: { actions: { setUserPreferences: (s) => ({ type: 'SET_USER_PREFERENCES', state: s }) } },
    DownloadManagerService: {
      archive: false, retry: 3,
      applyHydratedArchiveTransfer(v) { this.archive = v; },
      applyHydratedRetryAttempts(v) { this.retry = v; },
      isArchiveTransferEnabled() { return this.archive; },
      getRetryAttempts() { return this.retry; },
    },
    RETRY_ATTEMPTS_DEFAULT: 3,
    UserPreferencesService: service.default,
    LOCKED_MODELS_WARNING_PREFERENCE_KEY: service.LOCKED_MODELS_WARNING_PREFERENCE_KEY,
  };
});
jest.mock('../api/preferences', () => ({
  getUserPreferences: jest.fn(),
  getUserPreferenceSection: jest.fn(),
  updateUserPreferenceSection: jest.fn(),
}));
jest.mock('@ohif/core/src/services/UINotificationService', () => ({
  uiNotificationService: { show: jest.fn(), hide: jest.fn() },
}));
jest.mock('./studylistPreferenceSync', () => ({
  setStudylistSyncHydrating: () => {},
  startStudylistPreferenceSync: () => {},
}));
jest.mock('../store/useStudiesTableFiltersAndColumnsStore', () => ({
  useStudiesTableFiltersAndColumnsStore: { setState: () => {} },
}));
jest.mock('../store/useViewerMetadataSettingsStore', () => ({
  useViewerMetadataSettingsStore: { getState: () => ({}) },
}));

// Node jest environment: the queue reads localStorage and the OIDC identity off window.store, and
// PubSubService mirrors events onto document.body
const storageShim = () => {
  let data = {};
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: (key) => { delete data[key]; },
    clear: () => { data = {}; },
  };
};
global.localStorage = storageShim();
global.window = global.window || {};
global.window.addEventListener = () => {};
global.window.removeEventListener = () => {};
global.window.store = { getState: () => ({ oidc: { user: { profile: { preferred_username: 'user-1' } } } }) };
global.CustomEvent = global.CustomEvent || class CustomEvent {
  constructor(type, params = {}) { this.type = type; this.detail = params.detail; }
};
global.document = global.document || { body: { dispatchEvent: () => {} } };

const { UserPreferencesService, DownloadManagerService: mockDownloads } = require('@ohif/core');
const api = require('../api/preferences');
const { WRITE_QUEUE_STORAGE_KEY } = require('../constants/preferences');
const { stopPreferenceWriteQueue } = require('./preferenceWriteQueue');
const { initUserPreferences, resetUserPreferencesInitForTests } = require('../init/initUserPreferences');
const { persistGeneralPreferences } = require('./generalPreferences');

const SERVER = { language: 'en-US', offlineArchiveTransfer: false, offlineRetryAttempts: 3 };
const STORED = { language: 'de-DE', offlineArchiveTransfer: true, offlineRetryAttempts: 5 };
const documentWith = (general) => ({ viewer: { '0.4': { general: { ...general } } }, studylist: {} });

const httpError = (status) => { const e = new Error(`HTTP ${status}`); e.status = status; return e; };
const deferred = () => {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));
const readQueue = () => JSON.parse(global.localStorage.getItem(WRITE_QUEUE_STORAGE_KEY) || '[]');
const seedQueuedGeneral = (values) => global.localStorage.setItem(WRITE_QUEUE_STORAGE_KEY, JSON.stringify([{
  key: 'general', user: 'user-1', section: 'general', payload: { version: '0.4', values },
  queuedAt: new Date().toISOString(), attempts: 1, seq: 1,
}]));
const posts = () => api.updateUserPreferenceSection.mock.calls.map(([section, payload]) => ({ section, payload }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  global.localStorage.clear();
  resetUserPreferencesInitForTests();
  mockDownloads.archive = false;
  mockDownloads.retry = 3;
  api.updateUserPreferenceSection.mockResolvedValue({});
  // A fresh service per test: hydration state and the user's choices are per session
  UserPreferencesService._general = { ...UserPreferencesService.GENERAL_DEFAULTS };
  UserPreferencesService._userSet.clear();
  UserPreferencesService.setPersistence(null);
});

afterEach(() => {
  stopPreferenceWriteQueue();
  jest.restoreAllMocks();
});

describe('persisting a choice made before hydration lands', () => {
  it('waits for the startup GET and then keeps the other stored settings', async () => {
    const get = deferred();
    api.getUserPreferences.mockReturnValue(get.promise);
    const init = initUserPreferences();

    // The user answers the dialog while the GET is still in flight: the choice applies at once
    const write = UserPreferencesService.setGeneral(WARN, false);
    await flush();
    expect(UserPreferencesService.getGeneral(WARN)).toBe(false);
    expect(api.updateUserPreferenceSection).not.toHaveBeenCalled();

    get.resolve(documentWith(STORED));
    await init;
    await write;

    expect(posts()).toEqual([{ section: 'general', payload: { version: '0.4', values: { ...STORED, [WARN]: false } } }]);
    // The GET landing afterwards did not reinstate the warning
    expect(UserPreferencesService.getGeneral(WARN)).toBe(false);
  });

  it('reads the stored section first when the startup GET failed', async () => {
    api.getUserPreferences.mockRejectedValue(new Error('offline'));
    api.getUserPreferenceSection.mockResolvedValue({ version: '0.4', values: { ...STORED } });
    await initUserPreferences();

    await UserPreferencesService.setGeneral(WARN, false);

    expect(api.getUserPreferenceSection).toHaveBeenCalledWith('general', '0.4');
    expect(posts()[0].payload.values).toEqual({ ...STORED, [WARN]: false });
  });

  it('writes nothing when neither the document nor the section can be read', async () => {
    api.getUserPreferences.mockRejectedValue(new Error('offline'));
    api.getUserPreferenceSection.mockRejectedValue(new Error('still offline'));
    await initUserPreferences();

    await UserPreferencesService.setGeneral(WARN, false);

    expect(api.updateUserPreferenceSection).not.toHaveBeenCalled();
    expect(readQueue()).toEqual([]);
    expect(UserPreferencesService.getGeneral(WARN)).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('applies for this session'), expect.any(Error));
  });

  it('composes from the hydrated holders once hydration has landed', async () => {
    api.getUserPreferences.mockResolvedValue(documentWith(STORED));
    await initUserPreferences();

    await UserPreferencesService.setGeneral(WARN, false);

    expect(api.getUserPreferenceSection).not.toHaveBeenCalled();
    expect(posts()[0].payload.values).toEqual({ ...STORED, [WARN]: false });
  });

  it('does not wait when hydration was never started', async () => {
    api.getUserPreferenceSection.mockResolvedValue({ version: '0.4', values: {} });

    await persistGeneralPreferences();

    expect(posts()).toHaveLength(1);
  });
});

describe('a general write still queued from an earlier save', () => {
  // The queued payload is newer than the server (FR-20). Startup replay fails, so hydration
  // leaves the section alone; the choice must be amended onto the queued values, never onto the
  // older server section, whether this write succeeds (which dequeues the earlier one) or fails
  // retryably (which coalesces over it).
  const queuedStartup = () => {
    seedQueuedGeneral(STORED);
    api.updateUserPreferenceSection.mockRejectedValueOnce(httpError(503)); // the startup replay
    api.getUserPreferences.mockResolvedValue(documentWith(SERVER));
    api.getUserPreferenceSection.mockResolvedValue({ version: '0.4', values: { ...SERVER } });
  };

  it('keeps the queued settings when the amended write succeeds', async () => {
    queuedStartup();
    await initUserPreferences();
    expect(readQueue()).toHaveLength(1);

    const result = await UserPreferencesService.setGeneral(WARN, false);

    expect(api.getUserPreferenceSection).not.toHaveBeenCalled();
    expect(posts().slice(-1)[0].payload.values).toEqual({ ...STORED, [WARN]: false });
    // The earlier entry was superseded by a write that carried its values
    expect(readQueue()).toEqual([]);
    expect(result).toEqual({ outcome: 'saved', results: {} });
  });

  it('keeps the queued settings in the coalesced entry when the amended write fails retryably', async () => {
    queuedStartup();
    await initUserPreferences();
    api.updateUserPreferenceSection.mockRejectedValueOnce(httpError(503)); // the amended write

    await UserPreferencesService.setGeneral(WARN, false);

    const queue = readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].payload.values).toEqual({ ...STORED, [WARN]: false });
  });

  it('is written after a startup replay still in flight, so the replay cannot overwrite it', async () => {
    seedQueuedGeneral(STORED);
    const replay = deferred();
    api.updateUserPreferenceSection.mockReturnValueOnce(replay.promise).mockResolvedValue({});
    api.getUserPreferences.mockResolvedValue(documentWith(STORED));
    const init = initUserPreferences();
    await flush();
    expect(posts()).toHaveLength(1);

    // The user answers the dialog while the replay is still in flight
    const write = UserPreferencesService.setGeneral(WARN, false);
    await flush();
    expect(posts()).toHaveLength(1);

    // Whichever order the server sees them in, the amendment is asked for after the replay
    replay.resolve({});
    await init;
    await write;

    expect(posts()).toHaveLength(2);
    expect(posts()[1].payload.values).toEqual({ ...STORED, [WARN]: false });
    expect(readQueue()).toEqual([]);
    expect(UserPreferencesService.getGeneral(WARN)).toBe(false);
  });

  it('prefers a write queued while the fallback read was in flight', async () => {
    api.getUserPreferences.mockRejectedValue(new Error('offline'));
    // A Settings save lands (and is queued) while the stored section is being read
    api.getUserPreferenceSection.mockImplementation(async () => {
      seedQueuedGeneral(STORED);
      return { version: '0.4', values: { ...SERVER } };
    });
    await initUserPreferences();

    await UserPreferencesService.setGeneral(WARN, false);

    expect(posts().slice(-1)[0].payload.values).toEqual({ ...STORED, [WARN]: false });
  });
});
