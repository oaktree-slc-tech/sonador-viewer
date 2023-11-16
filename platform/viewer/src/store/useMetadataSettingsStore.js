import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const useMetadataSettingsStore = create(
  persist(
    (set) => ({
      metadataSettings: [],
      setMetadataSettings: (metadataSettings) => set({ metadataSettings }),
      toggleMetadataSetting: (id) =>
        set((state) => ({
          metadataSettings: state.metadataSettings.map((item) => {
            return {
              ...item,
              options: item.options.map((option) => {
                if (option.id === id) {
                  return {
                    ...option,
                    isSelected: !option.isSelected,
                  };
                }

                return option;
              }),
            };
          }),
        })),
    }),
    {
      name: 'metadata-settings',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
