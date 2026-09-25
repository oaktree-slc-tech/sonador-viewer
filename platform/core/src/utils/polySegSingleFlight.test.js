import {
  clearSurfaceComputeFailure,
  createSingleFlightPolySeg,
  getSurfaceComputeFailure,
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
