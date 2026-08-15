// Request-count tests for the bulk-share loop.
//
// The reported defect: applying four studies to two groups issued sixteen writes instead of eight,
// half of which the gateway rejected. These pin the count directly rather than reasoning about it.

jest.mock('../../../../../api/share', () => ({
  getAclUsers: jest.fn(),
  getAclGroups: jest.fn(),
  upsertAclUser: jest.fn(),
  upsertAclGroup: jest.fn(),
}));

import { buildShareOperations } from './bulkSharePlan';
import { describeWriteFailure, isTransportFailure, runBulkShare } from './bulkShareRunner';


const SERVER = { wadoRoot: 'https://orthanc.test/dicom-web' };

const study = (uid) => ({ StudyInstanceUID: uid, PatientName: `Patient ${uid}` });
const group = (id) => ({ 'result-type': 'group', id, name: `Group ${id}` });
const user = (id) => ({ 'result-type': 'user', id, first_name: 'Ada', last_name: 'L' });

const makeApi = (overrides = {}) => ({
  getAclUsers: jest.fn().mockResolvedValue([]),
  getAclGroups: jest.fn().mockResolvedValue([]),
  upsertAclUser: jest.fn().mockResolvedValue({ ID: 'u' }),
  upsertAclGroup: jest.fn().mockResolvedValue({ ID: 'g' }),
  ...overrides,
});


