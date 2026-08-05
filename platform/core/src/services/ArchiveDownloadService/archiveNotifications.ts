// User-facing notifications for archive exports (ohif-viewers#52, ohif-viewers#84).
//
// Split the same way the offline-cache notices are (see LocalCacheService/downloadNotifications),
// and for the same reasons:
//
//   - QUEUEING is announced by the CALL SITE, through `notifyArchivesQueued`. Only the call site
//     knows whether the user asked for one study or twenty, so a bulk selection raises ONE notice
//     with a count rather than one toast per study (#52 FR-10).
//   - COMPLETION and FAILURE are announced here, from an ArchiveDownloadService subscription. They
//     land long after the click -- the server builds the archive on demand -- and often after the
//     component that queued them has unmounted, because jobs deliberately outlive the React tree.
//   - CANCELLATION is silent (#52 FR-13). The user did it on purpose and is looking at the row that
//     already says "Cancelled"; a toast would only be telling them what they just asked for.
//
// The queue notice is STICKY and is retired when the archive starts streaming. That is a
// deliberate departure from a plain transient "queued" toast: between the click and the first byte
// the server is building the archive, which for a large study is minutes of nothing -- exactly the
// silence that made the old implementation feel broken. Once bytes are moving, the Downloads
// dropdown carries the progress and the toast has nothing left to say, so it goes.
//
// Info and success notices are transient and are NOT written to the unified log (#52 FR-12);
// errors are, automatically, by the notification service.

import { uiNotificationService } from '../UINotificationService';
import { describeStudy, describeSeries } from '../../utils/describeStudy';
import formatBytes from '../../utils/formatBytes';

import ArchiveDownloadService, {
  ArchiveDownloadServiceEvents,
  ARCHIVE_JOB_STATES,
} from './ArchiveDownloadService';

/** Where a queued export can be watched. Repeated in every queue notice, so it lives in one place. */
const TRACK_PROGRESS = 'Track progress in the Downloads menu.';

/**
 * Above this many jobs from a single user action, the batch reports itself once instead of once per
 * study (#52 FR-10). Three or fewer are announced individually, because at that size naming the
 * studies is more useful than counting them.
 */
const MAX_INDIVIDUAL_NOTICES = 3;

/** jobId -> id of its sticky "preparing" toast, so the subscription can retire it. */
const _pendingNoticeIds = new Map<string, string>();

/**
 * Terminal notices are raised at most once per job. `dismiss()` and `clearTerminal()` re-broadcast
 * JOB_STATE_CHANGED for an already-terminal job, which would otherwise re-announce a completed
 * export the moment the user clears its row.
 */
const _notifiedJobIds = new Set<string>();

let _subscriptions: Array<{ unsubscribe: () => void }> = [];

/** Human-readable identification of whatever this job exports. */
function _describe(job: any): string {
  return job?.kind === 'series' ? describeSeries(job) : describeStudy(job);
}

const _plural = (count: number, singular: string, plural: string): string =>
  count === 1 ? singular : plural;

/**
 * Announce the result of a queue request.
 *
 * @param {object} outcome
 * @param {object[]} [outcome.queued] - Jobs that were newly queued (used for their display fields)
 * @param {number} [outcome.alreadyQueued] - Resources skipped because an export is already in flight
 */
export function notifyArchivesQueued({
  queued = [],
  alreadyQueued = 0,
}: {
  queued?: any[];
  alreadyQueued?: number;
} = {}): void {
  const queuedCount = queued.length;

  if (!queuedCount && !alreadyQueued) {
    // The request came to nothing -- an empty selection, or rows with no resolvable study. Silence
    // is right here: an empty "0 studies queued" notice tells the user less than the disabled
    // button already did.
    return;
  }

  if (!queuedCount) {
    // Nothing to do, but the user pressed a button and is owed an answer for why nothing happened.
    uiNotificationService.show({
      title: 'Download already in progress',
      message: `${alreadyQueued} ${_plural(alreadyQueued, 'download is', 'downloads are')} already running. ${TRACK_PROGRESS}`,
      type: 'info',
    });
    return;
  }

  if (queuedCount > MAX_INDIVIDUAL_NOTICES) {
    // One aggregate notice for the batch. Transient rather than sticky: the jobs finish preparing
    // at different times, so there is no single moment at which a sticky batch notice would be
    // retired, and a stack of five sticky toasts would bury the study list.
    uiNotificationService.show({
      title: `${queuedCount} studies queued for download`,
      message: [
        'The server is preparing an archive for each. Files save automatically as they become ready.',
        alreadyQueued
          ? `${alreadyQueued} ${_plural(alreadyQueued, 'was', 'were')} already downloading.`
          : '',
        TRACK_PROGRESS,
      ]
        .filter(Boolean)
        .join(' '),
      type: 'info',
    });
    return;
  }

  queued.forEach(job => _announceQueued(job));
}

