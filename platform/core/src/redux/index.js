import actions from './actions.js';
import localStorage from './localStorage.js';
import reducers from './reducers';
import { getActiveViewportData, activeOhifServer } from './selectors.js';
import sessionStorage from './sessionStorage.js';

const redux = {
  reducers,
  actions,
  localStorage,
  sessionStorage,
  selectors: {
    getActiveViewportData,
    activeOhifServer,
  },
};

export default redux;
