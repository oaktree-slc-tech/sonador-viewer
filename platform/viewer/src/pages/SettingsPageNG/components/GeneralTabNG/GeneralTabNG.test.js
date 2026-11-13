/**
 * @jest-environment ./src/__tests__/jsdomEnvironment.js
 */
// Settings > General, rendered: the Application and Segmentation Editor tabs and their rows, the
// mesh colour well following the "follows the segment" box, hydration against edits, Reset over
// both tabs, and what one Save applies and posts (the section composed from the holders with the
// page's fields laid over it, no local-only key, a message naming what changed).

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from '@ohif/ui-next';

const mockMutate = jest.fn();
const mockNotify = jest.fn();

const KEYS = {
  LOCKED: 'warnLockedModelsOnOpenAsSegmentation',
  FOLLOW: 'segEditorFollowSelection',
  PREVIEW: 'segEditorPreviewColor',
  MESH: 'segEditorMeshColor',
};

// Stand-ins for the runtime holders, built inside the factory (jest hoists the mock above this
// file's bindings) and read back below. The download manager holds hydrated values that differ
// from the defaults, so a POST that carried a default would show.
jest.mock('@ohif/core', () => {
  const preferences = {
    listeners: [],
    values: {},
    GENERAL_DEFAULTS: {
      warnLockedModelsOnOpenAsSegmentation: true,
      segEditorFollowSelection: false,
      segEditorPreviewColor: '#ff8500',
      segEditorMeshColor: 'auto',
    },
    getGeneral(key) { return this.values[key]; },
    // Server-side keys only, as the real service's getGeneralValues
    getGeneralValues() { return { warnLockedModelsOnOpenAsSegmentation: this.values.warnLockedModelsOnOpenAsSegmentation }; },
    setGeneral: jest.fn(function (key, value) { this.values[key] = value; }),
    subscribe(event, listener) {
      this.listeners.push(listener);
      return { unsubscribe: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
    },
    broadcast(key, value) { this.listeners.forEach(l => l({ key, value, hydrated: true })); },
  };
  const downloads = {
    archive: true,
    retry: 4,
    listeners: {},
    isArchiveTransferEnabled() { return this.archive; },
    getRetryAttempts() { return this.retry; },
    setArchiveTransferEnabled: jest.fn(function (value) { this.archive = value; }),
    setRetryAttempts: jest.fn(function (value) { this.retry = value; }),
    subscribe(event, listener) {
      this.listeners[event] = listener;
      return { unsubscribe: () => { delete this.listeners[event]; } };
    },
  };
  return {
    DownloadManagerService: downloads,
    DownloadManagerServiceEvents: { TRANSFER_MODE_CHANGED: 'transfer', RETRY_ATTEMPTS_CHANGED: 'retry' },
    RETRY_ATTEMPTS_DEFAULT: 3,
    RETRY_ATTEMPTS_MAX: 5,
    RETRY_ATTEMPTS_MIN: 1,
    LOCKED_MODELS_WARNING_PREFERENCE_KEY: 'warnLockedModelsOnOpenAsSegmentation',
    SEG_EDITOR_FOLLOW_SELECTION_DEFAULT: false,
    SEG_EDITOR_FOLLOW_SELECTION_PREFERENCE_KEY: 'segEditorFollowSelection',
    SEG_EDITOR_MESH_COLOR_AUTO: 'auto',
    SEG_EDITOR_MESH_COLOR_DEFAULT: 'auto',
    SEG_EDITOR_MESH_COLOR_PREFERENCE_KEY: 'segEditorMeshColor',
    SEG_EDITOR_PREVIEW_COLOR_DEFAULT: '#ff8500',
    SEG_EDITOR_PREVIEW_COLOR_PREFERENCE_KEY: 'segEditorPreviewColor',
    UserPreferencesService: preferences,
    UserPreferencesServiceEvents: { GENERAL_CHANGED: 'event::general_changed' },
    uiNotificationService: { show: (...args) => mockNotify(...args) },
  };
});
jest.mock('@ohif/i18n', () => ({
  language: 'de',
  availableLanguages: [{ value: 'en-US', label: 'English' }, { value: 'de', label: 'Deutsch' }],
  changeLanguage: jest.fn(),
}));
jest.mock('@ohif/ui/src/elements/Svg/svgs/caret-down.svg', () => ({ ReactComponent: () => null }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, options) => {
      const value = options && (options.color ?? options.count);
      return value === undefined ? key : `${key}(${value})`;
    },
  }),
}));
// The real composer resolves a base and reads the holders; here the hydrated holders, over the
// stand-ins, so the test proves the page sets its values on the services BEFORE composing. The
// base itself, against delayed and failed hydration and a queued write, is exercised through this
// page in GeneralTabNG.languagePreservation.test.js.
jest.mock('../../../../lib/generalPreferences', () => ({
  saveGeneralSettings: async (fields, submit) => {
    const { DownloadManagerService, UserPreferencesService } = jest.requireMock('@ohif/core');
    return submit({
      version: '0.4',
      values: {
        language: 'de',
        offlineArchiveTransfer: DownloadManagerService.isArchiveTransferEnabled(),
        offlineRetryAttempts: DownloadManagerService.getRetryAttempts(),
        ...UserPreferencesService.getGeneralValues(),
        ...fields,
      },
    });
  },
}));
jest.mock('../../../../queries/preferences', () => ({ useUpdateUserPreferenceSection: () => ({ mutateAsync: mockMutate }) }));
jest.mock('../../../../store/useDeviceStore', () => ({ useDeviceStore: () => ({ isDesktop: true }) }));

