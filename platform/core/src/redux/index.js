import actionTypes from './constants/ActionTypes.js';
import localStorage from './localStorage.js';
import sessionStorage from './sessionStorage.js';

import actions from './actions.js';
import reducers from './reducers';

import createViewportGridMiddleware from './middleware/createViewportGridMiddleware';

import { getActiveViewportData, activeOhifServer, serverCount } from './selectors.js';


const redux = {
  actionTypes,
  reducers,
  actions,
  localStorage,
  sessionStorage,
  selectors: {
    getActiveViewportData,
    activeOhifServer,
    serverCount,
  },
  middleware: {
    createViewportGridMiddleware,
  }
};


export default redux;
