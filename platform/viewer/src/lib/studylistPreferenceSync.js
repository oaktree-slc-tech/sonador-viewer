// Save-on-change cloud sync for the study-list display configuration (sonador#42 FR-17,
// AR-9, §5.7 item 19).
//
// The study-list surfaces apply changes immediately (no Save button), so this module
// subscribes to useStudiesTableFiltersAndColumnsStore and, when an interface's slice
// (filter visibility, column selection, or column order) changes, debounces >= 1 s and
// submits `{ version, values: { <interface>: slice } }` through the write queue under key
// `studylist:<interface>` (FR-19). The endpoint merges at the interface level (FR-14), so
// one interface's sync can never clobber another's stored slice. Components stay unaware of
// the cloud API; a hydration guard prevents echo POSTs while stores are being applied.


import {
  PREFERENCES_VERSION,
  PREFERENCE_SECTIONS,
  STUDYLIST_INTERFACE_STORE_KEYS,
  STUDYLIST_SYNC_DEBOUNCE_MS,
  studylistQueueKey,
} from '../constants/preferences';

import { useStudiesTableFiltersAndColumnsStore } from '../store/useStudiesTableFiltersAndColumnsStore';

import { notifyPreferenceWriteQueued, submitPreferenceWrite } from './preferenceWriteQueue';
// The notification service is imported by its module path rather than the `@ohif/core` barrel:
// this file is deliberately React-free and node-testable (AR-7), and the barrel would pull the
// entire viewer core -- Cornerstone, VTK, and friends -- into the test environment.
import { uiNotificationService } from '@ohif/core/src/services/UINotificationService';

let unsubscribe = null;
let hydrating = false;
let baseline = {};
const debounceTimers = {};

const arraysEqual = (a, b) =>
  Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => value === b[i]);

export const getStudylistInterfaceSlice = (state, interfaceKey) => {
  // The full cloud slice for one interface, built from the store state (FR-17 submits the
  // full slice, mirroring the FR-14 replace-that-interface semantics).
  const slice = {};
  for (const [field, storeKey] of Object.entries(STUDYLIST_INTERFACE_STORE_KEYS[interfaceKey])) {
    const value = state[storeKey];
    if (Array.isArray(value)) {
      slice[field] = value;
    }
  }
  return slice;
};

const sliceChanged = (previous, next) => {
  if (!previous) {
    return true;
  }
  const fields = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const field of fields) {
    if (!arraysEqual(previous[field], next[field])) {
      return true;
    }
  }
  return false;
};

const captureBaseline = (state) => {
  baseline = {};
  for (const interfaceKey of Object.keys(STUDYLIST_INTERFACE_STORE_KEYS)) {
    baseline[interfaceKey] = getStudylistInterfaceSlice(state, interfaceKey);
  }
};

const submitInterface = (interfaceKey) => {
  const slice = getStudylistInterfaceSlice(useStudiesTableFiltersAndColumnsStore.getState(), interfaceKey);

  // StudylistPrefForm rejects an empty `values`/interface payload -- never POST one.
  if (!Object.keys(slice).length) {
    return;
  }

  void submitPreferenceWrite({
    key: studylistQueueKey(interfaceKey),
    section: PREFERENCE_SECTIONS.STUDYLIST,
    payload: {
      version: PREFERENCES_VERSION,
      values: { [interfaceKey]: slice },
    },
  })
    .then(({ outcome }) => {
      if (outcome === 'queued') {
        // Retryable failures queue silently -- at most one informational toast per
        // session (FR-17); local state is always retained.
        notifyPreferenceWriteQueued();
      }
    })
    .catch((error) => {
      // Validation failure (400): logged and surfaced as an error toast; never retried
      // (FR-17/FR-21). Local state is retained.
      console.error(`User preferences: study-list sync for "${interfaceKey}" was rejected.`, error);
      try {
        uiNotificationService.show({
          title: 'Study-list preference sync failed',
          message: `Could not sync preferences for "${interfaceKey}".`,
          type: 'error',
        });
      } catch (e) {
        // Best-effort notification only.
      }
    });
};

const handleStoreChange = (state) => {
  for (const interfaceKey of Object.keys(STUDYLIST_INTERFACE_STORE_KEYS)) {
    const slice = getStudylistInterfaceSlice(state, interfaceKey);
    if (!sliceChanged(baseline[interfaceKey], slice)) {
      continue;
    }
    baseline[interfaceKey] = slice;

    if (hydrating) {
      // AR-9 hydration guard: remote values being applied to the store must not echo back
      // as POSTs; the baseline above still advances so later user edits diff correctly.
      continue;
    }

    if (debounceTimers[interfaceKey]) {
      clearTimeout(debounceTimers[interfaceKey]);
    }
    debounceTimers[interfaceKey] = setTimeout(() => {
      delete debounceTimers[interfaceKey];
      submitInterface(interfaceKey);
    }, STUDYLIST_SYNC_DEBOUNCE_MS);
  }
};

export const startStudylistPreferenceSync = () => {
  // Idempotent; started from initUserPreferences AFTER hydration has applied any remote
  // values (§5.5), so the baseline reflects post-hydration state and startup produces zero
  // POSTs when the user changes nothing (AR-9).
  if (unsubscribe) {
    return;
  }
  captureBaseline(useStudiesTableFiltersAndColumnsStore.getState());
  unsubscribe = useStudiesTableFiltersAndColumnsStore.subscribe(handleStoreChange);
};

export const stopStudylistPreferenceSync = () => {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  for (const interfaceKey of Object.keys(debounceTimers)) {
    clearTimeout(debounceTimers[interfaceKey]);
    delete debounceTimers[interfaceKey];
  }
  hydrating = false;
  baseline = {};
};

export const setStudylistSyncHydrating = (value) => {
  // Raised by the hydration module around store writes (AR-9). Also usable if hydration is
  // ever re-run mid-session.
  hydrating = !!value;
};
