// https://github.com/maxmantz/redux-oidc/blob/master/docs/API.md
import { createUserManager, loadUser } from 'redux-oidc';

import { sessionRenewal } from './sonadorAccessToken.js';

/**
 * Creates a userManager from oidcSettings;
 * loads the user into the provided redux store
 * LINK: https://github.com/IdentityModel/oidc-client-js/wiki#configuration
 *
 * @param {*} store
 * @param {Object} oidcSettings
 * @param {string} oidcSettings.authServerUrl,
 * @param {string} oidcSettings.clientId,
 * @param {string} oidcSettings.authRedirectUri,
 * @param {string} oidcSettings.postLogoutRedirectUri,
 * @param {string} oidcSettings.responseType,
 * @param {string} oidcSettings.extraQueryParams,
 */
export default function (store, oidcSettings) {
  if (!store || !oidcSettings) {
    return;
  }

  const settings = {
    ...oidcSettings,
    // Renewal is driven below: oidc-client's silent renew runs in a frame that only carries the
    // Sonador session cookie when the viewer shares Sonador's site.
    automaticSilentRenew: false,
    revokeAccessTokenOnSignout: true,
    filterProtocolClaims: true,
  };

  const userManager = createUserManager(settings);

  // A session that cannot be renewed is left to expire; the sign-in route then reauthenticates.
  const renewal = sessionRenewal(userManager);
  userManager.events.addAccessTokenExpiring(() => {
    renewal.renew().catch(error => console.warn('Unable to renew the access token', error));
  });

  loadUser(store, userManager);

  return userManager;
}
