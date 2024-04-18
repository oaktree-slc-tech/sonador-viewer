import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const useViewerMetadataSettingsStore = create(
  persist(
    (set) => ({
      topLeftCorner: [
        { title: 'Patient Name', value: 'patientName' },
        { title: 'Patient Id', value: 'patientId' },
      ],
      topRightCorner: [
        { title: 'Study Description', value: 'studyDescription' },
        { title: 'Study Date Time', value: 'studyDate-studyTime' },
      ],
      bottomLeftCorner: [
        { title: 'Series Number', value: 'seriesNumber' },
        { title: 'Img instance number index/stack size', value: 'Img-instance-number-index-stack-size' },
        { title: 'Frame Rate Image Info', value: 'frameRate-image-info' },
      ],
      bottomRightCorner: [
        { title: 'Zoom Percentage', value: 'zoomPercentage' },
        { title: 'WWWC', value: 'wwwc' },
        { title: 'Compression', value: 'compression' },
      ],
      setTopLeftCorner: (topLeftCorner) => set({ topLeftCorner }),
      setTopRightCorner: (topRightCorner) => set({ topRightCorner }),
      setBottomLeftCorner: (bottomLeftCorner) => set({ bottomLeftCorner }),
      setBottomRightCorner: (bottomRightCorner) => set({ bottomRightCorner }),
    }),
    {
      name: 'viewer-metadata-settings-blocks',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
