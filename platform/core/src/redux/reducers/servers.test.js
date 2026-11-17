/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// The Cornerstone3D packages are ESM builds jest cannot load here; the exports under test do not use them
jest.mock('@cornerstonejs/dicom-image-loader', () => ({}), { virtual: true });
jest.mock('@cornerstonejs/core', () => ({ utilities: {}, cache: {}, metaData: {}, Enums: {} }), { virtual: true });
jest.mock('@cornerstonejs/tools', () => ({ utilities: {}, Enums: {}, segmentation: {} }), { virtual: true });
jest.mock('@cornerstonejs/core/utilities/textureSupport', () => ({}), { virtual: true });
jest.mock('@cornerstonejs/polymorphic-segmentation', () => ({}), { virtual: true });

import { Reducer } from 'redux-testkit';

import * as types from './../constants/ActionTypes.js';
import reducer, { defaultState } from './servers';

describe('viewports reducer', () => {
  it('should return the initial state', () => {
    expect(reducer(undefined, {})).toEqual(defaultState);
  });

  it('replaces the servers with those of ADD_SERVER, the default one active', () => {
    const initialState = { servers: [{ id: 'old', rootUrl: 'https://old.example' }] };
    const action = {
      type: types.ADD_SERVER,
      serversWithTypes: [
        { id: 'one', rootUrl: 'https://one.example' },
        { id: 'two', rootUrl: 'https://two.example', default: true },
      ],
    };

    const state = reducer(initialState, action);
    expect(state.servers.map(server => [server.id, Boolean(server.active)])).toEqual([['one', false], ['two', true]]);
  });

  it('marks the first server active when none is the default', () => {
    const action = {
      type: types.ADD_SERVER,
      serversWithTypes: [{ id: 'one', rootUrl: 'https://one.example' }, { id: 'two', rootUrl: 'https://two.example' }],
    };

    const state = reducer(defaultState, action);
    expect(state.servers.map(server => [server.id, Boolean(server.active)])).toEqual([['one', true], ['two', false]]);
  });

  it('gives a server without a rootUrl the scheme, host and port of its DICOMweb root', () => {
    const action = {
      type: types.ADD_SERVER,
      serversWithTypes: [{ id: 'one', wadoRoot: 'https://pacs.example:8042/dicom-web' }],
    };

    const [server] = reducer(defaultState, action).servers;
    expect(server.rootUrl).toBe('https://pacs.example:8042');
  });

  it('should replace servers on SET_SERVERS', () => {
    const initialState = {
      servers: [{ id: 'one' }, { id: 'two' }, { id: 'three' }, { id: 'four' }],
    };

    const action = {
      type: types.SET_SERVERS,
      servers: [{ id: 'un' }, { id: 'deux' }, { id: 'trois' }],
    };

    const expectedState = {
      servers: action.servers,
    };

    Reducer(reducer).withState(initialState).expect(action).toReturnState(expectedState);
  });
});
