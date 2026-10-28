// The Follow Selected Segment preference (off by default, a boolean the service holds) and the
// framer the editor layout registers for Frame Selected Segment

jest.mock('@ohif/core', () => ({
  SEG_EDITOR_FOLLOW_SELECTION_DEFAULT: false,
  SEG_EDITOR_FOLLOW_SELECTION_PREFERENCE_KEY: 'segEditorFollowSelection',
  UserPreferencesService: undefined,
  UserPreferencesServiceEvents: { GENERAL_CHANGED: 'changed' },
}));

import {
  frameSelectedSegment, getFollowSelection, registerSegmentFramer, setFollowSelection, subscribeFollowSelection,
} from './followSelection';

function fakeService(initial) {
  const values = { segEditorFollowSelection: initial };
  const listeners = new Set();
  return {
    values,
    getGeneral: key => values[key],
    setGeneral: jest.fn((key, value) => {
      if (typeof value !== 'boolean') {
        throw new Error('Invalid value');
      }
      values[key] = value;
      listeners.forEach(listener => listener({ key, value }));
      return Promise.resolve();
    }),
    subscribe: (event, listener) => {
      listeners.add(listener);
      return { unsubscribe: () => listeners.delete(listener) };
    },
  };
}

describe('the preference', () => {
  it('is off by default, also without a service or with a mistyped value', () => {
    expect(getFollowSelection(undefined)).toBe(false);
    expect(getFollowSelection(fakeService(undefined))).toBe(false);
    expect(getFollowSelection(fakeService('yes'))).toBe(false);
    expect(getFollowSelection(fakeService(true))).toBe(true);
  });

  it('is set as a boolean and followed', () => {
    const service = fakeService(false);
    const seen = [];
    const unsubscribe = subscribeFollowSelection(value => seen.push(value), service);
    setFollowSelection(1, service);
    expect(service.values.segEditorFollowSelection).toBe(true);
    expect(seen).toEqual([true]);
    unsubscribe();
    setFollowSelection(false, service);
    expect(seen).toEqual([true]);
    expect(getFollowSelection(service)).toBe(false);
  });

  it('logs and ignores a service that refuses the value', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const service = { setGeneral: () => { throw new Error('Unknown general preference'); } };
    expect(setFollowSelection(true, service)).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('the framer', () => {
  it('frames nothing without an editor, and reports whether a registered framer moved a view', () => {
    expect(frameSelectedSegment()).toBe(false);
    const framer = jest.fn(() => true);
    const unregister = registerSegmentFramer(framer);
    expect(frameSelectedSegment({ animate: false })).toBe(true);
    expect(framer).toHaveBeenCalledWith({ animate: false });
    framer.mockReturnValue(false);
    expect(frameSelectedSegment()).toBe(false);
    unregister();
    expect(frameSelectedSegment()).toBe(false);
  });

  it('keeps a later framer when an earlier one unregisters, and survives a framer that throws', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const first = registerSegmentFramer(() => true);
    const second = jest.fn(() => { throw new Error('no viewports'); });
    const unregisterSecond = registerSegmentFramer(second);
    first();
    expect(frameSelectedSegment()).toBe(false);
    expect(second).toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    unregisterSecond();
    error.mockRestore();
  });
});
