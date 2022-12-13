import actions from './actions.js';
import reducers from './reducers';
import localStorage from './localStorage.js';
import sessionStorage from './sessionStorage.js';

import { getActiveViewportData } from './selectors.js';

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
