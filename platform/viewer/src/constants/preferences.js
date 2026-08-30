// Constants for the Sonador User Preferences API integration (sonador#42, §5.4 item 6).
//
// Preference documents are versioned by "<major>.<minor>" release (AR-2) so older and newer
// viewer versions can store their keys without interfering with one another.
export const PREFERENCES_VERSION = '0.4';

// Section keys as stored inside the versioned `UserPref.viewer` document, plus the
// `studylist` section stored in `UserPref.studylist`.
export const PREFERENCE_SECTIONS = {
  GENERAL: 'general',
  HOTKEYS: 'hotkeys',
  WINDOW_LEVEL: 'windowLevel',
  VIEWER_METADATA: 'viewerMetadata',
  STUDYLIST: 'studylist',
};

// The four sections stored under `UserPref.viewer[version]` (the `studylist` section has its
// own model field and interface-level merge semantics -- FR-13/FR-14).
export const VIEWER_PREFERENCE_SECTIONS = [
  PREFERENCE_SECTIONS.GENERAL,
  PREFERENCE_SECTIONS.HOTKEYS,
  PREFERENCE_SECTIONS.WINDOW_LEVEL,
  PREFERENCE_SECTIONS.VIEWER_METADATA,
];

// URL slugs differ from the stored section keys (`windowLevel` -> `window-level`,
// `viewerMetadata` -> `viewer-meta`); endpoints live under /visionaire/api/user-preferences/.
export const PREFERENCE_SECTION_PATHS = {
  [PREFERENCE_SECTIONS.GENERAL]: 'general',
  [PREFERENCE_SECTIONS.HOTKEYS]: 'hotkeys',
  [PREFERENCE_SECTIONS.WINDOW_LEVEL]: 'window-level',
  [PREFERENCE_SECTIONS.VIEWER_METADATA]: 'viewer-meta',
  [PREFERENCE_SECTIONS.STUDYLIST]: 'studylist',
};

// Offline-storage transfer strategy (ohif-viewers#129, FR-1). Lives in the existing `general`
// section rather than a new one: a new section would need its own server endpoint slug, its own
// applier and a PREFERENCES_VERSION bump for a single boolean (#129 AR-7).
//
// Default OFF -- the per-instance transfer stays the default and the fallback.
export const ARCHIVE_TRANSFER_PREFERENCE_KEY = 'offlineArchiveTransfer';
export const ARCHIVE_TRANSFER_DEFAULT = false;

// Study-list interfaces stored under `UserPref.studylist[version]` (FR-13). `upload` carries
// `selectedColumns`/`columnOrder` only -- no `selectedFilters`.
export const STUDYLIST_INTERFACES = {
  WORKLIST: 'worklist',
  ALL_STUDIES: 'allStudies',
  SHARED: 'shared',
  UPLOAD: 'upload',
};

export const STUDYLIST_INTERFACE_KEYS = [
  STUDYLIST_INTERFACES.WORKLIST,
  STUDYLIST_INTERFACES.ALL_STUDIES,
  STUDYLIST_INTERFACES.SHARED,
  STUDYLIST_INTERFACES.UPLOAD,
];

// useStudiesTableFiltersAndColumnsStore keys backing each interface's cloud slice fields
// (§5.1). Shared by the hydration apply path and the save-on-change sync module so the two
// can never diverge on shape.
export const STUDYLIST_INTERFACE_STORE_KEYS = {
  [STUDYLIST_INTERFACES.WORKLIST]: {
    selectedFilters: 'workListStudiesSelectedFilters',
    selectedColumns: 'workListStudiesSelectedColumns',
    columnOrder: 'workListColumnOrder',
  },
  [STUDYLIST_INTERFACES.ALL_STUDIES]: {
    selectedFilters: 'allStudiesSelectedFilters',
    selectedColumns: 'allStudiesSelectedColumns',
    columnOrder: 'allStudiesColumnOrder',
  },
  [STUDYLIST_INTERFACES.SHARED]: {
    selectedFilters: 'sharedStudiesSelectedFilters',
    selectedColumns: 'sharedStudiesSelectedColumns',
    columnOrder: 'sharedColumnOrder',
  },
  [STUDYLIST_INTERFACES.UPLOAD]: {
    selectedColumns: 'uploadStudiesSelectedColumns',
    columnOrder: 'uploadColumnOrder',
  },
};

// Write-queue keys (FR-19): the viewer section URL slug, or `studylist:<interface>`.
export const studylistQueueKey = (interfaceKey) => `studylist:${interfaceKey}`;

// Persistent write queue (FR-19..FR-21, AR-8: the one sanctioned new localStorage key).
export const WRITE_QUEUE_STORAGE_KEY = 'user-pref-write-queue';
export const WRITE_QUEUE_BACKOFF_FLOOR_MS = 5 * 1000;
export const WRITE_QUEUE_BACKOFF_CAP_MS = 5 * 60 * 1000;
export const WRITE_QUEUE_PRUNE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// Save-on-change sync debounce for the study-list surfaces (FR-17: >= 1 s).
export const STUDYLIST_SYNC_DEBOUNCE_MS = 1000;
