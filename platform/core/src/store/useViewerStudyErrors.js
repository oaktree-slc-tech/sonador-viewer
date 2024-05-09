import { del, get, set } from 'idb-keyval';
import { v4 as uuidv4 } from 'uuid';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

const storage = {
  getItem: async (name) => {
    return (await get(name)) || null;
  },
  setItem: async (name, value) => {
    await set(name, value);
  },
  removeItem: async (name) => {
    await del(name);
  },
};

export const useViewerStudyErrors = create(
  persist(
    (set) => ({
      errors: {},
      addError: ({ studyId, error, title }) =>
        set((prevState) => {
          const studyErrors = prevState.errors[studyId];
          const hasThisError = studyErrors
            ? studyErrors.some((currentError) => currentError.error === error && currentError.title === title)
            : false;

          if (hasThisError) {
            return prevState;
          }

          const prevStudyErrors = studyErrors || [];

          return {
            errors: { ...prevState.errors, [studyId]: [{ title, error, errorId: uuidv4() }, ...prevStudyErrors] },
          };
        }),
      removeError: ({ studyId, errorId }) =>
        set((prevState) => {
          const prevStudyErrors = prevState.errors[studyId] || [];

          return {
            errors: { ...prevState.errors, [studyId]: prevStudyErrors.filter((error) => error.errorId !== errorId) },
          };
        }),
    }),
    {
      name: 'viewer-study-errors-db',
      storage: createJSONStorage(() => storage),
    }
  )
);
