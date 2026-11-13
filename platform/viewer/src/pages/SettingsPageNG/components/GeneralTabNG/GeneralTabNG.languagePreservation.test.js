/**
 * @jest-environment ./src/__tests__/jsdomEnvironment.js
 */
// Settings' Save while the language selector is hidden (ohif-viewers!117): a section POST replaces
// the section wholesale, so the save must carry the stored language back even when startup
// hydration is late, has failed, or was kept off the holders by a write still queued -- and post
// nothing when the stored settings cannot be read at all -- and two Saves must land in the order
// they were made, however their reads complete. The page's Save, the production
// initializer, composer, language holder, write queue and UserPreferencesService run together;
// the transport and the download manager are stubbed.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from '@ohif/ui-next';

const mockNotify = jest.fn();

jest.mock('@ohif/i18n', () => ({
  language: 'en-US',
  availableLanguages: [{ value: 'en-US', label: 'English' }, { value: 'de-DE', label: 'Deutsch' }],
  changeLanguage: jest.fn(function (language) { this.language = language; }),
}));
jest.mock('@ohif/core', () => {
  const service = jest.requireActual('../../../../../../core/src/services/UserPreferencesService/UserPreferencesService');
  const downloads = {
    archive: false,
    retry: 3,
    listeners: {},
    applyHydratedArchiveTransfer(value) { this.archive = value; },
    applyHydratedRetryAttempts(value) { this.retry = value; },
    isArchiveTransferEnabled() { return this.archive; },
    getRetryAttempts() { return this.retry; },
    setArchiveTransferEnabled(value) { this.archive = value; },
    setRetryAttempts(value) { this.retry = value; },
    subscribe(event, listener) {
      this.listeners[event] = listener;
      return { unsubscribe: () => { delete this.listeners[event]; } };
    },
  };
  return {
    ...service,
    redux: { actions: { setUserPreferences: state => ({ type: 'SET_USER_PREFERENCES', state }) } },
    displayAttributes: { setSiteDisplayAttributes: () => {} },
    DownloadManagerService: downloads,
    DownloadManagerServiceEvents: { TRANSFER_MODE_CHANGED: 'transfer', RETRY_ATTEMPTS_CHANGED: 'retry' },
    RETRY_ATTEMPTS_DEFAULT: 3,
    RETRY_ATTEMPTS_MAX: 5,
    RETRY_ATTEMPTS_MIN: 1,
    UserPreferencesService: service.default,
    uiNotificationService: { show: (...args) => mockNotify(...args) },
  };
});
jest.mock('@ohif/core/src/services/UINotificationService', () => ({
  uiNotificationService: { show: (...args) => mockNotify(...args), hide: () => {} },
}));
jest.mock('../../../../api/preferences', () => ({
  getUserPreferences: jest.fn(),
  getUserPreferenceSection: jest.fn(),
  updateUserPreferenceSection: jest.fn(),
}));
// The page's mutation, without react-query: the same submission through the real write queue
jest.mock('../../../../queries/preferences', () => {
  const { submitPreferenceWrite } = jest.requireActual('../../../../lib/preferenceWriteQueue');
  const { PREFERENCE_SECTION_PATHS } = jest.requireActual('../../../../constants/preferences');
  return {
    useUpdateUserPreferenceSection: section => ({
      mutateAsync: payload => submitPreferenceWrite({ key: PREFERENCE_SECTION_PATHS[section], section, payload }),
    }),
  };
});
jest.mock('../../../../lib/studylistPreferenceSync', () => ({
  setStudylistSyncHydrating: () => {},
  startStudylistPreferenceSync: () => {},
}));
jest.mock('../../../../store/useStudiesTableFiltersAndColumnsStore', () => ({
  useStudiesTableFiltersAndColumnsStore: { setState: () => {} },
}));
jest.mock('../../../../store/useViewerMetadataSettingsStore', () => ({
  useViewerMetadataSettingsStore: { getState: () => ({}) },
}));
jest.mock('../../../../store/useDeviceStore', () => ({ useDeviceStore: () => ({ isDesktop: true }) }));
jest.mock('@ohif/ui/src/elements/Svg/svgs/caret-down.svg', () => ({ ReactComponent: () => null }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: key => key }) }));

