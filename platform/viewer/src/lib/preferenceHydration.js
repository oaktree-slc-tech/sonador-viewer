// Per-field guard for settings forms whose values arrive asynchronously.
//
// Startup preference hydration is an authenticated fetch, so a settings form can render, and be
// edited, before the stored values land. A value the user has changed must not be reinstated by a
// fetch that was already in flight; a value they have NOT changed must still be hydrated, because
// a section is saved wholesale and an un-hydrated field would be posted from its default over
// whatever the server holds.
//
// Those two requirements only hold together when intent is tracked per field. One flag for a form
// with several fields makes the first edit block hydration for all of them.

/**
 * @returns {{ markEdited: Function, isEdited: Function, accept: Function, reset: Function }}
 */
export function createHydrationLatch() {
  const edited = new Set();

  return {
    /** Record that the user has changed `field`. Never cleared by saving: the startup fetch can
     *  still land afterwards. */
    markEdited: field => {
      edited.add(field);
    },

    isEdited: field => edited.has(field),

    /**
     * The value `field` should hold once a hydrated value arrives.
     *
     * @param {string} field
     * @param {*} hydrated value resolved from the stored preference document
     * @param {*} current value the form is showing
     */
    accept: (field, hydrated, current) => (edited.has(field) ? current : hydrated),

    /** Forget every edit (tests, and forms that are torn down and rebuilt). */
    reset: () => {
      edited.clear();
    },
  };
}

export default createHydrationLatch;
