var _ = require('lodash');


export const defaultState = {
  servers: [],
};


export const switchServerActionCreator  = token => ({
  type: 'SWITCH_SERVER',
  token,
});


const servers = (state = defaultState, action) => {
  switch (action.type) {
    case 'ADD_SERVER':
      const servers = action.serversWithTypes;

      // Iterate through server list and activate "default"
      servers.forEach(s => (s.default ? (s.active = true) : false));

      // In cases where there is no default, mark first 
      // server in list as active.
      if (!_.find(servers, s => s.active) && servers.length) {
        servers[0].active = true;
      }

      return { ...state.servers, servers };

    case 'ACTIVATE_SERVER': {
      const newServer = { ...action.server, active: true };
      const newServers = state.servers;
      newServers.forEach(s => (s.active = false));
      return {
        ...state,
        servers: _.uniqBy([...newServers, newServer], 'wadoRoot'),
      };
    }

    case 'SET_SERVERS':
      return { ...state, servers: action.servers };

    case 'SWITCH_SERVER':
      const allServers = state.servers;
      allServers.forEach(s =>
        s.token === action.token ? (s.active = true) : (s.active = false)
      );
      return {
        ...state,
        servers: allServers,
      };

    default:
      return state;
  }
};


export default servers;

