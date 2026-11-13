// The `general` preference section as the viewer holds it at runtime, and its write path.
//
// The section's values live with the feature that reads them -- the language with i18n (or, while
// the selector is hidden, as it was stored: lib/languagePreference.js), the offline-transfer
// settings with DownloadManagerService, the rest with UserPreferencesService -- and a section POST
// replaces the section wholesale. So every write of the section, a dialog's "don't ask again" or
// Settings' Save, lays its own keys over a base that holds the user's settings: a write still
// queued, the holders once startup hydration has landed, or the stored section read for the
// purpose. Before hydration lands the holders carry built-in defaults, and writing those would
// replace whatever the user had stored for the keys the write does not set.

import { DownloadManagerService, RETRY_ATTEMPTS_DEFAULT, UserPreferencesService } from '@ohif/core';

import { getUserPreferenceSection } from '../api/preferences';
import {
  ARCHIVE_TRANSFER_DEFAULT,
  ARCHIVE_TRANSFER_PREFERENCE_KEY,
  LANGUAGE_SELECTION_ENABLED,
  PREFERENCES_VERSION,
  PREFERENCE_SECTIONS,
  PREFERENCE_SECTION_PATHS,
  RETRY_ATTEMPTS_PREFERENCE_KEY,
} from '../constants/preferences';
import { whenGeneralHydrated } from './generalHydration';
import { languagePreferenceValue, visibleLanguageValue } from './languagePreference';
import { getPendingPreferenceWrite, submitPreferenceWrite } from './preferenceWriteQueue';


/** The section's current values, from every runtime holder. */
export const composeGeneralPreferenceValues = () => ({
  language: languagePreferenceValue(),
  [ARCHIVE_TRANSFER_PREFERENCE_KEY]:
    DownloadManagerService?.isArchiveTransferEnabled?.() ?? ARCHIVE_TRANSFER_DEFAULT,
  [RETRY_ATTEMPTS_PREFERENCE_KEY]:
    DownloadManagerService?.getRetryAttempts?.() ?? RETRY_ATTEMPTS_DEFAULT,
  ...UserPreferencesService.getGeneralValues(),
});

const GENERAL_KEY = PREFERENCE_SECTION_PATHS[PREFERENCE_SECTIONS.GENERAL];

/** The values of the general write still queued for this user, if any: newer than the server. */
const pendingGeneralValues = () => {
  const pending = getPendingPreferenceWrite(GENERAL_KEY);
  return pending && pending.payload && pending.payload.values;
};

/**
 * The values a write of the section lays its own keys over, once they are known to be the user's.
 * In order of precedence:
 * - a write of the section still queued for this user, since it is newer than anything the
 *   server holds and would otherwise be dequeued or coalesced away by this write;
 * - the runtime holders, once startup hydration has settled with them authoritative;
 * - otherwise (hydration failed, or a queued write kept it off the holders and has since gone
 *   through) the stored section, read now -- and if a write was queued while that read was in
 *   flight, that write instead.
 * Rejects when the stored section cannot be read: nothing can then serve as the base.
 */
export const resolveGeneralBase = async () => {
  let base = pendingGeneralValues();

  if (!base) {
    const { hydrated } = await whenGeneralHydrated();
    base = pendingGeneralValues();

    if (!base && hydrated) {
      base = composeGeneralPreferenceValues();
    } else if (!base) {
      const stored = await getUserPreferenceSection(PREFERENCE_SECTIONS.GENERAL, PREFERENCES_VERSION);
      base = pendingGeneralValues() || (stored && stored.values) || {};
    }
  }

  return base;
};

// Writes of the section, one after another: each reads its base and has been submitted before the
// next begins. The write queue orders submissions, not the reads before them, so two writes
// reading their bases at once could submit in the reverse of the order they were made, and an
// older choice would land last.
let sectionWrites = Promise.resolve();
const inOrder = (write) => {
  const run = sectionWrites.then(write);
  sectionWrites = run.catch(() => {});
  return run;
};

/**
 * Post the section through the write queue (FR-7), over the base above, with the service's keys
 * laid on it. If the base cannot be read, nothing is written: the choice stays in effect for the
 * session and the next Settings save carries it, rather than a default-filled section replacing
 * what the user stored.
 */
export const persistGeneralPreferences = () =>
  inOrder(async () => {
    const base = await resolveGeneralBase();

    return submitPreferenceWrite({
      key: GENERAL_KEY,
      section: PREFERENCE_SECTIONS.GENERAL,
      payload: { version: PREFERENCES_VERSION, values: { ...base, ...UserPreferencesService.getGeneralValues() } },
    });
  });

/**
 * The section Settings' Save posts: `fields`, the page's own keys, over the base above and the
 * service's keys. While the language selector is offered, the language the user sees is part of
 * the page and is written as shown; and if the base cannot be read, every key of the section is
 * then on screen, so the holders serve as it, as they did before. While the selector is hidden,
 * the language is not on screen, so an unreadable base rejects rather than write the running
 * default over the stored language.
 */
export const composeGeneralSettingsWrite = async (fields, { languageSelection = LANGUAGE_SELECTION_ENABLED } = {}) => {
  let base;
  try {
    base = await resolveGeneralBase();
  } catch (error) {
    if (!languageSelection) {
      throw error;
    }
    base = composeGeneralPreferenceValues();
  }

  return {
    version: PREFERENCES_VERSION,
    values: {
      ...base,
      ...visibleLanguageValue(languageSelection),
      ...UserPreferencesService.getGeneralValues(),
      ...fields,
    },
  };
};

/**
 * A Settings save: compose the section for `fields` and hand it to `submit`, in order with every
 * other write of the section, so a later save reads its base only once an earlier one has been
 * submitted, and the newest choice is the one that lands last. `submit` receives the payload and
 * returns a promise that settles once the write has gone through or been refused. Rejects, having
 * submitted nothing, when the base cannot be read (composeGeneralSettingsWrite).
 */
export const saveGeneralSettings = (fields, submit, options) =>
  inOrder(async () => submit(await composeGeneralSettingsWrite(fields, options)));
