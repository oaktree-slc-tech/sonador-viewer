// The reporting guard, tested directly.
//
// It is exercised through both runners already, but it is now also what keeps a broken notification
// service from aborting a run before its first write -- the opening notice goes through it -- so the
// property is worth pinning on its own rather than inferring it from a runner test.

import { describeOperationFailure, isTransportFailure, reportSafely } from './bulkFailure';


describe('reportSafely', () => {
  let consoleError;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => consoleError.mockRestore());

  it('passes the payload through to the callback', () => {
    const callback = jest.fn();

    reportSafely(callback, { title: 'Applying access policies' }, 'Bulk share');

    expect(callback).toHaveBeenCalledWith({ title: 'Applying access policies' });
  });

  it('swallows a throwing callback so the run continues', () => {
    // A notification service that is broken must not decide whether the user's policies get written.
    expect(() => reportSafely(() => { throw new Error('tray is broken'); }, {}, 'Bulk share'))
      .not.toThrow();
  });

  it('reports the swallowed failure to the console, named by its caller', () => {
    reportSafely(() => { throw new Error('tray is broken'); }, {}, 'Bulk review request');

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('Bulk review request'),
      expect.any(Error)
    );
  });
});


describe('describeOperationFailure hedging', () => {
  it('carries the caller\'s hedge only when there was no response at all', () => {
    // The two paths hedge differently on purpose: an unwritten policy is re-checked by reopening a
    // dialog, but a review request that may exist must not simply be retried.
    const transport = new TypeError('Failed to fetch');

    expect(describeOperationFailure(transport, { hedge: 'The policy may still have been applied.' }))
      .toBe('No response from the server (Failed to fetch). The policy may still have been applied.');
    expect(describeOperationFailure(transport, { hedge: 'The request may still have been created.' }))
      .toBe('No response from the server (Failed to fetch). The request may still have been created.');

    // A real status means the gateway answered; no hedge belongs on it.
    expect(describeOperationFailure(Object.assign(new Error('x'), { status: 500 }), { hedge: 'nope' }))
      .toBe('Request failed (HTTP 500).');
  });

  it('omits the hedge cleanly when none is given', () => {
    expect(describeOperationFailure(new TypeError('Failed to fetch')))
      .toBe('No response from the server (Failed to fetch).');
  });
});


describe('isTransportFailure', () => {
  it('is what separates "the gateway said no" from "nothing came back"', () => {
    expect(isTransportFailure(Object.assign(new Error('x'), { status: 403 }))).toBe(false);
    expect(isTransportFailure(new TypeError('Failed to fetch'))).toBe(true);
    expect(isTransportFailure(undefined)).toBe(false);
  });
});
