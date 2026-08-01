import React, { useContext, useEffect } from 'react';
import PropTypes from 'prop-types';

import WhiteLabelingContext from '../../context/WhiteLabelingContext';
import { BrandedMessage } from '../../components/emptyState/EmptyStateIndicator';
import { endSignOut } from '../../components/UserMenu/UserMenu';
import Layout from '../../layouts/Layout/Layout';

import styles from './SignedOut.module.scss';


// Shown only when the deployment has no farewell configured at all.
const DEFAULT_FAREWELL = '# Signed Out\n\nYou have been logged out of Sonador successfully.';


/**
 * Resolve the site's "Farewell Message".
 *
 * Sonador serves it per site: `OhifConfigView` resolves the active SonadorSite for the request,
 * so a multi-site deployment gets whichever site's message belongs to the host being used, and it
 * arrives on the config API as `branding.farewell`.
 *
 * `signedOutMessageFn` is the white-labeling hook and stays the primary source, but the config
 * value is read directly as a fallback: a deployment that supplies its own `whiteLabeling` block
 * (a custom config file, an embedding host) would otherwise silently lose the site's message,
 * because the context default returns an empty string.
 */
function farewellMessage(whiteLabeling) {
  const branded = whiteLabeling?.signedOutMessageFn && whiteLabeling.signedOutMessageFn();
  if (branded) {
    return branded;
  }

  return window.config?.branding?.farewell || DEFAULT_FAREWELL;
}


/**
 * Sign-out confirmation, rendered at the OpenID `post_logout_redirect_uri` once Sonador has
 * destroyed the session (ohif-viewers#31).
 *
 * This route MUST NOT attempt to authenticate. It lives in the unauthenticated route tree, where
 * the catch-all triggers a silent sign-in -- landing here without an explicit route is what used
 * to send a just-logged-out user straight back through the OpenID workflow.
 *
 * Uses the standard Layout, exactly as the welcome/empty state message does on the study list, so
 * the two screens read as the same product: the sidebar carries the site logo at its normal size,
 * and the message sits at the top of the content area. Settings is suppressed -- there is no
 * session left to configure anything with.
 */
export default function SignedOut({ interim = false }) {
  const whiteLabeling = useContext(WhiteLabelingContext);

  useEffect(() => {
    // Reaching this page as a destination means the logout navigation completed, so release the
    // sign-out latch and let the app authenticate normally again.
    //
    // `interim` renders are the holding frame shown while that navigation is still in flight
    // (see SignInSilentOrRedirectRoute). Clearing the latch there would re-arm the very sign-in
    // race the latch exists to prevent.
    if (!interim) {
      endSignOut();
    }
  }, [interim]);

  return (
    <Layout noHorizontalPadding fixedHeight showSettings={false}>
      <BrandedMessage>{farewellMessage(whiteLabeling)}</BrandedMessage>

      <div className={styles.actions}>
        {/*
          A full page load rather than a router link: it re-enters Sonador from the top, which is
          what starts a clean OpenID login. Staying inside the router would drop back into the
          silent sign-in catch-all this page exists to avoid.
        */}
        <a href="/">Sign in again</a>
      </div>
    </Layout>
  );
}

SignedOut.propTypes = {
  /** Rendered as a holding frame while the logout navigation is still in flight. */
  interim: PropTypes.bool,
};
