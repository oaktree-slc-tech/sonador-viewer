// Segmentation Editor keyboard support: active 2D viewport tracking and editor key bindings

// The comparison the Settings page refuses conflicts by, from its source
jest.mock('@ohif/core', () => jest.requireActual('@ohif/core/src/utils/keyCombination'), { virtual: true });

import { SEG_EDITOR_HOTKEY_DEFAULTS } from '@ohif/core/src/services/UserPreferencesService/UserPreferencesService';

import { attachSegEditorKeyBindings, keyBindingOf, normalizeKeyCombination, trackActiveViewport } from './segEditorKeyboard';
import { SEG_EDITOR_COMMAND_CONTEXT } from './constants';
import {
  clearSegEditorToolContext,
  getSegEditorToolContext,
  setSegEditorToolContext,
} from './segEditorToolContext';

jest.mock('@ohif/extension-vtk', () => ({ Enums: { CORNERSTONE: {} } }));
jest.mock('@cornerstonejs/tools', () => ({ ToolGroupManager: { getToolGroup: () => undefined } }), { virtual: true });

class FakeTarget {
  constructor() {
    this.listeners = {};
  }

  addEventListener(type, listener) {
    (this.listeners[type] = this.listeners[type] || new Set()).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners[type]?.delete(listener);
  }

  dispatch(type, event = {}) {
    const full = { type, preventDefault: jest.fn(), ...event };
    [...(this.listeners[type] || [])].forEach(listener => listener(full));
    return full;
  }
}

// The bindings the editor starts with: the preference defaults
const DEFAULT_BINDINGS = Object.values(SEG_EDITOR_HOTKEY_DEFAULTS);

beforeEach(() => {
  clearSegEditorToolContext();
  setSegEditorToolContext({ toolGroupId: 'tg', viewportIds: ['axial', 'coronal', 'sagittal'] });
});

describe('trackActiveViewport', () => {
  it('starts on the first 2D viewport and follows the pointer', () => {
    const coronal = new FakeTarget();
    const sagittal = new FakeTarget();
    trackActiveViewport({ viewportId: 'coronal', element: coronal });
    const detach = trackActiveViewport({ viewportId: 'sagittal', element: sagittal });

    expect(getSegEditorToolContext().activeViewportId).toBe('axial');

    coronal.dispatch('pointerenter');
    expect(getSegEditorToolContext().activeViewportId).toBe('coronal');

    sagittal.dispatch('pointerdown');
    expect(getSegEditorToolContext().activeViewportId).toBe('sagittal');

    detach();
    coronal.dispatch('pointerenter');
    sagittal.dispatch('pointerenter');
    expect(getSegEditorToolContext().activeViewportId).toBe('coronal');
  });

  it('keeps the active viewport when the palette context is republished', () => {
    const coronal = new FakeTarget();
    trackActiveViewport({ viewportId: 'coronal', element: coronal });
    coronal.dispatch('pointerenter');

    setSegEditorToolContext({ toolGroupId: 'tg', segmentationId: 'seg::edit' });

    expect(getSegEditorToolContext().activeViewportId).toBe('coronal');
  });
});