/** One sticky "preparing" notice for a single export, retired once bytes start moving. */
function _announceQueued(job: any): void {
  if (!job || _pendingNoticeIds.has(job.id)) {
    return;
  }

  // Never raise a STICKY notice for a job that is already past the preparing window -- the state
  // change that would retire it has already been broadcast, so the toast would stand forever.
  // Reachable when a caller announces a de-duplicated job it did not actually queue.
  if (job.state !== ARCHIVE_JOB_STATES.QUEUED && job.state !== ARCHIVE_JOB_STATES.PROCESSING) {
    return;
  }

  const noticeId = uiNotificationService.show({
    title: 'Download queued',
    message: `${_describe(job)} — the server is preparing the archive. The download starts automatically once it is ready. ${TRACK_PROGRESS}`,
    type: 'info',
    // Sticky while the archive is being built: this window has no progress to show and can run for
    // minutes. `_retirePendingNotice` takes it down as soon as the transfer begins.
    autoClose: false,
    studyInstanceUID: job.StudyInstanceUID,
    seriesInstanceUID: job.SeriesInstanceUID,
  });

  if (noticeId) {
    _pendingNoticeIds.set(job.id, noticeId);
  }
}

function _retirePendingNotice(jobId: string): void {
  const noticeId = _pendingNoticeIds.get(jobId);
  if (noticeId) {
    uiNotificationService.hide(noticeId);
    _pendingNoticeIds.delete(jobId);
  }
}

function _onJobStateChanged({ job }): void {
  if (!job) {
    return;
  }

  // Bytes are moving, or the job has settled: either way the "preparing" notice has nothing left
  // to say. Retired before the terminal guard below, so a job that is dismissed after completing
  // cannot strand its sticky toast.
  if (job.state !== ARCHIVE_JOB_STATES.QUEUED && job.state !== ARCHIVE_JOB_STATES.PROCESSING) {
    _retirePendingNotice(job.id);
  }

  if (_notifiedJobIds.has(job.id)) {
    return;
  }

  const label = _describe(job);

  switch (job.state) {
    case ARCHIVE_JOB_STATES.COMPLETED: {
      _notifiedJobIds.add(job.id);

      uiNotificationService.show({
        title: 'Download complete',
        message: `${label} — saved as ${job.filename} (${formatBytes(job.totalBytes || job.bytesReceived || 0)}).`,
        type: 'success',
        studyInstanceUID: job.StudyInstanceUID,
        seriesInstanceUID: job.SeriesInstanceUID,
      });
      break;
    }

    case ARCHIVE_JOB_STATES.ERROR: {
      _notifiedJobIds.add(job.id);

      // Sticky, because nothing was saved and the user has a decision to make (retry, or take it
      // to support). `details` carries the request URL, HTTP status and response body -- what the
      // Issues list renders in its Details drawer, and what a support conversation actually needs.
      uiNotificationService.show({
        title: 'Download failed',
        message: `${label} — ${job.error || 'The archive could not be downloaded.'}`,
        type: 'error',
        autoClose: false,
        studyInstanceUID: job.StudyInstanceUID,
        seriesInstanceUID: job.SeriesInstanceUID,
        details: job.details,
      });
      break;
    }

    case ARCHIVE_JOB_STATES.CANCELLED:
      // Silent by design (#52 FR-13) -- the dropdown row is the feedback. Marked as notified so a
      // later dismiss cannot re-enter this switch.
      _notifiedJobIds.add(job.id);
      break;

    default:
      // Queued/processing/downloading transitions are progress, not news: the dropdown shows them.
      break;
  }
}

/** Begin announcing archive-export outcomes. Idempotent, and safe to call before any job exists. */
export function startArchiveNotifications(): void {
  if (_subscriptions.length) {
    return;
  }

  _subscriptions = [
    ArchiveDownloadService.subscribe(
      ArchiveDownloadServiceEvents.JOB_STATE_CHANGED,
      _onJobStateChanged
    ),
  ];
}

/** Tear down the subscription (tests; the app never stops listening). */
export function stopArchiveNotifications(): void {
  _subscriptions.forEach(subscription => subscription.unsubscribe());
  _subscriptions = [];
  _notifiedJobIds.clear();
  _pendingNoticeIds.clear();
}
