// Whether the `hotkeys` preference section has been hydrated from the server this session, and
// word of the application's hotkeys changing when it lands.
//
// A section POST replaces the section wholesale, and Settings > Hotkeys composes its save from
// the bindings in effect. Before hydration those are the cached or built-in ones, not the user's
// stored bindings, so a save has to wait for hydration, or, when hydration failed, read the stored
// section first (lib/hotkeyPreferences.js). `initUserPreferences` opens and settles this. The
// hotkeys manager announces nothing itself, so hydration also says here when it has applied the
// stored bindings, for a form that is showing them.

let hydration = null;
const listeners = new Set();

const open = () => {
  let settle;
  const promise = new Promise((resolve) => { settle = resolve; });
  hydration = { promise, settle, settled: false };
};

/** Startup hydration is beginning (once per identity). */
export const startHotkeyHydration = () => {
  if (!hydration || hydration.settled) {
    open();
  }
};

/**
 * Startup hydration finished.
 *
 * @input outcome (Object): `hydrated` (boolean), true when the bindings in effect now reflect the
 *   stored section, false when the server could not be read or a queued write kept it off them
 */
export const settleHotkeyHydration = ({ hydrated }) => {
  if (!hydration) {
    open();
  }
  hydration.settled = true;
  hydration.settle({ hydrated: !!hydrated });
};

/**
 * @returns (Promise<Object>): `{ hydrated }` once startup hydration has settled; `{ hydrated:
 *   false }` at once when none was ever started (an unauthenticated session)
 */
export const whenHotkeysHydrated = () => (hydration ? hydration.promise : Promise.resolve({ hydrated: false }));

/** Hydration has applied the stored bindings to the hotkeys manager. */
export const notifyHotkeysApplied = () => {
  [...listeners].forEach((listener) => listener());
};

/**
 * @input listener (Function): called each time hydration applies the stored bindings
 * @returns (Function): unsubscribe
 */
export const subscribeHotkeysApplied = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const resetHotkeyHydrationForTests = () => {
  hydration = null;
  listeners.clear();
};
