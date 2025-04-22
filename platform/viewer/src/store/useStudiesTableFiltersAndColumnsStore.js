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
    }
  )
);
