import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const useStudiesTableFilters = create(
  persist(
    (set) => ({
      studyListPageFilters: {},
      workListPageFilters: {},
      sharedWithMePageFilters: {},
      setStudyListPageFilters: (getFilter) =>
        set((prevState) => {
          return {
            studyListPageFilters: { ...prevState.studyListPageFilters, ...getFilter(prevState.studyListPageFilters) },
          };
        }),
      setWorkListPageFilters: (getFilter) =>
        set((prevState) => {
          return {
            workListPageFilters: { ...prevState.workListPageFilters, ...getFilter(prevState.workListPageFilters) },
          };
        }),
      setSharedWithMePageFilters: (getFilter) =>
        set((prevState) => {
          return {
            sharedWithMePageFilters: {
              ...prevState.sharedWithMePageFilters,
              ...getFilter(prevState.sharedWithMePageFilters),
            },
          };
        }),
    }),
    {
      name: 'pages-studies-table-filters',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
