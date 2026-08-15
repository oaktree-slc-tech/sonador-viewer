// Request-count and reporting tests for the bulk review-request loop.
//
// The count matters more here than it does for a bulk share: the worklist endpoint ACCEPTS a repeat
// request for the same study and reviewer, so a duplicated write is not rejected by the gateway --
// it lands silently in the reviewer's worklist twice. Nothing downstream will catch it, so it is
// pinned here.

jest.mock('../../../../../api/worklist', () => ({
  createWorklistRequest: jest.fn(),
}));

import { buildWorklistOperations } from './bulkWorklistPlan';
import {
  describeRequestFailure,
  INITIAL_STATE,
  isTransportFailure,
  runBulkWorklist,
} from './bulkWorklistRunner';


const SERVER = { wadoRoot: 'https://orthanc.test/dicom-web' };

const study = (uid) => ({ StudyInstanceUID: uid, PatientName: `Patient ${uid}` });

const makeApi = (overrides = {}) => ({
  createWorklistRequest: jest.fn().mockResolvedValue({ ID: 'wl-1' }),
  ...overrides,
});


describe('runBulkWorklist request counts', () => {
  it('issues exactly one request per study', async () => {
    const api = makeApi();
    const records = [];

    const operations = buildWorklistOperations({
      studies: [study('a'), study('b'), study('c'), study('d')],
    });

    const outcome = await runBulkWorklist({
      server: SERVER,
      operations,
      groupId: 7,
      userId: 11,
      onRecord: (entry) => records.push(entry),
      api,
    });

    expect(api.createWorklistRequest).toHaveBeenCalledTimes(4);
    expect(records).toHaveLength(4);
    expect(outcome).toEqual({ total: 4, created: 4, failed: 0 });
  });

  it('writes once even when the operation list contains duplicates', async () => {
    // Defence in depth: buildWorklistOperations de-duplicates, but the loop must not rely on it.
    const api = makeApi();
    const records = [];
    const one = { key: 'a', study: study('a') };

    const outcome = await runBulkWorklist({
      server: SERVER,
      operations: [one, one, { ...one }],
      groupId: 7,
      userId: 11,
      onRecord: (entry) => records.push(entry),
      api,
    });

    expect(api.createWorklistRequest).toHaveBeenCalledTimes(1);
    expect(records).toHaveLength(1);
    expect(outcome.total).toBe(1);
  });

  it('posts once for a study that appears under two different operation keys', async () => {
    // The write identity here is the StudyInstanceUID, not `operation.key`: a run assigns ONE
    // reviewer, so (study, reviewer) collapses to the study. Keying the guard on `key` let two
    // operations for the same study through while their progress entries -- both keyed by UID --
    // collapsed into a single line, so the user saw one request and the reviewer got two.
    const api = makeApi();
    const records = [];

    const outcome = await runBulkWorklist({
      server: SERVER,
      operations: [
        { key: 'a::first', study: study('a') },
        { key: 'a::second', study: study('a') },
      ],
      groupId: 7,
      userId: 11,
      onRecord: (entry) => records.push(entry),
      api,
    });

    expect(api.createWorklistRequest).toHaveBeenCalledTimes(1);
    expect(records).toHaveLength(1);
    expect(outcome).toEqual({ total: 1, created: 1, failed: 0 });
  });

  it('reports a total that matches the number of requests actually issued', async () => {
    // The dialog's progress bar divides by `total`, so a total that counts operations rather than
    // writes would leave a completed run showing as half done.
    const api = makeApi();

    const outcome = await runBulkWorklist({
      server: SERVER,
      operations: [
        { key: 'a::first', study: study('a') },
        { key: 'a::second', study: study('a') },
        { key: 'b', study: study('b') },
      ],
      groupId: 7,
      userId: 11,
      api,
    });

    expect(outcome.total).toBe(api.createWorklistRequest.mock.calls.length);
    expect(outcome.total).toBe(2);
  });

  it('skips operations carrying no StudyInstanceUID', async () => {
    const api = makeApi();

    const outcome = await runBulkWorklist({
      server: SERVER,
      operations: [{ key: 'a', study: study('a') }, { key: 'b', study: {} }, { key: 'c' }],
      groupId: 7,
      userId: 11,
      api,
    });

    expect(api.createWorklistRequest).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ total: 1, created: 1, failed: 0 });
  });

  it('sends the group, the reviewer and the shared procedure on every request', async () => {
    const api = makeApi();
    const procedure = { RequestedProcedure: { ReasonForTheRequestedProcedure: 'Second opinion' } };

    await runBulkWorklist({
      server: SERVER,
      operations: buildWorklistOperations({ studies: [study('a'), study('b')] }),
      groupId: 7,
      userId: 11,
      procedure,
      api,
    });

    api.createWorklistRequest.mock.calls.forEach(([payload]) => {
      expect(payload).toMatchObject({
        server: SERVER,
        groupId: 7,
        userId: 11,
        State: INITIAL_STATE,
        Procedure: procedure,
      });
    });

    expect(api.createWorklistRequest.mock.calls.map(([p]) => p.StudyInstanceUID)).toEqual(['a', 'b']);
  });

  it('omits the procedure when neither optional field was filled in', async () => {
    const api = makeApi();

    await runBulkWorklist({
      server: SERVER,
      operations: buildWorklistOperations({ studies: [study('a')] }),
      groupId: 7,
      userId: 11,
      api,
    });

    expect(api.createWorklistRequest.mock.calls[0][0].Procedure).toBeUndefined();
  });

  it('creates requests in the same state as the single-study dialog', async () => {
    // A bulk-created request has to be indistinguishable from one created study by study, or the
    // worklist's status filters treat them differently.
    expect(INITIAL_STATE).toBe('Scheduled');
  });
});