import ApplicationSettingsTab from './ApplicationSettingsTab';
import GeneralTabNG from './GeneralTabNG';

const { UserPreferencesService: mockPrefs, DownloadManagerService: mockDownloads } = jest.requireMock('@ohif/core');

global.IS_REACT_ACT_ENVIRONMENT = true;

// react-color's checkerboard canvas, and Radix's layer positioning, both want browser APIs jsdom
// lacks
HTMLCanvasElement.prototype.getContext = () => null;
if (typeof global.ResizeObserver === 'undefined') {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

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
  return host;
}

beforeEach(() => {
  mockMutate.mockReset();
  mockMutate.mockResolvedValue({ outcome: 'saved' });
  mockNotify.mockClear();
  mockPrefs.setGeneral.mockClear();
  mockPrefs.values = { ...mockPrefs.GENERAL_DEFAULTS };
  mockPrefs.listeners = [];
  mockDownloads.setArchiveTransferEnabled.mockClear();
  mockDownloads.setRetryAttempts.mockClear();
  mockDownloads.archive = true;
  mockDownloads.retry = 4;
  mockDownloads.listeners = {};
});

afterEach(() => {
  while (mounted.length) {
    const { root, host } = mounted.pop();
    act(() => root.unmount());
    host.remove();
  }
});

