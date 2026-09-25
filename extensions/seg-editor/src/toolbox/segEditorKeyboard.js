// Keyboard support for the Segmentation Editor.
//
// - The active 2D viewport: the one under the pointer, or the last one the pointer was over or
//   clicked (the first 2D viewport until then). Image scrolling acts on it.
// - The viewer's hotkeys (HotkeysManager, configured in the app config and the user's hotkey
//   preferences) run commands in the active context; the editor defines nextImage / previousImage
//   in its own context, so the configured Up / Down keys scroll the editor's active 2D viewport.
// - Editor keys: bindings that only apply while the editor is open, such as A / D for scrolling,
//   so a hand can stay on the keyboard while the other works the mouse, and Ctrl/Cmd+Z / Y for
//   undo / redo. They run commands in the editor's command context.

import { SEG_EDITOR_COMMAND_CONTEXT } from './constants';
import { setSegEditorActiveViewport } from './segEditorToolContext';


// Editor-only key bindings. `keys` are KeyboardEvent.key values (letters in lower case), with a
// `mod+` prefix for Ctrl (Cmd on macOS) and `shift+` for Shift held with it. A key without `mod+`
// only matches when neither Ctrl/Cmd nor Alt is held.
export const SEG_EDITOR_KEY_BINDINGS = [
  { commandName: 'previousImage', keys: ['a'], label: 'Previous Image' },
  { commandName: 'nextImage', keys: ['d'], label: 'Next Image' },
  { commandName: 'undoSegEditor', keys: ['mod+z'], label: 'Undo' },
  { commandName: 'redoSegEditor', keys: ['mod+y', 'mod+shift+z'], label: 'Redo' },
];

/** The binding key of a keydown ('a', 'mod+z', 'mod+shift+z'), or null with Alt held */
export function keyBindingOf(event) {
  if (event.altKey || !event.key) {
    return null;
  }
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (event.ctrlKey || event.metaKey) {
    return `mod+${event.shiftKey ? 'shift+' : ''}${key}`;
  }
  return key;
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
 * @param {Object} params
 * @param {Object} params.commandsManager
 * @param {Object[]} [params.bindings]
 * @param {EventTarget} [params.target] - receives the key events (default: window)
 * @returns {Function} detach
 */
export function attachSegEditorKeyBindings({
  commandsManager, bindings = SEG_EDITOR_KEY_BINDINGS, target = window,
}) {
  const commandForKey = new Map();
  bindings.forEach(({ commandName, keys }) => keys.forEach(key => commandForKey.set(key, commandName)));

  const onKeyDown = event => {
    if (event.defaultPrevented || _isTextInput(event.target)) {
      return;
    }
    const commandName = commandForKey.get(keyBindingOf(event));
    if (commandName) {
      event.preventDefault();
      commandsManager.runCommand(commandName, {}, SEG_EDITOR_COMMAND_CONTEXT);
    }
  };

  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
}
