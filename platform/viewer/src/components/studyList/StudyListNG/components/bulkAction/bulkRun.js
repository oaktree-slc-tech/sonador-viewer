// The in-flight latch a bulk run holds, and the guarantee that it is always released.
//
// Both bulk hooks acquired the latch by hand and then opened a `try/finally` a few lines later, with
// the progress initialisation and the opening notification sitting in the gap. Anything throwing in
// that gap -- a notification service that is broken is the realistic case -- skipped the release, and
// the consequence is not a lost notification but a dead dialog: `isApplying` stays true, so
// `handleClose` refuses to close, and the ref stays true, so every retry returns null immediately.
// The user cannot close it and cannot proceed.
//
// Rather than move the `try` up and rely on the next person putting it in the right place, the latch
// and the try/finally are one thing here. There is no gap to get wrong, because there is nowhere to
// put post-acquisition work except inside `run`.
//
// Deliberately free of React: it takes the ref and the setter as arguments, so the invariant that
// matters -- the latch is released whatever happens -- is testable with plain objects. This repo's
// jest setup has no React renderer, which is exactly how the gap survived review in the first place.

/**
 * Run one bulk operation under an in-flight latch.
 *
 * @param {Object}   options
 * @param {Object}   options.latchRef A ref-like `{ current: boolean }`. Synchronous, because React
 *                                    state lands a render too late to stop a second click.
 * @param {Function} options.setBusy  Setter for the state the dialog blocks on.
 * @param {Function} options.run      The work. Everything after acquisition belongs in here.
 * @returns {Promise<*>} Whatever `run` resolves to, or null if a run was already in flight.
 */
export const withBulkRunLatch = async ({ latchRef, setBusy, run }) => {
  if (latchRef.current) {
    return null;
  }

  latchRef.current = true;
  setBusy(true);

  try {
    return await run();
  } finally {
    latchRef.current = false;
    setBusy(false);
  }
};


export default withBulkRunLatch;
