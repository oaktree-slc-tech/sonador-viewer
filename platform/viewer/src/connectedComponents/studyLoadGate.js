// The wait a study load makes for the general preferences, as part of the view's cancelable load
// (imaging-development-env#103). The preferences decide how the study is loaded, so the load waits
// for their hydration to settle; the wait is registered among the view's cancelable loads, so
// leaving the view (unmount, a study change, a reload) cancels it like any pending retrieval, and
// the caller learns whether the view is still current once the preferences are known.

import { whenGeneralHydrated } from '../lib/generalHydration';

export const HYDRATION_WAIT_KEY = '__general-preferences-hydration__';

/**
 * Resolves true once hydration has settled (hydrated or failed; the study then loads on whatever
 * the preference holders carry), false when the view cancelled its loads meanwhile.
 *
 * @param {object} cancelables - the view's registry of cancelable loads; the entry registered here
 *   has the `cancel` the registry's purge calls
 */
export function awaitPreferencesForLoad(cancelables) {
  let cancelled = false;
  const wait = {
    cancel() {
      cancelled = true;
    },
  };
  cancelables[HYDRATION_WAIT_KEY] = wait;
  return whenGeneralHydrated()
    .catch(() => undefined)
    .then(() => {
      if (cancelables[HYDRATION_WAIT_KEY] === wait) {
        delete cancelables[HYDRATION_WAIT_KEY];
      }
      return !cancelled;
    });
}
