// The `hotkeys` preference section's two sets: the application's and the Segmentation Editor's

const mockReadSection = jest.fn();
const mockPending = jest.fn();

jest.mock('@ohif/core', () => ({ SEG_EDITOR_HOTKEY_PREFIX: 'segEditor:' }));
jest.mock('../api/preferences', () => ({ getUserPreferenceSection: (...args) => mockReadSection(...args) }));
jest.mock('./preferenceWriteQueue', () => ({ getPendingPreferenceWrite: (...args) => mockPending(...args) }));

import { resetHotkeyHydrationForTests, settleHotkeyHydration, startHotkeyHydration } from './hotkeyHydration';
import { composeHotkeyValues, resolveStoredHotkeys, saveHotkeysInOrder, splitHotkeyValues } from './hotkeyPreferences';

beforeEach(() => {
  mockReadSection.mockReset();
  mockPending.mockReset();
  resetHotkeyHydrationForTests();
});

describe('hotkeyPreferences', () => {
  it('composes both sets into one flat map of keys and label', () => {
    const values = composeHotkeyValues(
      { nextImage: { keys: ['down'], label: 'Next Image', scope: 'viewport' } },
      { nextImage: { keys: ['d'], label: 'Next Image', commandName: 'nextImage' } }
    );

    expect(values).toEqual({
      nextImage: { keys: ['down'], label: 'Next Image' },
      'segEditor:nextImage': { keys: ['d'], label: 'Next Image' },
    });
  });

  it('splits a stored section back into its sets', () => {
    expect(
      splitHotkeyValues({
        nextImage: { keys: ['down'], label: 'Next Image' },
        'segEditor:nextImage': { keys: ['d'], label: 'Next Image' },
      })
    ).toEqual({
      application: { nextImage: { keys: ['down'], label: 'Next Image' } },
      segEditor: { nextImage: { keys: ['d'], label: 'Next Image' } },
    });
  });

  it('reads a section without editor keys, or no section, as such', () => {
    expect(splitHotkeyValues({ nextImage: { keys: ['down'], label: 'Next Image' } }).segEditor).toEqual({});
    expect(splitHotkeyValues(null)).toEqual({ application: {}, segEditor: {} });
  });

  describe('resolveStoredHotkeys', () => {
    const stored = { nextImage: { keys: ['j'], label: 'Next Image' }, 'segEditor:undo': { keys: ['u'], label: 'Undo' } };
    const split = { application: { nextImage: stored.nextImage }, segEditor: { undo: stored['segEditor:undo'] } };

    it('waits for hydration, then leaves the bindings in effect to stand for the stored ones', async () => {
      startHotkeyHydration();
      let resolved = false;
      const base = resolveStoredHotkeys().then(value => { resolved = true; return value; });
      await Promise.resolve();
      expect(resolved).toBe(false);

      settleHotkeyHydration({ hydrated: true });
      expect(await base).toBeNull();
      expect(mockReadSection).not.toHaveBeenCalled();
    });

    it('reads the stored section when hydration failed, or never started', async () => {
      mockReadSection.mockResolvedValue({ version: '0.4', values: stored });
      expect(await resolveStoredHotkeys()).toEqual(split);
      expect(mockReadSection).toHaveBeenCalledWith('hotkeys', '0.4');

      startHotkeyHydration();
      settleHotkeyHydration({ hydrated: false });
      expect(await resolveStoredHotkeys()).toEqual(split);

      // Nothing stored: the bindings in effect stand
      mockReadSection.mockResolvedValue({ version: '0.4', values: {} });
      expect(await resolveStoredHotkeys()).toBeNull();
    });

    it('rejects when the stored section cannot be read', async () => {
      mockReadSection.mockRejectedValue(new Error('offline'));
      await expect(resolveStoredHotkeys()).rejects.toThrow('offline');
    });

    it('takes a write still queued over anything else', async () => {
      mockPending.mockReturnValue({ section: 'hotkeys', payload: { version: '0.4', values: stored } });
      startHotkeyHydration();
      expect(await resolveStoredHotkeys()).toEqual(split);
      expect(mockReadSection).not.toHaveBeenCalled();
    });
  });

  it('runs saves one after another, the next only once the one before has settled', async () => {
    const order = [];
    let release;
    const first = saveHotkeysInOrder(() => new Promise((resolve, reject) => { release = reject; }).finally(() => order.push('first')));
    const second = saveHotkeysInOrder(async () => { order.push('second'); return 'done'; });
    await Promise.resolve();
    expect(order).toEqual([]);

    release(new Error('refused'));
    await expect(first).rejects.toThrow('refused');
    expect(await second).toBe('done');
    expect(order).toEqual(['first', 'second']);
  });
});
