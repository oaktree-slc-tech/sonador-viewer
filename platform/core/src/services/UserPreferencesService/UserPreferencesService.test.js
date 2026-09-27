// The session holder for general preferences without another holder: hydration, user choice and
// the persistence hook the viewer wires in.

import {
  LOCKED_MODELS_WARNING_PREFERENCE_KEY as KEY,
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
