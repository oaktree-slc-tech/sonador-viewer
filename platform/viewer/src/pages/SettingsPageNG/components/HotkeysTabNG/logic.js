import { canonicalKeyCombination } from '@ohif/core';

import {
  disallowedValidator,
  emptyValidator,
  modifierValidator,
} from '../../../../components/UserPreferences/hotkeysValidators';

/**
 * Take hotkeyDefenintions and build an initialState to be used into the component state
 *
 * @param {Object} hotkeyDefinitions
 * @returns {Object} initialState
 */
export const getInitialState = (hotkeyDefinitions) => ({
  hotkeys: { ...hotkeyDefinitions },
  errors: {},
});
const formatKeys = (keys = []) => keys.join('+');

/**
 * Validate a binding's new keys against the bindings of its own set and of the other set. Two
 * combinations conflict when the handler that runs them treats them as one (canonicalKeyCombination):
 * the application's hotkeys tell Ctrl and Cmd apart, the Segmentation Editor's keys do not, and
 * neither depends on the order of the modifiers. Both sets are live in the editor, so a
 * combination is compared across the sets the way the editor matches it.
 *
 * @input commandName (string): the binding being changed
 * @input pressedKeys (string[]): its new keys
 * @input hotkeys (Object): the bindings of its own set
 * @input otherHotkeys (Object): the bindings of the other set
 * @input otherSetName (string): the other set's name, for the message
 * @input ctrlMatchesMeta (boolean): whether its own set's handler counts Cmd as Ctrl
 * @input supportedCombinations (string[]): canonical combinations (Cmd counted as Ctrl) its
 *   own set's handler takes from the browser, allowed although the browser uses them
 * @returns (Object): `{ errorMessage }`, undefined when the keys are valid
 */
export const validateCommandKey = ({
  commandName,
  pressedKeys,
  hotkeys,
  otherHotkeys = {},
  otherSetName = '',
  ctrlMatchesMeta = false,
  supportedCombinations = [],
}) => {
  const invalid = emptyValidator({ pressedKeys }) || modifierValidator({ pressedKeys });
  if (invalid) {
    return invalid;
  }

  const pressed = formatKeys(pressedKeys);
  const own = canonicalKeyCombination(pressedKeys, { ctrlMatchesMeta });
  const ownConflict = Object.entries(hotkeys).find(
    ([name, { keys }]) => name !== commandName && canonicalKeyCombination(keys, { ctrlMatchesMeta }) === own
  );
  if (ownConflict) {
    return { errorMessage: `"${ownConflict[1].label}" is already using the "${pressed}" shortcut.` };
  }

  const inEditor = canonicalKeyCombination(pressedKeys, { ctrlMatchesMeta: true });
  if (!supportedCombinations.includes(inEditor)) {
    const disallowed = disallowedValidator({ pressedKeys });
    if (disallowed) {
      return disallowed;
    }
  }

  const conflict = Object.values(otherHotkeys).find(
    ({ keys }) => canonicalKeyCombination(keys, { ctrlMatchesMeta: true }) === inEditor
  );
  if (conflict) {
    return { errorMessage: `"${conflict.label}" (${otherSetName}) is already using the "${pressed}" shortcut.` };
  }

  return { errorMessage: undefined };
};

/**
 * Whether two sets of bindings hold the same keys, binding by binding.
 *
 * @input a (Object): binding name -> `{ keys: string[] }`
 * @input b (Object): binding name -> `{ keys: string[] }`
 * @returns (boolean)
 */
export const sameKeys = (a = {}, b = {}) => {
  const names = Object.keys(a);
  return (
    names.length === Object.keys(b).length &&
    names.every((name) => b[name] && formatKeys(a[name].keys) === formatKeys(b[name].keys))
  );
};

/**
 * Take all hotkeys and split the list into two lists
 *
 * @param {object} hotkeys list of all hotkeys
 * @returns {array} array containing two arrays of keys
 */
export const splitHotkeys = (hotkeys) => {
  const splitedHotkeys = [];
  const arrayHotkeys = Object.entries(hotkeys);

  if (arrayHotkeys.length) {
    const halfwayThrough = Math.ceil(arrayHotkeys.length / 2);

    splitedHotkeys.push(arrayHotkeys.slice(0, halfwayThrough));
    splitedHotkeys.push(arrayHotkeys.slice(halfwayThrough, arrayHotkeys.length));
  }

  return splitedHotkeys;
};