describe('runBulkShare request counts', () => {
  it('issues exactly one write per study/recipient pair', async () => {
    // The reported scenario: four studies, two groups, no existing policies.
    const api = makeApi();
    const records = [];

    const operations = buildShareOperations({
      studies: [study('a'), study('b'), study('c'), study('d')],
      subjects: [group(1), group(2)],
    });

    const outcome = await runBulkShare({
      server: SERVER,
      operations,
      permissions: { View: true },
      onRecord: (entry) => records.push(entry),
      api,
    });

    expect(operations).toHaveLength(8);
    expect(api.upsertAclGroup).toHaveBeenCalledTimes(8);
    expect(api.upsertAclUser).not.toHaveBeenCalled();
    expect(records).toHaveLength(8);
    expect(outcome).toEqual({ total: 8, applied: 8, failed: 0 });
  });

  it('reads each study\'s existing policies once, not once per recipient', async () => {
    const api = makeApi();

    await runBulkShare({
      server: SERVER,
      operations: buildShareOperations({
        studies: [study('a'), study('b')],
        subjects: [group(1), group(2), group(3)],
      }),
      api,
    });

    expect(api.getAclGroups).toHaveBeenCalledTimes(2);
    expect(api.upsertAclGroup).toHaveBeenCalledTimes(6);
  });

  it('does not read the user policy list when every recipient is a group', async () => {
    // Both lists were read for every study regardless of the recipients, doubling the reads.
    const api = makeApi();

    await runBulkShare({
      server: SERVER,
      operations: buildShareOperations({ studies: [study('a')], subjects: [group(1)] }),
      api,
    });

    expect(api.getAclGroups).toHaveBeenCalledTimes(1);
    expect(api.getAclUsers).not.toHaveBeenCalled();
  });

  it('does not read the group policy list when every recipient is a user', async () => {
    const api = makeApi();

    await runBulkShare({
      server: SERVER,
      operations: buildShareOperations({ studies: [study('a')], subjects: [user(1)] }),
      api,
    });

    expect(api.getAclUsers).toHaveBeenCalledTimes(1);
    expect(api.getAclGroups).not.toHaveBeenCalled();
  });

  it('writes once even when the operation list contains duplicates', async () => {
    // Defence in depth: buildShareOperations de-duplicates, but the loop must not rely on it.
    const api = makeApi();
    const records = [];
    const one = { key: 'a::group:1', study: study('a'), subject: group(1) };

    const outcome = await runBulkShare({
      server: SERVER,
      operations: [one, one, { ...one }],
      onRecord: (entry) => records.push(entry),
      api,
    });

    expect(api.upsertAclGroup).toHaveBeenCalledTimes(1);
    expect(records).toHaveLength(1);
    expect(outcome.total).toBe(1);
  });

  it('routes users and groups to their own endpoints', async () => {
    const api = makeApi();

    await runBulkShare({
      server: SERVER,
      operations: buildShareOperations({ studies: [study('a')], subjects: [group(1), user(2)] }),
      api,
    });

    expect(api.upsertAclGroup).toHaveBeenCalledTimes(1);
    expect(api.upsertAclUser).toHaveBeenCalledTimes(1);
  });

  it('passes the existing policy ID through so the write becomes an update', async () => {
    const api = makeApi({
      getAclGroups: jest.fn().mockResolvedValue([{ ID: 'existing', Group: 1, name: 'Group 1' }]),
    });

    await runBulkShare({
      server: SERVER,
      operations: buildShareOperations({ studies: [study('a')], subjects: [group(1)] }),
      permissions: { View: true, Modify: true },
      api,
    });

    expect(api.upsertAclGroup).toHaveBeenCalledWith(
      SERVER,
      'a',
      expect.objectContaining({ ID: 'existing', Group: 1, View: true, Modify: true })
    );
  });

  it('writes every editable permission explicitly, including the ones left off', async () => {
    // Built from the canonical field list rather than spread from the old policy, so a permission
    // the dialog cleared is actually cleared rather than inherited.
    const api = makeApi({
      getAclGroups: jest.fn().mockResolvedValue([
        { ID: 'existing', Group: 1, View: true, Modify: true, Remove: true, ACL: true },
      ]),
    });

    await runBulkShare({
      server: SERVER,
      operations: buildShareOperations({ studies: [study('a')], subjects: [group(1)] }),
      permissions: { View: true },
      api,
    });

    expect(api.upsertAclGroup).toHaveBeenCalledWith(SERVER, 'a', expect.objectContaining({
      View: true, Modify: false, Remove: false, ACL: false,
    }));
  });

  it('replaces comment permissions rather than inheriting them', async () => {
    // All six permissions are editable, so this is a genuine whole-policy replacement: a comment
    // permission the dialog leaves unchecked is revoked, not carried over from the old policy.
    const api = makeApi({
      getAclGroups: jest.fn().mockResolvedValue([
        { ID: 'existing', Group: 1, View: true, Modify: true, CommentEdit: true, CommentView: true },
      ]),
    });

    await runBulkShare({
      server: SERVER,
      operations: buildShareOperations({ studies: [study('a')], subjects: [group(1)] }),
      permissions: { View: true },
      api,
    });

    expect(api.upsertAclGroup).toHaveBeenCalledWith(SERVER, 'a', expect.objectContaining({
      View: true,
      Modify: false,
      CommentEdit: false,
      CommentView: false,
    }));
  });

  it('writes the comment permissions the dialog does set', async () => {
    const api = makeApi();

    await runBulkShare({
      server: SERVER,
      operations: buildShareOperations({ studies: [study('a')], subjects: [group(1)] }),
      permissions: { View: true, CommentView: true },
      api,
    });

    expect(api.upsertAclGroup).toHaveBeenCalledWith(SERVER, 'a', expect.objectContaining({
      View: true,
      CommentView: true,
      CommentEdit: false,
    }));
  });

  it('does not carry unrelated fields of the old policy into the write', async () => {
    // `name`, the nested `group` object and anything else the list endpoint decorates the policy
    // with are display data, not policy data, and were previously spread into the request body.
    const api = makeApi({
      getAclGroups: jest.fn().mockResolvedValue([
        { ID: 'existing', Group: 1, name: 'Radiology', group: { id: 1, name: 'Radiology' } },
      ]),
    });

    await runBulkShare({
      server: SERVER,
      operations: buildShareOperations({ studies: [study('a')], subjects: [group(1)] }),
      permissions: { View: true },
      api,
    });

    const body = api.upsertAclGroup.mock.calls[0][2];

    expect(body.name).toBeUndefined();
    expect(body.group).toBeUndefined();
    expect(Object.keys(body).sort()).toEqual(
      ['ACL', 'CommentEdit', 'CommentView', 'Group', 'ID', 'Modify', 'Remove', 'View'].sort()
    );
    expect(body.ACL).toBe(false);
  });

  it('matches an existing policy whose id is a string against a numeric recipient id', async () => {
    // The list carries ids lifted off the nested group object; the recipient comes from the
    // directory search. A type mismatch here sent an already-shared study down the create path.
    const api = makeApi({
      getAclGroups: jest.fn().mockResolvedValue([{ ID: 'existing', Group: '1' }]),
    });

    await runBulkShare({
      server: SERVER,
      operations: buildShareOperations({ studies: [study('a')], subjects: [group(1)] }),
      api,
    });

    expect(api.upsertAclGroup).toHaveBeenCalledWith(
      SERVER, 'a', expect.objectContaining({ ID: 'existing' })
    );
  });

  it('reports a failed study once per recipient and keeps going', async () => {
    const api = makeApi({
      getAclGroups: jest.fn()
        .mockRejectedValueOnce(Object.assign(new Error('nope'), { status: 500 }))
        .mockResolvedValue([]),
    });
    const records = [];

    const outcome = await runBulkShare({
      server: SERVER,
      operations: buildShareOperations({
        studies: [study('a'), study('b')],
        subjects: [group(1), group(2)],
      }),
      onRecord: (entry) => records.push(entry),
      api,
      concurrency: 1,
    });

    expect(records).toHaveLength(4);
    expect(outcome).toEqual({ total: 4, applied: 2, failed: 2 });
  });

  it('commits the writes that succeeded when one fails', async () => {
    const api = makeApi({
      upsertAclGroup: jest.fn()
        .mockRejectedValueOnce(Object.assign(new Error('bad'), { status: 400 }))
        .mockResolvedValue({ ID: 'g' }),
    });

    const outcome = await runBulkShare({
      server: SERVER,
      operations: buildShareOperations({ studies: [study('a')], subjects: [group(1), group(2)] }),
      api,
      concurrency: 1,
    });

    expect(outcome).toEqual({ total: 2, applied: 1, failed: 1 });
  });
});


