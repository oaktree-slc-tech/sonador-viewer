// Desktop studylist sidebar mode (ohif-viewers#128).
//
// The mode is state of record rather than component state because two components read it:
// SideBarNG renders from it, and Layout writes it into --sonador-sidebar-width so the content
// area's left margin follows the rail. Persisted per browser through the same zustand `persist`
// idiom the viewer's other five stores use (see useMetadataSettingsStore).
//
// No `version` / `migrate`: the persisted shape is a single string field, so there is nothing to
// migrate from yet. Add both together if the shape ever grows.

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const SIDEBAR_MODE_FULL = 'full';
export const SIDEBAR_MODE_NARROW = 'narrow';

/**
 * Rail width per mode, in px. The single runtime source: Layout writes the chosen value into
 * --sonador-sidebar-width, which both the sidebar and the content area read.
 *
 * The narrow rail is 64px rather than the 40px the specification named: 40px is exactly the icon
 * button's own width, which left the icons flush against the window chrome with no breathing room
 * at all. 64px keeps the 40px button and gives it 12px of gutter either side. This is the one
 * number to change if it wants further tuning -- the sidebar and the content area's left margin
 * both follow it through --sonador-sidebar-width.
 */
export const SIDEBAR_WIDTHS = {
  [SIDEBAR_MODE_FULL]: '315px',
  [SIDEBAR_MODE_NARROW]: '64px',
};

export const useSidebarStore = create(
  persist(
    (set) => ({
      mode: SIDEBAR_MODE_FULL,
      setMode: (mode) => set({ mode }),
      toggleMode: () =>
        set((state) => ({
          mode: state.mode === SIDEBAR_MODE_NARROW ? SIDEBAR_MODE_FULL : SIDEBAR_MODE_NARROW,
        })),
    }),
    {
      name: 'sidebar-mode',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