describe('runBulkWorklist partial failure', () => {
  it('commits the requests that succeeded when one fails', async () => {
    const api = makeApi({
      createWorklistRequest: jest.fn(({ StudyInstanceUID }) =>
        StudyInstanceUID === 'b'
          ? Promise.reject(Object.assign(new Error('nope'), { status: 403 }))
          : Promise.resolve({ ID: 'wl' })
      ),
    });
    const records = [];
    const failures = [];

    const outcome = await runBulkWorklist({
      server: SERVER,
      operations: buildWorklistOperations({ studies: [study('a'), study('b'), study('c')] }),
      groupId: 7,
      userId: 11,
      onRecord: (entry) => records.push(entry),
      onFailure: (payload) => failures.push(payload),
      api,
      concurrency: 1,
    });

    expect(outcome).toEqual({ total: 3, created: 2, failed: 1 });
    expect(records.filter((r) => r.status === 'failed')).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].StudyInstanceUID).toBe('b');
  });

  it('labels each progress line with the patient rather than the UID', async () => {
    const api = makeApi();
    const records = [];

    await runBulkWorklist({
      server: SERVER,
      operations: buildWorklistOperations({ studies: [study('a')] }),
      groupId: 7,
      userId: 11,
      onRecord: (entry) => records.push(entry),
      api,
    });

    expect(records[0].label).toBe('Patient a');
  });
});


describe('reporting failures are never mistaken for write failures', () => {
  it('keeps a request successful when the audit-log callback throws', async () => {
    // The bulk-share loop had exactly this defect: a logging call inside the try block turned a
    // successful write into a "not applied" error notification.
    const api = makeApi();

    const outcome = await runBulkWorklist({
      server: SERVER,
      operations: buildWorklistOperations({ studies: [study('a')] }),
      groupId: 7,
      userId: 11,
      onSuccess: () => { throw new Error('logging blew up'); },
      api,
    });

    expect(outcome).toEqual({ total: 1, created: 1, failed: 0 });
  });

  it('finishes the run when the progress callback throws', async () => {
    const api = makeApi();

    const outcome = await runBulkWorklist({
      server: SERVER,
      operations: buildWorklistOperations({ studies: [study('a'), study('b')] }),
      groupId: 7,
      userId: 11,
      onRecord: () => { throw new Error('render blew up'); },
      api,
    });

    expect(api.createWorklistRequest).toHaveBeenCalledTimes(2);
    expect(outcome).toEqual({ total: 2, created: 2, failed: 0 });
  });

  it('does not claim the review was not requested when the response never reached the client', async () => {
    // A transport failure carries no status. The request may well have been created, so the message
    // must hedge -- claiming it was not would invite a retry that creates a duplicate.
    const api = makeApi({
      createWorklistRequest: jest.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    });
    const records = [];

    await runBulkWorklist({
      server: SERVER,
      operations: buildWorklistOperations({ studies: [study('a')] }),
      groupId: 7,
      userId: 11,
      onRecord: (entry) => records.push(entry),
      api,
    });

    expect(records[0].message).toMatch(/may still have been created/);
  });
});


describe('describeRequestFailure', () => {
  it('quotes the gateway field and code from a validation payload', () => {
    const err = Object.assign(new Error('x'), {
      status: 400,
      json: { errors: { User: [{ code: 'required', message: 'This field is required' }] } },
    });

    expect(describeRequestFailure(err)).toBe('User: required (HTTP 400)');
  });

  it('quotes a flat detail or message when there is no field-level payload', () => {
    expect(describeRequestFailure(Object.assign(new Error('x'), {
      status: 403,
      json: { detail: 'You do not have worklist access to this study' },
    }))).toBe('You do not have worklist access to this study (HTTP 403)');
  });

  it('falls back to the status alone when the body is opaque', () => {
    expect(describeRequestFailure(Object.assign(new Error('x'), { status: 500 })))
      .toBe('Request failed (HTTP 500).');
  });

  it('quotes the transport error and hedges when there is no status at all', () => {
    expect(describeRequestFailure(new TypeError('Failed to fetch')))
      .toBe('No response from the server (Failed to fetch). The request may still have been created.');
    expect(describeRequestFailure(undefined)).toBe('Request failed.');
  });
});


describe('isTransportFailure', () => {
  it('separates a response from the gateway from no response at all', () => {
    expect(isTransportFailure(Object.assign(new Error('x'), { status: 409 }))).toBe(false);
    expect(isTransportFailure(new TypeError('Failed to fetch'))).toBe(true);
    expect(isTransportFailure(undefined)).toBe(false);
  });
});
