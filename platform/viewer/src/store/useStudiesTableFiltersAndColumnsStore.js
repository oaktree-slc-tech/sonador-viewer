import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { DEFAULT_COLUMNS_IDS, DEFAULT_FILTERS } from '../studylist/StudyListNG/logic';

export const useStudiesTableFiltersAndColumnsStore = create(
  persist(
    (set) => ({
      selectedFilters: DEFAULT_FILTERS,
      selectedColumns: DEFAULT_COLUMNS_IDS,
      setSelectedColumns: (columns) => set({ selectedColumns: columns }),
      setSelectedFilters: (filters) => set({ selectedFilters: filters }),
    }),
    {
      name: 'studies-table-filters-and-columns',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
