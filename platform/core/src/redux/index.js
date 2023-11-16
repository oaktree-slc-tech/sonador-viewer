import actions from './actions.js';
import localStorage from './localStorage.js';
import reducers from './reducers';
import { getActiveViewportData } from './selectors.js';
import sessionStorage from './sessionStorage.js';

const redux = {
  reducers,
  actions,
  localStorage,
  sessionStorage,
  selectors: {
    getActiveViewportData,
  },
};

export default redux;
