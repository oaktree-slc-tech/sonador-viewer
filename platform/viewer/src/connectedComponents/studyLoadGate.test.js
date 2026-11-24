// The hydration wait belongs to the view's cancelable load: a view left while the preferences are
// still hydrating does not go on to retrieve its study.

import { awaitPreferencesForLoad, HYDRATION_WAIT_KEY } from './studyLoadGate';
import {
  resetGeneralHydrationForTests,
  settleGeneralHydration,
  startGeneralHydration,
} from '../lib/generalHydration';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => resetGeneralHydrationForTests());

it('a current view loads once hydration settles, hydrated or not', async () => {
  startGeneralHydration();
  const cancelables = {};
  const gate = awaitPreferencesForLoad(cancelables);
  expect(cancelables[HYDRATION_WAIT_KEY]).toBeDefined();
  settleGeneralHydration({ hydrated: true });
  expect(await gate).toBe(true);
  expect(cancelables[HYDRATION_WAIT_KEY]).toBeUndefined();

  startGeneralHydration();
  const failing = awaitPreferencesForLoad(cancelables);
  settleGeneralHydration({ hydrated: false });
  expect(await failing).toBe(true);
});

it('a view that is left while hydration is pending is told so when it settles, and does not load', async () => {
  startGeneralHydration();
  const cancelables = {};
  const gate = awaitPreferencesForLoad(cancelables);
  await flush();
  // What purgeCancellablePromises does on unmount, a study change or a reload
  Object.values(cancelables).forEach(pending => pending.cancel());
  settleGeneralHydration({ hydrated: true });
  expect(await gate).toBe(false);
});

it('resolves at once when no hydration was ever started', async () => {
  expect(await awaitPreferencesForLoad({})).toBe(true);
});