describe('attachSegEditorKeyBindings', () => {
  function setup(bindings = DEFAULT_BINDINGS) {
    const target = new FakeTarget();
    const commandsManager = { runCommand: jest.fn() };
    const detach = attachSegEditorKeyBindings({ commandsManager, target, bindings: () => bindings });
    return { target, commandsManager, detach };
  }

  it('A steps up the stack and D steps down, in the editor command context', () => {
    const { target, commandsManager } = setup();

    const event = target.dispatch('keydown', { key: 'a' });
    target.dispatch('keydown', { key: 'D' });

    expect(commandsManager.runCommand.mock.calls).toEqual([
      ['previousImage', {}, SEG_EDITOR_COMMAND_CONTEXT],
      ['nextImage', {}, SEG_EDITOR_COMMAND_CONTEXT],
    ]);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('Ctrl/Cmd+Z undoes; Ctrl/Cmd+Y and Ctrl/Cmd+Shift+Z redo', () => {
    const { target, commandsManager } = setup();

    target.dispatch('keydown', { key: 'z', ctrlKey: true });
    target.dispatch('keydown', { key: 'Z', metaKey: true });
    target.dispatch('keydown', { key: 'y', ctrlKey: true });
    target.dispatch('keydown', { key: 'Z', metaKey: true, shiftKey: true });
    target.dispatch('keydown', { key: 'z' }); // plain Z does nothing

    expect(commandsManager.runCommand.mock.calls.map(([name]) => name))
      .toEqual(['undoSegEditor', 'undoSegEditor', 'redoSegEditor', 'redoSegEditor']);
  });

  it('leaves Ctrl/Cmd+Z in a text field to the field', () => {
    const { target, commandsManager } = setup();

    target.dispatch('keydown', { key: 'z', ctrlKey: true, target: { tagName: 'INPUT' } });

    expect(commandsManager.runCommand).not.toHaveBeenCalled();
  });

  it('ignores typing, modified keys, handled events and other keys', () => {
    const { target, commandsManager } = setup();

    target.dispatch('keydown', { key: 'a', target: { tagName: 'INPUT' } });
    target.dispatch('keydown', { key: 'd', ctrlKey: true });
    target.dispatch('keydown', { key: 'd', metaKey: true });
    target.dispatch('keydown', { key: 'a', defaultPrevented: true });
    target.dispatch('keydown', { key: 'x' });
    target.dispatch('keydown', { key: 'ArrowUp' }); // the viewer's hotkeys handle the arrows

    expect(commandsManager.runCommand).not.toHaveBeenCalled();
  });

  it('follows a change to the bindings without re-attaching', () => {
    const bindings = [{ commandName: 'nextImage', keys: ['d'] }];
    const { target, commandsManager } = setup(bindings);

    bindings[0] = { commandName: 'nextImage', keys: ['shift', 'right'] };
    target.dispatch('keydown', { key: 'd' });
    target.dispatch('keydown', { key: 'ArrowRight', shiftKey: true });

    expect(commandsManager.runCommand.mock.calls).toEqual([['nextImage', {}, SEG_EDITOR_COMMAND_CONTEXT]]);
  });

  it('matches a recorded combination: modifiers exactly, shifted symbols by their key', () => {
    const { target, commandsManager } = setup([
      { commandName: 'undoSegEditor', keys: ['alt', 'u'] },
      { commandName: 'redoSegEditor', keys: ['shift', '/'] },
      { commandName: 'nextImage', keys: ['meta', 'k'] },
    ]);

    target.dispatch('keydown', { key: 'u' }); // Alt not held
    target.dispatch('keydown', { key: 'u', altKey: true });
    target.dispatch('keydown', { key: '?', code: 'Slash', shiftKey: true });
    target.dispatch('keydown', { key: 'k', ctrlKey: true });

    expect(commandsManager.runCommand.mock.calls.map(([name]) => name))
      .toEqual(['undoSegEditor', 'redoSegEditor', 'nextImage']);
  });

  it('stops listening when detached', () => {
    const { target, commandsManager, detach } = setup();

    detach();
    target.dispatch('keydown', { key: 'a' });

    expect(commandsManager.runCommand).not.toHaveBeenCalled();
  });
});

describe('key combinations', () => {
  it('puts a binding and a keypress in the same form', () => {
    expect(normalizeKeyCombination(['shift', 'ctrl', 'Z'])).toBe('ctrl+shift+z');
    expect(normalizeKeyCombination(['meta', 'z'])).toBe('ctrl+z');
    expect(normalizeKeyCombination(['shift', '+'])).toBe('shift++');
    expect(keyBindingOf({ key: 'Z', metaKey: true, shiftKey: true })).toBe('ctrl+shift+z');
    expect(keyBindingOf({ key: ' ' })).toBe('space');
    expect(keyBindingOf({ key: '!', code: 'Digit1', shiftKey: true })).toBe('shift+1');
    expect(keyBindingOf({})).toBeNull();
  });
});
