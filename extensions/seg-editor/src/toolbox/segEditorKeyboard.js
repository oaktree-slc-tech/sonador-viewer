// Keyboard support for the Segmentation Editor.
//
// - The active 2D viewport: the one under the pointer, or the last one the pointer was over or
//   clicked (the first 2D viewport until then). Image scrolling acts on it.
// - The viewer's hotkeys (HotkeysManager, configured in the app config and the user's hotkey
//   preferences) run commands in the active context; the editor defines nextImage / previousImage
//   in its own context, so the configured Up / Down keys scroll the editor's active 2D viewport.
// - Editor keys: bindings that only apply while the editor is open, such as A / D for scrolling,
//   so a hand can stay on the keyboard while the other works the mouse, and Ctrl/Cmd+Z / Y for
//   undo / redo. They run commands in the editor's command context. The bindings are the user's
//   Segmentation Editor hotkey preferences (UserPreferencesService, edited under Settings >
//   Hotkeys), handed in by the layout.

import { canonicalKeyCombination } from '@ohif/core';

import { SEG_EDITOR_COMMAND_CONTEXT } from './constants';
import { setSegEditorActiveViewport } from './segEditorToolContext';


// The hotkey vocabulary's names for the keys KeyboardEvent.key spells differently
const KEY_NAMES = {
  ' ': 'space',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
  arrowup: 'up',
  delete: 'del',
  escape: 'esc',
  insert: 'ins',
};

// The unshifted character of the keys whose KeyboardEvent.key changes with Shift held, by
// KeyboardEvent.code: a recorded combination names the key itself (`shift+/`, not `?`)
const CODE_CHARACTERS = {
  Backquote: '`', Backslash: '\\', BracketLeft: '[', BracketRight: ']', Comma: ',', Equal: '=', Minus: '-',
  Period: '.', Quote: "'", Semicolon: ';', Slash: '/',
};

const MODIFIERS = ['ctrl', 'alt', 'shift'];

function _combination(modifiers, key) {
  return [...MODIFIERS.filter(modifier => modifiers.has(modifier)), key].join('+');
}

/**
 * The canonical form of a binding's key combination, for comparison with `keyBindingOf`. The
 * Settings page refuses conflicting bindings by the same form.
 *
 * @input keys (string[]): one combination in the hotkey vocabulary, e.g. `['ctrl', 'shift', 'z']`
 * @returns (string): e.g. `ctrl+shift+z`; Cmd counts as `ctrl`
 */
export function normalizeKeyCombination(keys = []) {
  return canonicalKeyCombination(keys, { ctrlMatchesMeta: true });
}

/**
 * The key combination of a keydown in canonical form (`a`, `ctrl+z`, `ctrl+shift+z`, `up`).
 *
 * @input event (KeyboardEvent)
 * @returns (string|null): null for an event without a key
 */
export function keyBindingOf(event) {
  if (!event.key) {
    return null;
  }
  const modifiers = new Set();
  if (event.ctrlKey || event.metaKey) {
    modifiers.add('ctrl');
  }
  if (event.altKey) {
    modifiers.add('alt');
  }
  if (event.shiftKey) {
    modifiers.add('shift');
  }

  const digit = /^(?:Digit|Numpad)(\d)$/.exec(event.code || '');
  const lower = event.key.toLowerCase();
  let key = KEY_NAMES[lower] || lower;
  if (event.shiftKey && digit) {
    key = digit[1];
  } else if (event.shiftKey && CODE_CHARACTERS[event.code]) {
    key = CODE_CHARACTERS[event.code];
  }
  return _combination(modifiers, key);
}

/**
 * Make a 2D viewport the active one when the pointer enters it or presses on it.
 *
 * @returns {Function} detach
 */
export function trackActiveViewport({ viewportId, element }) {
  const activate = () => setSegEditorActiveViewport(viewportId);
  element.addEventListener('pointerenter', activate);
  element.addEventListener('pointerdown', activate);
  return () => {
    element.removeEventListener('pointerenter', activate);
    element.removeEventListener('pointerdown', activate);
  };
}

function _isTextInput(target) {
  const tag = target?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target?.isContentEditable;
}

/**
 * Listen for the editor's key bindings.
 *
 * @input commandsManager (Object)
 * @input bindings (Object[] | function(): Object[]): `{ commandName: string, keys: string[] }`
 *   entries, `keys` one combination each; a function is read at every keypress, so a change to the
 *   user's bindings applies without re-attaching
 * @input target (EventTarget): receives the key events (default: window)
 * @returns (Function): detach
 */
export function attachSegEditorKeyBindings({ commandsManager, bindings = [], target = window }) {
  const commandFor = combination => {
    const current = typeof bindings === 'function' ? bindings() : bindings;
    const match = (current || []).find(({ keys }) => normalizeKeyCombination(keys) === combination);
    return match && match.commandName;
  };

  const onKeyDown = event => {
    if (event.defaultPrevented || _isTextInput(event.target)) {
      return;
    }
    const combination = keyBindingOf(event);
    const commandName = combination && commandFor(combination);
    if (commandName) {
      event.preventDefault();
      commandsManager.runCommand(commandName, {}, SEG_EDITOR_COMMAND_CONTEXT);
    }
  };

  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
}
