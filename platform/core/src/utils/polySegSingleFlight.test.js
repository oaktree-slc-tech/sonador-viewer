import {
  clearSurfaceComputeFailure,
  createSingleFlightPolySeg,
  getSurfaceComputeFailure,
  isSurfaceUpdating,
  resetPolySegInFlight,
  subscribeSurfaceUpdates,
  waitForSurfaceUpdate,
} from './polySegSingleFlight';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('createSingleFlightPolySeg', () => {
  it('shares one in-flight computation between concurrent callers', async () => {
    const job = deferred();
    const polySeg = { computeSurfaceData: jest.fn(() => job.promise), other: () => 'kept' };
    const wrapped = createSingleFlightPolySeg(polySeg);

    const a = wrapped.computeSurfaceData('seg', { viewport: {} });
    const b = wrapped.computeSurfaceData('seg', { viewport: {} });
    job.resolve('surface');

    expect(polySeg.computeSurfaceData).toHaveBeenCalledTimes(1);
    await expect(a).resolves.toBe('surface');
    await expect(b).resolves.toBe('surface');
    expect(wrapped.other()).toBe('kept');
  });

  it('records a failed computation and clears it when a later one succeeds', async () => {
    const failure = new Error('marching cubes failed');
    const polySeg = {
      computeSurfaceData: jest
        .fn()
        .mockImplementationOnce(() => Promise.reject(failure))
        .mockImplementationOnce(() => Promise.resolve('surface')),
    };
    const wrapped = createSingleFlightPolySeg(polySeg);

    await expect(wrapped.computeSurfaceData('seg-a')).rejects.toBe(failure);
    await settle();
    expect(getSurfaceComputeFailure('seg-a')).toMatchObject({ error: failure });
    expect(getSurfaceComputeFailure('seg-b')).toBeUndefined();

    await wrapped.computeSurfaceData('seg-a');
    await settle();
    expect(getSurfaceComputeFailure('seg-a')).toBeUndefined();
  });

  it('forgets a failure on request', async () => {
    const polySeg = { computeSurfaceData: () => Promise.reject(new Error('x')) };
    const wrapped = createSingleFlightPolySeg(polySeg);

    await wrapped.computeSurfaceData('seg-c').catch(() => {});
    await settle();
    clearSurfaceComputeFailure('seg-c');

    expect(getSurfaceComputeFailure('seg-c')).toBeUndefined();
  });

  it('starts a new computation once the previous one settled', async () => {
    const polySeg = { computeSurfaceData: jest.fn(() => Promise.resolve('surface')) };
    const wrapped = createSingleFlightPolySeg(polySeg);

    await wrapped.computeSurfaceData('seg-d');
    await settle();
    await wrapped.computeSurfaceData('seg-d');

    expect(polySeg.computeSurfaceData).toHaveBeenCalledTimes(2);
  });
});

describe('updateSurfaceData through the wrapper', () => {
  afterEach(() => resetPolySegInFlight());

  it('runs updates of one segmentation one after another, and publishes their start and end', async () => {
    const first = deferred();
    const second = deferred();
    const polySeg = {
      updateSurfaceData: jest.fn()
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise),
    };
    const wrapped = createSingleFlightPolySeg(polySeg);
    const events = [];
    const unsubscribe = subscribeSurfaceUpdates(event => events.push(event));

    const a = wrapped.updateSurfaceData('seg', { viewport: {} });
    const b = wrapped.updateSurfaceData('seg', { viewport: {} });
    await settle();
    expect(polySeg.updateSurfaceData).toHaveBeenCalledTimes(1);   // the second waits
    expect(isSurfaceUpdating('seg')).toBe(true);

    first.resolve('one');
    await a;
    await settle();
    expect(polySeg.updateSurfaceData).toHaveBeenCalledTimes(2);
    second.resolve('two');
    await expect(b).resolves.toBe('two');
    await settle();

    expect(isSurfaceUpdating('seg')).toBe(false);
    expect(events).toEqual([
      { segmentationId: 'seg', phase: 'start', update: 1 },
      { segmentationId: 'seg', phase: 'start', update: 2 },
      { segmentationId: 'seg', phase: 'end', update: 1 },
      { segmentationId: 'seg', phase: 'end', update: 2 },
    ]);
    unsubscribe();
  });

  it('keeps a waiter pending past an older update until the one it asked for has ended', async () => {
    const a = deferred();
    const b = deferred();
    const wrapped = createSingleFlightPolySeg({
      updateSurfaceData: jest.fn().mockImplementationOnce(() => a.promise).mockImplementationOnce(() => b.promise),
    });

    wrapped.updateSurfaceData('seg');           // A, running
    const waited = waitForSurfaceUpdate('seg'); // asks while A is outstanding...
    wrapped.updateSurfaceData('seg');           // ...and B is queued before it resolves
    let settled = false;
    waited.then(() => { settled = true; });

    a.resolve();
    await settle();
    expect(settled).toBe(false);
    expect(isSurfaceUpdating('seg')).toBe(true);

    b.resolve();
    await settle();
    expect(settled).toBe(true);
    expect(isSurfaceUpdating('seg')).toBe(false);
  });

  it('waits for the update queued after the call, not for one that happens to be running', async () => {
    const first = deferred();
    const wrapped = createSingleFlightPolySeg({ updateSurfaceData: jest.fn(() => first.promise) });
    wrapped.updateSurfaceData('seg');
    first.resolve();
    await settle();

    const waited = waitForSurfaceUpdate('seg', { timeoutMs: 50 });
    const next = deferred();
    wrapped.updateSurfaceData = undefined;
    const again = createSingleFlightPolySeg({ updateSurfaceData: jest.fn(() => next.promise) });
    again.updateSurfaceData('seg');
    next.resolve();
    await expect(waited).resolves.toEqual({ ended: true, error: undefined });
  });

  it('lets a caller wait for the update that follows, and reports a failed one', async () => {
    const failure = new Error('worker died');
    const job = deferred();
    const wrapped = createSingleFlightPolySeg({ updateSurfaceData: () => job.promise });

    const waited = waitForSurfaceUpdate('seg');
    const update = wrapped.updateSurfaceData('seg');
    job.reject(failure);
    await expect(update).rejects.toBe(failure);
    await expect(waited).resolves.toEqual({ ended: true, error: failure });
  });

  it('times out a wait when nothing ends', async () => {
    await expect(waitForSurfaceUpdate('nobody', { timeoutMs: 5 })).resolves.toEqual({ timedOut: true });
  });

  it('forgets in-flight work on reset: waiters are released, and later calls start fresh', async () => {
    const dead = deferred();   // a job the terminated worker will never finish
    const compute = jest.fn(() => dead.promise);
    const update = jest.fn(() => dead.promise);
    const wrapped = createSingleFlightPolySeg({ computeSurfaceData: compute, updateSurfaceData: update });

    wrapped.computeSurfaceData('seg');
    wrapped.updateSurfaceData('seg');
    const waited = waitForSurfaceUpdate('seg');
    await settle();
    expect(isSurfaceUpdating('seg')).toBe(true);

    resetPolySegInFlight();

    await expect(waited).resolves.toEqual({ cancelled: true });
    expect(isSurfaceUpdating('seg')).toBe(false);
    // Neither joins the dead job nor queues behind it
    const fresh = deferred();
    compute.mockImplementation(() => fresh.promise);
    update.mockImplementation(() => fresh.promise);
    wrapped.computeSurfaceData('seg');
    wrapped.updateSurfaceData('seg');
    await settle();
    expect(compute).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledTimes(2);
    fresh.resolve();
    await settle();
  });
});
