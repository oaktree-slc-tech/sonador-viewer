// The session holder for general preferences without another holder: hydration, user choice and
// the persistence hook the viewer wires in.

import {
  LOCKED_MODELS_WARNING_PREFERENCE_KEY as KEY,
  SEG_EDITOR_PREVIEW_COLOR_DEFAULT as PREVIEW_DEFAULT,
  SEG_EDITOR_PREVIEW_COLOR_PREFERENCE_KEY as PREVIEW_KEY,
  UserPreferencesServiceClass,
  UserPreferencesServiceEvents as EVENTS,
} from './UserPreferencesService';

// Jest 29 runs in a node environment here (jest-environment-jsdom is not installed), and
// PubSubService._broadcastEvent mirrors every event onto document.body as a CustomEvent. Same
// shims as LocalCacheService.test.js.
global.CustomEvent = global.CustomEvent || class CustomEvent {
  constructor(type, params = {}) {
    this.type = type;
    this.detail = params.detail;
  }
};
global.document = global.document || { body: { dispatchEvent: () => {} } };

describe('UserPreferencesService', () => {
  let service;
  let changes;

  beforeEach(() => {
    service = new UserPreferencesServiceClass();
    changes = [];
    service.subscribe(EVENTS.GENERAL_CHANGED, change => changes.push(change));
  });

  it('starts from the defaults', () => {
    expect(service.getGeneral(KEY)).toBe(true);
    expect(service.getGeneralValues()).toEqual({ [KEY]: true });
  });

  it('applies a hydrated value and announces it', () => {
    service.applyHydratedGeneral({ [KEY]: false, language: 'en-US' });

    expect(service.getGeneral(KEY)).toBe(false);
    expect(changes).toEqual([{ key: KEY, value: false, hydrated: true }]);
  });

  it('reads an absent or mistyped stored value as the default', () => {
    service.applyHydratedGeneral({ [KEY]: false });
    service.applyHydratedGeneral({});
    expect(service.getGeneral(KEY)).toBe(true);

    service.applyHydratedGeneral({ [KEY]: 'no' });
    expect(service.getGeneral(KEY)).toBe(true);
  });

  it('keeps the user\'s choice over a hydration that lands afterwards, and persists it', async () => {
    const persist = jest.fn(() => Promise.resolve({ outcome: 'saved' }));
    service.setPersistence(persist);

    await service.setGeneral(KEY, false);
    service.applyHydratedGeneral({ [KEY]: true });

    expect(service.getGeneral(KEY)).toBe(false);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(changes).toEqual([{ key: KEY, value: false, hydrated: false }]);
  });

  it('keeps the value for the session when persistence fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    service.setPersistence(() => Promise.reject(new Error('400')));

    await expect(service.setGeneral(KEY, false)).resolves.toBeUndefined();

    expect(service.getGeneral(KEY)).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('records a value without persisting when the caller writes the section itself', async () => {
    const persist = jest.fn(() => Promise.resolve());
    service.setPersistence(persist);

    await service.setGeneral(KEY, false, { persist: false });

    expect(service.getGeneral(KEY)).toBe(false);
    expect(persist).not.toHaveBeenCalled();
  });

  it('refuses a key it does not hold', () => {
    expect(() => service.setGeneral('theme', 'dark')).toThrow('Unknown general preference');
  });
});

describe('UserPreferencesService: local-only keys (the Seg Editor preview colour)', () => {
  // The server's general-section allowlist does not know the preview colour yet, so it is kept in
  // the browser and never sent with the section (a section with an unknown key is refused)
  function memoryStorage(initial = {}) {
    const items = { ...initial };
    return {
      items,
      getItem: key => (key in items ? items[key] : null),
      setItem: jest.fn((key, value) => {
        items[key] = String(value);
      }),
    };
  }
  const STORED = `sonador.preferences.general.${PREVIEW_KEY}`;

  it('defaults to Blender orange, and leaves the key out of the section values', () => {
    const service = new UserPreferencesServiceClass({ storage: memoryStorage() });
    expect(service.getGeneral(PREVIEW_KEY)).toBe(PREVIEW_DEFAULT);
    expect(PREVIEW_DEFAULT).toBe('#ff8500');
    expect(service.isLocalOnly(PREVIEW_KEY)).toBe(true);
    expect(service.getGeneralValues()).toEqual({ [KEY]: true });
  });

  it('keeps a choice in the browser, without a section write, and reads it back in a new session', async () => {
    const storage = memoryStorage();
    const persist = jest.fn(() => Promise.resolve());
    const service = new UserPreferencesServiceClass({ storage });
    service.setPersistence(persist);

    await service.setGeneral(PREVIEW_KEY, '#33aaff');

    expect(service.getGeneral(PREVIEW_KEY)).toBe('#33aaff');
    expect(storage.items[STORED]).toBe('"#33aaff"');
    expect(persist).not.toHaveBeenCalled();
    expect(service.getGeneralValues()).not.toHaveProperty(PREVIEW_KEY);
    // Also when a Settings form saves the section itself
    await service.setGeneral(PREVIEW_KEY, '#00ff00', { persist: false });
    expect(storage.items[STORED]).toBe('"#00ff00"');

    const next = new UserPreferencesServiceClass({ storage });
    expect(next.getGeneral(PREVIEW_KEY)).toBe('#00ff00');
  });

  it('is not overridden by hydration, and ignores a malformed stored value', () => {
    const service = new UserPreferencesServiceClass({ storage: memoryStorage({ [STORED]: '"#123456"' }) });
    service.applyHydratedGeneral({ [PREVIEW_KEY]: '#abcdef' });
    expect(service.getGeneral(PREVIEW_KEY)).toBe('#123456');

    const broken = new UserPreferencesServiceClass({ storage: memoryStorage({ [STORED]: '"orange"' }) });
    expect(broken.getGeneral(PREVIEW_KEY)).toBe(PREVIEW_DEFAULT);
    const unparsable = new UserPreferencesServiceClass({ storage: memoryStorage({ [STORED]: '{' }) });
    expect(unparsable.getGeneral(PREVIEW_KEY)).toBe(PREVIEW_DEFAULT);
  });

  it('refuses a value that is not a #rrggbb colour', () => {
    const service = new UserPreferencesServiceClass({ storage: memoryStorage() });
    expect(() => service.setGeneral(PREVIEW_KEY, 'orange')).toThrow('Invalid value');
    expect(() => service.setGeneral(PREVIEW_KEY, 0xff8500)).toThrow('Invalid value');
    expect(service.getGeneral(PREVIEW_KEY)).toBe(PREVIEW_DEFAULT);
  });

  it('keeps the value for the session when the browser storage fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    const service = new UserPreferencesServiceClass({ storage });
    expect(service.getGeneral(PREVIEW_KEY)).toBe(PREVIEW_DEFAULT);
    await service.setGeneral(PREVIEW_KEY, '#010203');
    expect(service.getGeneral(PREVIEW_KEY)).toBe('#010203');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
