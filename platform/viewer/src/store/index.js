import { reducer as oidcReducer } from 'redux-oidc';
import thunkMiddleware from 'redux-thunk';

import { redux } from '@ohif/core';

import { applyMiddleware, combineReducers, compose, createStore } from 'redux';


export function createViewerStore({ servicesManager, middleware = [], }) {
  // Create the Redux store for the Sonador Viewer

  // Combine our @ohif/core and oidc reducers
  // Set init data, using values found in localStorage
  const { reducers, localStorage, sessionStorage, middleware: sonadorCoreMiddleware } = redux;
  const { viewportGridService } = servicesManager.services;

  // Create middeware pipeline
  const _middleware = [...middleware, thunkMiddleware, 
    sonadorCoreMiddleware.createViewportGridMiddleware({ viewportGridService }) ];
  const composeEnhancers = window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ || compose;

  reducers.oidc = oidcReducer;

  const rootReducer = combineReducers(reducers);
  const preloadedState = {
    ...localStorage.loadState(),
    ...sessionStorage.loadState(),
  };

  if (window.config && window.config.disableServersCache === true) {
    delete preloadedState.servers;
  }

  const _store = createStore(rootReducer, preloadedState, composeEnhancers(applyMiddleware(..._middleware)));

  // When the store's preferences change,
  // Update our cached preferences in localStorage
  _store.subscribe(() => {
    localStorage.saveState({
      preferences: _store.getState().preferences,
    });
    sessionStorage.saveState({
      servers: _store.getState().servers,
    });
  });

  // Set global store reference
  return _store;
}
