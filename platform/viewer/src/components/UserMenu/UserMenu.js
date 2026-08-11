import React, { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import PropTypes from 'prop-types';

import { withModal } from '@ohif/ui';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icons,
} from '@ohif/ui-next';

import { useAppContext } from '../../context/AppContext';
import UserManagerContext from '../../context/UserManagerContext';
import AboutSonador from '../AboutSonador/AboutSonador';


/**
 * Sign-out latch.
 *
 * `signoutRedirect()` calls `removeUser()` *before* it navigates. That clears `state.oidc.user`
 * synchronously, React re-renders, and OHIFStandaloneViewer flips to its unauthenticated route
 * tree while the browser is still sitting on a protected path. The "*" route there mounts
 * SignInSilentOrRedirectRoute, which immediately fires `signinRedirect()` -- and that navigation
 * beats the logout navigation that is still being assembled. The user is sent to the
 * authorization endpoint instead of the end session endpoint, the identity provider's session is
 * still live so it answers straight away, and they land back on the study list still signed in.
 *
 * That race is why logout has never worked (ohif-viewers#31): the browser never reaches Sonador's
 * logout URL at all, so no amount of server side correctness is ever exercised.
 *
 * The latch closes for the brief window between "logout requested" and "browser has navigated
 * away", and the sign-in routes refuse to act while it is set.
 *
 * Deliberately module scope rather than sessionStorage: the window it guards lives entirely
 * inside one document, and the navigation that ends it replaces that document. Persisting it
 * would outlive its purpose -- sessionStorage is per origin, so a viewer served from a different
 * origin than Sonador would keep the flag set after the logout navigation left, and refuse to
 * sign the user back in when they returned.
 */
let signingOut = false;

export function isSigningOut() {
  return signingOut;
}

export function beginSignOut() {
  signingOut = true;
}

export function endSignOut() {
  signingOut = false;
}

/**
 * Start OpenID RP-initiated logout: clear the local OIDC user and hand the browser to Sonador's
 * `end_session_endpoint`, which destroys the Django session (the authentication of record) and
 * returns the user to the sign-out confirmation page.
 *
 * `signoutRedirect()` rejects before navigating if the provider metadata cannot be read or
 * publishes no end session endpoint, which would otherwise leave the user apparently signed in
 * with a live server session, so fall back to a direct navigation to the configured logout URL.
 */
export function signOut(userManager, appConfig) {
  const endSessionUri = appConfig?.oidc?.[0]?.end_session_uri;

  // Must be set before signoutRedirect(): its internal removeUser() is what triggers the
  // re-render that would otherwise start a competing sign-in.
  beginSignOut();

  return userManager.signoutRedirect().catch((error) => {
    console.error('Unable to start OpenID logout.', error);

    if (endSessionUri) {
      // Drop the local session first; the redirect below may not come back to this app.
      return userManager
        .removeUser()
        .catch(() => {})
        .then(() => window.location.assign(endSessionUri));
    }

    // Nothing left to try -- release the latch so the app can authenticate normally again
    // rather than sitting inert on a blank route.
    endSignOut();
    return undefined;
  });
}


/**
 * Account glyph for the menu trigger.
 *
 * Drawn inline rather than pulled from an icon set so the trigger has no dependency on the legacy
 * @ohif/ui icon registry -- ui-next ships no account icon of its own.
 */
function AccountIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}


/**
 * The account menu -- About, Preferences and Logout.
 *
 * Shared by the viewer header and the study list so that both surfaces offer the same actions.
 * Logout in particular used to exist only in the viewer header, which left no way to sign out of
 * the study list at all (ohif-viewers#31).
 *
 * `userManager` comes from context rather than a prop: App only provides it when OpenID is
 * configured, so the absence of a provider is exactly the signal that there is no session to end.
 */
function UserMenu({ modal: { show }, align = 'end', className }) {
  const { t } = useTranslation(['Header', 'AboutModal']);
  const { appConfig = {} } = useAppContext();
  const navigate = useNavigate();

  const user = useSelector((state) => state.oidc && state.oidc.user);
  const userManager = useContext(UserManagerContext);

  // Whatever the identity provider gave us to show for the signed-in account. Sonador's token
  // workflow returns few profile claims, so every one of these may be absent.
  const account =
    user?.profile?.name || user?.profile?.preferred_username || user?.profile?.email || null;

  return (
    <DropdownMenu>
      {/*
        A plain button rather than a ui-next <Button>: the ghost variant paints itself from the
        `--primary` theme token, which does not match the surrounding chrome on either surface.
        `asChild` lets each host style its own trigger to sit with its neighbouring controls,
        while the menu itself stays ui-next.
      */}
      <DropdownMenuTrigger asChild>
        <button type="button" className={className} aria-label={t('Account')} title={t('Account')}>
          <AccountIcon />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align={align} className="min-w-44">
        {account && (
          <>
            <DropdownMenuLabel className="max-w-56 truncate">{account}</DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}

        <DropdownMenuItem
          onSelect={() => show({ content: AboutSonador, title: t('Sonador Viewer / About') })}
        >
          <Icons.Info className="h-5 w-5" />
          <span className="pl-2">{t('About')}</span>
        </DropdownMenuItem>

        {/*
          The settings page is the app's own settings surface (the same destination as the
          sidebar), so the menu routes to it rather than opening the legacy UserPreferences
          modal, which crashed when opened this way.
        */}
        <DropdownMenuItem onSelect={() => navigate('/settings')}>
          <Icons.GearSettings className="h-5 w-5" />
          <span className="pl-2">{t('Settings')}</span>
        </DropdownMenuItem>

        {user && userManager && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => signOut(userManager, appConfig)}>
              <Icons.PowerOff className="h-5 w-5" />
              <span className="pl-2">{t('Logout')}</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

UserMenu.displayName = 'UserMenu';

UserMenu.propTypes = {
  modal: PropTypes.object.isRequired,

  /** Which edge of the trigger the menu aligns to (Radix alignment, via ui-next). */
  align: PropTypes.oneOf(['start', 'center', 'end']),

  /** Lets the host match the trigger to its neighbouring controls. */
  className: PropTypes.string,
};

export default withModal(UserMenu);
