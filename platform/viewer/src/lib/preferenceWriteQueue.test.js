// Unit tests for the persistent preference write queue (sonador#42 FR-19..FR-21, AR-10).
//
// Jest runs in a node environment (jest-environment-jsdom is not installed in this repo), so
// the browser globals the queue touches -- localStorage, window (OIDC identity + `online`
// listener) -- are shimmed below. The API layer and the notification service are mocked: the queue's
// contract with them is "resolve on 2xx, reject with `status` on HTTP errors" (FR-8).

jest.mock('../api/preferences', () => ({
  updateUserPreferenceSection: jest.fn(),
}));

jest.mock('@ohif/core/src/services/UINotificationService', () => ({
  uiNotificationService: { show: jest.fn(), hide: jest.fn() },
}));

import { uiNotificationService } from '@ohif/core/src/services/UINotificationService';

import { updateUserPreferenceSection } from '../api/preferences';
import { WRITE_QUEUE_STORAGE_KEY } from '../constants/preferences';

import {
  flushPreferenceWrites,
  hasPendingPreferenceWrite,
  notifyPreferenceWriteQueued,
  startPreferenceWriteQueue,
  stopPreferenceWriteQueue,
  submitPreferenceWrite,
} from './preferenceWriteQueue';

// -- Browser-global shims (node test environment) ------------------------------------------

const storageShim = () => {
  let data = {};
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
    removeItem: (key) => {
      delete data[key];
    },
    clear: () => {
      data = {};
    },
  };
};

const setCurrentUser = (username) => {
  global.window.store = {
    getState: () => ({
      oidc: username ? { user: { profile: { preferred_username: username } } } : {},
    }),
  };
};

const readStoredQueue = () => JSON.parse(global.localStorage.getItem(WRITE_QUEUE_STORAGE_KEY) || '[]');

const httpError = (status) => {
  const error = new Error(`HTTP ${status}`);
  error.status = status;
  return error;
};

const networkError = () => new TypeError('Failed to fetch');

beforeAll(() => {
  global.localStorage = storageShim();
  global.window = global.window || {};
  global.window.addEventListener = jest.fn();
  global.window.removeEventListener = jest.fn();
});

let warnSpy;

beforeEach(() => {
  jest.useFakeTimers();
  global.localStorage.clear();
  setCurrentUser('user-a');
  updateUserPreferenceSection.mockReset();
  uiNotificationService.show.mockClear();
  // Retryable failures log a warning per enqueue; keep the test output quiet.
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  stopPreferenceWriteQueue();
  jest.useRealTimers();
  warnSpy.mockRestore();
});

// -- submitPreferenceWrite (FR-7 outcomes) --------------------------------------------------

