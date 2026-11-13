// The session holder for general preferences without another holder: hydration, user choice and
// the persistence hook the viewer wires in.

import {
  LOCKED_MODELS_WARNING_PREFERENCE_KEY as KEY,
  SEG_EDITOR_FOLLOW_SELECTION_DEFAULT as FOLLOW_DEFAULT,
  SEG_EDITOR_FOLLOW_SELECTION_PREFERENCE_KEY as FOLLOW_KEY,
  SEG_EDITOR_MESH_COLOR_DEFAULT as MESH_DEFAULT,
  SEG_EDITOR_MESH_COLOR_PREFERENCE_KEY as MESH_KEY,
  SEG_EDITOR_PREVIEW_COLOR_DEFAULT as PREVIEW_DEFAULT,
  SEG_EDITOR_PREVIEW_COLOR_PREFERENCE_KEY as PREVIEW_KEY,
  SEG_EDITOR_HOTKEY_DEFAULTS as HOTKEY_DEFAULTS,
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

  it('keeps the Segmentation Editor mesh colour the same way: following the segment by default, local-only, a hex colour or auto', async () => {
    const storage = memoryStorage();
    const service = new UserPreferencesServiceClass({ storage });
    expect(MESH_DEFAULT).toBe('auto');
    expect(service.getGeneral(MESH_KEY)).toBe(MESH_DEFAULT);
    expect(service.isLocalOnly(MESH_KEY)).toBe(true);
    expect(service.getGeneralValues()).not.toHaveProperty(MESH_KEY);
    await service.setGeneral(MESH_KEY, '#336699');
    expect(storage.items[`sonador.preferences.general.${MESH_KEY}`]).toBe('"#336699"');
    expect(new UserPreferencesServiceClass({ storage }).getGeneral(MESH_KEY)).toBe('#336699');
    await service.setGeneral(MESH_KEY, 'auto');
    expect(service.getGeneral(MESH_KEY)).toBe('auto');
    const broken = new UserPreferencesServiceClass({ storage: memoryStorage({ [`sonador.preferences.general.${MESH_KEY}`]: '"grey"' }) });
    expect(broken.getGeneral(MESH_KEY)).toBe(MESH_DEFAULT);
  });

  it('keeps Follow Selected Segment the same way: off by default, local-only, a boolean only', async () => {
    const storage = memoryStorage();
    const service = new UserPreferencesServiceClass({ storage });
    expect(FOLLOW_DEFAULT).toBe(false);
    expect(service.getGeneral(FOLLOW_KEY)).toBe(false);
    expect(service.isLocalOnly(FOLLOW_KEY)).toBe(true);
    expect(service.getGeneralValues()).not.toHaveProperty(FOLLOW_KEY);
    await service.setGeneral(FOLLOW_KEY, true);
    expect(storage.items[`sonador.preferences.general.${FOLLOW_KEY}`]).toBe('true');
    expect(new UserPreferencesServiceClass({ storage }).getGeneral(FOLLOW_KEY)).toBe(true);
    expect(() => service.setGeneral(FOLLOW_KEY, 'yes')).toThrow('Invalid value');
    const broken = new UserPreferencesServiceClass({ storage: memoryStorage({ [`sonador.preferences.general.${FOLLOW_KEY}`]: '"on"' }) });
    expect(broken.getGeneral(FOLLOW_KEY)).toBe(false);
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

describe('UserPreferencesService Segmentation Editor hotkeys', () => {
  const HOTKEYS_STORED = 'sonador.preferences.segEditorHotkeys';
  const memoryStorage = (initial = {}) => {
    const items = { ...initial };
    return {
      items,
      getItem: key => (key in items ? items[key] : null),
      setItem: (key, value) => {
        items[key] = String(value);
      },
    };
  };
  const keysOf = service => Object.fromEntries(Object.entries(service.getSegEditorHotkeys()).map(([id, { keys }]) => [id, keys]));
  const defaults = Object.fromEntries(Object.entries(HOTKEY_DEFAULTS).map(([id, { keys }]) => [id, [...keys]]));

  it('starts from the defaults, each with its command and label', () => {
    const service = new UserPreferencesServiceClass({ storage: memoryStorage() });
    expect(keysOf(service)).toEqual(defaults);
    expect(service.getSegEditorHotkeys().undo).toEqual({ commandName: 'undoSegEditor', label: 'Undo', keys: ['ctrl', 'z'] });
  });

  it('takes the user\'s bindings, announces them and caches them in the browser', () => {
    const storage = memoryStorage();
    const service = new UserPreferencesServiceClass({ storage });
    const changes = [];
    service.subscribe(EVENTS.SEG_EDITOR_HOTKEYS_CHANGED, change => changes.push(change));

    service.setSegEditorHotkeys({ ...service.getSegEditorHotkeys(), nextImage: { keys: ['shift', 'right'] } });

    expect(keysOf(service)).toEqual({ ...defaults, nextImage: ['shift', 'right'] });
    expect(changes).toHaveLength(1);
    expect(changes[0].hydrated).toBe(false);
    expect(keysOf(new UserPreferencesServiceClass({ storage }))).toEqual({ ...defaults, nextImage: ['shift', 'right'] });
    expect(JSON.parse(storage.items[HOTKEYS_STORED]).nextImage).toEqual(['shift', 'right']);
  });

  it('applies hydrated bindings, reading an absent, unknown or malformed one as the default', () => {
    const service = new UserPreferencesServiceClass({ storage: memoryStorage({ [HOTKEYS_STORED]: '{"undo":["u"]}' }) });
    expect(keysOf(service).undo).toEqual(['u']);

    service.applyHydratedSegEditorHotkeys({
      previousImage: { keys: ['q'], label: 'Previous Image' },
      nextImage: { keys: [] },
      redo: { keys: 'y' },
      unknownBinding: { keys: ['x'] },
    });

    expect(keysOf(service)).toEqual({ ...defaults, previousImage: ['q'] });
    expect(service.getSegEditorHotkeys()).not.toHaveProperty('unknownBinding');
  });

  it('keeps the user\'s choice over a hydration that lands afterwards', () => {
    const service = new UserPreferencesServiceClass({ storage: memoryStorage() });
    service.setSegEditorHotkeys({ undo: ['u'] });
    service.applyHydratedSegEditorHotkeys({ undo: { keys: ['ctrl', 'u'] } });
    expect(keysOf(service).undo).toEqual(['u']);
  });
});
