// Unit tests for the Display Attributes plugin helpers. `fetch` is stubbed per test, following
// ./ext.test.js.

jest.mock('./sonador', () => ({
  getAuthToken: () => 'test-token',
}));

jest.mock('@ohif/core/src/utils', () => ({
  urlUtil: { urlJoin: (...parts) => parts.join('/') },
}));

import {
  createDisplayAttribute,
  failureMessage,
  getDisplayAttributeCollection,
  getDisplayAttributes,
  parsePermissionsHeader,
  removeDisplayAttribute,
  updateDisplayAttribute,
} from './displayAttributes';

const SERVER = { rootUrl: 'https://orthanc.test' };

const response = (body, { ok = true, status = 200, headers = {} } = {}) => ({
  ok,
  status,
  headers: { get: name => headers[name] || null },
  text: () => Promise.resolve(body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)),
});

beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => {
  delete global.fetch;
});

describe('failureMessage', () => {
  it('prefers the body message, then the first field error, then the status', () => {
    expect(failureMessage(400, { message: 'Tag "0008,0080" is not indexed by this imaging server' })).toBe(
      'Tag "0008,0080" is not indexed by this imaging server'
    );
    expect(failureMessage(400, { status: 'fail', errors: { Code: [{ message: 'already part of the collection' }] } })).toBe(
      'already part of the collection'
    );
    expect(failureMessage(500, { error: 'boom', status: 'fail' })).toBe('boom');
    expect(failureMessage(502, 'Bad Gateway')).toBe('Bad Gateway');
    expect(failureMessage(403, null)).toBe('HTTP 403');
  });
});

describe('parsePermissionsHeader', () => {
  it('reads both flags and tolerates a missing or malformed header', () => {
    expect(parsePermissionsHeader({ get: () => '{"display_attr": true, "display_attr_modify": false}' })).toEqual({
      display_attr: true,
      display_attr_modify: false,
    });
    expect(parsePermissionsHeader({ get: () => null })).toBeNull();
    expect(parsePermissionsHeader({ get: () => 'not json' })).toBeNull();
    expect(parsePermissionsHeader(undefined)).toBeNull();
  });
});

describe('getDisplayAttributes', () => {
  it('requests the aggregate with a bearer token and normalises the shape', async () => {
    global.fetch.mockResolvedValue(response({ groups: [{ id: 1, name: 'alpha', manage: true }], tags: [] }));

    const result = await getDisplayAttributes(SERVER);

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('https://orthanc.test/display-attributes');
    expect(init.headers.Authorization).toBe('Bearer test-token');
    expect(result).toEqual({ groups: [{ id: 1, name: 'alpha', manage: true }], tags: [] });
  });

  it('defaults missing arrays', async () => {
    global.fetch.mockResolvedValue(response({}));

    expect(await getDisplayAttributes(SERVER)).toEqual({ groups: [], tags: [] });
  });

  it('rejects without a plugin root URL', async () => {
    await expect(getDisplayAttributes({})).rejects.toThrow('no plugin root URL');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('getDisplayAttributeCollection', () => {
  it('returns the records and the permission header', async () => {
    global.fetch.mockResolvedValue(
      response([{ ID: 'a', Code: '0018,1030' }], { headers: { 'sonador-permissions': '{"display_attr":true,"display_attr_modify":true}' } })
    );

    const result = await getDisplayAttributeCollection(SERVER, { id: 5, name: 'alpha' });

    expect(global.fetch.mock.calls[0][0]).toBe('https://orthanc.test/groups/5/display-attributes');
    expect(result).toEqual({ tags: [{ ID: 'a', Code: '0018,1030' }], permissions: { display_attr: true, display_attr_modify: true } });
  });

  it('accepts a bare group id', async () => {
    global.fetch.mockResolvedValue(response([]));

    await getDisplayAttributeCollection(SERVER, 7);

    expect(global.fetch.mock.calls[0][0]).toBe('https://orthanc.test/groups/7/display-attributes');
  });
});

describe('mutations', () => {
  it('creates with only the code when no label is given', async () => {
    global.fetch.mockResolvedValue(response({ ID: 'new', status: 'success' }, { status: 201 }));

    await createDisplayAttribute(SERVER, 5, { Code: '(0018,1030)', Label: '' });

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('https://orthanc.test/groups/5/display-attributes');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ Code: '(0018,1030)' });
  });

  it('updates the label and removes by id', async () => {
    global.fetch.mockResolvedValue(response({ ID: 'a', status: 'success' }));

    await updateDisplayAttribute(SERVER, 5, 'a', { Label: 'Protocol' });
    await removeDisplayAttribute(SERVER, 5, 'a');

    expect(global.fetch.mock.calls[0][0]).toBe('https://orthanc.test/groups/5/display-attributes/a');
    expect(global.fetch.mock.calls[0][1].method).toBe('PUT');
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ Label: 'Protocol' });
    expect(global.fetch.mock.calls[1][1].method).toBe('DELETE');
  });

  it('surfaces the plugin message on a 400', async () => {
    global.fetch.mockResolvedValue(
      response({ status: 'fail', message: 'Tag "0008,0080" is not indexed by this imaging server' }, { ok: false, status: 400 })
    );

    await expect(createDisplayAttribute(SERVER, 5, { Code: '0008,0080' })).rejects.toMatchObject({
      status: 400,
      message: 'Tag "0008,0080" is not indexed by this imaging server',
    });
  });

  it('surfaces a non-JSON failure body', async () => {
    global.fetch.mockResolvedValue(response('Forbidden', { ok: false, status: 403 }));

    await expect(removeDisplayAttribute(SERVER, 5, 'a')).rejects.toThrow('Forbidden');
  });
});