import GeneralTabNG from './GeneralTabNG';

const { UserPreferencesService, DownloadManagerService: mockDownloads } = jest.requireMock('@ohif/core');
const api = jest.requireMock('../../../../api/preferences');
const i18n = jest.requireMock('@ohif/i18n');
const { WRITE_QUEUE_STORAGE_KEY } = require('../../../../constants/preferences');
const { stopPreferenceWriteQueue } = require('../../../../lib/preferenceWriteQueue');
const { initUserPreferences, resetUserPreferencesInitForTests } = require('../../../../init/initUserPreferences');

global.IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = () => null;
if (typeof global.ResizeObserver === 'undefined') {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
window.store = { getState: () => ({ oidc: { user: { profile: { preferred_username: 'user-1' } } } }) };

// The server holds English; the user stored German before the selector was hidden
const SERVER = { language: 'en-US', offlineArchiveTransfer: false, offlineRetryAttempts: 3 };
const STORED = { language: 'de-DE', offlineArchiveTransfer: false, offlineRetryAttempts: 5 };
const documentWith = general => ({ viewer: { '0.4': { general: { ...general } } }, studylist: {} });

const httpError = status => { const error = new Error(`HTTP ${status}`); error.status = status; return error; };
const deferred = () => {
  let resolve;
  const promise = new Promise(res => { resolve = res; });
  return { promise, resolve };
};
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
const readQueue = () => JSON.parse(window.localStorage.getItem(WRITE_QUEUE_STORAGE_KEY) || '[]');
const seedQueuedGeneral = values => window.localStorage.setItem(WRITE_QUEUE_STORAGE_KEY, JSON.stringify([{
  key: 'general', user: 'user-1', section: 'general', payload: { version: '0.4', values },
  queuedAt: new Date().toISOString(), attempts: 1, seq: 1,
}]));
const posts = () => api.updateUserPreferenceSection.mock.calls.map(([, payload]) => payload.values);

const mounted = [];
function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <TooltipProvider>
        <GeneralTabNG />
      </TooltipProvider>
    );
  });
  mounted.push({ root, host });
}
const click = element => act(() => {
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
// The setting the user changes: offline archive transfer, off in every stored section
const turnOnArchiveTransferAndSave = () => {
  click(document.getElementById('offline-archive-transfer'));
  click(document.querySelector('[data-cy="settings-save"]'));
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  window.localStorage.clear();
  resetUserPreferencesInitForTests();
  i18n.language = 'en-US';
  mockDownloads.archive = false;
  mockDownloads.retry = 3;
  mockDownloads.listeners = {};
  api.updateUserPreferenceSection.mockResolvedValue({});
  UserPreferencesService._general = { ...UserPreferencesService.GENERAL_DEFAULTS };
  UserPreferencesService._userSet.clear();
  UserPreferencesService.setPersistence(null);
});

afterEach(() => {
  while (mounted.length) {
    const { root, host } = mounted.pop();
    act(() => root.unmount());
    host.remove();
  }
  stopPreferenceWriteQueue();
  jest.restoreAllMocks();
});

describe('Settings Save keeps the hidden language', () => {
  it('waits for a startup GET still in flight, then carries the stored language', async () => {
    const get = deferred();
    api.getUserPreferences.mockReturnValue(get.promise);
    const init = initUserPreferences();
    mount();

    turnOnArchiveTransferAndSave();
    await settle();
    expect(api.updateUserPreferenceSection).not.toHaveBeenCalled();

    get.resolve(documentWith(STORED));
    await act(() => init);
    await settle();

    expect(posts()).toEqual([expect.objectContaining({ language: 'de-DE', offlineArchiveTransfer: true })]);
    expect(i18n.language).toBe('en-US');
  });

  it('reads the stored section when the startup GET failed', async () => {
    api.getUserPreferences.mockRejectedValue(new Error('offline'));
    api.getUserPreferenceSection.mockResolvedValue({ version: '0.4', values: { ...STORED } });
    await act(() => initUserPreferences());
    mount();

    turnOnArchiveTransferAndSave();
    await settle();

    expect(api.getUserPreferenceSection).toHaveBeenCalledWith('general', '0.4');
    expect(posts()).toEqual([expect.objectContaining({ language: 'de-DE', offlineArchiveTransfer: true })]);
  });

  it('carries the language of a write still queued after a failed replay, and the queue empties', async () => {
    seedQueuedGeneral(STORED);
    api.updateUserPreferenceSection.mockRejectedValueOnce(httpError(503)); // the startup replay
    api.getUserPreferences.mockResolvedValue(documentWith(SERVER));
    api.getUserPreferenceSection.mockResolvedValue({ version: '0.4', values: { ...SERVER } });
    await act(() => initUserPreferences());
    mount();

    turnOnArchiveTransferAndSave();
    await settle();

    const settingsWrite = posts()[posts().length - 1];
    expect(settingsWrite).toEqual(expect.objectContaining({ language: 'de-DE', offlineArchiveTransfer: true }));
    expect(readQueue()).toEqual([]);
  });

  it('carries the hydrated language when hydration landed, without applying it', async () => {
    api.getUserPreferences.mockResolvedValue(documentWith(STORED));
    await act(() => initUserPreferences());
    mount();

    turnOnArchiveTransferAndSave();
    await settle();

    expect(api.getUserPreferenceSection).not.toHaveBeenCalled();
    expect(posts()).toEqual([expect.objectContaining({ language: 'de-DE', offlineArchiveTransfer: true })]);
    expect(i18n.changeLanguage).not.toHaveBeenCalled();
  });

  it('posts nothing, and says so, when the stored settings cannot be read', async () => {
    api.getUserPreferences.mockRejectedValue(new Error('offline'));
    api.getUserPreferenceSection.mockRejectedValue(new Error('still offline'));
    await act(() => initUserPreferences());
    mount();

    turnOnArchiveTransferAndSave();
    await settle();

    expect(api.updateUserPreferenceSection).not.toHaveBeenCalled();
    expect(readQueue()).toEqual([]);
    // The change still applies in this session
    expect(mockDownloads.archive).toBe(true);
    expect(mockNotify).toHaveBeenLastCalledWith(expect.objectContaining({
      title: 'Could not save general preferences',
      type: 'error',
    }));
    // Nothing reached the account, so Save stays for another try
    expect(document.querySelector('[data-cy="settings-save"]')).not.toBeNull();
  });

  it('lands two Saves in the order they were made, the newest last, when their reads would finish in reverse', async () => {
    api.getUserPreferences.mockRejectedValue(new Error('offline'));
    const reads = [];
    api.getUserPreferenceSection.mockImplementation(() => {
      const read = deferred();
      reads.push(read);
      return read.promise;
    });
    await act(() => initUserPreferences());
    mount();

    // On, then off, each saved before the first one's read has come back
    turnOnArchiveTransferAndSave();
    click(document.getElementById('offline-archive-transfer'));
    click(document.querySelector('[data-cy="settings-save"]'));
    await settle();

    // Answer the newest read first, as a slow first read would have it
    let answered = 0;
    while (answered < reads.length) {
      const pending = reads.filter(read => !read.answered);
      const newest = pending[pending.length - 1];
      newest.answered = true;
      newest.resolve({ version: '0.4', values: { ...STORED } });
      answered += 1;
      await settle();
    }

    expect(posts().map(values => values.offlineArchiveTransfer)).toEqual([true, false]);
    expect(posts().every(values => values.language === 'de-DE')).toBe(true);
    expect(mockDownloads.archive).toBe(false);
    expect(mockNotify).toHaveBeenLastCalledWith(expect.objectContaining({
      title: 'GeneralSettingsSaved',
      message: 'OfflineArchiveTransferSavedOff',
      type: 'success',
    }));
  });
});
