import { create } from 'zustand';

export const useDicomHeadersOverlayStore = create((set) => ({
  showOverlay: true,
  toggleShowOverlay: () => set((state) => {
    return ({ showOverlay: !state.showOverlay });
  }),
}));
