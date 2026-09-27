// Whether the `general` preference section has been hydrated from the server this session.
//
// A write of the section made on the user's behalf outside the Settings page (a dialog's "don't
// ask again") is composed from the runtime holders, and a section POST replaces the section
// wholesale. Before hydration those holders carry built-in defaults, not the user's stored
// settings, so such a write has to wait for hydration -- or, when hydration failed, read the
// stored section first. `initUserPreferences` opens and settles this; the composer awaits it.

let hydration = null;

const open = () => {
  let settle;
  const promise = new Promise((resolve) => { settle = resolve; });
  hydration = { promise, settle, settled: false };
};

/** Startup hydration is beginning (once per identity). */
export const startGeneralHydration = () => {
  if (!hydration || hydration.settled) {
    open();
  }
};

/**
 * Startup hydration finished. `hydrated` is true when the runtime holders now reflect the
 * stored section (or a local value newer than it), false when the server could not be read.
 */
export const settleGeneralHydration = ({ hydrated }) => {
  if (!hydration) {
    open();
  }
  hydration.settled = true;
  hydration.settle({ hydrated: !!hydrated });
};

/**
 * Resolves once startup hydration has settled: `{ hydrated }`. Resolves `{ hydrated: false }`
 * at once when no hydration was ever started (an unauthenticated session).
 */
export const whenGeneralHydrated = () => (hydration ? hydration.promise : Promise.resolve({ hydrated: false }));

export const resetGeneralHydrationForTests = () => {
  hydration = null;
};
