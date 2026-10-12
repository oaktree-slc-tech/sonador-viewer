/**
 * Access token handling against Sonador that does not depend on the Sonador session cookie, so
 * it works the same for a viewer served by Sonador and for one served from another site.
 */
import { User } from 'oidc-client';

import { isSigningOut } from './signOutLatch';

// Sonador's session renew endpoint, at the root of the authority's origin
const RENEW_PATH = '/silent-refresh.html';

export const RENEWED = 'renewed';
export const REFUSED = 'refused';
export const STALE = 'stale';

export function sonadorRenewUrl(authority) {
  return new URL(RENEW_PATH, authority).toString();
}

// `getUser()` re-arms the access token timers, which raise "expiring" again within a second
// while inside the notification window; `_loadUser()` reads the same storage without that.
function loadStoredUser(userManager) {
  return userManager._loadUser();
}

const renewals = new WeakMap();

/**
 * Renewal of the stored user's session, shared by everything that renews for `userManager`.
 *
 * `renew()` asks Sonador for a new token with the current one. It resolves with:
 *   RENEWED -- a new token was stored and loaded
 *   REFUSED -- the session cannot be renewed; reauthentication is needed
 *   STALE   -- the user signed out or changed while the request was pending; nothing was stored
 *
 * Concurrent calls share one attempt, and a token that has been refused is not retried. There is
 * no silent sign-in fallback: it authenticates with the same Sonador session, and oidc-client
 * stores its result before returning, outside the check that guards this renewal's write.
 */
export function sessionRenewal(userManager) {
  if (!renewals.has(userManager)) {
    renewals.set(userManager, createSessionRenewal(userManager));
  }

  return renewals.get(userManager);
}

function createSessionRenewal(userManager) {
  let pending = null;
  let refusedToken = null;

  // Every other write to the stored user (sign-in, sign-out, removal) goes through
  // `storeUser`. Counting the calls lets a pending renewal tell that the user it started from
  // is no longer the stored one.
  let writes = 0;
  const storeUser = userManager.storeUser.bind(userManager);
  userManager.storeUser = user => {
    writes += 1;
    return storeUser(user);
  };

  async function requestToken(user) {
    const { authority, accessTokenExpiringNotificationTime = 60 } = userManager.settings;

    try {
      const response = await fetch(sonadorRenewUrl(authority), {
        headers: { Authorization: `Bearer ${user.access_token}` },
        credentials: 'omit',
      });
      if (!response.ok) {
        return null;
      }

      const renewed = await response.json();

      // A session that ends within the notification window would raise "expiring" again at once
      return renewed.access_token && renewed.expires_in > accessTokenExpiringNotificationTime
        ? renewed
        : null;
    } catch (error) {
      return null;
    }
  }

  async function attempt() {
    const startedAt = writes;
    const unchanged = () => writes === startedAt && !isSigningOut();

    const user = await loadStoredUser(userManager);
    if (!unchanged()) {
      return STALE;
    }
    if (!user || !user.access_token || user.access_token === refusedToken) {
      return REFUSED;
    }

    const renewed = await requestToken(user);
    if (!unchanged()) {
      return STALE;
    }

    if (renewed) {
      const next = new User({
        ...user,
        access_token: renewed.access_token,
        expires_at: Math.floor(Date.now() / 1000) + renewed.expires_in,
      });

      // The web storage user store writes synchronously, so the check above, this write and
      // the load cannot interleave with another write.
      const stored = storeUser(next);
      userManager.events.load(next);
      await stored;
      return RENEWED;
    }

    refusedToken = user.access_token;
    return REFUSED;
  }

  return {
    renew() {
      if (!pending) {
        pending = attempt().finally(() => {
          pending = null;
        });
      }

      return pending;
    },
  };
}

/**
 * Resolve with the signed-in user once the store holds one that has not expired.
 *
 * @param {Object} store redux store with the redux-oidc reducer at `oidc`
 * @returns {Promise<Object>}
 */
export function whenSignedIn(store) {
  const signedInUser = () => {
    const user = store.getState().oidc && store.getState().oidc.user;
    return user && !user.expired ? user : null;
  };

  return new Promise(resolve => {
    const user = signedInUser();
    if (user) {
      resolve(user);
      return;
    }

    const unsubscribe = store.subscribe(() => {
      const user = signedInUser();
      if (user) {
        unsubscribe();
        resolve(user);
      }
    });
  });
}