describe('submitPreferenceWrite', () => {
  it('resolves saved on 2xx and queues nothing', async () => {
    updateUserPreferenceSection.mockResolvedValue({ version: '0.4', values: { language: 'en-US' } });

    const result = await submitPreferenceWrite({
      key: 'general',
      section: 'general',
      payload: { version: '0.4', values: { language: 'en-US' } },
    });

    expect(result.outcome).toBe('saved');
    expect(updateUserPreferenceSection).toHaveBeenCalledWith('general', {
      version: '0.4',
      values: { language: 'en-US' },
    });
    expect(readStoredQueue()).toEqual([]);
    expect(hasPendingPreferenceWrite('general')).toBe(false);
  });

  it.each([
    ['network error', networkError()],
    ['HTTP 500', httpError(500)],
    ['HTTP 401', httpError(401)],
  ])('enqueues and resolves queued on retryable failure (%s)', async (label, error) => {
    updateUserPreferenceSection.mockRejectedValue(error);

    const result = await submitPreferenceWrite({
      key: 'hotkeys',
      section: 'hotkeys',
      payload: { version: '0.4', values: { zoom: { label: 'Zoom', keys: ['z'] } } },
    });

    expect(result.outcome).toBe('queued');
    expect(hasPendingPreferenceWrite('hotkeys')).toBe(true);

    const [entry] = readStoredQueue();
    expect(entry).toMatchObject({
      key: 'hotkeys',
      user: 'user-a',
      section: 'hotkeys',
      payload: { version: '0.4', values: { zoom: { label: 'Zoom', keys: ['z'] } } },
    });
    expect(entry.queuedAt).toEqual(expect.any(String));
  });

  it('rejects on HTTP 400 and queues nothing (FR-21: defective payload, not the network)', async () => {
    updateUserPreferenceSection.mockRejectedValue(httpError(400));

    await expect(
      submitPreferenceWrite({ key: 'general', section: 'general', payload: { version: '0.4', values: {} } })
    ).rejects.toMatchObject({ status: 400 });

    expect(readStoredQueue()).toEqual([]);
  });

  it('coalesces repeated submits per key, keeping the latest payload (FR-19)', async () => {
    updateUserPreferenceSection.mockRejectedValue(networkError());

    await submitPreferenceWrite({
      key: 'window-level',
      section: 'windowLevel',
      payload: { version: '0.4', values: { 1: { description: 'old', window: '1', level: '1' } } },
    });
    await submitPreferenceWrite({
      key: 'window-level',
      section: 'windowLevel',
      payload: { version: '0.4', values: { 1: { description: 'new', window: '2', level: '2' } } },
    });
    // A different key coalesces separately.
    await submitPreferenceWrite({
      key: 'studylist:worklist',
      section: 'studylist',
      payload: { version: '0.4', values: { worklist: { selectedColumns: ['Status'] } } },
    });

    const entries = readStoredQueue();
    expect(entries).toHaveLength(2);
    expect(entries[0].key).toBe('window-level');
    expect(entries[0].payload.values['1'].description).toBe('new');
    expect(entries[1].key).toBe('studylist:worklist');
  });

  it('resolves failed (not queued) without an authenticated identity, so callers never promise a sync', async () => {
    setCurrentUser(null);
    updateUserPreferenceSection.mockRejectedValue(networkError());

    const result = await submitPreferenceWrite({
      key: 'general',
      section: 'general',
      payload: { version: '0.4', values: {} },
    });

    expect(result.outcome).toBe('failed');
    expect(readStoredQueue()).toEqual([]);
  });
});

// -- flushPreferenceWrites (FR-20/FR-21) ----------------------------------------------------

