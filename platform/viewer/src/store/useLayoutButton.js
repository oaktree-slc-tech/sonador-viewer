import { create } from 'zustand';

export const useLayoutButton = create((set) => ({
  isDisplayedLayoutButton: true,
  setIsDisplayedLayoutButton: (value) => set(() => ({ isDisplayedLayoutButton: value })),
}));
