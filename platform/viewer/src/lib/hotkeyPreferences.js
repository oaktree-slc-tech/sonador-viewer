// The `hotkeys` preference section holds two sets of bindings in one flat map, every entry
// `{ keys: string[], label: string }` (the shape the server's section form accepts):
//
//   <commandName>            the application's hotkeys, run by the HotkeysManager
//   segEditor:<binding id>   the Segmentation Editor's own keys, held by UserPreferencesService
//
// A section POST replaces the section wholesale, so a save always carries both sets, and lays the
// bindings the user changed over a base known to be the user's (resolveStoredHotkeys). No React.

import { SEG_EDITOR_HOTKEY_PREFIX } from '@ohif/core';

import { getUserPreferenceSection } from '../api/preferences';
import { PREFERENCE_SECTION_PATHS, PREFERENCE_SECTIONS, PREFERENCES_VERSION } from '../constants/preferences';
import { whenHotkeysHydrated } from './hotkeyHydration';
import { getPendingPreferenceWrite } from './preferenceWriteQueue';

const entryOf = ({ keys, label }) => ({ keys, label });

/**
 * Separate the stored section into its two sets.
 *
 * @input values (Object): the section's values, may be null
 * @returns (Object): `{ application, segEditor }`, `application` keyed by command name and
 *   `segEditor` by binding id, entries as stored
 */
export function splitHotkeyValues(values) {
  const application = {};
  const segEditor = {};
  Object.entries(values || {}).forEach(([name, definition]) => {
    if (name.startsWith(SEG_EDITOR_HOTKEY_PREFIX)) {
      segEditor[name.slice(SEG_EDITOR_HOTKEY_PREFIX.length)] = definition;
    } else {
      application[name] = definition;
    }
  });
  return { application, segEditor };
}

/**
 * The section's values for a save: both sets, keys and label only (a binding's scope and command
 * stay with its definition).
 *
 * @input application (Object): command name -> `{ keys, label }`
 * @input segEditor (Object): binding id -> `{ keys, label }`
 * @returns (Object): the flat map the section stores
 */
export function composeHotkeyValues(application, segEditor) {
  return {
    ...Object.fromEntries(Object.entries(application || {}).map(([name, definition]) => [name, entryOf(definition)])),
    ...Object.fromEntries(
      Object.entries(segEditor || {}).map(([id, definition]) => [SEG_EDITOR_HOTKEY_PREFIX + id, entryOf(definition)])
    ),
  };
}

const HOTKEYS_KEY = PREFERENCE_SECTION_PATHS[PREFERENCE_SECTIONS.HOTKEYS];

// The values of the hotkeys write still queued for this user, if any: newer than the server
const pendingHotkeyValues = () => {
  const pending = getPendingPreferenceWrite(HOTKEYS_KEY);
  return pending && pending.payload && pending.payload.values;
};

/**
 * The user's stored bindings, where the bindings in effect cannot stand for them. A save lays the
 * changed bindings over this, so the ones the user did not touch are written as stored. In order
 * of precedence:
 * - a write of the section still queued for this user, which is newer than anything the server
 *   holds and would be replaced by this save;
 * - the bindings in effect, once startup hydration has settled with them authoritative;
 * - otherwise (hydration failed) the stored section, read now.
 * Rejects when the stored section cannot be read: nothing can then serve as the base.
 *
 * @returns (Promise<Object|null>): `{ application, segEditor }` as stored (splitHotkeyValues), or
 *   null when the bindings in effect are the user's (hydration landed, or nothing is stored)
 */
export const resolveStoredHotkeys = async () => {
  let values = pendingHotkeyValues();

  if (!values) {
    const { hydrated } = await whenHotkeysHydrated();
    values = pendingHotkeyValues();

    if (!values && !hydrated) {
      const stored = await getUserPreferenceSection(PREFERENCE_SECTIONS.HOTKEYS, PREFERENCES_VERSION);
      values = pendingHotkeyValues() || (stored && stored.values);
    }
  }

  return values && Object.keys(values).length ? splitHotkeyValues(values) : null;
};

// Saves of the section, one after another: each resolves its base and is submitted before the
// next begins, so the newest save is the one that lands last
let sectionSaves = Promise.resolve();

/**
 * Run a save of the section in order with every other.
 *
 * @input save (function(): Promise): resolves its base, applies and submits
 * @returns (Promise): the save's own result
 */
export const saveHotkeysInOrder = (save) => {
  const run = sectionSaves.then(save);
  sectionSaves = run.catch(() => {});
  return run;
};
