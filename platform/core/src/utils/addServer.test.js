import addServers from './addServers';

describe('addServers', () => {
  const servers = {
    dicomWeb: [
      {
        name: 'DCM4CHEE',
        wadoUriRoot: 'https://server.dcmjs.org/dcm4chee-arc/aets/DCM4CHEE/wado',
        qidoRoot: 'https://server.dcmjs.org/dcm4chee-arc/aets/DCM4CHEE/rs',
        wadoRoot: 'https://server.dcmjs.org/dcm4chee-arc/aets/DCM4CHEE/rs',
        qidoSupportsIncludeField: true,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
      },
    ],
    oidc: [
      {
        authority: 'http://127.0.0.1/auth/realms/ohif',
        client_id: 'ohif-viewer',
        redirect_uri: 'http://127.0.0.1/callback',
        response_type: 'code',
        scope: 'openid',
        post_logout_redirect_uri: '/logout-redirect.html',
      },
    ],
  };

  const store = {
    dispatch: jest.fn(),
  };

  test('dispatches the servers of each type, each marked with its type', () => {
    addServers(servers, store);
    expect(store.dispatch).toHaveBeenCalledTimes(2);
    expect(store.dispatch).toBeCalledWith({
      type: 'ADD_SERVER',
      serversWithTypes: [{ ...servers.dicomWeb[0], type: 'dicomWeb' }],
    });
    expect(store.dispatch).toBeCalledWith({
      type: 'ADD_SERVER',
      serversWithTypes: [{ ...servers.oidc[0], type: 'oidc' }],
    });
    // The configuration is not changed
    expect(servers.dicomWeb[0].type).toBeUndefined();
  });

  test('should throw an error if servers list is not defined', () => {
    expect(() => addServers(undefined, store)).toThrowError(new Error('The servers and store must be defined'));
  });

  test('should throw an error if store is not defined', () => {
    expect(() => addServers(servers, undefined)).toThrowError(new Error('The servers and store must be defined'));
  });

  test('should throw an error when both server and store are not defined', () => {
    expect(() => addServers(undefined, undefined)).toThrowError(new Error('The servers and store must be defined'));
  });
});
