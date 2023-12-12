import { useContext } from 'react';
import { useDispatch, useSelector } from 'react-redux';

// Contexts
import AppContext from '../context/AppContext';
import GoogleCloudApi from '../googleCloud/api/GoogleCloudApi';
import * as GoogleCloudUtilServers from '../googleCloud/utils/getServers';

import usePrevious from './usePrevious';

const getActiveServer = (servers) => {
  // Search the servers list for the active server instance.
  // @param servers: collection of servers to be searched for active instance.
  // @returns active server or undefined
  const isActive = (a) => a.active === true;

  return servers && servers.servers && servers.servers.find(isActive);
};

const getServers = (appConfig, project, location, dataset, dicomStore) => {
  // Dynamically retrieve server list
  // TODO: Remove Google Cloud adapter
  let servers = [];

  // Retrieve server list from Google Cloud
  if (appConfig.enableGoogleCloudAdapter) {
    GoogleCloudApi.urlBase = appConfig.healthcareApiEndpoint;
    const pathUrl = GoogleCloudApi.getUrlBaseDicomWeb(project, location, dataset, dicomStore);
    const data = {
      project,
      location,
      dataset,
      dicomStore,
      wadoUriRoot: pathUrl,
      qidoRoot: pathUrl,
      wadoRoot: pathUrl,
    };
    servers = GoogleCloudUtilServers.getServers(data, dicomStore);
    if (!isValidServer(servers[0], appConfig)) {
      return;
    }
  }

  return servers;
};

const isValidServer = (server, appConfig) => {
  // Validate the server as valid/invalid.

  if (appConfig.enableGoogleCloudAdapter) {
    return GoogleCloudUtilServers.isValidServer(server);
  }

  return !!server;
};

const setServers = (dispatch, servers) => {
  // Update Redux server list
  const action = {
    type: 'SET_SERVERS',
    servers,
  };
  dispatch(action);
};

const useServerFromUrl = (servers = [], previousServers, activeServer, urlBasedServers, appConfig) => {
  // Update OHIF state URL

  if (!appConfig.enableGoogleCloudAdapter) {
    return false;
  }

  const serverHasChanged = previousServers !== servers && previousServers;

  // do not update from url. use state instead.
  if (serverHasChanged) {
    return false;
  }

  // if no valid urlbased servers
  if (!urlBasedServers || !urlBasedServers.length) {
    return false;
  } else if (!servers.length || !activeServer) {
    // no current valid server
    return true;
  }

  const newServer = urlBasedServers[0];

  let exists = servers.some(GoogleCloudUtilServers.isEqualServer.bind(undefined, newServer));

  return !exists;
};

export default function useServer({ project, location, dataset, dicomStore, token } = {}) {
  // Hooks
  const servers = useSelector((state) => state && state.servers);
  const previousServers = usePrevious(servers);
  const dispatch = useDispatch();
  const { appConfig = {} } = useContext(AppContext);

  // Set active server to match token
  servers.servers.map((server) => {
    if (token) {
      server.active = server.token === token;
    }
  });

  // Retrieve active server
  const activeServer = getActiveServer(servers, token);
  const urlBasedServers = getServers(appConfig, project, location, dataset, dicomStore) || [];
  const shouldUpdateServer = useServerFromUrl(
    servers.servers,
    previousServers,
    activeServer,
    urlBasedServers,
    appConfig
  );

  if (shouldUpdateServer) {
    setServers(dispatch, urlBasedServers);
  } else if (isValidServer(activeServer, appConfig)) {
    return activeServer;
  }
}
