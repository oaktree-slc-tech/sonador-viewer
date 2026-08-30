// Unit tests for offline-download notifications (ohif-viewers#125, ohif-viewers#84).
//
// Two behaviours here are load bearing and easy to regress:
//   - a bulk queue raises ONE notice with a count, not one toast per study;
//   - a terminal job is announced exactly once, because `DownloadManagerService.dismiss()`
//     re-broadcasts JOB_STATE_CHANGED for an already-terminal job.

import { uiNotificationService } from '../UINotificationService';
import { notificationLogService } from '../NotificationLogService';

import DownloadManagerService, {
  DownloadManagerServiceEvents,
  JOB_STATES,
  TRANSFER_MODES,
} from './DownloadManagerService';
import {
  notifyStudiesQueued,
  notifySeriesQueued,
  clearOfflineStorageWithNotice,
  startDownloadNotifications,
  stopDownloadNotifications,
} from './downloadNotifications';

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

const JOB = {
  id: 'dl-1.2.3-1000',
  StudyInstanceUID: '1.2.3',
  state: JOB_STATES.QUEUED,
  progress: { total: 240, completed: 0, failed: 0 },
  createdAt: 1000,
  PatientName: 'Doe^Jane',
  PatientID: 'MRN0042',
  StudyDescription: 'CT CHEST',
};

// A series-scoped job (ohif-viewers#130): same shape, plus the series attributes every notice
// about it is composed from.
const SERIES_JOB = {
  ...JOB,
  id: 'dl-1.2.3.4-1000',
  kind: 'series',
  SeriesInstanceUID: '1.2.3.4',
  SeriesNumber: 4,
  SeriesDescription: 'AXIAL 1.25MM',
  Modality: 'CT',
  progress: { total: 60, completed: 0, failed: 0 },
};

let shown;

beforeEach(() => {
  shown = [];
  uiNotificationService.setServiceImplementation({
    show: options => {
      shown.push(options);
      return options.id || `toast-${shown.length}`;
    },
    hide: () => {},
  });
  notificationLogService.clear();
  startDownloadNotifications();
});

afterEach(() => {
  stopDownloadNotifications();
});

/** Drive the service's own event so the subscription is exercised, not the handler directly. */
const broadcastState = job =>
  DownloadManagerService._broadcastEvent(DownloadManagerServiceEvents.JOB_STATE_CHANGED, { job });

describe('notifyStudiesQueued', () => {
  it('names the study when one is queued', () => {
    notifyStudiesQueued({ queued: [JOB] });

    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe('Queued for offline storage');
    expect(shown[0].message).toContain('Doe, Jane (MRN0042) · CT CHEST');
    expect(shown[0].type).toBe('info');
  });

  it('raises a single counted notice for a bulk selection', () => {
    notifyStudiesQueued({ queued: [JOB, { ...JOB, id: 'dl-2' }, { ...JOB, id: 'dl-3' }] });

    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe('3 studies queued for offline storage');
  });

  it('accounts for studies skipped as already cached or already downloading', () => {
    notifyStudiesQueued({ queued: [JOB], alreadyCached: 2, alreadyDownloading: 1 });

    expect(shown).toHaveLength(1);
    expect(shown[0].message).toContain('2 studies are already saved offline');
    expect(shown[0].message).toContain('1 study is already downloading');
  });

  it('explains why nothing happened when every selected study was skipped', () => {
    notifyStudiesQueued({ alreadyCached: 3 });

    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe('Already saved offline');
    expect(shown[0].type).toBe('info');
  });

  it('stays silent when the request came to nothing at all', () => {
    notifyStudiesQueued({});
    notifyStudiesQueued();

    expect(shown).toHaveLength(0);
  });
});

describe('notifySeriesQueued (ohif-viewers#130, FR-9)', () => {
  it('names the series rather than the study, and carries its UID', () => {
    notifySeriesQueued({ job: SERIES_JOB });

    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe('Series queued for offline storage');
    expect(shown[0].message).toContain('Series 4');
    expect(shown[0].message).toContain('AXIAL 1.25MM');
    // `seriesInstanceUID` is consumed by UINotificationService (it routes to the unified log) and
    // is not forwarded to the renderer, so it is not observable on `shown` -- same as the
    // study-scoped notices above.
  });

  it('stays silent without a job', () => {
    notifySeriesQueued({});

    expect(shown).toHaveLength(0);
  });
});

