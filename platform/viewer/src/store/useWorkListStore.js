import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { DEFAULT_FILTERS } from '../lib/constants';

export const useWorkListStore = create(
  persist(
    (set) => ({
      workListSelectedStudies: [],
      workListFilters: DEFAULT_FILTERS,
      setWorkListSelectedStudies: (selectedStudies) => set(() => ({ workListSelectedStudies: selectedStudies })),
      setWorkListFilters: (filters) => set(() => ({ workListFilters: filters })),
    }),
    {
      name: 'worklist-viewer',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
