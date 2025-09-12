// Imaging servers within OHIF represent PACS / Orthanc instances.
// Schema:
// - `rootUrl` (str): URL including scheme, hostname, and port (but omitting path components)
//      which can be used to connect to the server. Example: https://domain.com:{port}
// - `wadoUriRoot` (str): URL root (including path) for the WadoRS endpoints of the server.
//      https://www.dicomstandard.org/using/dicomweb/retrieve-wado-rs-and-wado-uri
// - `wadoRoot` (str): URL root Wado (including path) endpoints.
// - `qidoRoot` (str): URL root for QIDO endpoints
//      https://www.dicomstandard.org/using/dicomweb/query-qido-rs

var _ = require('lodash');


import { SET_ACTIVE_SERVER, ADD_SERVER, UPDATE_SERVER, SET_SERVERS } from '../constants/ActionTypes';
import { urlUtil } from '../../utils';


export const defaultState = {
  servers: [],
};


export const switchServerActionCreator = (token) => ({
  type: 'SWITCH_SERVER',
  token,
});


const servers = (state = defaultState, action) => {
  // Manage Imaging Servers

  switch (action.type) {
    
    case ADD_SERVER:
      const servers = action.serversWithTypes;

      // Iterate through server list and ensure that servers include all
      // components required by the viewer API including an `active` and `rootUrl` properties.
      servers.forEach((s) => {

        // Mark "default" server as active
        (s.default ? (s.active = true) : false)

        // Ensure that the server includes a rootUrl property.
        if (!s.rootUrl) {
          _.extend(s, _.pick(urlUtil.getRootUrl(s.wadoUriRoot || s.wadoRoot || s.qidoRoot || ''), 'rootUrl'));
        }
      });

      // In cases where there is no default, mark first
      // server in list as active.
      if (!_.find(servers, (s) => s.active) && servers.length) {
        servers[0].active = true;
      }

      return { ...state, servers };

    
    case UPDATE_SERVER:
      // Update (or add) a server entry to the servers list. The properties provided
      // with the dispatch action will be added to the Redux state.

      return {
        ...state,
        servers: _.uniqBy([...state.servers, { ...action.server }], 'wadoRoot'),
      };

    
    case 'ACTIVATE_SERVER':
      // Mark the provided server as active. All other servers in the Redux state are marked inactive.

      const newServer = { ...action.server, active: true };
      const newServers = state.servers;
      newServers.forEach((s) => (s.active = false));
      return {
        ...state,
        servers: _.uniqBy([...newServers, newServer], 'wadoRoot'),
      };

    
    case SET_SERVERS:
      // Replace all servers in the Redux state
      return { ...state, servers: action.servers };

    
    case 'SWITCH_SERVER':
      // Switch to the server instance indicated by the action token value

      const allServers = state.servers;
      allServers.forEach((s) => (s.token === action.token ? (s.active = true) : (s.active = false)));
      return {
        ...state,
        servers: allServers,
      };

    
    case SET_ACTIVE_SERVER:
      // Set the server specified by the server token as active

      const updatedServers = state.servers.slice().map((server) => {
        return {
          ...server,
          active: server.token === action.payload,
        };
      });

      return {
        ...state,
        servers: updatedServers,
      };
    

    default:
      return state;
  }
};


export default servers;
