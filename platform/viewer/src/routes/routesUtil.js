import { lazy } from 'react';
import { every, find, isArray, keys } from 'lodash';

import OHIF from '@ohif/core';

const { urlUtil: UrlUtil } = OHIF.utils;

// Dynamic Import Routes (CodeSplitting)
const IHEInvokeImageDisplay = lazy(
  () => import(/* webpackChunkName: "IHEInvokeImageDisplay" */ './IHEInvokeImageDisplay.js')
);
const ViewerRouting = lazy(() => import(/* webpackChunkName: "ViewerRouting" */ './ViewerRouting.js'));

const StudyListRouting = lazy(
  () => import(/* webpackChunkName: "StudyListRouting" */ '../studylist/StudyListRouting.js')
);
const StudyListRoutingNG = lazy(
  () => import(/* webpackChunkName: "StudyListRouting" */ '../studylist/StudyListRoutingNG.js')
);
const StandaloneRouting = lazy(() => import('../connectedComponents/ConnectedStandaloneRouting.js'));
const ViewerLocalFileData = lazy(() => import('../connectedComponents/ViewerLocalFileData.js'));
const UploadStudyPageNG = lazy(() => import('../pages/UploadStudyPageNG/UploadStudyPageNG.js'));
const SettingsPageNG = lazy(() => import('../pages/SettingsPageNG/SettingsPageNG'));
const SharedWithMeNG = lazy(() => import('../pages/SharedWithMePageNG/SharedWithMePageNG'));

const reload = () => window.location.reload();

const ROUTES_DEF = [
  // Load viewer for specific studies
  {
    path: '/server/:token/viewer/study/:studyInstanceUIDs',
    component: ViewerRouting,
  },
  {
    path: '/viewer/:studyInstanceUIDs',
    component: ViewerRouting,
  },
  {
    path: '/viewer',
    component: StandaloneRouting,
  },
  {
    path: '/server/:token',
    component: StudyListRouting,
    condition: (appConfig) => appConfig.showStudyList,
  },
  {
    path: '/server/:token/viewer',
    component: StudyListRouting,
    condition: (appConfig) => appConfig.showStudyList,
  },
  {
    path: '/studylist',
    component: StudyListRouting,
    condition: (appConfig) => appConfig.showStudyList,
  },
  {
    path: '/',
    component: StudyListRouting,
    condition: (appConfig) => appConfig.showStudyList,
  },
  {
    path: '/ng/server/:token',
    component: StudyListRoutingNG,
    condition: (appConfig) => appConfig.showStudyList,
  },
  {
    path: '/ng/server/:token/viewer',
    component: StudyListRoutingNG,
    condition: (appConfig) => appConfig.showStudyList,
  },
  {
    path: '/ng/studylist',
    component: StudyListRoutingNG,
    condition: (appConfig) => appConfig.showStudyList,
  },
  {
    path: '/ng',
    component: StudyListRoutingNG,
    condition: (appConfig) => appConfig.showStudyList,
  },
  {
    path: '/ng/upload',
    component: UploadStudyPageNG,
    condition: (appConfig) => {
      return appConfig.showStudyList;
    },
  },
  {
    path: '/ng/settings',
    component: SettingsPageNG,
  },
  {
    path: '/ng/shared-with-me',
    component: SharedWithMeNG,
    condition: (appConfig) => {
      return appConfig.showStudyList;
    },
  },
  {
    path: '/local',
    component: ViewerLocalFileData,
  },
  {
    path: '/IHEInvokeImageDisplay',
    component: IHEInvokeImageDisplay,
  },
  {
    path: '/server/:token/viewer/study/:studyInstanceUIDs',
    component: ViewerRouting,
    condition: (appConfig) => {
      return !!appConfig.enableGoogleCloudAdapter;
    },
  },
  {
    path: '/server/:token/viewer',
    component: StudyListRouting,
    condition: (appConfig) => {
      const showList = appConfig.showStudyList;

      return showList && !!appConfig.enableGoogleCloudAdapter;
    },
  },
];

const getRoutes = (appConfig) => {
  const routes = [];
  ROUTES_DEF.forEach((route) => {
    const validRoute = typeof route.condition === 'function' ? route.condition(appConfig) : true;

    if (validRoute) {
      routes.push({
        path: route.path,
        Component: route.component,
      });
    }
  });

  return routes;
};

const parsePath = (path, server, params) => {
  // Create URL from the provided path that incorporates the values in "params".
  let _path;

  if (isArray(path)) {
    // If path is an array, look for a path string that includes all of the parameter keys.
    _path = find(path, (v) => {
      return every(keys(params), (k) => (v || '').includes(k));
    });
  } else {
    // For string path values, use value as provided
    _path = path;
  }

  const _paramsCopy = Object.assign({}, server, params);

  for (let key in _paramsCopy) {
    _path = UrlUtil.paramString.replaceParam(_path, key, _paramsCopy[key]);
  }

  return _path;
};

const parseViewerPath = (_ = {}, server = {}, params) => {
  // Create viewer URL from the provided configuration, server, and URL parameters.
  // Use the Sonador viewer path if there is a server token, otherwise use the default
  // viewer path.
  let viewerPath =
    params.token || server.token
      ? '/server/:token/viewer/study/:studyInstanceUIDs'
      : ['/server/:token/viewer/study/:studyInstanceUIDs', '/viewer/:studyInstanceUIDs'];
  if (!params.token && server.token) params.token = server.token;

  return parsePath(viewerPath, server, params);
};

const parseStudyListPath = (_ = {}, server = {}, params) => {
  let studyListPath = params.token
    ? '/server/:token/viewer'
    : ['/server/:token', '/server/:token/viewer', '/studylist', '/'];

  return parsePath(studyListPath, server, params);
};

export { getRoutes, parseViewerPath, parseStudyListPath, reload };