describe('job outcomes', () => {
  it('announces a completed download with its stored image count', () => {
    broadcastState({ ...JOB, id: 'dl-completed', state: JOB_STATES.COMPLETED });

    expect(shown).toHaveLength(1);
    expect(shown[0].type).toBe('success');
    expect(shown[0].title).toBe('Study saved for offline use');
    expect(shown[0].message).toContain('240 images stored on this device');
    // The default transfer is not worth a sentence; only archive mode names itself (#129 FR-8).
    expect(shown[0].message).not.toContain('archive');
  });

  it('names the transfer mode and any per-series fallback for an archive job (#129 FR-8/FR-9)', () => {
    broadcastState({
      ...JOB,
      id: 'dl-archived',
      state: JOB_STATES.COMPLETED,
      transferMode: TRANSFER_MODES.ARCHIVES,
      fallbackSeriesCount: 1,
    });

    expect(shown).toHaveLength(1);
    expect(shown[0].message).toContain('Transferred as per-series archives.');
    expect(shown[0].message).toContain('1 series was retrieved image by image');
  });

  it('announces a completed series transfer as a series (#130 FR-9)', () => {
    broadcastState({ ...SERIES_JOB, id: 'dl-series-done', state: JOB_STATES.COMPLETED });

    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe('Series saved for offline use');
    expect(shown[0].message).toContain('Series 4');
    expect(shown[0].message).toContain('60 images stored on this device');
  });

  it('announces a failure with the job error, sticky and logged', () => {
    broadcastState({
      ...JOB,
      id: 'dl-failed',
      state: JOB_STATES.ERROR,
      error: '3 of 240 instance(s) failed to download.',
    });

    expect(shown).toHaveLength(1);
    expect(shown[0].type).toBe('error');
    expect(shown[0].message).toContain('3 of 240 instance(s) failed to download.');
    expect(shown[0].duration).toBe(Infinity);
    // Errors are recorded in the unified log without the caller asking (ohif-viewers#84).
    expect(notificationLogService.getEntries()).toHaveLength(1);
  });

  it('announces a cancelled download', () => {
    broadcastState({ ...JOB, id: 'dl-cancelled', state: JOB_STATES.CANCELLED });

    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe('Offline download cancelled');
  });

  it('says nothing about a job that is merely progressing', () => {
    broadcastState({ ...JOB, id: 'dl-running', state: JOB_STATES.DOWNLOADING });

    expect(shown).toHaveLength(0);
  });

  it('announces a terminal job once, even when its row is later dismissed', () => {
    const job = { ...JOB, id: 'dl-once', state: JOB_STATES.COMPLETED };

    broadcastState(job);
    // `dismiss()` re-broadcasts the same terminal job.
    broadcastState(job);

    expect(shown).toHaveLength(1);
  });
});

describe('clearing offline storage', () => {
  it('reports what is being removed, then what was freed', async () => {
    await clearOfflineStorageWithNotice({
      studyCount: 12,
      byteCount: 1509949440,
      clear: () => Promise.resolve(),
    });

    expect(shown).toHaveLength(2);
    expect(shown[0].title).toBe('Clearing offline storage');
    expect(shown[0].message).toContain('Removing 12 studies from this device.');
    expect(shown[0].type).toBe('info');

    expect(shown[1].title).toBe('Offline storage cleared');
    expect(shown[1].message).toBe('12 studies removed, freeing 1.41 GB on this device.');
    expect(shown[1].type).toBe('success');
  });

  it('mentions the transfers it had to stop', async () => {
    await clearOfflineStorageWithNotice({
      studyCount: 1,
      activeTransfers: 2,
      clear: () => Promise.resolve(),
    });

    expect(shown[0].message).toContain('Removing 1 study from this device.');
    expect(shown[0].message).toContain('2 transfers in progress were stopped.');
  });

  it('does not raise a per-transfer cancel notice for the jobs the wipe stops', async () => {
    await clearOfflineStorageWithNotice({
      studyCount: 3,
      activeTransfers: 1,
      clear: () => {
        // cancelAllActive() drives its queued jobs straight to CANCELLED, synchronously.
        broadcastState({ ...JOB, id: 'dl-swept', state: JOB_STATES.CANCELLED });
        return Promise.resolve();
      },
    });

    expect(shown.map(n => n.title)).toEqual(['Clearing offline storage', 'Offline storage cleared']);
  });

  it('surfaces a failed wipe as a sticky error and still rejects', async () => {
    await expect(
      clearOfflineStorageWithNotice({
        studyCount: 3,
        clear: () => Promise.reject(new Error('IndexedDB is unavailable')),
      })
    ).rejects.toThrow('IndexedDB is unavailable');

    const error = shown[shown.length - 1];
    expect(error.title).toBe('Could not clear offline storage');
    expect(error.message).toContain('IndexedDB is unavailable');
    expect(error.duration).toBe(Infinity);
  });

  it('still performs the wipe, silently, when there is nothing stored', async () => {
    const clear = jest.fn(() => Promise.resolve());

    await clearOfflineStorageWithNotice({ studyCount: 0, clear });

    expect(clear).toHaveBeenCalled();
    expect(shown).toHaveLength(0);
  });
});
