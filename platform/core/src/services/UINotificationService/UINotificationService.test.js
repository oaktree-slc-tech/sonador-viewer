// Unit tests for UINotificationService.
//
// These cover the Sonador-specific behaviour layered on top of the OHIF v3 service, each of which
// exists because an existing viewer call site depends on it. The persistent-notification and
// action-button cases in particular are load-bearing: the 2D MPR and volume viewers put up a
// sticky error with an "Exit" button that must run a command when clicked, and the v2 contract
// passes a `close` callback into that handler.

import { uiNotificationService } from './index';
import { notificationLogService } from '../NotificationLogService';

// -- Browser-global shims (node test environment) ------------------------------------------
//
// jest-environment-jsdom is not installed in this repo, and PubSubService._broadcastEvent
// dispatches a real CustomEvent on document.body in addition to calling its subscribers. Same
// approach as lib/preferenceWriteQueue.test.js.

if (typeof global.CustomEvent === 'undefined') {
  global.CustomEvent = class CustomEvent {
    constructor(type, params = {}) {
      this.type = type;
      this.detail = params.detail;
    }
  };
}

if (typeof global.document === 'undefined') {
  global.document = { body: { dispatchEvent: () => true } };
}

// Stands in for NotificationProvider. Returns a stable id so `close` can be asserted against it.
const createImplementation = () => {
  const shown = [];
  const hidden = [];
  let counter = 0;

  const show = jest.fn((options) => {
    const id = `toast-${++counter}`;
    shown.push({ ...options, id: options.id || id });
    return options.id || id;
  });
  const hide = jest.fn((id) => hidden.push(id));

  return { show, hide, shown, hidden };
};

let impl;

beforeEach(() => {
  impl = createImplementation();
  uiNotificationService.setServiceImplementation({ show: impl.show, hide: impl.hide });
  notificationLogService.clear();
});

describe('persistent notifications', () => {
  it('maps autoClose:false to an infinite duration so the toast never self-dismisses', () => {
    uiNotificationService.show({
      title: 'Failed to load image data.',
      message: 'Dataset is too big to display in MPR',
      type: 'error',
      autoClose: false,
    });

    // sonner skips its dismiss timer only when duration is exactly Infinity.
    expect(impl.shown[0].duration).toBe(Infinity);
  });

  it('leaves an explicit duration alone when autoClose is not disabled', () => {
    uiNotificationService.show({ title: 'Tag created', type: 'success', duration: 3000 });

    expect(impl.shown[0].duration).toBe(3000);
  });

  it('defaults to a readable duration rather than the v3 2000ms', () => {
    uiNotificationService.show({ title: 'Tag created', type: 'success' });

    expect(impl.shown[0].duration).toBe(5000);
  });
});

describe('action buttons (v2 SnackbarItem contract)', () => {
  it('invokes the handler with the notification and a working close callback', () => {
    const onClick = jest.fn();

    const id = uiNotificationService.show({
      title: 'Failed to load image data.',
      message: 'Dataset is too big to display in MPR',
      type: 'error',
      autoClose: false,
      action: { label: 'Exit 2D MPR', onClick },
    });

    // The provider receives a wrapped action, not the caller's handler.
    const wrapped = impl.shown[0].action;
    expect(wrapped.label).toBe('Exit 2D MPR');
    expect(wrapped.onClick).not.toBe(onClick);

    // sonner calls the wrapper with a click event, which the v2 contract does not use.
    wrapped.onClick({ preventDefault: () => {} });

    expect(onClick).toHaveBeenCalledTimes(1);

    const context = onClick.mock.calls[0][0];
    expect(context.title).toBe('Failed to load image data.');
    expect(typeof context.close).toBe('function');

    // `close` must dismiss the notification it was handed to, by id.
    context.close();
    expect(impl.hidden).toEqual([id]);
  });

  it('supports zero-argument v3-style handlers', () => {
    const onClick = jest.fn(() => 'ok');

    uiNotificationService.show({
      title: 'Something happened',
      type: 'warning',
      action: { label: 'Undo', onClick },
    });

    expect(() => impl.shown[0].action.onClick({})).not.toThrow();
    expect(onClick).toHaveBeenCalled();
  });

  it('does not forward a malformed action to the renderer', () => {
    uiNotificationService.show({
      title: 'No action here',
      type: 'info',
      action: { label: 'Broken' },
    });

    expect(impl.shown[0].action).toBeUndefined();
  });
});

describe('back-compatibility shims', () => {
  it('accepts v2 camelCase positions', () => {
    uiNotificationService.show({ title: 'Placed', type: 'info', position: 'bottomRight' });

    expect(impl.shown[0].position).toBe('bottom-right');
  });

  it('promotes a message-only notification to the title line', () => {
    uiNotificationService.show({ message: 'Preferences saved', type: 'success' });

    expect(impl.shown[0].title).toBe('Preferences saved');
    expect(impl.shown[0].message).toBeUndefined();
  });
});

describe('notifications raised before the renderer mounts', () => {
  it('queues them and flushes in arrival order once an implementation registers', () => {
    // Simulate a fresh module with no provider yet, as during bootstrap in sonador.index.js.
    uiNotificationService.setServiceImplementation({
      show: undefined,
      hide: undefined,
    });

    const pending = createImplementation();

    // Reach the pre-mount path by replacing the implementation with the queueing default.
    jest.isolateModules(() => {
      const { uiNotificationService: fresh } = require('./index');

      fresh.show({ title: 'First', type: 'error' });
      fresh.show({ title: 'Second', type: 'error' });

      expect(pending.show).not.toHaveBeenCalled();

      fresh.setServiceImplementation({ show: pending.show, hide: pending.hide });

      expect(pending.shown.map((n) => n.title)).toEqual(['First', 'Second']);
    });
  });
});

describe('write-through to the unified log', () => {
  it('records errors and warnings but not routine confirmations', () => {
    uiNotificationService.show({ title: 'Broke', type: 'error' });
    uiNotificationService.show({ title: 'Careful', type: 'warning' });
    uiNotificationService.show({ title: 'Saved', type: 'success' });

    expect(notificationLogService.getEntries().map((e) => e.title)).toEqual(['Careful', 'Broke']);
  });

  it('records the settled failure of a promise-backed notification', async () => {
    const rejection = new Error('server said no');

    uiNotificationService.show({
      title: 'Saving',
      promise: Promise.reject(rejection),
      promiseMessages: { loading: 'Saving...', error: (e) => e.message },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const entries = notificationLogService.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].severity).toBe('error');
    expect(entries[0].message).toBe('server said no');
    expect(entries[0].error).toBe(rejection);
  });

  it('scopes an entry to a study so it reaches that study Issues list', () => {
    uiNotificationService.show({
      title: 'Fail to load series',
      type: 'error',
      studyInstanceUID: '1.2.3',
    });

    expect(notificationLogService.getEntries({ studyInstanceUID: '1.2.3' })).toHaveLength(1);
    expect(notificationLogService.getEntries({ studyInstanceUID: 'other' })).toHaveLength(0);
  });

  it('collapses a repeated condition into one entry with a count', () => {
    uiNotificationService.show({ title: 'Image Load Error', message: 'boom', type: 'error' });
    uiNotificationService.show({ title: 'Image Load Error', message: 'boom', type: 'error' });

    const entries = notificationLogService.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].count).toBe(2);
  });
});
