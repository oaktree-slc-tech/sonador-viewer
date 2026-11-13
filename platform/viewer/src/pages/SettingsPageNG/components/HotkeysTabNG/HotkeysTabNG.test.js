/**
 * @jest-environment ./src/__tests__/jsdomEnvironment.js
 */
// Settings > Hotkeys, rendered: the Application and Segmentation Editor tabs, a field recording
// the keys pressed in it (through the real key recorder), conflicts within and across the two
// sets as their handlers match combinations, stored bindings landing after the page opens, and
// what one Save applies and posts. The Segmentation Editor's bindings are held by the real
// preferences service.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from '@ohif/ui-next';

const mockMutate = jest.fn();
const mockNotify = jest.fn();
const mockReadSection = jest.fn();
const mockHolder = { preferences: null };

jest.mock('@ohif/core', () => {
  const service = jest.requireActual('../../../../../../core/src/services/UserPreferencesService/UserPreferencesService');
  const { canonicalKeyCombination } = jest.requireActual('../../../../../../core/src/utils/keyCombination');
  return {
    // The real recorder: the field must reach it through the document
    hotkeys: jest.requireActual('@ohif/core/src/utils/hotkeys').default,
    canonicalKeyCombination,
    SEG_EDITOR_HOTKEY_DEFAULTS: service.SEG_EDITOR_HOTKEY_DEFAULTS,
    SEG_EDITOR_HOTKEY_PREFIX: service.SEG_EDITOR_HOTKEY_PREFIX,
    UserPreferencesServiceEvents: service.UserPreferencesServiceEvents,
    get UserPreferencesService() {
      return mockHolder.preferences;
    },
    uiNotificationService: { show: (...args) => mockNotify(...args) },
  };
});
jest.mock('../../../../App', () => {
  const manager = {
    hotkeyDefaults: [
      { commandName: 'invertViewport', label: 'Invert', keys: ['i'] },
      { commandName: 'nextImage', label: 'Next Image', keys: ['down'], scope: 'viewport' },
    ],
    hotkeyDefinitions: {},
    // As the manager does: the bindings given, by command
    setHotkeys: jest.fn(definitions => {
      const entries = Array.isArray(definitions)
        ? definitions.map(({ commandName, ...definition }) => [commandName, definition])
        : Object.entries(definitions);
      entries.forEach(([name, definition]) => {
        manager.hotkeyDefinitions[name] = { ...manager.hotkeyDefinitions[name], ...definition };
      });
    }),
  };
  return { hotkeysManager: manager };
});
jest.mock('../../../../api/preferences', () => ({ getUserPreferenceSection: (...args) => mockReadSection(...args) }));
jest.mock('../../../../lib/preferenceWriteQueue', () => ({ getPendingPreferenceWrite: () => undefined }));
jest.mock('@ohif/ui/src/elements/Svg/svgs/error.svg', () => ({ ReactComponent: () => null }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: key => key }) }));
jest.mock('../../../../queries/preferences', () => ({ useUpdateUserPreferenceSection: () => ({ mutateAsync: mockMutate }) }));
jest.mock('../../../../store/useDeviceStore', () => ({ useDeviceStore: () => ({ isDesktop: true }) }));

import {
  notifyHotkeysApplied,
  resetHotkeyHydrationForTests,
  settleHotkeyHydration,
  startHotkeyHydration,
} from '../../../../lib/hotkeyHydration';

import HotkeysTabNG from './HotkeysTabNG';

const { UserPreferencesServiceClass } = jest.requireActual(
  '../../../../../../core/src/services/UserPreferencesService/UserPreferencesService'
);
const { hotkeysManager: mockManager } = jest.requireMock('../../../../App');

