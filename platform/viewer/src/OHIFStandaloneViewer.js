import React, { lazy, Suspense, useContext, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Route, Routes, useLocation } from 'react-router-dom';
import PropTypes from 'prop-types';
import qs from 'query-string';

import { redux } from '@ohif/core';
import { ViewerbaseDragDropContext } from '@ohif/ui';
import Loader from '@ohif/ui/src/components/Loader/Loader';

// Contexts
import AppContext from './context/AppContext';
import { initUserPreferences } from './init/initUserPreferences';
import NotFound from './pages/NotFound/NotFound';
import SignedOut from './pages/SignedOut/SignedOut';
import { isSigningOut } from './components/UserMenu/UserMenu';
import * as RoutesUtil from './routes/routesUtil';

import './OHIFStandaloneViewer.css';
import './variables.css';
import './theme-tide.css';
import '@ohif/ui-next/src/tailwind-integration.css';

const {
  actions: { setActiveServer },
} = redux;

const CallbackPage = lazy(() => import(/* webpackChunkName: "CallbackPage" */ './pages/CallbackPage'));

// Sonador's OpenID `post_logout_redirect_uri`, plus the extension-less form older builds use
const SIGNED_OUT_PATHS = ['/logout-redirect.html', '/logout-redirect'];

// Routes that are steps in an auth flow, never a post-login destination
const AUTH_TRANSITION_PATHS = ['/callback', ...SIGNED_OUT_PATHS];

const OHIFStandaloneViewer = ({ userManager }) => {
  const dispatch = useDispatch();
  const location = useLocation();

  const user = useSelector((state) => state.oidc.user);
  const servers = useSelector((state) => state.servers.servers);

  const { appConfig = {} } = useContext(AppContext);
  const userNotLoggedIn = userManager && (!user || user.expired);
  const { activeServerToken } = qs.parse(location.search.replace('?', ''));
  const areServersPresent = servers.length > 0;

  useEffect(() => {
    if (activeServerToken && areServersPresent) {
      dispatch(setActiveServer(activeServerToken));
    }
  }, [areServersPresent]);

  if (userNotLoggedIn) {
    const { pathname, search } = location;

    // Paths that are part of an auth transition rather than a destination. Remembering them as
    // the post-login target would bounce the user back into the flow they just finished.
    if (!AUTH_TRANSITION_PATHS.includes(pathname)) {
      sessionStorage.setItem('ohif-redirect-to', JSON.stringify({ pathname, search }));
    }

    return (
      <Routes>
        <Route exact path="/silent-refresh.html" element={<RefreshRoute />} />

        {/*
          Sign-out confirmation (ohif-viewers#31). Both spellings are routed: ".html" is what
          Sonador configures as `post_logout_redirect_uri`, the bare path is kept for viewer
          builds and deployments still configured the old way. Without an explicit match here the
          request falls through to the catch-all below and silently signs the user back in.
        */}
        {SIGNED_OUT_PATHS.map((path) => (
          <Route exact key={path} path={path} element={<SignedOut />} />
        ))}

        <Route
          path="/callback"
          element={
            <Suspense fallback={<Loader />}>
              <CallbackPage userManager={userManager} />
            </Suspense>
          }
        />
        <Route path="/login" element={<LoginRoute />} />
        <Route path="*" element={<SignInSilentOrRedirectRoute userManager={userManager} />} />
      </Routes>
    );
  }

  const routes = RoutesUtil.getRoutes(appConfig);

  return (
    <>
    <UserPreferencesInit user={user} />
    <Routes>
      <Route exact path="/silent-refresh.html" element={<RefreshRoute />} />

      {/*
        Reachable when the sign-out page is opened while a session is still live (a stale tab, or
        the URL entered directly). Show the confirmation rather than reloading: the old
        RefreshRoute here reloaded into the Sonador catch-all, which re-authenticated.
      */}
      {SIGNED_OUT_PATHS.map((path) => (
        <Route exact key={path} path={path} element={<SignedOut />} />
      ))}

      {routes.map(({ path, Component }) => (
        <Route
          exact
          key={path}
          path={path}
          element={
            <Suspense fallback={<Loader />}>
              <Component location={location} />
            </Suspense>
          }
        />
      ))}
      <Route path="*" element={<NotFound />} />
    </Routes>
    </>
  );
};

function UserPreferencesInit({ user }) {
  // Startup hydration of user preferences (sonador#42 §5.5). Rendered only in the
  // authenticated tree; the effect additionally waits for a live (non-expired) OIDC user so
  // getAuthToken() returns a token before the first request fires. When no userManager is
  // configured there is no Sonador auth to hydrate with, and initUserPreferences degrades to
  // a logged no-op (FR-9).
  const authenticated = !!(user && !user.expired);

  useEffect(() => {
    if (authenticated) {
      void initUserPreferences();
    }
  }, [authenticated]);

  return null;
}

OHIFStandaloneViewer.propTypes = {
  userManager: PropTypes.object,
};

export default ViewerbaseDragDropContext(OHIFStandaloneViewer);

function RefreshRoute() {
  useEffect(() => {
    void RoutesUtil.reload();
  }, []);

  return null;
}

function LoginRoute({ appConfig, userManager }) {
  useEffect(() => {
    const queryParams = new URLSearchParams(location.search);
    const iss = queryParams.get('iss');
    const loginHint = queryParams.get('login_hint');
    const targetLinkUri = queryParams.get('target_link_uri');
    const oidcAuthority = appConfig.oidc !== null && appConfig.oidc[0].authority;
    if (iss !== oidcAuthority) {
      console.error('iss of /login does not match the oidc authority');
      return null;
    }

    userManager.removeUser().then(() => {
      if (targetLinkUri !== null) {
        const ohifRedirectTo = {
          pathname: new URL(targetLinkUri).pathname,
        };
        sessionStorage.setItem('ohif-redirect-to', JSON.stringify(ohifRedirectTo));
      } else {
        const ohifRedirectTo = {
          pathname: '/',
        };
        sessionStorage.setItem('ohif-redirect-to', JSON.stringify(ohifRedirectTo));
      }

      if (loginHint !== null) {
        void userManager.signinRedirect({ login_hint: loginHint });
      } else {
        void userManager.signinRedirect();
      }
    });
  }, []);

  return null;
}

function SignInSilentOrRedirectRoute({ userManager }) {
  // A sign-out in progress unmounts the authenticated tree the instant signoutRedirect() clears
  // the stored user -- before its own navigation has been issued. Starting a sign-in here would
  // win that race and cancel the logout outright, which is exactly the loop in ohif-viewers#31.
  const signingOut = isSigningOut();

  useEffect(() => {
    if (signingOut) {
      return;
    }

    void userManager.getUser().then((user) => {
      if (user) {
        void userManager.signinSilent();
      } else {
        void userManager.signinRedirect();
      }
    });
  }, [signingOut]);

  // Hold the sign-out confirmation until the logout navigation lands, so the interim frame is not
  // an empty page.
  return signingOut ? <SignedOut interim /> : null;
}
