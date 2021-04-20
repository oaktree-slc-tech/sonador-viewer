import uniqBy from 'lodash/uniqBy';

export const defaultState = {
  servers: [],
};

export const swithServerActionCreator = token => ({
  type: 'SWITCH_SERVER',
  token,
});

const servers = (state = defaultState, action) => {
  switch (action.type) {
    case 'ADD_SERVER':
      const servers = action.serversWithTypes;
      servers.forEach(s => (s.default ? (s.active = true) : false));
      return { ...state.servers, servers };

    case 'ACTIVATE_SERVER': {
      const newServer = { ...action.server, active: true };
      const newServers = state.servers;
      newServers.forEach(s => (s.active = false));
      return {
        ...state,
        servers: uniqBy([...newServers, newServer], 'wadoRoot'),
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
