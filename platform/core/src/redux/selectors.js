// Redux selectors for working with OHIF data: viewports, servers, and other global 

import { getActiveServer } from '../api/sonador.js';


const getActiveViewportData = (state) => {
  // Retrieve display data for the currently active viewport

  const { viewports = {} } = state;
  const { viewportSpecificData, activeViewportIndex } = viewports;

  return {
    viewportSpecificData,
    activeViewportIndex,
  };
};


const activeOhifServer = (state) => {
  // Retrieve active server instance

  const { servers = {} } = state;
  const activeServer = getActiveServer(servers);

  return {
    activeServer,
  };
};


export { getActiveViewportData, activeOhifServer };
