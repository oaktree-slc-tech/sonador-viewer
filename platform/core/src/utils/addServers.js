// TODO: figure out where else to put this function
const addServers = (servers, store) => {
  if (!servers || !store) {
    throw new Error('The servers and store must be defined');
  }

  Object.keys(servers).forEach(serverType => {
    const endpoints = servers[serverType];
    let serversWithTypes = endpoints.map(endpoint => {
      const server = Object.assign({}, endpoint);
      server.type = serverType;
      return server;
    });
    store.dispatch({
      type: 'ADD_SERVER',
      serversWithTypes,
    });
  });
};

export default addServers;
