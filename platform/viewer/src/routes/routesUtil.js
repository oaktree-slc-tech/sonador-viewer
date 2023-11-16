import { every, find, isArray, keys } from 'lodash';

import OHIF from '@ohif/core';
import { asyncComponent, retryImport } from '@ohif/ui';

const { urlUtil: UrlUtil } = OHIF.utils;

// Dynamic Import Routes (CodeSplitting)
const IHEInvokeImageDisplay = asyncComponent(() =>
  retryImport(() => import(/* webpackChunkName: "IHEInvokeImageDisplay" */ './IHEInvokeImageDisplay.js'))
);
const ViewerRouting = asyncComponent(() =>
  retryImport(() => import(/* webpackChunkName: "ViewerRouting" */ './ViewerRouting.js'))
);

const StudyListRouting = asyncComponent(() =>
  retryImport(() => import(/* webpackChunkName: "StudyListRouting" */ '../studylist/StudyListRouting.js'))
);
const StudyListRoutingNG = asyncComponent(() =>
  retryImport(() => import(/* webpackChunkName: "StudyListRouting" */ '../studylist/StudyListRoutingNG.js'))
);
const StandaloneRouting = asyncComponent(() =>
  retryImport(() =>
    import(/* webpackChunkName: "ConnectedStandaloneRouting" */ '../connectedComponents/ConnectedStandaloneRouting.js')
  )
);
const ViewerLocalFileData = asyncComponent(() =>
  retryImport(() =>
    import(/* webpackChunkName: "ViewerLocalFileData" */ '../connectedComponents/ViewerLocalFileData.js')
  )
);
const UploadStudyPageNG = asyncComponent(() =>
  retryImport(() => import('../studylist/UploadStudyPageNG/UploadStudyPageNG.js'))
);
const SettingsPageNG = asyncComponent(() => retryImport(() => import('../studylist/SettingsPageNG/SettingsPageNG')));
const SharedWithMeNG = asyncComponent(() =>
  retryImport(() => import('../studylist/SharedWithMePageNG/SharedWithMePageNG'))
);

const reload = () => window.location.reload();

const ROUTES_DEF = {
  default: {
    // Load viewer for specific studies
    viewer: {
      path: ['/server/:token/viewer/study/:studyInstanceUIDs', '/viewer/:studyInstanceUIDs'],
      component: ViewerRouting,
    },
    standaloneViewer: {
      path: '/viewer',
      component: StandaloneRouting,
    },
    list: {
      path: ['/server/:token', '/server/:token/viewer', '/studylist', '/'],
      component: StudyListRouting,
      condition: (appConfig) => {
        return appConfig.showStudyList;
      },
    },
    listNG: {
      path: ['/ng/server/:token', '/ng/server/:token/viewer', '/ng/studylist', '/ng'],
      component: StudyListRoutingNG,
      condition: (appConfig) => {
        return appConfig.showStudyList;
      },
    },
    uploadNG: {
      path: ['/ng/upload'],
      component: UploadStudyPageNG,
      condition: (appConfig) => {
        return appConfig.showStudyList;
      },
    },
    settingsNG: {
      path: ['/ng/settings'],
      component: SettingsPageNG,
    },
    sharedWithMeNG: {
      path: ['/ng/shared-with-me'],
      component: SharedWithMeNG,
      condition: (appConfig) => {
        return appConfig.showStudyList;
      },
    },
    local: {
      path: '/local',
      component: ViewerLocalFileData,
    },
    IHEInvokeImageDisplay: {
      path: '/IHEInvokeImageDisplay',
      component: IHEInvokeImageDisplay,
    },
  },
  sonador: {
    viewer: {
      path: '/server/:token/viewer/study/:studyInstanceUIDs',
      component: ViewerRouting,
      condition: (appConfig) => {
        return !!appConfig.enableGoogleCloudAdapter;
      },
    },
    list: {
      path: '/server/:token/viewer',
      component: StudyListRouting,
      condition: (appConfig) => {
        const showList = appConfig.showStudyList;

        return showList && !!appConfig.enableGoogleCloudAdapter;
      },
    },
  },
};

const getRoutes = (appConfig) => {
  const routes = [];
  for (let keyConfig in ROUTES_DEF) {
    const routesConfig = ROUTES_DEF[keyConfig];

    for (let routeKey in routesConfig) {
      const route = routesConfig[routeKey];
      const validRoute = typeof route.condition === 'function' ? route.condition(appConfig) : true;

      if (validRoute) {
        routes.push({
          path: route.path,
          Component: route.component,
        });
      }
    }
  }

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
  let viewerPath = params.token || server.token ? ROUTES_DEF.sonador.viewer.path : ROUTES_DEF.default.viewer.path;
  if (!params.token && server.token) params.token = server.token;

  return parsePath(viewerPath, server, params);
};

const parseStudyListPath = (_ = {}, server = {}, params) => {
  let studyListPath = params.token ? ROUTES_DEF.sonador.list.path : ROUTES_DEF.default.list.path;

  return parsePath(studyListPath, server, params);
};

export { getRoutes, parseViewerPath, parseStudyListPath, reload };