describe('flushPreferenceWrites', () => {
  const seedQueueViaFailures = async (submissions) => {
    updateUserPreferenceSection.mockRejectedValue(networkError());
    for (const submission of submissions) {
      await submitPreferenceWrite(submission);
    }
    updateUserPreferenceSection.mockReset();
  };

  it('replays pending entries for the current user oldest first and empties the queue', async () => {
    await seedQueueViaFailures([
      { key: 'general', section: 'general', payload: { version: '0.4', values: { language: 'de' } } },
      { key: 'hotkeys', section: 'hotkeys', payload: { version: '0.4', values: {} } },
    ]);

    updateUserPreferenceSection.mockResolvedValue({});
    await flushPreferenceWrites();

    expect(updateUserPreferenceSection.mock.calls.map(([section]) => section)).toEqual([
      'general',
      'hotkeys',
    ]);
    expect(readStoredQueue()).toEqual([]);
  });

  it('drops a 400 entry with an error notification while other entries still flush (FR-21)', async () => {
    await seedQueueViaFailures([
      { key: 'general', section: 'general', payload: { version: '0.4', values: { language: 7 } } },
      { key: 'hotkeys', section: 'hotkeys', payload: { version: '0.4', values: {} } },
    ]);

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    updateUserPreferenceSection.mockImplementation((section) =>
      section === 'general' ? Promise.reject(httpError(400)) : Promise.resolve({})
    );

    await flushPreferenceWrites();

    // Both entries are gone: the 400 was dropped (never retried), the other succeeded.
    expect(readStoredQueue()).toEqual([]);
    expect(uiNotificationService.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    errorSpy.mockRestore();
  });

  it('keeps entries on 401 (held for the next trigger) and on 5xx (retried under backoff)', async () => {
    await seedQueueViaFailures([
      { key: 'general', section: 'general', payload: { version: '0.4', values: {} } },
      { key: 'hotkeys', section: 'hotkeys', payload: { version: '0.4', values: {} } },
    ]);

    updateUserPreferenceSection.mockImplementation((section) =>
      Promise.reject(section === 'general' ? httpError(401) : httpError(503))
    );

    await flushPreferenceWrites();

    const entries = readStoredQueue();
    expect(entries.map((e) => e.key).sort()).toEqual(['general', 'hotkeys']);
    expect(entries.every((e) => e.attempts === 1)).toBe(true);
  });

  it('never flushes or drops entries queued under another user (FR-21)', async () => {
    await seedQueueViaFailures([
      { key: 'general', section: 'general', payload: { version: '0.4', values: { language: 'de' } } },
    ]);

    // User B logs in on the same browser; user A's entry must be untouched.
    setCurrentUser('user-b');
    updateUserPreferenceSection.mockResolvedValue({});

    expect(hasPendingPreferenceWrite('general')).toBe(false);
    await flushPreferenceWrites();

    expect(updateUserPreferenceSection).not.toHaveBeenCalled();
    expect(readStoredQueue()).toMatchObject([{ key: 'general', user: 'user-a' }]);

    // User A authenticates again: the entry flushes.
    setCurrentUser('user-a');
    expect(hasPendingPreferenceWrite('general')).toBe(true);
    await flushPreferenceWrites();
    expect(updateUserPreferenceSection).toHaveBeenCalledTimes(1);
    expect(readStoredQueue()).toEqual([]);
  });

  it('replays entries persisted by a previous session (localStorage round-trip, FR-19)', async () => {
    // Simulate a reload: entries exist in localStorage but module state is fresh.
    global.localStorage.setItem(
      WRITE_QUEUE_STORAGE_KEY,
      JSON.stringify([
        {
          key: 'viewer-meta',
          user: 'user-a',
          section: 'viewerMetadata',
          payload: { version: '0.4', values: { topLeftCorner: [] } },
          queuedAt: new Date().toISOString(),
          attempts: 2,
        },
      ])
    );

    expect(hasPendingPreferenceWrite('viewer-meta')).toBe(true);

    updateUserPreferenceSection.mockResolvedValue({});
    await flushPreferenceWrites();

    expect(updateUserPreferenceSection).toHaveBeenCalledWith('viewerMetadata', {
      version: '0.4',
      values: { topLeftCorner: [] },
    });
    expect(readStoredQueue()).toEqual([]);
  });

  it('a successful live write triggers a flush of the remaining backlog (FR-20d)', async () => {
    await seedQueueViaFailures([
      { key: 'hotkeys', section: 'hotkeys', payload: { version: '0.4', values: {} } },
    ]);

    updateUserPreferenceSection.mockResolvedValue({});
    await submitPreferenceWrite({
      key: 'general',
      section: 'general',
      payload: { version: '0.4', values: { language: 'en-US' } },
    });

    // Let the fire-and-forget flush settle.
    await jest.advanceTimersByTimeAsync(0);

    expect(updateUserPreferenceSection.mock.calls.map(([section]) => section)).toEqual([
      'general',
      'hotkeys',
    ]);
    expect(readStoredQueue()).toEqual([]);
  });
});

// -- Triggers and session behavior ----------------------------------------------------------

describe('startPreferenceWriteQueue', () => {
  it('registers the browser online listener (FR-20b)', () => {
    startPreferenceWriteQueue();
    expect(global.window.addEventListener).toHaveBeenCalledWith('online', expect.any(Function));
  });

  it('arms the backoff timer when a previous session left entries pending (FR-20c)', async () => {
    updateUserPreferenceSection.mockRejectedValue(networkError());
    await submitPreferenceWrite({
      key: 'general',
      section: 'general',
      payload: { version: '0.4', values: {} },
    });

    updateUserPreferenceSection.mockReset();
    updateUserPreferenceSection.mockResolvedValue({});

    startPreferenceWriteQueue();
    await jest.advanceTimersByTimeAsync(5000);

    expect(updateUserPreferenceSection).toHaveBeenCalled();
    expect(readStoredQueue()).toEqual([]);
  });

  it('shows the informational sync toast at most once per session (FR-17)', () => {
    notifyPreferenceWriteQueued();
    notifyPreferenceWriteQueued();
    expect(uiNotificationService.show).toHaveBeenCalledTimes(1);
  });
});
