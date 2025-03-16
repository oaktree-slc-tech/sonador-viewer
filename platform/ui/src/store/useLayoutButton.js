import { create } from 'zustand';

export const useLayoutButton = create((set) => ({
  // Set state display property for "Layout" button. Utilizes `create` from Zustand.
  // https://github.com/pmndrs/zustand

  isDisplayedLayoutButton: true,
  setIsDisplayedLayoutButton: (value) => set(() => ({ isDisplayedLayoutButton: value })),
}));
