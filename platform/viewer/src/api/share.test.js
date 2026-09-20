// Duplicate-policy handling on ACL writes.
//
// The Sonador cloud plugin refuses to create an ACL policy that already exists rather than updating
// it: UserAclValidationMixin/GroupAclValidationMixin.clean in orthanc-sonador raise a pydantic
// error of type VALIDATION_APICODE_DUPLICATE ('unique'), and ObjectManagementView.post renders any
// validation error as HTTP 400. The plugin attaches the existing policy's UID as
// `object-data.ID`, which is what lets the retry go straight to PUT.
//
// These tests pin that contract: a duplicate must be retried as an update, and 401/403/404 must
// not be.

// `@ohif/core/src/utils` is mocked for the reason ./ext.test.js gives: importing the real barrel
// pulls in cornerstone and the whole viewer runtime, which needs a browser environment.
jest.mock('./sonador', () => ({
  getAuthToken: () => 'test-token',
  sonadorUrl: (path) => `https://example.test${path}`,
}));

jest.mock('@ohif/core/src/utils', () => ({
  urlUtil: { urlJoin: (...parts) => parts.join('/') },
}));

import {
  duplicateAclPolicyId,
  getAclGroups,
  getAclUsers,
  isDuplicateAclError,
  upsertAclGroup,
  upsertAclUser,
} from './share';


const SERVER = { wadoRoot: 'https://example.test/dicomweb' };
const STUDY = '1.2.826.0.1';

// The gateway's duplicate response, verbatim in shape.
const duplicateBody = (field, id) => JSON.stringify({
  status: 'fail',
  errors: {
    [field]: [{
      field,
      code: 'unique',
      message: `ACL policy for ${field.toLowerCase()} already exists`,
      input: { [field]: 7 },
    }],
  },
  message: 'ACL policy already exists',
  'object-data': { ID: id },
});


const response = ({ ok = true, status = 200, body = '{}' }) => ({
  ok,
  status,
  text: () => Promise.resolve(body),
  json: () => Promise.resolve(JSON.parse(body)),
});


describe('isDuplicateAclError / duplicateAclPolicyId', () => {
  const err = (status, json) => ({ status, json });

  it('recognises the plugin duplicate response', () => {
    const parsed = JSON.parse(duplicateBody('User', 'acl-uuid'));

    expect(isDuplicateAclError(err(400, parsed))).toBe(true);
    expect(duplicateAclPolicyId(err(400, parsed))).toBe('acl-uuid');
  });

  it('recognises a duplicate from the error code alone, without object-data', () => {
    const parsed = { errors: { Group: [{ code: 'unique' }] } };

    expect(isDuplicateAclError(err(400, parsed))).toBe(true);
    expect(duplicateAclPolicyId(err(400, parsed))).toBeUndefined();
  });

  it('does NOT treat auth or missing-resource failures as duplicates', () => {
    // The distinction the whole retry rests on: only 400 'unique' means "already exists".
    [401, 403, 404, 500].forEach((status) => {
      expect(isDuplicateAclError(err(status, { errors: { User: [{ code: 'unique' }] } }))).toBe(false);
    });
  });

  it('does not treat a different 400 as a duplicate', () => {
    expect(isDuplicateAclError(err(400, { errors: { User: [{ code: 'required' }] } }))).toBe(false);
    expect(isDuplicateAclError(err(400, undefined))).toBe(false);
    expect(isDuplicateAclError(undefined)).toBe(false);
  });

  it('requires the uniqueness code even when the payload carries an object id', () => {
    // object-data says WHICH policy; only the `unique` code says that updating is the right
    // response. Accepting the id alone would turn an unrelated validation failure into a PUT that
    // silently overwrites an existing policy.
    const parsed = {
      errors: { User: [{ field: 'User', code: 'invalid', message: 'not a member of this server' }] },
      'object-data': { ID: 'some-uuid' },
    };

    expect(isDuplicateAclError(err(400, parsed))).toBe(false);
  });
});


