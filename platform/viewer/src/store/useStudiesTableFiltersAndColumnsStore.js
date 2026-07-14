import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { DEFAULT_COLUMNS_IDS, DEFAULT_FILTERS, WORK_LIST_DEFAULT_COLUMNS_IDS } from '../lib/constants';

export const useStudiesTableFiltersAndColumnsStore = create(
  persist(
    (set) => ({
      allStudiesSelectedFilters: DEFAULT_FILTERS,
      allStudiesSelectedColumns: DEFAULT_COLUMNS_IDS,
      setAllStudiesSelectedColumns: (columns) => set({ allStudiesSelectedColumns: columns }),
      setAllStudiesSelectedFilters: (filters) => set({ allStudiesSelectedFilters: filters }),
      workListStudiesSelectedFilters: DEFAULT_FILTERS,
      workListStudiesSelectedColumns: WORK_LIST_DEFAULT_COLUMNS_IDS,
      setWorkListStudiesSelectedColumns: (columns) => set({ workListStudiesSelectedColumns: columns }),
      setWorkListStudiesSelectedFilters: (filters) => set({ workListStudiesSelectedFilters: filters }),
      sharedStudiesSelectedFilters: DEFAULT_FILTERS,
      sharedStudiesSelectedColumns: DEFAULT_COLUMNS_IDS,
      setSharedStudiesSelectedColumns: (columns) => set({ sharedStudiesSelectedColumns: columns }),
      setSharedStudiesSelectedFilters: (filters) => set({ sharedStudiesSelectedFilters: filters }),
      uploadStudiesSelectedColumns: DEFAULT_COLUMNS_IDS,
      setUploadStudiesSelectedColumns: (columns) => set({ uploadStudiesSelectedColumns: columns }),
    }),
    {
      name: 'studies-filters-and-columns',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      migrate: (persistedState, version) => {
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
        return persistedState;
      },
    }
  )
);