describe('reporting failures are never mistaken for write failures', () => {
  it('keeps a write successful when the audit-log callback throws', async () => {
    // The reported symptom: policies were created on the server, yet every operation raised
    // "Access policy not applied". Reporting used to sit inside the write's try block.
    const api = makeApi();
    const records = [];

    const outcome = await runBulkShare({
      server: SERVER,
      operations: buildShareOperations({ studies: [study('a')], subjects: [group(1), group(2)] }),
      onRecord: (entry) => records.push(entry),
      onSuccess: () => {
        throw new Error('notification service exploded');
      },
      api,
    });

    expect(outcome).toEqual({ total: 2, applied: 2, failed: 0 });
    expect(records.every((r) => r.status === 'ok')).toBe(true);
    expect(api.upsertAclGroup).toHaveBeenCalledTimes(2);
  });

  it('finishes the run when the progress callback throws', async () => {
    const api = makeApi();

    const outcome = await runBulkShare({
      server: SERVER,
      operations: buildShareOperations({
        studies: [study('a'), study('b')],
        subjects: [group(1)],
      }),
      onRecord: () => {
        throw new Error('setState exploded');
      },
      api,
    });

    expect(outcome.applied).toBe(2);
    expect(api.upsertAclGroup).toHaveBeenCalledTimes(2);
  });

  it('survives a reporting callback that throws while the pre-read is already failing', async () => {
    // The worst place for an unguarded callback. A throw here happens while the run is ALREADY
    // handling a failure, so it escapes the worker and rejects Promise.all -- and the dialog refuses
    // to close while a run is in flight, leaving the user stuck on a progress panel with no way out.
    const api = makeApi({
      getAclGroups: jest.fn().mockRejectedValue(Object.assign(new Error('nope'), { status: 500 })),
    });

    const outcome = await runBulkShare({
      server: SERVER,
      operations: buildShareOperations({ studies: [study('a'), study('b')], subjects: [group(1)] }),
      onRecord: () => { throw new Error('render blew up'); },
      onFailure: () => { throw new Error('notification blew up'); },
      api,
    });

    // Resolved rather than rejected, and every operation still accounted for as failed.
    expect(outcome).toEqual({ total: 2, applied: 0, failed: 2 });
  });

  it('does not claim "not applied" when the response never reached the client', async () => {
    // fetch rejects with a bare TypeError for a network drop or a response withheld for want of
    // CORS headers. The server may have applied the policy, so the wording must not assert it did
    // not -- and the reason has to reach the user.
    const api = makeApi({
      upsertAclGroup: jest.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    });
    const records = [];

    await runBulkShare({
      server: SERVER,
      operations: buildShareOperations({ studies: [study('a')], subjects: [group(1)] }),
      onRecord: (entry) => records.push(entry),
      api,
    });

    expect(records[0].status).toBe('failed');
    expect(records[0].message).toContain('Failed to fetch');
    expect(records[0].message).toContain('may still have been applied');
  });
});


describe('describeWriteFailure', () => {
  it('quotes the gateway field and code', () => {
    expect(describeWriteFailure({
      status: 400,
      json: { errors: { User: [{ field: 'User', code: 'unique', message: 'already exists' }] } },
    })).toBe('User: unique (HTTP 400)');
  });

  it('falls back to the status when there is no validation payload', () => {
    expect(describeWriteFailure({ status: 403 })).toBe('Request failed (HTTP 403).');
    expect(describeWriteFailure(undefined)).toBe('Request failed.');
  });

  it('quotes the transport error and hedges when there is no status at all', () => {
    const message = describeWriteFailure(new TypeError('Failed to fetch'));

    expect(message).toContain('Failed to fetch');
    expect(message).toContain('may still have been applied');
  });
});


describe('isTransportFailure', () => {
  it('separates a response from the gateway from no response at all', () => {
    expect(isTransportFailure(new TypeError('Failed to fetch'))).toBe(true);
    expect(isTransportFailure({ status: 400 })).toBe(false);
    expect(isTransportFailure({ status: 500 })).toBe(false);
    expect(isTransportFailure(undefined)).toBe(false);
  });
});
