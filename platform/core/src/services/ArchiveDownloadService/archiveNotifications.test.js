// Unit tests for archive-export notifications (ohif-viewers#52, ohif-viewers#84).
//
// Three behaviours here are load bearing and easy to regress:
//   - a bulk queue raises ONE notice with a count, not one toast per study (FR-10);
//   - a user-initiated cancel says nothing at all (FR-13);
//   - the sticky "preparing" notice is retired when bytes start moving, and cannot be stranded by
//     a job that settles or is dismissed.

import { uiNotificationService } from '../UINotificationService';
import { notificationLogService } from '../NotificationLogService';

import ArchiveDownloadService, {
  ArchiveDownloadServiceEvents,
  ARCHIVE_JOB_STATES,
} from './ArchiveDownloadService';
import {
  notifyArchivesQueued,
  startArchiveNotifications,
  stopArchiveNotifications,
} from './archiveNotifications';

// Jest 29 runs in a node environment here (jest-environment-jsdom is not installed), and
// PubSubService._broadcastEvent mirrors every event onto document.body as a CustomEvent. Same
// shims as downloadNotifications.test.js.
global.CustomEvent = global.CustomEvent || class CustomEvent {
  constructor(type, params = {}) {
    this.type = type;
    this.detail = params.detail;
  }
};
global.document = global.document || { body: { dispatchEvent: () => {} } };

const job = (overrides = {}) => ({
  id: 'archive-1.2.3-1000',
  kind: 'study',
  StudyInstanceUID: '1.2.3',
  state: ARCHIVE_JOB_STATES.QUEUED,
  bytesReceived: 0,
  totalBytes: null,
  filename: 'Doe-Jane_CT-CHEST.zip',
  createdAt: 1000,
  PatientName: 'Doe^Jane',
  PatientID: 'MRN0042',
  StudyDescription: 'CT CHEST',
  ...overrides,
});

let shown;
let hidden;

beforeEach(() => {
  shown = [];
  hidden = [];
  uiNotificationService.setServiceImplementation({
    show: options => {
      shown.push(options);
      return options.id || `toast-${shown.length}`;
    },
    hide: id => hidden.push(id),
  });
  notificationLogService.clear();
  startArchiveNotifications();
});

afterEach(() => {
  stopArchiveNotifications();
});

/** Drive the service's own event so the subscription is exercised, not the handler directly. */
const broadcast = j =>
  ArchiveDownloadService._broadcastEvent(ArchiveDownloadServiceEvents.JOB_STATE_CHANGED, { job: j });

describe('queue notices', () => {
  it('announces a small batch individually', () => {
    notifyArchivesQueued({
      queued: [job({ id: 'a' }), job({ id: 'b' })],
    });

    expect(shown).toHaveLength(2);
    expect(shown.every(n => n.type === 'info' && n.autoClose === false)).toBe(true);
    expect(shown[0].title).toBe('Download queued');
    // Identified by patient and study, never by bare UID, when a descriptor was supplied.
    expect(shown[0].message).toContain('Doe, Jane (MRN0042)');
  });

  it('collapses a large batch into one aggregate notice (FR-10)', () => {
    notifyArchivesQueued({
      queued: [1, 2, 3, 4, 5].map(n => job({ id: `job-${n}` })),
    });

    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe('5 studies queued for download');
    // Transient (the service's `autoClose = true` default): there is no single moment at which a
    // sticky batch notice would be retired, since the jobs finish preparing at different times.
    expect(shown[0].autoClose).not.toBe(false);
  });

  it('says nothing when the request came to nothing', () => {
    notifyArchivesQueued({ queued: [], alreadyQueued: 0 });
    expect(shown).toHaveLength(0);
  });

  it('explains a fully de-duplicated request rather than staying silent (FR-14)', () => {
    notifyArchivesQueued({ queued: [], alreadyQueued: 2 });

    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe('Download already in progress');
  });

  it('refuses to raise a sticky notice for a job already past the preparing window', () => {
    notifyArchivesQueued({ queued: [job({ state: ARCHIVE_JOB_STATES.DOWNLOADING })] });

    // Nothing would ever retire it, so it is not raised at all.
    expect(shown).toHaveLength(0);
  });
});

describe('terminal notices', () => {
  it('retires the preparing notice once the transfer begins', () => {
    const queued = job();
    notifyArchivesQueued({ queued: [queued] });
    const pendingId = shown[0].id || 'toast-1';

    broadcast({ ...queued, state: ARCHIVE_JOB_STATES.DOWNLOADING });

    expect(hidden).toContain(pendingId);
    // Bytes moving is not news -- the dropdown shows it.
    expect(shown).toHaveLength(1);
  });

  it('announces completion with the filename and archive size (FR-11)', () => {
    broadcast(
      job({ state: ARCHIVE_JOB_STATES.COMPLETED, totalBytes: 1048576, bytesReceived: 1048576 })
    );

    expect(shown).toHaveLength(1);
    expect(shown[0].type).toBe('success');
    expect(shown[0].title).toBe('Download complete');
    expect(shown[0].message).toContain('Doe-Jane_CT-CHEST.zip');
    expect(shown[0].message).toContain('1 MB');
  });

  it('announces failure stickily, carrying the request diagnostics (FR-12)', () => {
    broadcast(
      job({
        state: ARCHIVE_JOB_STATES.ERROR,
        error: 'Failed to fetch archive: 503 Service Unavailable',
        details: { url: 'https://example.test/studies/1.2.3/archive', status: 503, body: 'nope' },
      })
    );

    expect(shown).toHaveLength(1);
    expect(shown[0].type).toBe('error');
    expect(shown[0].autoClose).toBe(false);

    // UINotificationService strips the diagnostics keys off the toast and routes them to the
    // unified log, which is what the Issues list renders in its Details drawer.
    const [entry] = notificationLogService.getEntries();
    expect(entry.severity).toBe('error');
    expect(entry.studyInstanceUID).toBe('1.2.3');
    expect(entry.details.status).toBe(503);
    expect(entry.details.url).toContain('/archive');
  });

  it('says nothing when the user cancels (FR-13)', () => {
    broadcast(job({ state: ARCHIVE_JOB_STATES.CANCELLED }));

    expect(shown).toHaveLength(0);
    expect(notificationLogService.getEntries?.() || []).toHaveLength(0);
  });

  it('announces a terminal job exactly once, even when its row is later cleared', () => {
    const done = job({ state: ARCHIVE_JOB_STATES.COMPLETED, totalBytes: 512 });

    broadcast(done);
    // dismiss()/clearTerminal() re-broadcast JOB_STATE_CHANGED for an already-terminal job.
    broadcast(done);

    expect(shown).toHaveLength(1);
  });

  it('describes a series export by its series attributes', () => {
    broadcast(
      job({
        kind: 'series',
        SeriesInstanceUID: '1.2.3.4',
        SeriesNumber: 4,
        SeriesDescription: 'AXIAL 1.25MM',
        Modality: 'CT',
        state: ARCHIVE_JOB_STATES.COMPLETED,
        totalBytes: 2048,
      })
    );

    expect(shown[0].message).toContain('Series 4');
    expect(shown[0].message).toContain('AXIAL 1.25MM');
  });
});
