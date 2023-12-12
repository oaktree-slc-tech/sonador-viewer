import React, { lazy, Suspense, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Route, Routes, useLocation } from 'react-router-dom';
import PropTypes from 'prop-types';
import qs from 'query-string';
import { SignoutCallbackComponent } from 'redux-oidc';

import { redux } from '@ohif/core';
import { ViewerbaseDragDropContext } from '@ohif/ui';
import Loader from '@ohif/ui/src/components/Loader/Loader';

// Contexts
import AppContext from './context/AppContext';
import NotFound from './pages/NotFound/NotFound';
import * as RoutesUtil from './routes/routesUtil';

import './OHIFStandaloneViewer.css';
import './variables.css';
import './theme-tide.css';

const {
  actions: { setActiveServer },
} = redux;

const CallbackPage = lazy(() => import(/* webpackChunkName: "CallbackPage" */ './pages/CallbackPage'));

const OHIFStandaloneViewer = ({ userManager }) => {
  const dispatch = useDispatch();
  const location = useLocation();

  const user = useSelector((state) => state.oidc.user);
  const servers = useSelector((state) => state.servers.servers);

  const { appConfig = {} } = React.useContext(AppContext);
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

    if (pathname !== '/callback') {
      sessionStorage.setItem('ohif-redirect-to', JSON.stringify({ pathname, search }));
    }

    return (
      <Routes>
        <Route exact path="/silent-refresh.html" element={<RefreshRoute />} />
        <Route
          exact
          path="/logout-redirect"
          element={
            <SignoutCallbackComponent
              userManager={userManager}
              successCallback={() => {}}
              errorCallback={(error) => {
                console.warn(error);
                console.warn('Signout failed');
              }}
            />
          }
        />
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
    <Routes>
      <Route exact path="/silent-refresh.html" element={<RefreshRoute />} />
      <Route exact path="/logout-redirect.html" element={<RefreshRoute />} />
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
  );
};

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
  useEffect(() => {
    void userManager.getUser().then((user) => {
      if (user) {
        void userManager.signinSilent();
      } else {
        void userManager.signinRedirect();
      }
    });
  }, []);

  return null;
}
