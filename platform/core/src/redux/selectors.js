// Redux selectors for working with OHIF data: viewports, servers, and other global 

import { getActiveServer } from '../api/sonador.js';


// Selectors that build a new object or array on every call break referential equality, so
// `useSelector` treats every store notification as a change and re-renders its component. It is
// also what react-redux's development stability check reports as "Selector <name> returned a
// different result when called with the same parameters", once per mounted consumer -- one line
// per study-list row and per series thumbnail, which is most of the console noise on a busy study.
//
// These wrappers keep the last result and return it unchanged while the values it was derived from
// are identical. The cache is module-level, which is correct here because the viewer runs a single
// redux store; it is the same trade-off reselect's default `createSelector` makes.
function memoizeOnInputs(compute) {
  let lastInputs = null;
  let lastResult;

  return (...inputs) => {
    if (
      lastInputs &&
      lastInputs.length === inputs.length &&
      lastInputs.every((value, i) => value === inputs[i])
    ) {
      return lastResult;
    }

    lastInputs = inputs;
    lastResult = compute(...inputs);
    return lastResult;
  };
}


const _buildActiveViewportData = memoizeOnInputs((viewportSpecificData, activeViewportIndex) => ({
  viewportSpecificData,
  activeViewportIndex,
}));

const getActiveViewportData = (state) => {
  // Retrieve display data for the currently active viewport

  const { viewports = {} } = state;
  const { viewportSpecificData, activeViewportIndex } = viewports;

  return _buildActiveViewportData(viewportSpecificData, activeViewportIndex);
};


const _buildActiveOhifServer = memoizeOnInputs((activeServer) => ({ activeServer }));

const activeOhifServer = (state) => {
  // Retrieve active server instance

  const { servers = {} } = state;

  // getActiveServer returns a reference into the store's server array, so it is stable across
  // calls for as long as the active server does not change -- which is what makes the memo hold.
  return _buildActiveOhifServer(getActiveServer(servers));
};


const serverCount = (state) => {
  // Retrieve the count of servers registered with the viewer
  
  return state.servers?.servers?.length;
}


export { getActiveViewportData, activeOhifServer, serverCount };
