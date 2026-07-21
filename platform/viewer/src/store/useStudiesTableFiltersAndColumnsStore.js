import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { DEFAULT_COLUMNS_IDS, DEFAULT_FILTERS, WORK_LIST_DEFAULT_COLUMNS_IDS } from '../lib/constants';

// Natural column order for each interface: the selector/settings/expander column first, then
// the interface's default columns -- the same order StudyListNG builds when nothing is stored.
const SELECTOR_COLUMN_ID = 'selector-settings-expander';
const DEFAULT_COLUMN_ORDER = [SELECTOR_COLUMN_ID, ...DEFAULT_COLUMNS_IDS];
const WORK_LIST_DEFAULT_COLUMN_ORDER = [SELECTOR_COLUMN_ID, ...WORK_LIST_DEFAULT_COLUMNS_IDS];

const readLegacyColumnOrder = () => {
  // Pre-v2 column order: a single `columnOrder` localStorage key (written via usehooks-ts
  // useLocalStorage in StudyListNG) shared by every interface. Used only to seed the v1 -> v2
  // migration below; the key itself is left in place.
  try {
    const stored = JSON.parse(localStorage.getItem('columnOrder'));
    return Array.isArray(stored) && stored.every((id) => typeof id === 'string') ? stored : null;
  } catch (e) {
    return null;
  }
};

export const migrateStudiesFiltersAndColumns = (persistedState, version) => {
  // v0 -> v1: worklist tables gained the ReasonForReview column (orthanc-sonador#54).
  // Persisted column selections predate it, so splice it in directly after Status.
  if (version < 1 && Array.isArray(persistedState?.workListStudiesSelectedColumns)) {
    const columns = [...persistedState.workListStudiesSelectedColumns];
    if (!columns.includes('ReasonForReview')) {
      const statusIndex = columns.indexOf('Status');
      columns.splice(statusIndex >= 0 ? statusIndex + 1 : columns.length, 0, 'ReasonForReview');
      persistedState.workListStudiesSelectedColumns = columns;
    }
  }

  // v1 -> v2: column order became per interface (sonador#42 FR-16; previously one shared
  // localStorage key silently reordered every table). Seed each interface's order from the
  // legacy key when present so a user's existing order survives the upgrade.
  if (version < 2) {
    const legacyOrder = readLegacyColumnOrder();
    if (legacyOrder) {
      persistedState.workListColumnOrder = legacyOrder;
      persistedState.allStudiesColumnOrder = legacyOrder;
      persistedState.sharedColumnOrder = legacyOrder;
      persistedState.uploadColumnOrder = legacyOrder;
    }
  }

  return persistedState;
};

export const useStudiesTableFiltersAndColumnsStore = create(
  persist(
    (set) => ({
      allStudiesSelectedFilters: DEFAULT_FILTERS,
      allStudiesSelectedColumns: DEFAULT_COLUMNS_IDS,
      allStudiesColumnOrder: DEFAULT_COLUMN_ORDER,
      setAllStudiesSelectedColumns: (columns) => set({ allStudiesSelectedColumns: columns }),
      setAllStudiesSelectedFilters: (filters) => set({ allStudiesSelectedFilters: filters }),
      setAllStudiesColumnOrder: (columnOrder) => set({ allStudiesColumnOrder: columnOrder }),
      workListStudiesSelectedFilters: DEFAULT_FILTERS,
      workListStudiesSelectedColumns: WORK_LIST_DEFAULT_COLUMNS_IDS,
      workListColumnOrder: WORK_LIST_DEFAULT_COLUMN_ORDER,
      setWorkListStudiesSelectedColumns: (columns) => set({ workListStudiesSelectedColumns: columns }),
      setWorkListStudiesSelectedFilters: (filters) => set({ workListStudiesSelectedFilters: filters }),
      setWorkListColumnOrder: (columnOrder) => set({ workListColumnOrder: columnOrder }),
      sharedStudiesSelectedFilters: DEFAULT_FILTERS,
      sharedStudiesSelectedColumns: DEFAULT_COLUMNS_IDS,
      sharedColumnOrder: DEFAULT_COLUMN_ORDER,
      setSharedStudiesSelectedColumns: (columns) => set({ sharedStudiesSelectedColumns: columns }),
      setSharedStudiesSelectedFilters: (filters) => set({ sharedStudiesSelectedFilters: filters }),
      setSharedColumnOrder: (columnOrder) => set({ sharedColumnOrder: columnOrder }),
      uploadStudiesSelectedColumns: DEFAULT_COLUMNS_IDS,
      uploadColumnOrder: DEFAULT_COLUMN_ORDER,
      setUploadStudiesSelectedColumns: (columns) => set({ uploadStudiesSelectedColumns: columns }),
      setUploadColumnOrder: (columnOrder) => set({ uploadColumnOrder: columnOrder }),
    }),
    {
      name: 'studies-filters-and-columns',
      storage: createJSONStorage(() => localStorage),
      version: 2,
      migrate: migrateStudiesFiltersAndColumns,
    }
  )
);
