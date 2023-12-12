import { MODIFIER_KEYS } from '../../../../components/UserPreferences/hotkeysConfig';

/**
 * Take the pressed key array and return the readable string for the keys
 *
 * @param {Array} keys
 * @returns {string} string representation of an array of keys
 */
export const formatKeysForInput = (keys = []) => keys.join('+');

/**
 * formats given keys sequence to insert the modifier keys in the first index of the array
 * @param {string} sequence keys sequence from MouseTrap Record -> "shift+left"
 * @returns {Array} keys in array-format -> ['shift','left']
 */
export const getKeys = (sequence) => {
  const keysArray = sequence.join(' ').split('+');
  let keys = [];
  let modifiers = [];

  keysArray.forEach((key) => {
    if (MODIFIER_KEYS.includes(key)) {
      modifiers.push(key);
    } else {
      keys.push(key);
    }
  });

  return [...modifiers, ...keys];
};
