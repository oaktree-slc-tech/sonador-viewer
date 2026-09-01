import { createHydrationLatch } from './preferenceHydration';

const ARCHIVE = 'archiveTransfer';
const RETRY = 'retryAttempts';

describe('createHydrationLatch', () => {
  it('hydrates a field the user has not touched', () => {
    const latch = createHydrationLatch();

    expect(latch.accept(ARCHIVE, true, false)).toBe(true);
  });

  it('keeps the user\'s value for a field they have touched', () => {
    const latch = createHydrationLatch();
    latch.markEdited(ARCHIVE);

    expect(latch.accept(ARCHIVE, false, true)).toBe(true);
  });

  it('hydrates the retry budget when only the archive toggle was touched', () => {
    // The General section is saved wholesale, so a retry budget left at its default here is
    // posted over the value already stored on the server.
    const latch = createHydrationLatch();
    latch.markEdited(ARCHIVE);

    expect(latch.accept(RETRY, 5, 3)).toBe(5);
  });

  it('hydrates the archive toggle when only the retry budget was touched', () => {
    const latch = createHydrationLatch();
    latch.markEdited(RETRY);

    expect(latch.accept(ARCHIVE, true, false)).toBe(true);
  });

  it('keeps both values once both fields are touched', () => {
    const latch = createHydrationLatch();
    latch.markEdited(ARCHIVE);
    latch.markEdited(RETRY);

    expect(latch.accept(ARCHIVE, false, true)).toBe(true);
    expect(latch.accept(RETRY, 1, 4)).toBe(4);
  });

  it('stays latched after a save, because the startup fetch can still land', () => {
    const latch = createHydrationLatch();
    latch.markEdited(RETRY);

    expect(latch.isEdited(RETRY)).toBe(true);
    expect(latch.accept(RETRY, 2, 5)).toBe(5);
  });

  it('forgets edits on reset', () => {
    const latch = createHydrationLatch();
    latch.markEdited(RETRY);
    latch.reset();

    expect(latch.isEdited(RETRY)).toBe(false);
    expect(latch.accept(RETRY, 2, 5)).toBe(2);
  });
});