const byId = id => document.getElementById(id);
const click = element => act(() => {
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
const checked = element => element.getAttribute('data-state') === 'checked';
const openTab = cy => click(document.querySelector(`[data-cy="${cy}"]`));
// Save composes its payload asynchronously before it posts
const save = async () => {
  click(document.querySelector('[data-cy="settings-save"]'));
  await act(async () => {});
};
const lastPayload = () => mockMutate.mock.calls[mockMutate.mock.calls.length - 1][0];
const lastMessage = () => mockNotify.mock.calls[mockNotify.mock.calls.length - 1][0];

describe('GeneralTabNG', () => {
  it('opens on Application, with the Segmentation Editor rows on the second tab', () => {
    mount();
    expect(document.querySelector('h2').textContent).toBe('General Settings');
    expect(checked(byId('offline-archive-transfer'))).toBe(true);
    expect(document.querySelector('input[type="number"], input').value).toBe('4');
    expect(byId('locked-models-warning')).toBeNull();

    openTab('general-settings-seg-editor');
    expect(byId('offline-archive-transfer')).toBeNull();
    expect(checked(byId('locked-models-warning'))).toBe(true);
    expect(byId('locked-models-warning').getAttribute('aria-describedby')).toBe('locked-models-warning-help');
    expect(byId('locked-models-warning-help').textContent).toBe('LockedModelsWarningHelp');
    expect(checked(byId('seg-editor-follow-selection'))).toBe(false);
    expect(byId('seg-editor-preview-color').getAttribute('aria-label')).toBe('SegEditorPreviewColorLabel: #ff8500');
    expect(checked(byId('seg-editor-mesh-color-auto'))).toBe(true);
    expect(byId('seg-editor-mesh-color').disabled).toBe(true);
    // The label points at the kit's switch button, so clicking the text toggles it
    expect(document.querySelector('label[for="seg-editor-mesh-color-auto"]').textContent).toBe('SegEditorMeshColorAutoLabel');
    // The footer is the page's, shown on both tabs; with nothing changed it offers no Save
    expect(document.querySelector('[data-cy="settings-reset"]')).not.toBeNull();
    expect(document.querySelector('[data-cy="settings-save"]')).toBeNull();
  });

  it('does not offer the language while the selector is hidden, and offers it when enabled', () => {
    const host = mount();
    expect(host.textContent).not.toContain('Language');
    expect(host.textContent).not.toContain('Deutsch');

    const tab = document.createElement('div');
    document.body.appendChild(tab);
    const root = createRoot(tab);
    act(() => {
      root.render(
        <TooltipProvider>
          <ApplicationSettingsTab
            archiveTransfer retryAttempts={3} languageSelection
            onArchiveTransferChange={() => {}} onRetryAttemptsChange={() => {}} onStepRetryAttempts={() => {}}
          />
        </TooltipProvider>
      );
    });
    mounted.push({ root, host: tab });
    expect(tab.textContent).toContain('Language');
    expect(tab.textContent).toContain('Deutsch');
  });

  it('shows Save and Cancel only while changes are pending, and Cancel puts the saved values back', async () => {
    mount();
    const cancel = () => document.querySelector('[data-cy="settings-cancel"]');
    const saveButton = () => document.querySelector('[data-cy="settings-save"]');
    expect(cancel()).toBeNull();
    expect(saveButton()).toBeNull();

    click(byId('offline-archive-transfer'));
    expect(cancel()).not.toBeNull();
    expect(saveButton()).not.toBeNull();
    // Put back by hand, the field is no longer a change
    click(byId('offline-archive-transfer'));
    expect(saveButton()).toBeNull();
    click(byId('offline-archive-transfer'));
    openTab('general-settings-seg-editor');
    click(byId('seg-editor-follow-selection'));
    // Still pending, on the other tab, with the same footer
    expect(cancel()).not.toBeNull();

    click(cancel());
    expect(cancel()).toBeNull();
    expect(saveButton()).toBeNull();
    expect(checked(byId('seg-editor-follow-selection'))).toBe(false);
    openTab('general-settings-application');
    expect(checked(byId('offline-archive-transfer'))).toBe(true);
    expect(mockMutate).not.toHaveBeenCalled();

    // A change that is saved is no longer pending; a value that merely hydrates is not a change
    click(byId('offline-archive-transfer'));
    expect(cancel()).not.toBeNull();
    await save();
    expect(cancel()).toBeNull();
    expect(saveButton()).toBeNull();
    act(() => mockDownloads.listeners.retry({ retryAttempts: 2 }));
    expect(cancel()).toBeNull();
    expect(saveButton()).toBeNull();
    expect(document.querySelector('input').value).toBe('2');
  });

  it('keeps an edit on one tab across a trip to the other and back', () => {
    mount();
    click(byId('offline-archive-transfer'));
    expect(checked(byId('offline-archive-transfer'))).toBe(false);
    expect(document.querySelector('input').getAttribute('aria-describedby')).toBe('offline-retry-attempts-help');
    openTab('general-settings-seg-editor');
    click(byId('seg-editor-follow-selection'));
    openTab('general-settings-application');
    // The tab's content was unmounted and rebuilt; the page's state survived
    expect(checked(byId('offline-archive-transfer'))).toBe(false);
    expect(document.querySelector('input').getAttribute('aria-describedby')).toBe('offline-retry-attempts-help');
    openTab('general-settings-seg-editor');
    expect(checked(byId('seg-editor-follow-selection'))).toBe(true);
  });

  it('enables the mesh colour well when the mesh stops following the segment, on the last pick', () => {
    mockPrefs.values[KEYS.MESH] = '#336699';
    mount();
    openTab('general-settings-seg-editor');
    const auto = byId('seg-editor-mesh-color-auto');
    const well = byId('seg-editor-mesh-color');
    expect(checked(auto)).toBe(false);
    expect(well.disabled).toBe(false);
    expect(well.getAttribute('aria-label')).toBe('SegEditorMeshColorLabel: #336699');

    click(auto);
    expect(checked(auto)).toBe(true);
    expect(well.disabled).toBe(true);
    expect(well.getAttribute('aria-label')).toBe('SegEditorMeshColorLabel: #8f8f8f');

    click(auto);
    expect(well.disabled).toBe(false);
    expect(well.getAttribute('aria-label')).toBe('SegEditorMeshColorLabel: #336699');
  });

  it('brings back a colour that landed from the editor while the box was untouched', () => {
    mount();
    openTab('general-settings-seg-editor');
    act(() => mockPrefs.broadcast(KEYS.MESH, '#112233'));
    const auto = byId('seg-editor-mesh-color-auto');
    expect(checked(auto)).toBe(false);
    click(auto);
    click(auto);
    expect(byId('seg-editor-mesh-color').getAttribute('aria-label')).toBe('SegEditorMeshColorLabel: #112233');
  });

  it('follows a hydrated value until the field is edited, and not after, and lets go on unmount', () => {
    mount();
    act(() => mockDownloads.listeners.transfer({ archiveTransferEnabled: false }));
    expect(checked(byId('offline-archive-transfer'))).toBe(false);

    openTab('general-settings-seg-editor');
    act(() => mockPrefs.broadcast(KEYS.LOCKED, false));
    expect(checked(byId('locked-models-warning'))).toBe(false);

    click(byId('seg-editor-follow-selection'));
    expect(checked(byId('seg-editor-follow-selection'))).toBe(true);
    act(() => mockPrefs.broadcast(KEYS.FOLLOW, false));
    expect(checked(byId('seg-editor-follow-selection'))).toBe(true);

    expect(mockPrefs.listeners).toHaveLength(1);
    const { root, host } = mounted.pop();
    act(() => root.unmount());
    host.remove();
    expect(mockPrefs.listeners).toHaveLength(0);
    expect(mockDownloads.listeners).toEqual({});
  });

  it('Save applies every field to its holder, posts the section once, and names what changed', async () => {
    mount();
    click(byId('offline-archive-transfer'));
    openTab('general-settings-seg-editor');
    click(byId('seg-editor-follow-selection'));
    click(byId('locked-models-warning'));
    await save();

    expect(mockDownloads.setArchiveTransferEnabled).toHaveBeenCalledWith(false);
    expect(mockDownloads.setRetryAttempts).toHaveBeenCalledWith(4);
    expect(mockPrefs.setGeneral.mock.calls).toEqual(expect.arrayContaining([
      [KEYS.LOCKED, false, { persist: false }],
      [KEYS.FOLLOW, true, { persist: false }],
      [KEYS.PREVIEW, '#ff8500', { persist: false }],
      [KEYS.MESH, 'auto', { persist: false }],
    ]));
    expect(mockPrefs.setGeneral).toHaveBeenCalledTimes(4);

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(lastPayload()).toEqual({
      version: '0.4',
      values: {
        language: 'de',
        offlineArchiveTransfer: false,
        // Untouched: the holder's hydrated value, not the built-in default
        offlineRetryAttempts: 4,
        warnLockedModelsOnOpenAsSegmentation: false,
      },
    });
    expect(lastMessage()).toEqual(expect.objectContaining({
      title: 'GeneralSettingsSaved',
      message: 'OfflineArchiveTransferSavedOff LockedModelsWarningSavedOff SegEditorFollowSelectionSavedOn',
      type: 'success',
    }));
  });

  it('keeps naming a change until the save goes through', async () => {
    mount();
    click(byId('offline-archive-transfer'));
    mockMutate.mockRejectedValueOnce(new Error('rejected'));
    await save();
    expect(mockNotify).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'error' }));
    // The save did not reach the account, so Save stays for another try
    await save();
    expect(lastMessage().message).toBe('OfflineArchiveTransferSavedOff');
    expect(document.querySelector('[data-cy="settings-save"]')).toBeNull();
  });

  it('Cancel puts back a value hydration delivered while the field was being edited, and Save keeps it', async () => {
    mount();
    openTab('general-settings-seg-editor');
    const warning = byId('locked-models-warning');
    expect(checked(warning)).toBe(true);
    click(warning);
    expect(checked(warning)).toBe(false);
    // The account's saved value arrives after the edit: the draft stays, the baseline moves
    act(() => mockPrefs.broadcast(KEYS.LOCKED, false));
    expect(checked(warning)).toBe(false);
    expect(document.querySelector('[data-cy="settings-cancel"]')).toBeNull();
    click(warning);
    expect(document.querySelector('[data-cy="settings-cancel"]')).not.toBeNull();
    click(document.querySelector('[data-cy="settings-cancel"]'));
    expect(checked(byId('locked-models-warning'))).toBe(false);
    expect(mockMutate).not.toHaveBeenCalled();
    // An unrelated change saved afterwards carries the hydrated choice, not the pre-hydration default
    openTab('general-settings-application');
    click(byId('offline-archive-transfer'));
    await save();
    expect(lastPayload().values.warnLockedModelsOnOpenAsSegmentation).toBe(false);
    expect(mockPrefs.setGeneral).toHaveBeenCalledWith(KEYS.LOCKED, false, { persist: false });
  });

  it('names a picked colour and the attempt budget in the save message', async () => {
    mockPrefs.values[KEYS.MESH] = '#336699';
    mockPrefs.values[KEYS.PREVIEW] = '#112233';
    mount();
    const input = document.querySelector('input');
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    });
    openTab('general-settings-seg-editor');
    click(byId('seg-editor-mesh-color-auto'));
    await save();
    expect(mockDownloads.setRetryAttempts).toHaveBeenCalledWith(5);
    expect(lastPayload().values.offlineRetryAttempts).toBe(5);
    expect(lastMessage().message).toBe('OfflineRetryAttemptsSaved(5) SegEditorMeshColorSavedAuto');
    expect(mockPrefs.setGeneral).toHaveBeenCalledWith(KEYS.PREVIEW, '#112233', { persist: false });
  });

  it('Reset Defaults returns every field on both tabs to its default without saving', () => {
    mockPrefs.values[KEYS.LOCKED] = false;
    mockPrefs.values[KEYS.FOLLOW] = true;
    mockPrefs.values[KEYS.MESH] = '#336699';
    mount();
    click(document.querySelector('[data-cy="settings-reset"]'));
    expect(checked(byId('offline-archive-transfer'))).toBe(false);
    expect(document.querySelector('input').value).toBe('3');
    openTab('general-settings-seg-editor');
    expect(checked(byId('locked-models-warning'))).toBe(true);
    expect(checked(byId('seg-editor-follow-selection'))).toBe(false);
    expect(checked(byId('seg-editor-mesh-color-auto'))).toBe(true);
    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockPrefs.setGeneral).not.toHaveBeenCalled();
    expect(mockDownloads.setArchiveTransferEnabled).not.toHaveBeenCalled();
  });
});