global.IS_REACT_ACT_ENVIRONMENT = true;
if (typeof global.ResizeObserver === 'undefined') {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const memoryStorage = () => {
  const items = {};
  return { getItem: key => (key in items ? items[key] : null), setItem: (key, value) => { items[key] = String(value); } };
};

const mounted = [];

function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <TooltipProvider>
        <HotkeysTabNG />
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
  mockReadSection.mockReset();
  mockReadSection.mockRejectedValue(new Error('not read in this test'));
  mockHolder.preferences = new UserPreferencesServiceClass({ storage: memoryStorage() });
  mockManager.setHotkeys.mockClear();
  mockManager.hotkeyDefinitions = {
    invertViewport: { label: 'Invert', keys: ['i'] },
    nextImage: { label: 'Next Image', keys: ['down'], scope: 'viewport' },
  };
  localStorage.clear();
  // The stored bindings have landed, unless a test says otherwise
  resetHotkeyHydrationForTests();
  startHotkeyHydration();
  settleHotkeyHydration({ hydrated: true });
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
const openTab = cy => click(document.querySelector(`[data-cy="${cy}"]`));
const KEY_CODES = { a: 65, i: 73, k: 75, q: 81, d: 68, z: 90, down: 40 };
// Press and release a key in a field, as the browser delivers it: on the field, bubbling
const press = (field, key, modifiers = {}) => act(() => {
  field.focus();
  const init = { keyCode: KEY_CODES[key], which: KEY_CODES[key], bubbles: true, cancelable: true, ...modifiers };
  field.dispatchEvent(new KeyboardEvent('keydown', init));
  field.dispatchEvent(new KeyboardEvent('keyup', init));
});
const save = async () => {
  click(document.querySelector('[data-cy="settings-save"]'));
  await act(async () => {});
};
const cancelButton = () => document.querySelector('[data-cy="settings-cancel"]');
const saveButton = () => document.querySelector('[data-cy="settings-save"]');

const pendingHydration = () => {
  resetHotkeyHydrationForTests();
  startHotkeyHydration();
};
// Startup hydration applying the stored section, as initUserPreferences does
const hydrate = ({ application = {}, segEditor = {} }) => act(() => {
  mockHolder.preferences.applyHydratedSegEditorHotkeys(segEditor);
  mockManager.setHotkeys(application);
  notifyHotkeysApplied();
});
const lastPayload = () => mockMutate.mock.calls[mockMutate.mock.calls.length - 1][0];
const SEG_DEFAULT_VALUES = {
  'segEditor:previousImage': { label: 'Previous Image', keys: ['a'] },
  'segEditor:nextImage': { label: 'Next Image', keys: ['d'] },
  'segEditor:undo': { label: 'Undo', keys: ['ctrl', 'z'] },
  'segEditor:redo': { label: 'Redo', keys: ['ctrl', 'y'] },
  'segEditor:redoAlternate': { label: 'Redo (alternate)', keys: ['ctrl', 'shift', 'z'] },
};

describe('HotkeysTabNG', () => {
  it('opens on Application, with the Segmentation Editor keys on the second tab', () => {
    mount();
    expect(document.querySelector('h2').textContent).toBe('Hotkey Settings');
    expect(byId('hotkey-application-invertViewport').value).toBe('i');
    expect(byId('hotkey-seg-editor-undo')).toBeNull();

    openTab('hotkey-settings-seg-editor');
    expect(byId('hotkey-application-invertViewport')).toBeNull();
    expect(byId('hotkey-seg-editor-undo').value).toBe('ctrl+z');
    expect(byId('hotkey-seg-editor-previousImage').value).toBe('a');
  });

  it('says so when the application has no hotkeys, without pointing at a configuration file', () => {
    mockManager.hotkeyDefinitions = {};
    const host = mount();
    expect(host.textContent).toContain('HotkeysApplicationEmpty');
    expect(host.textContent).not.toContain('No hotkeys found');
  });

  it('records the keys pressed in a field, and offers Save and Cancel once they differ', () => {
    mount();
    expect(cancelButton()).toBeNull();
    expect(saveButton()).toBeNull();

    press(byId('hotkey-application-invertViewport'), 'k');
    expect(byId('hotkey-application-invertViewport').value).toBe('k');
    expect(saveButton()).not.toBeNull();
    // Recorded back to the saved key, the binding is no longer a change
    press(byId('hotkey-application-invertViewport'), 'i');
    expect(saveButton()).toBeNull();
    expect(cancelButton()).toBeNull();
    press(byId('hotkey-application-invertViewport'), 'k');

    click(cancelButton());
    expect(byId('hotkey-application-invertViewport').value).toBe('i');
    expect(cancelButton()).toBeNull();
    expect(saveButton()).toBeNull();
  });

  it('refuses a combination already used in the same set or in the other, until it is freed', () => {
    mount();
    press(byId('hotkey-application-invertViewport'), 'down');
    expect(document.body.textContent).toContain('"Next Image" is already using the "down" shortcut.');
    expect(saveButton().disabled).toBe(true);

    press(byId('hotkey-application-invertViewport'), 'd');
    expect(document.body.textContent).toContain('"Next Image" (GeneralTabSegEditor) is already using the "d" shortcut.');

    // Moving the editor's binding off the combination clears the application's error
    openTab('hotkey-settings-seg-editor');
    press(byId('hotkey-seg-editor-nextImage'), 'q');
    expect(saveButton().disabled).toBe(false);
  });

  it('refuses a combination the editor matches as one already in use, Cmd for Ctrl', () => {
    mount();
    openTab('hotkey-settings-seg-editor');
    // The editor runs Cmd+Z as Ctrl+Z, which is Undo
    press(byId('hotkey-seg-editor-nextImage'), 'z', { metaKey: true });
    expect(byId('hotkey-seg-editor-nextImage').value).toBe('meta+z');
    expect(document.body.textContent).toContain('"Undo" is already using the "meta+z" shortcut.');
    expect(saveButton().disabled).toBe(true);
    // A combination no binding uses is accepted
    press(byId('hotkey-seg-editor-nextImage'), 'q', { metaKey: true });
    expect(saveButton().disabled).toBe(false);

    // Across the sets too: with the editor open, Cmd+Z pressed for the application's binding
    // would run the editor's Undo
    openTab('hotkey-settings-application');
    press(byId('hotkey-application-invertViewport'), 'z', { metaKey: true });
    expect(document.body.textContent).toContain('"Undo" (GeneralTabSegEditor) is already using the "meta+z" shortcut.');
    expect(saveButton().disabled).toBe(true);
  });

  it('lets an editor binding go back to a combination the editor supports, and no other the browser uses', () => {
    mount();
    openTab('hotkey-settings-seg-editor');
    press(byId('hotkey-seg-editor-nextImage'), 'q');
    press(byId('hotkey-seg-editor-undo'), 'k');
    press(byId('hotkey-seg-editor-undo'), 'z', { ctrlKey: true });
    expect(byId('hotkey-seg-editor-undo').value).toBe('ctrl+z');
    expect(byId('hotkey-seg-editor-undo').getAttribute('aria-invalid')).toBeNull();
    expect(saveButton().disabled).toBe(false);

    press(byId('hotkey-seg-editor-undo'), 'a', { ctrlKey: true });
    expect(document.body.textContent).toContain('"ctrl+a" shortcut combination is not allowed');
    expect(saveButton().disabled).toBe(true);

    // The application's hotkeys do not take Ctrl+Z from the browser
    press(byId('hotkey-seg-editor-undo'), 'k');
    openTab('hotkey-settings-application');
    press(byId('hotkey-application-invertViewport'), 'z', { ctrlKey: true });
    expect(document.body.textContent).toContain('"ctrl+z" shortcut combination is not allowed');
  });

  it('marks a refused field invalid and describes it by its message, until the conflict is resolved', () => {
    mount();
    const field = () => byId('hotkey-application-invertViewport');
    expect(field().getAttribute('aria-invalid')).toBeNull();
    expect(field().getAttribute('aria-describedby')).toBeNull();
    expect(document.querySelector('label[for="hotkey-application-invertViewport"]').textContent).toBe('Invert');

    press(field(), 'down');
    expect(field().getAttribute('aria-invalid')).toBe('true');
    const message = byId(field().getAttribute('aria-describedby'));
    expect(message.textContent).toBe('"Next Image" is already using the "down" shortcut.');

    press(field(), 'k');
    expect(field().getAttribute('aria-invalid')).toBeNull();
    expect(field().getAttribute('aria-describedby')).toBeNull();
    expect(byId('hotkey-application-invertViewport-error')).toBeNull();
  });

  it('applies both sets on Save and posts them as one section', async () => {
    mount();
    press(byId('hotkey-application-invertViewport'), 'k');
    openTab('hotkey-settings-seg-editor');
    press(byId('hotkey-seg-editor-undo'), 'z', { shiftKey: true });
    // Shift is reported as a modifier of the key event
    expect(byId('hotkey-seg-editor-undo').value).toBe('shift+z');

    await save();

    expect(mockManager.hotkeyDefinitions.invertViewport.keys).toEqual(['k']);
    expect(JSON.parse(localStorage.getItem('hotkey-definitions'))).not.toHaveProperty('segEditor:undo');
    expect(mockHolder.preferences.getSegEditorHotkeys().undo.keys).toEqual(['shift', 'z']);
    expect(mockMutate).toHaveBeenCalledWith({
      version: '0.4',
      values: {
        invertViewport: { label: 'Invert', keys: ['k'] },
        nextImage: { label: 'Next Image', keys: ['down'] },
        ...SEG_DEFAULT_VALUES,
        'segEditor:undo': { label: 'Undo', keys: ['shift', 'z'] },
      },
    });
    expect(mockNotify.mock.calls[0][0]).toMatchObject({ title: 'HotkeysSaved', type: 'success' });
    // The message says only that the save was made, not what the page shows
    expect(mockNotify.mock.calls[0][0].message).toBeUndefined();
    expect(cancelButton()).toBeNull();
    expect(saveButton()).toBeNull();
  });

  it('follows stored bindings that land after it opened, and saves them untouched', async () => {
    pendingHydration();
    mount();
    openTab('hotkey-settings-seg-editor');
    expect(byId('hotkey-seg-editor-undo').value).toBe('ctrl+z');

    hydrate({ application: { nextImage: { keys: ['j'] } }, segEditor: { undo: { keys: ['u'] } } });
    settleHotkeyHydration({ hydrated: true });
    // What landed is what is saved: no change is pending
    expect(byId('hotkey-seg-editor-undo').value).toBe('u');
    expect(saveButton()).toBeNull();

    openTab('hotkey-settings-application');
    expect(byId('hotkey-application-nextImage').value).toBe('j');
    press(byId('hotkey-application-invertViewport'), 'k');
    await save();

    expect(lastPayload().values).toEqual({
      invertViewport: { label: 'Invert', keys: ['k'] },
      nextImage: { label: 'Next Image', keys: ['j'] },
      ...SEG_DEFAULT_VALUES,
      'segEditor:undo': { label: 'Undo', keys: ['u'] },
    });
    expect(mockHolder.preferences.getSegEditorHotkeys().undo.keys).toEqual(['u']);
    expect(mockManager.hotkeyDefinitions.nextImage.keys).toEqual(['j']);
  });

  it('keeps an edit when stored bindings land after it, and Cancel puts the stored ones back', () => {
    pendingHydration();
    mount();
    press(byId('hotkey-application-invertViewport'), 'k');

    hydrate({
      application: { invertViewport: { keys: ['x'] }, nextImage: { keys: ['j'] } },
      segEditor: { undo: { keys: ['u'] } },
    });
    settleHotkeyHydration({ hydrated: true });
    expect(byId('hotkey-application-invertViewport').value).toBe('k');
    expect(byId('hotkey-application-nextImage').value).toBe('j');

    click(cancelButton());
    expect(byId('hotkey-application-invertViewport').value).toBe('x');
    expect(byId('hotkey-application-nextImage').value).toBe('j');
    openTab('hotkey-settings-seg-editor');
    expect(byId('hotkey-seg-editor-undo').value).toBe('u');
    expect(saveButton()).toBeNull();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('holds a Save made before the stored bindings land, then writes only the change over them', async () => {
    pendingHydration();
    mount();
    press(byId('hotkey-application-invertViewport'), 'k');
    await save();
    expect(mockMutate).not.toHaveBeenCalled();
    expect(saveButton().disabled).toBe(true);

    hydrate({
      application: { invertViewport: { keys: ['x'] }, nextImage: { keys: ['j'] } },
      segEditor: { undo: { keys: ['u'] } },
    });
    await act(async () => settleHotkeyHydration({ hydrated: true }));

    expect(lastPayload().values).toEqual({
      invertViewport: { label: 'Invert', keys: ['k'] },
      nextImage: { label: 'Next Image', keys: ['j'] },
      ...SEG_DEFAULT_VALUES,
      'segEditor:undo': { label: 'Undo', keys: ['u'] },
    });
    expect(mockManager.hotkeyDefinitions.invertViewport.keys).toEqual(['k']);
    expect(mockManager.hotkeyDefinitions.nextImage.keys).toEqual(['j']);
    expect(mockHolder.preferences.getSegEditorHotkeys().undo.keys).toEqual(['u']);
    expect(byId('hotkey-application-invertViewport').value).toBe('k');
    expect(saveButton()).toBeNull();
  });

  it('reads the stored section for a Save when the stored bindings never landed', async () => {
    pendingHydration();
    settleHotkeyHydration({ hydrated: false });
    mockReadSection.mockResolvedValue({
      version: '0.4',
      values: {
        nextImage: { label: 'Next Image', keys: ['j'] },
        'segEditor:undo': { label: 'Undo', keys: ['u'] },
      },
    });
    mount();
    press(byId('hotkey-application-invertViewport'), 'k');
    await save();

    expect(mockReadSection).toHaveBeenCalledWith('hotkeys', '0.4');
    expect(lastPayload().values).toEqual({
      invertViewport: { label: 'Invert', keys: ['k'] },
      nextImage: { label: 'Next Image', keys: ['j'] },
      ...SEG_DEFAULT_VALUES,
      'segEditor:undo': { label: 'Undo', keys: ['u'] },
    });
    // The stored bindings are now in effect and on the page
    expect(mockManager.hotkeyDefinitions.nextImage.keys).toEqual(['j']);
    expect(byId('hotkey-application-nextImage').value).toBe('j');
    expect(saveButton()).toBeNull();
  });

  it('posts nothing, and says so, when the stored section cannot be read', async () => {
    pendingHydration();
    settleHotkeyHydration({ hydrated: false });
    mount();
    press(byId('hotkey-application-invertViewport'), 'k');
    await save();

    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockNotify.mock.calls[0][0]).toMatchObject({ title: 'Could not save hotkeys', type: 'error' });
    // The change still applies in this session, and Save stays for another try
    expect(mockManager.hotkeyDefinitions.invertViewport.keys).toEqual(['k']);
    expect(saveButton()).not.toBeNull();
  });

  it('keeps a change the account never received, and writes it over the stored bindings on the retry', async () => {
    pendingHydration();
    settleHotkeyHydration({ hydrated: false });
    mount();
    press(byId('hotkey-application-invertViewport'), 'k');
    await save();
    expect(mockMutate).not.toHaveBeenCalled();

    // The stored section can be read again, and still holds what it did
    mockReadSection.mockResolvedValue({
      version: '0.4',
      values: {
        invertViewport: { label: 'Invert', keys: ['i'] },
        nextImage: { label: 'Next Image', keys: ['j'] },
        'segEditor:undo': { label: 'Undo', keys: ['u'] },
      },
    });
    await save();

    expect(lastPayload().values).toEqual({
      invertViewport: { label: 'Invert', keys: ['k'] },
      nextImage: { label: 'Next Image', keys: ['j'] },
      ...SEG_DEFAULT_VALUES,
      'segEditor:undo': { label: 'Undo', keys: ['u'] },
    });
    expect(mockManager.hotkeyDefinitions.invertViewport.keys).toEqual(['k']);
    expect(byId('hotkey-application-invertViewport').value).toBe('k');
    expect(saveButton()).toBeNull();
  });

  it('keeps a change the server rejected over a stored section read again for the retry', async () => {
    pendingHydration();
    settleHotkeyHydration({ hydrated: false });
    mockReadSection.mockResolvedValue({
      version: '0.4',
      values: { invertViewport: { label: 'Invert', keys: ['i'] }, nextImage: { label: 'Next Image', keys: ['j'] } },
    });
    mount();
    press(byId('hotkey-application-invertViewport'), 'k');
    mockMutate.mockRejectedValueOnce(new Error('rejected'));
    await save();
    expect(saveButton()).not.toBeNull();

    await save();
    expect(mockMutate).toHaveBeenCalledTimes(2);
    expect(lastPayload().values.invertViewport.keys).toEqual(['k']);
    expect(lastPayload().values.nextImage.keys).toEqual(['j']);
    expect(mockManager.hotkeyDefinitions.invertViewport.keys).toEqual(['k']);
    expect(saveButton()).toBeNull();
  });

  it('refuses a held Save when the stored bindings that land conflict with it, until it is resolved', async () => {
    pendingHydration();
    mount();
    press(byId('hotkey-application-invertViewport'), 'k');
    await save();

    hydrate({ segEditor: { undo: { keys: ['k'] } } });
    await act(async () => settleHotkeyHydration({ hydrated: true }));

    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockManager.hotkeyDefinitions.invertViewport.keys).toEqual(['i']);
    expect(mockNotify.mock.calls[0][0]).toMatchObject({ title: 'HotkeysNotSaved', type: 'error' });
    const field = () => byId('hotkey-application-invertViewport');
    expect(field().value).toBe('k');
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(byId(field().getAttribute('aria-describedby')).textContent).toBe(
      '"Undo" (GeneralTabSegEditor) is already using the "k" shortcut.'
    );
    expect(saveButton().disabled).toBe(true);

    press(field(), 'q');
    await save();
    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(lastPayload().values.invertViewport.keys).toEqual(['q']);
    expect(lastPayload().values['segEditor:undo'].keys).toEqual(['k']);
    expect(saveButton()).toBeNull();
  });

  it('refuses a Save that conflicts with the stored section read for it, until it is resolved', async () => {
    pendingHydration();
    settleHotkeyHydration({ hydrated: false });
    mockReadSection.mockResolvedValue({
      version: '0.4',
      values: { 'segEditor:undo': { label: 'Undo', keys: ['k'] } },
    });
    mount();
    press(byId('hotkey-application-invertViewport'), 'k');
    await save();

    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockManager.setHotkeys).not.toHaveBeenCalled();
    expect(mockHolder.preferences.getSegEditorHotkeys().undo.keys).toEqual(['ctrl', 'z']);
    const field = () => byId('hotkey-application-invertViewport');
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(byId(field().getAttribute('aria-describedby')).textContent).toBe(
      '"Undo" (GeneralTabSegEditor) is already using the "k" shortcut.'
    );

    press(field(), 'q');
    await save();
    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(lastPayload().values.invertViewport.keys).toEqual(['q']);
    expect(lastPayload().values['segEditor:undo'].keys).toEqual(['k']);
    expect(mockHolder.preferences.getSegEditorHotkeys().undo.keys).toEqual(['k']);
    expect(saveButton()).toBeNull();
  });

  it('keeps a binding changed again while a Save is held as an unsaved draft', async () => {
    pendingHydration();
    mount();
    press(byId('hotkey-application-invertViewport'), 'k');
    await save();
    press(byId('hotkey-application-invertViewport'), 'q');
    await act(async () => settleHotkeyHydration({ hydrated: true }));

    expect(lastPayload().values.invertViewport.keys).toEqual(['k']);
    expect(mockManager.hotkeyDefinitions.invertViewport.keys).toEqual(['k']);
    expect(byId('hotkey-application-invertViewport').value).toBe('q');
    expect(saveButton()).not.toBeNull();
    expect(cancelButton()).not.toBeNull();
  });

  it('keeps Save after a save the server rejected, until one goes through', async () => {
    mount();
    press(byId('hotkey-application-invertViewport'), 'k');
    mockMutate.mockRejectedValueOnce(new Error('rejected'));
    await save();
    expect(mockNotify.mock.calls[0][0]).toMatchObject({ type: 'error' });
    expect(saveButton()).not.toBeNull();

    await save();
    expect(mockMutate).toHaveBeenCalledTimes(2);
    expect(saveButton()).toBeNull();
  });

  it('resets both tabs to their defaults without saving', () => {
    mockManager.hotkeyDefinitions.invertViewport.keys = ['x'];
    mockHolder.preferences.setSegEditorHotkeys({ undo: { keys: ['u'] } });
    mount();
    expect(byId('hotkey-application-invertViewport').value).toBe('x');

    click(document.querySelector('[data-cy="settings-reset"]'));

    expect(byId('hotkey-application-invertViewport').value).toBe('i');
    openTab('hotkey-settings-seg-editor');
    expect(byId('hotkey-seg-editor-undo').value).toBe('ctrl+z');
    expect(mockMutate).not.toHaveBeenCalled();
    expect(cancelButton()).not.toBeNull();
  });
});