describe('upsertAclUser', () => {
  afterEach(() => {
    delete global.fetch;
  });

  it('PUTs directly when the policy ID is already known', async () => {
    global.fetch = jest.fn().mockResolvedValue(response({ body: '{"ID":"known"}' }));

    await upsertAclUser(SERVER, STUDY, { User: 7, ID: 'known', View: true });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][1].method).toBe('PUT');
  });

  it('POSTs when no policy is known', async () => {
    global.fetch = jest.fn().mockResolvedValue(response({ body: '{"ID":"new"}' }));

    await upsertAclUser(SERVER, STUDY, { User: 7, View: true });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][1].method).toBe('POST');
  });

  it('retries a duplicate-rejected POST as a PUT against the returned ID', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(response({ ok: false, status: 400, body: duplicateBody('User', 'existing-uuid') }))
      .mockResolvedValueOnce(response({ body: '{"ID":"existing-uuid"}' }));

    const result = await upsertAclUser(SERVER, STUDY, { User: 7, View: true, Modify: true });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[0][1].method).toBe('POST');

    const [retryUrl, retryInit] = global.fetch.mock.calls[1];
    expect(retryInit.method).toBe('PUT');
    // The retry has to address the EXISTING policy, or it recreates the same conflict.
    expect(retryUrl).toContain('existing-uuid');
    expect(JSON.parse(retryInit.body)).toMatchObject({ User: 7, View: true, Modify: true, ID: 'existing-uuid' });
    expect(result).toEqual({ ID: 'existing-uuid' });
  });

  it('re-reads the list when a duplicate carries no object-data', async () => {
    global.fetch = jest
      .fn()
      // POST rejected as duplicate, with no ID supplied
      .mockResolvedValueOnce(response({
        ok: false,
        status: 400,
        body: JSON.stringify({ errors: { User: [{ code: 'unique' }] } }),
      }))
      // GET the policy list to find it. api/share flattens `user.id` onto `User`.
      .mockResolvedValueOnce(response({ body: JSON.stringify([{ ID: 'found-uuid', user: { id: 7 } }]) }))
      .mockResolvedValueOnce(response({ body: '{"ID":"found-uuid"}' }));

    await upsertAclUser(SERVER, STUDY, { User: 7, View: true });

    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(global.fetch.mock.calls[2][0]).toContain('found-uuid');
    expect(global.fetch.mock.calls[2][1].method).toBe('PUT');
  });

  it('rethrows a non-uniqueness 400 that carries an object id, instead of PUTting over it', async () => {
    global.fetch = jest.fn().mockResolvedValue(response({
      ok: false,
      status: 400,
      body: JSON.stringify({
        errors: { User: [{ code: 'invalid' }] },
        'object-data': { ID: 'unrelated-uuid' },
      }),
    }));

    await expect(upsertAclUser(SERVER, STUDY, { User: 7 })).rejects.toMatchObject({ status: 400 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('rethrows a 403 instead of retrying it', async () => {
    global.fetch = jest.fn().mockResolvedValue(response({ ok: false, status: 403, body: 'Forbidden' }));

    await expect(upsertAclUser(SERVER, STUDY, { User: 7 })).rejects.toMatchObject({ status: 403 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});


describe('upsertAclGroup', () => {
  afterEach(() => {
    delete global.fetch;
  });

  it('retries a duplicate-rejected POST as a PUT', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(response({ ok: false, status: 400, body: duplicateBody('Group', 'grp-uuid') }))
      .mockResolvedValueOnce(response({ body: '{"ID":"grp-uuid"}' }));

    await upsertAclGroup(SERVER, STUDY, { Group: 3, View: true });

    expect(global.fetch.mock.calls[1][1].method).toBe('PUT');
    expect(global.fetch.mock.calls[1][0]).toContain('grp-uuid');
    expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toMatchObject({ Group: 3, ID: 'grp-uuid' });
  });
});


describe('policy principals', () => {
  // The gateway names a policy's principal as an object (`Group: { id, name }`); when Sonador
  // cannot describe the principal it still names it by id. Both shapes have to map to a usable row.
  const policies = (rows) => Promise.resolve({ ok: true, json: () => Promise.resolve(rows) });

  afterEach(() => {
    delete global.fetch;
  });

  it('flattens a described group onto the row', async () => {
    global.fetch = jest.fn(() => policies([{ ID: 'p1', Group: { id: 26, name: 'consult' }, View: true }]));

    const [row] = await getAclGroups(SERVER, STUDY);

    expect(row.Group).toBe(26);
    expect(row.name).toBe('consult');
    expect(row.View).toBe(true);
  });

  it('keeps the group id, and no name, when the gateway could only name the group by id', async () => {
    global.fetch = jest.fn(() => policies([{ ID: 'p1', Group: { id: 14 }, View: true }, { ID: 'p2', Group: 15 }]));

    const [byObject, byId] = await getAclGroups(SERVER, STUDY);

    expect(byObject.Group).toBe(14);
    expect(byObject.name).toBeUndefined();
    expect(byId.Group).toBe(15);
    expect(byId.name).toBeUndefined();
  });

  it('does the same for users', async () => {
    global.fetch = jest.fn(() => policies([{ ID: 'p1', User: { id: 13, username: 'dev01' } }, { ID: 'p2', User: 99 }]));

    const [described, bare] = await getAclUsers(SERVER, STUDY);

    expect(described.User).toBe(13);
    expect(described.username).toBe('dev01');
    expect(bare.User).toBe(99);
    expect(bare.username).toBeUndefined();
  });
});
