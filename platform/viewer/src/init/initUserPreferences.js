// Startup hydration of user preferences from the Sonador User Preferences API (sonador#42
// §5.5, FR-9/FR-10/FR-18/FR-20).
//
// Runs once per session, as soon as the OIDC token is available (mounted from the
// authenticated tree in OHIFStandaloneViewer.js -- getAuthToken() must return a token before
// any request fires). Sequence:
//
//   1. Flush the persistent write queue -- writes queued by a previous offline session are
//      newer than the server copy and must land first (FR-20).
//   2. Fetch the full preference document once (FR-5 endpoint).
//   3. Resolve each section/interface (current -> backfill -> defaults, FR-10) and apply it
//      to the existing in-app stores, SKIPPING any key with a pending queued write. Backfilled
//      values are posted up to the current version through the write queue.
//   4. Start the study-list save-on-change sync subscription (§5.7).
//
// Online-first, offline-second (AR-5/FR-9): on any remote failure this module logs and leaves
// the locally cached state (localStorage / zustand persist / redux) in effect -- it must be a
// no-op on error, never a crash or an error dialog.

import i18n from '@ohif/i18n';
import { redux, DownloadManagerService, RETRY_ATTEMPTS_DEFAULT } from '@ohif/core';

import {
  ARCHIVE_TRANSFER_DEFAULT,
  ARCHIVE_TRANSFER_PREFERENCE_KEY,
  RETRY_ATTEMPTS_PREFERENCE_KEY,
  PREFERENCES_VERSION,
  PREFERENCE_SECTIONS,
  PREFERENCE_SECTION_PATHS,
  STUDYLIST_INTERFACE_KEYS,
  STUDYLIST_INTERFACE_STORE_KEYS,
  studylistQueueKey,
} from '../constants/preferences';

import { getUserPreferences } from '../api/preferences';
import {
  flushPreferenceWrites,
  getCurrentPreferenceUser,
  hasPendingPreferenceWrite,
  startPreferenceWriteQueue,
  submitPreferenceWrite,
} from '../lib/preferenceWriteQueue';
import {
  RESOLVED_FROM_CURRENT,
  RESOLVED_FROM_DEFAULTS,
  resolveSection,
  resolveStudylistInterfaces,
} from '../lib/userPreferences';
import {
  setStudylistSyncHydrating,
  startStudylistPreferenceSync,
} from '../lib/studylistPreferenceSync';

import { useStudiesTableFiltersAndColumnsStore } from '../store/useStudiesTableFiltersAndColumnsStore';
import { useViewerMetadataSettingsStore } from '../store/useViewerMetadataSettingsStore';

// Identity the once-per-session latch ran for. Logout goes through the OIDC redirect
// (userManager.signoutRedirect in Header.js), which reloads the page and resets this module
// -- but scope the latch per user anyway, so a future flow that swaps the authenticated user
// without a reload re-hydrates for the new identity instead of keeping the previous user's
// settings applied. null = never ran; '' = ran without a resolvable identity.
let hydratedForUser = null;

const getHotkeysManager = () =>
  // Imported lazily off the App module's global registration to avoid a module cycle
  // (App.js -> OHIFStandaloneViewer -> this module).
  (typeof window !== 'undefined' && window.ohif && window.ohif.app && window.ohif.app.hotkeysManager) || null;

const getReduxStore = () => (typeof window !== 'undefined' && window.store) || null;

const applyGeneral = (values) => {
  if (typeof values.language === 'string' && values.language && values.language !== i18n.language) {
    void i18n.changeLanguage(values.language);
  }

  // Offline-storage transfer strategy (ohif-viewers#129, FR-1). The service is a module singleton
  // outside the React tree and reads this when a job STARTS, so hydrating it here is all the
  // plumbing the download queue needs. An absent key means the stored document predates the
  // preference: fall back to the default rather than leaving whatever a previous identity set.
  if (DownloadManagerService) {
    const enabled = values[ARCHIVE_TRANSFER_PREFERENCE_KEY];
    // `applyHydrated...`, not `set...`: this fetch may resolve after the user has already changed
    // the setting in Settings, and a value read before that change must not reinstate itself.
    DownloadManagerService.applyHydratedArchiveTransfer(
      typeof enabled === 'boolean' ? enabled : ARCHIVE_TRANSFER_DEFAULT
    );

    // Per-instance attempt budget (ohif-viewers#131, FR-12). Same hydration rules, and the
    // service clamps the value, so a document written by a future release (or edited by hand)
    // cannot put a job on an unbounded retry loop.
    const attempts = values[RETRY_ATTEMPTS_PREFERENCE_KEY];
    DownloadManagerService.applyHydratedRetryAttempts(
      typeof attempts === 'number' ? attempts : RETRY_ATTEMPTS_DEFAULT
    );
  }
};

const applyHotkeys = (values) => {
  const hotkeysManager = getHotkeysManager();
  if (!hotkeysManager) {
    return;
  }
  hotkeysManager.setHotkeys(values);
  // Cloud values overwrite the local cache on successful load (AR-5) -- the same key
  // _initHotkeys reads before authentication.
  try {
    localStorage.setItem('hotkey-definitions', JSON.stringify(values));
  } catch (e) {
    // Cache write is best-effort.
  }
};

const applyWindowLevel = (values) => {
  const store = getReduxStore();
  if (!store) {
    return;
  }
  store.dispatch(redux.actions.setUserPreferences({ windowLevelData: values }));
};

const VIEWER_METADATA_SETTERS = {
  topLeftCorner: 'setTopLeftCorner',
  topRightCorner: 'setTopRightCorner',
  bottomLeftCorner: 'setBottomLeftCorner',
  bottomRightCorner: 'setBottomRightCorner',
};

