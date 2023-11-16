import { create } from 'zustand';

const MOBILE_WIDTH = 480;
const TABLET_WIDTH = 833;
const LARGE_WIDTH = 1411;

export const useDeviceStore = create((set) => ({
  isDesktop: window.innerWidth > TABLET_WIDTH,
  isLarge: window.innerWidth <= LARGE_WIDTH && window.innerWidth > TABLET_WIDTH,
  isTablet: window.innerWidth <= TABLET_WIDTH && window.innerWidth > MOBILE_WIDTH,
  isMobile: window.innerWidth <= MOBILE_WIDTH,
  setDevice: (windowWidth) =>
    set(() => {
      if (windowWidth <= LARGE_WIDTH && windowWidth > TABLET_WIDTH) {
        return { isMobile: false, isDesktop: false, isTablet: false, isLarge: true };
      }

      if (windowWidth <= TABLET_WIDTH && windowWidth > MOBILE_WIDTH) {
        return { isMobile: false, isDesktop: false, isTablet: true, isLarge: false };
      }

      if (windowWidth <= MOBILE_WIDTH) {
        return { isMobile: true, isDesktop: false, isTablet: false, isLarge: false };
      }

      return { isMobile: false, isDesktop: true, isTablet: false, isLarge: false };
    }),
}));
