// Comparison of key combinations in the hotkey vocabulary the Settings page records
// (`['ctrl', 'shift', 'z']`). Two handlers run combinations, and they differ in what they treat
// as the same combination: the application's hotkeys (Mousetrap) tell Ctrl and Cmd apart, while
// the Segmentation Editor's keys treat them as one. Neither depends on the order the modifiers
// are written in.

const MODIFIERS = ['ctrl', 'meta', 'alt', 'shift'];
const MODIFIER_ALIASES = { command: 'meta', option: 'alt' };

const _isApplePlatform = () =>
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform || '');

/**
 * The canonical form of a key combination, equal for every spelling the handler treats as one.
 *
 * @input keys (string[]): one combination, e.g. `['shift', 'ctrl', 'z']`
 * @input options (Object): `ctrlMatchesMeta` (boolean, default false): count Cmd as Ctrl, as the
 *   Segmentation Editor's keys do
 * @returns (string): the modifiers in a fixed order, then the key, e.g. `ctrl+shift+z`
 */
export function canonicalKeyCombination(keys = [], { ctrlMatchesMeta = false } = {}) {
  const names = (keys || [])
    .map(name => String(name).toLowerCase())
    .map(name => MODIFIER_ALIASES[name] || name)
    // `mod` is Cmd on Apple platforms and Ctrl elsewhere
    .map(name => (name === 'mod' ? (_isApplePlatform() && !ctrlMatchesMeta ? 'meta' : 'ctrl') : name))
    .map(name => (ctrlMatchesMeta && name === 'meta' ? 'ctrl' : name));
  const modifiers = MODIFIERS.filter(modifier => names.includes(modifier));
  const key = names.filter(name => !MODIFIERS.includes(name)).pop() || '';
  return [...modifiers, key].join('+');
}

export default canonicalKeyCombination;