const applyViewerMetadata = (values) => {
  const store = useViewerMetadataSettingsStore.getState();
  for (const [corner, setter] of Object.entries(VIEWER_METADATA_SETTERS)) {
    if (Array.isArray(values[corner])) {
      store[setter](values[corner]);
    }
  }
};

const SECTION_APPLIERS = {
  [PREFERENCE_SECTIONS.GENERAL]: applyGeneral,
  [PREFERENCE_SECTIONS.HOTKEYS]: applyHotkeys,
  [PREFERENCE_SECTIONS.WINDOW_LEVEL]: applyWindowLevel,
  [PREFERENCE_SECTIONS.VIEWER_METADATA]: applyViewerMetadata,
};

const backfillToCurrentVersion = (key, section, values) => {
  // FR-10: values resolved from an older release are posted up under the current version,
  // through the write queue like every other mutation (AR-10). A rejection here (e.g. a
  // legacy shape the section form no longer accepts) is logged and dropped -- the values
  // still apply locally for this session.
  void submitPreferenceWrite({
    key,
    section,
    payload: { version: PREFERENCES_VERSION, values },
  }).catch((error) => {
    console.warn(`User preferences: backfill for "${key}" was rejected by the server.`, error);
  });
};

const applyViewerSections = (viewerDocument) => {
  for (const [section, apply] of Object.entries(SECTION_APPLIERS)) {
    const key = PREFERENCE_SECTION_PATHS[section];

    // FR-20: a pending queued write means the local value is newer than the server copy --
    // it is being flushed, not overwritten.
    if (hasPendingPreferenceWrite(key)) {
      console.warn(`User preferences: section "${section}" has a pending queued write; skipping remote apply.`);
      continue;
    }

    const { values, resolvedFrom } = resolveSection(viewerDocument, section, PREFERENCES_VERSION);
    if (resolvedFrom === RESOLVED_FROM_DEFAULTS) {
      // Nothing stored in any version: the locally cached / built-in state stays in effect
      // (the resolver already logged the one warning per section).
      continue;
    }

    try {
      apply(values);
    } catch (error) {
      console.error(`User preferences: failed to apply section "${section}".`, error);
      continue;
    }

    if (resolvedFrom !== RESOLVED_FROM_CURRENT) {
      backfillToCurrentVersion(key, section, values);
    }
  }
};

const applyStudylist = (studylistDocument) => {
  const resolved = resolveStudylistInterfaces(studylistDocument, STUDYLIST_INTERFACE_KEYS, PREFERENCES_VERSION);

  setStudylistSyncHydrating(true);
  try {
    for (const interfaceKey of STUDYLIST_INTERFACE_KEYS) {
      const queueKey = studylistQueueKey(interfaceKey);
      if (hasPendingPreferenceWrite(queueKey)) {
        console.warn(
          `User preferences: study-list interface "${interfaceKey}" has a pending queued write; skipping remote apply.`
        );
        continue;
      }

      const { values, resolvedFrom } = resolved[interfaceKey];
      if (resolvedFrom === RESOLVED_FROM_DEFAULTS) {
        continue;
      }

      const update = {};
      for (const [field, storeKey] of Object.entries(STUDYLIST_INTERFACE_STORE_KEYS[interfaceKey])) {
        if (Array.isArray(values[field])) {
          update[storeKey] = values[field];
        }
      }

      try {
        if (Object.keys(update).length) {
          useStudiesTableFiltersAndColumnsStore.setState(update);
        }
      } catch (error) {
        console.error(`User preferences: failed to apply study-list interface "${interfaceKey}".`, error);
        continue;
      }

      if (resolvedFrom !== RESOLVED_FROM_CURRENT) {
        backfillToCurrentVersion(queueKey, PREFERENCE_SECTIONS.STUDYLIST, { [interfaceKey]: values });
      }
    }
  } finally {
    setStudylistSyncHydrating(false);
  }
};

export const initUserPreferences = async () => {
  // Idempotent per session AND per user; safe to call from a mount effect. A repeat call
  // with a different authenticated identity re-runs the sequence for that user; a repeat
  // call with the same (or no resolvable) identity is a no-op.
  const identity = getCurrentPreferenceUser() || '';
  if (hydratedForUser !== null && (hydratedForUser === identity || identity === '')) {
    return;
  }
  hydratedForUser = identity;

  try {
    startPreferenceWriteQueue();

    // (1) Queued offline writes are newer than the server copy: flush before fetching.
    try {
      await flushPreferenceWrites();
    } catch (error) {
      console.warn('User preferences: flushing the write queue failed; continuing to hydration.', error);
    }

    // (2) Single whole-document fetch (FR-5) for cross-version backfill in one request.
    let document = null;
    try {
      document = await getUserPreferences();
    } catch (error) {
      console.warn(
        'User preferences: remote fetch failed; starting from locally cached preferences (online-first, offline-second).',
        error
      );
    }

    // (3) Apply, skipping keys with pending queued writes (FR-20).
    if (document) {
      applyViewerSections(document.viewer);
      applyStudylist(document.studylist);
    }
  } catch (error) {
    // FR-9: hydration must never block startup or surface an error dialog.
    console.error('User preferences: hydration failed; the locally cached values remain in effect.', error);
  } finally {
    // (4) Save-on-change sync starts against the post-hydration baseline (AR-9) -- also on
    // the failure paths, so changes made while offline queue for later replay.
    startStudylistPreferenceSync();
  }
};

export const resetUserPreferencesInitForTests = () => {
  hydratedForUser = null;
};
