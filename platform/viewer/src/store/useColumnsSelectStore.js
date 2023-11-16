import { create } from 'zustand';

export const useColumnsSelectStore = create((set) => ({
  isOpenColumnsSelect: false,
  setIsOpenColumnsSelect: (value) => set(() => ({ isOpenColumnsSelect: value })),
}));
