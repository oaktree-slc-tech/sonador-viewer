import { lazy } from 'react';
import { every, find, isArray, keys } from 'lodash';

import OHIF from '@ohif/core';

const { urlUtil: UrlUtil } = OHIF.utils;

// Dynamic Import Routes (CodeSplitting)
const IHEInvokeImageDisplay = lazy(
  () => import(/* webpackChunkName: "IHEInvokeImageDisplay" */ './IHEInvokeImageDisplay')
);
const ViewerRouting = lazy(() => import(/* webpackChunkName: "ViewerRouting" */ './ViewerRouting'));

const StudyListRouting = lazy(() => import(/* webpackChunkName: "StudyListRouting" */ '../studylist/StudyListRouting'));
const StudyListRoutingNG = lazy(
  () => import(/* webpackChunkName: "StudyListRouting" */ '../studylist/StudyListRoutingNG')
);
const StandaloneRouting = lazy(() => import('../connectedComponents/ConnectedStandaloneRouting'));
const ViewerLocalFileData = lazy(() => import('../connectedComponents/ViewerLocalFileData'));
const UploadStudyPageNG = lazy(() => import('../pages/UploadStudyPageNG/UploadStudyPageNG'));
const SettingsPageNG = lazy(() => import('../pages/SettingsPageNG/SettingsPageNG'));
const SharedWithMeNG = lazy(() => import('../pages/SharedWithMePageNG/SharedWithMePageNG'));
const WorkListPageNG = lazy(() => import('../pages/WorkListPageNG/WorkListPageNG'));
const WorkListViewerPageNG = lazy(() => import('../pages/WorkListViewerPageNG/WorkListViewerPageNG'));

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
    path: '/legacy/studylist',
    component: StudyListRouting,
    condition: (appConfig) => appConfig.showStudyList,
  },
  {
    path: '/legacy',
    component: StudyListRouting,
    condition: (appConfig) => appConfig.showStudyList,
  },
  {
    path: '/server/:token',
    component: StudyListRoutingNG,
    condition: (appConfig) => appConfig.showStudyList,
  },
  {
    path: '/server/:token/viewer',
    component: StudyListRoutingNG,
    condition: (appConfig) => appConfig.showStudyList,
  },
  {
    path: '/studylist',
    component: StudyListRoutingNG,
    condition: (appConfig) => appConfig.showStudyList,
  },
  {
    path: '/',
    component: StudyListRoutingNG,
    condition: (appConfig) => appConfig.showStudyList,
  },
  {
    path: '/upload',
    component: UploadStudyPageNG,
    condition: (appConfig) => {
      return appConfig.showStudyList;
    },
  },
  {
    path: '/settings',
    component: SettingsPageNG,
  },
  {
    path: '/shared-with-me',
    component: SharedWithMeNG,
    condition: (appConfig) => {
      return appConfig.showStudyList;
    },
  },
  {
    path: '/worklist',
    component: WorkListPageNG,
    condition: (appConfig) => {
      return appConfig.showStudyList;
    },
  },
  {
    path: '/worklist/viewer',
    component: WorkListViewerPageNG,
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
