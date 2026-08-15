// The latch a bulk run holds, and the guarantee that it is always released.
//
// The defect these exist for: both hooks acquired the latch, then did a few more things -- progress
// initialisation, the opening notification -- and only THEN opened the try/finally that releases it.
// Anything throwing in that gap skipped the release. The visible consequence is not a lost
// notification but a dead dialog: the busy flag stays set, so the dialog refuses to close, and the
// ref stays set, so every retry returns null. No way out but a page reload.
//
// Testable without React precisely because withBulkRunLatch takes the ref and the setter as
// arguments -- this repo's jest setup has no React renderer, which is how the gap survived review.

import { withBulkRunLatch } from './bulkRun';


const latch = () => ({ current: false });


describe('withBulkRunLatch', () => {
  it('runs the work and returns its result', async () => {
    const latchRef = latch();
    const setBusy = jest.fn();

    await expect(withBulkRunLatch({ latchRef, setBusy, run: async () => 'outcome' }))
      .resolves.toBe('outcome');

    expect(setBusy.mock.calls).toEqual([[true], [false]]);
    expect(latchRef.current).toBe(false);
  });

  it('refuses a second run while one is in flight, without touching the busy flag', async () => {
    const latchRef = latch();
    const setBusy = jest.fn();
    const run = jest.fn();

    latchRef.current = true;

    await expect(withBulkRunLatch({ latchRef, setBusy, run })).resolves.toBeNull();
    expect(run).not.toHaveBeenCalled();
    expect(setBusy).not.toHaveBeenCalled();
    // Still held by the run that is genuinely in flight.
    expect(latchRef.current).toBe(true);
  });

  it('releases the latch when the work throws, and lets the error out', async () => {
    // The reported case: the opening notification throws. Everything the run does now happens inside
    // `run`, so there is no longer anywhere for a throw to skip the release.
    const latchRef = latch();
    const setBusy = jest.fn();

    await expect(withBulkRunLatch({
      latchRef,
      setBusy,
      run: async () => { throw new Error('notification service is broken'); },
    })).rejects.toThrow('notification service is broken');

    expect(latchRef.current).toBe(false);
    expect(setBusy.mock.calls).toEqual([[true], [false]]);
  });

  it('releases when the work throws synchronously, before its first await', async () => {
    const latchRef = latch();
    const setBusy = jest.fn();

    await expect(withBulkRunLatch({
      latchRef,
      setBusy,
      run: () => { throw new Error('threw immediately'); },
    })).rejects.toThrow('threw immediately');

    expect(latchRef.current).toBe(false);
    expect(setBusy).toHaveBeenLastCalledWith(false);
  });

  it('leaves the dialog able to retry after a failed run', async () => {
    // The whole point. After a throw the user must be able to press the button again and have it do
    // something -- with the latch stuck, every retry returned null and the dialog was dead.
    const latchRef = latch();
    const setBusy = jest.fn();

    await expect(withBulkRunLatch({
      latchRef, setBusy, run: async () => { throw new Error('boom'); },
    })).rejects.toThrow('boom');

    await expect(withBulkRunLatch({ latchRef, setBusy, run: async () => 'second attempt' }))
      .resolves.toBe('second attempt');
  });
});
