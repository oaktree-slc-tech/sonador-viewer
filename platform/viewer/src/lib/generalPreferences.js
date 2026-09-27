// The `general` preference section as the viewer holds it at runtime, and its write path.
//
// The section's values live with the feature that reads them -- the language with i18n, the
// offline-transfer settings with DownloadManagerService, the rest with UserPreferencesService --
// and a section POST replaces the section wholesale. So a write made on behalf of ONE key (a
// dialog's "don't ask again", say) is composed from every holder here, rather than from whatever
// form happens to be open -- and only once those holders hold the user's stored settings. Before
// startup hydration lands they hold built-in defaults, and writing those would replace whatever
// the user had stored for the other keys.

import i18n from '@ohif/i18n';
import { DownloadManagerService, RETRY_ATTEMPTS_DEFAULT, UserPreferencesService } from '@ohif/core';

import { getUserPreferenceSection } from '../api/preferences';
import {
  ARCHIVE_TRANSFER_DEFAULT,
  ARCHIVE_TRANSFER_PREFERENCE_KEY,
  PREFERENCES_VERSION,
  PREFERENCE_SECTIONS,
  PREFERENCE_SECTION_PATHS,
  RETRY_ATTEMPTS_PREFERENCE_KEY,
} from '../constants/preferences';
import { whenGeneralHydrated } from './generalHydration';
import { getPendingPreferenceWrite, submitPreferenceWrite } from './preferenceWriteQueue';


/** The section's current values, from every runtime holder. */
export const composeGeneralPreferenceValues = () => ({
  language: i18n.language,
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
 * Post the section through the write queue (FR-7), once its values are known to be the user's.
 *
 * The base the service's keys are laid over, in order of precedence:
 * - a write of the section still queued for this user, since it is newer than anything the
 *   server holds and would otherwise be dequeued or coalesced away by this write;
 * - the runtime holders, once startup hydration has settled with them authoritative;
 * - otherwise (the server could not be read at startup) the stored section, read now -- and if
 *   a write was queued while that read was in flight, that write instead.
 * If nothing can serve as a base, nothing is written: the choice stays in effect for the
 * session and the next Settings save carries it, rather than a default-filled section replacing
 * what the user stored.
 */
export const persistGeneralPreferences = async () => {
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

  return submitPreferenceWrite({
    key: GENERAL_KEY,
    section: PREFERENCE_SECTIONS.GENERAL,
    payload: { version: PREFERENCES_VERSION, values: { ...base, ...UserPreferencesService.getGeneralValues() } },
  });
};
