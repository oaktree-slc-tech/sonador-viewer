import { hotkeysValidators } from '../../../../components/UserPreferences/hotkeysValidators';

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
/**
 * Take the updated command and keys and validate the changes with all validators
 *
 * @param {string} commandName command name string to be updated
 * @param {string[]} pressedKeys new array of keys to be added for the commandName
 * @param {object} hotkeys all hotkeys currently into the app
 * @returns {Object} {errorMessage} errorMessage coming from any of the validator or undefined if none
 */
export const validateCommandKey = ({ commandName, pressedKeys, hotkeys }) => {
  for (const validator of hotkeysValidators) {
    const validation = validator({
      commandName,
      pressedKeys,
      hotkeys,
    });
    if (validation && validation.hasError) {
      return validation;
    }
  }

  return { errorMessage: undefined };
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
