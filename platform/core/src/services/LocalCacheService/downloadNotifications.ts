// User-facing notifications for offline-storage downloads (ohif-viewers#125, ohif-viewers#84).
//
// Queueing a study for offline storage is background work: the only feedback used to be a row badge
// in the study list, so a study that was queued -- or that failed in transit minutes later -- said
// nothing at all. Everything here goes through the unified notification service, which raises the
// toast and, for errors, files the entry in the Issues list from the same call.
//
// The two halves are notified from different places on purpose:
//
//   - QUEUEING is announced by the call site, through `notifyStudiesQueued`. Only the call site
//     knows whether the user asked for one study or twenty and how many were skipped as already
//     cached, so a bulk selection raises ONE notice with a count rather than one toast per study.
//   - COMPLETION and FAILURE are announced here, from a DownloadManagerService subscription. They
//     land long after the click, often after the component that queued them has unmounted -- jobs
//     deliberately outlive the React tree (AC-7).
//   - CLEARING the whole cache is wrapped by `clearOfflineStorageWithNotice`, which brackets the
//     operation: it has to read the counts before the wipe destroys them, and mute the per-job
//     cancel notices for the transfers the wipe has to stop.

import { uiNotificationService } from '../UINotificationService';
import { describeStudy, describeSeries } from '../../utils/describeStudy';
import formatBytes from '../../utils/formatBytes';

import DownloadManagerService, {
  DownloadManagerServiceEvents,
  JOB_STATES,
  TRANSFER_MODES,
} from './DownloadManagerService';

/** A job's user-facing label: a series-scoped job names the series, a study job the study. */
const _describeJob = (job: any): string =>
  job?.kind === 'series' ? describeSeries(job) : describeStudy(job);

/** Where a queued study can be watched. Repeated in every queue notice, so it lives in one place. */
const TRACK_PROGRESS = 'Track progress in the Download Manager.';

const _plural = (count: number, singular: string, plural: string): string =>
  count === 1 ? singular : plural;

/**
 * Terminal notifications are raised at most once per job. `DownloadManagerService.dismiss()`
 * re-broadcasts JOB_STATE_CHANGED for an already-terminal job, which would otherwise re-announce a
 * completed download the moment the user clears its row from the Download Manager.
 */
const _notifiedJobIds = new Set<string>();

/**
 * The sticky failure toast raised for a job, so Retry can retire it (ohif-viewers#131 FR-9): once
 * the job is re-running, that notice describes a run the user has already replaced.
 */
const _failureToastIdsByJob = new Map<string, string>();

let _subscriptions: Array<{ unsubscribe: () => void }> = [];

/**
 * Per-job "download cancelled" notices are muted until this timestamp, so a bulk clear reports
 * itself once instead of once per transfer it had to stop. See `clearOfflineStorageWithNotice`.
 */
let _suppressCancelNoticesUntil = 0;

const MAX_CLEAR_SUPPRESSION_MS = 60000;
const CLEAR_SUPPRESSION_TAIL_MS = 10000;

/**
 * Announce the result of a queue request.
 *
 * @param {object} outcome
 * @param {object[]} [outcome.queued] - Jobs that were newly queued (used for their display fields)
 * @param {number} [outcome.alreadyCached] - Studies skipped because they are already stored locally
 * @param {number} [outcome.alreadyDownloading] - Studies skipped because a job is already in flight
 */
export function notifyStudiesQueued({
  queued = [],
  alreadyCached = 0,
  alreadyDownloading = 0,
}: {
  queued?: any[];
  alreadyCached?: number;
  alreadyDownloading?: number;
} = {}): void {
  const queuedCount = queued.length;

  if (!queuedCount && !alreadyCached && !alreadyDownloading) {
    // The request came to nothing -- an empty selection, or rows with no resolvable study. Silence
    // is right here: an empty "0 studies queued" notice tells the user less than the disabled
    // button already did.
    return;
  }

  const skipped = [];
  if (alreadyCached) {
    skipped.push(
      `${alreadyCached} ${_plural(alreadyCached, 'study is', 'studies are')} already saved offline`
    );
  }
  if (alreadyDownloading) {
    skipped.push(
      `${alreadyDownloading} ${_plural(alreadyDownloading, 'study is', 'studies are')} already downloading`
    );
  }

  if (!queuedCount) {
    // Nothing to do, but the user pressed a button and is owed an answer for why nothing happened.
    uiNotificationService.show({
      title: alreadyCached ? 'Already saved offline' : 'Download already in progress',
      message: `${_capitalize(skipped.join(', and '))}.`,
      type: 'info',
    });
    return;
  }

  const message = [
    queuedCount === 1
      ? `${describeStudy(queued[0])} is downloading in the background.`
      : 'They are downloading in the background.',
    skipped.length ? `${_capitalize(skipped.join(', and '))}.` : '',
    TRACK_PROGRESS,
  ]
    .filter(Boolean)
    .join(' ');

  uiNotificationService.show({
    title:
      queuedCount === 1
        ? 'Queued for offline storage'
        : `${queuedCount} studies queued for offline storage`,
    message,
    type: 'info',
    studyInstanceUID: queuedCount === 1 ? queued[0]?.StudyInstanceUID : undefined,
  });
}

/**
 * Announce that ONE SERIES was queued for offline storage (ohif-viewers#130 FR-9).
 *
 * Series-scoped rather than study-scoped: the notice names the series the user picked, and carries
 * `seriesInstanceUID` so the Issues list and any series-aware surface can key on it. The phrasing
 * follows `describeSeries`, which the archive-export notifications already established, so the two
 * queues describe a series identically even though they share nothing else.
 *
 * There is no "already cached" / "already downloading" counterpart to `notifyStudiesQueued`'s:
 * both menus withhold the item entirely in those states, so the user is never told about a click
 * they could not have made.
 *
 * @param {object} outcome
 * @param {object} outcome.job - The queued job, for its display fields
 */
export function notifySeriesQueued({ job }: { job?: any } = {}): void {
  if (!job) {
    return;
  }

  uiNotificationService.show({
    title: 'Series queued for offline storage',
    message: `${describeSeries(job)} is downloading in the background. ${TRACK_PROGRESS}`,
    type: 'info',
    studyInstanceUID: job.StudyInstanceUID,
    seriesInstanceUID: job.SeriesInstanceUID,
  });
}

/**
 * Run the Download Manager's "Clear Storage" action, announcing it on both ends.
 *
 * The wipe runs through this wrapper rather than being notified around, for two reasons: the
 * counts it reports are gone the moment the wipe starts, so they must be captured first; and
 * clearing necessarily cancels every transfer still writing into the cache, which would otherwise
 * raise a per-job "download cancelled" toast for each one on top of the notice the user is
 * actually reading. Cancel notices are suppressed for the duration.
 *
 * @param {object} request
 * @param {number} request.studyCount - Studies stored on the device when the user confirmed
 * @param {number} [request.byteCount] - Bytes those studies occupied, for the "freed" figure
 * @param {number} [request.activeTransfers] - Transfers that will be stopped to make the wipe safe
 * @param {Function} request.clear - Performs the wipe; its promise resolves when the device is clear
 * @returns {Promise} the caller's own promise, so a caller can still await or catch it
 */
export function clearOfflineStorageWithNotice({
  studyCount,
  byteCount = 0,
  activeTransfers = 0,
  clear,
}: {
  studyCount: number;
  byteCount?: number;
  activeTransfers?: number;
  clear: () => Promise<unknown> | unknown;
}): Promise<unknown> {
  // Armed BEFORE the wipe, because cancelling a queued job broadcasts its terminal state
  // synchronously. Bounded so a wipe that never settles cannot mute cancel notices for the rest
  // of the session.
  _suppressCancelNoticesUntil = Date.now() + MAX_CLEAR_SUPPRESSION_MS;

  const studies = `${studyCount} ${_plural(studyCount, 'study', 'studies')}`;
  const announce = studyCount > 0 || activeTransfers > 0;

  const pendingId = announce
    ? uiNotificationService.show({
        title: 'Clearing offline storage',
        message: [
          `Removing ${studies} from this device.`,
          activeTransfers
            ? `${activeTransfers} ${_plural(activeTransfers, 'transfer', 'transfers')} in progress ${_plural(activeTransfers, 'was', 'were')} stopped.`
            : '',
        ]
          .filter(Boolean)
          .join(' '),
        type: 'info',
        // Sticky: the wipe is what the user is waiting on, so the notice stands until it settles.
        autoClose: false,
      })
    : undefined;

  const settled = () => {
    if (pendingId) {
      uiNotificationService.hide(pendingId);
    }
    // A cancelled job that was mid-fetch reaches its terminal state shortly after the wipe; keep
    // its notice suppressed through that tail.
    _suppressCancelNoticesUntil = Date.now() + CLEAR_SUPPRESSION_TAIL_MS;
  };

  return Promise.resolve()
    .then(() => clear())
    .then(
      result => {
        settled();

        if (announce) {
          uiNotificationService.show({
            title: 'Offline storage cleared',
            message: byteCount
              ? `${studies} removed, freeing ${formatBytes(byteCount)} on this device.`
              : `${studies} removed from this device.`,
            type: 'success',
          });
        }

        return result;
      },
      error => {
        settled();

        uiNotificationService.show({
          title: 'Could not clear offline storage',
          message: `${error?.message || error} — some studies may still be stored on this device.`,
          type: 'error',
          autoClose: false,
          error,
        });

        throw error;
      }
    );
}

function _onJobStateChanged({ job }): void {
  if (!job || _notifiedJobIds.has(job.id)) {
    return;
  }

  const label = _describeJob(job);
  const isSeriesJob = job.kind === 'series';

  switch (job.state) {
    case JOB_STATES.COMPLETED: {
      _notifiedJobIds.add(job.id);
      const stored = job.progress?.total || 0;

      uiNotificationService.show({
        title: isSeriesJob ? 'Series saved for offline use' : 'Study saved for offline use',
        message: [
          `${label} — ${stored} ${_plural(stored, 'image', 'images')} stored on this device.`,
          // How it was transferred, when that was not the default (#129 FR-8/§5.4). One line, not
          // one per series: a per-series notification stream would drown the Issues list.
          _describeTransferMode(job),
        ]
          .filter(Boolean)
          .join(' '),
        type: 'success',
        studyInstanceUID: job.StudyInstanceUID,
        seriesInstanceUID: job.SeriesInstanceUID,
      });
      break;
    }

    case JOB_STATES.ERROR: {
      _notifiedJobIds.add(job.id);

      // Sticky, because the study is now partially cached and the user has a decision to make
      // (retry, free up space, or remove the partial copy). `details` is what the Issues list
      // renders in its Details drawer.
      const toastId = uiNotificationService.show({
        title: 'Offline download failed',
        message: `${label} — ${job.error || 'The data could not be saved to this device.'}`,
        type: 'error',
        autoClose: false,
        studyInstanceUID: job.StudyInstanceUID,
        seriesInstanceUID: job.SeriesInstanceUID,
        details: {
          jobId: job.id,
          StudyInstanceUID: job.StudyInstanceUID,
          SeriesInstanceUID: job.SeriesInstanceUID,
          transferMode: job.transferMode,
          progress: job.progress,
          // Per-series diagnostics for an archive transfer: which series failed, which path served
          // it, and the URL/status/body of a failed archive request (#129 FR-13).
          series: _failedSeriesDetails(job),
        },
      });

      if (toastId) {
        _failureToastIdsByJob.set(job.id, toastId);
      }
      break;
    }

    case JOB_STATES.CANCELLED: {
      _notifiedJobIds.add(job.id);

      if (Date.now() < _suppressCancelNoticesUntil) {
        // A bulk clear stopped this transfer and is reporting that itself.
        break;
      }

      uiNotificationService.show({
        title: 'Offline download cancelled',
        message: `${label} — nothing from this download was kept on the device.`,
        type: 'info',
        studyInstanceUID: job.StudyInstanceUID,
        seriesInstanceUID: job.SeriesInstanceUID,
      });
      break;
    }

    default:
      // Queued/downloading transitions are progress, not news: the Download Manager shows them.
      break;
  }
}

/**
 * A failed job was re-armed (ohif-viewers#131 FR-9). The announce-once entry is cleared, without
 * which the re-run would reach its terminal state in silence, and the previous run's sticky
 * failure toast is retired.
 */
function _onJobRetried({ job }): void {
  if (!job) {
    return;
  }

  _notifiedJobIds.delete(job.id);

  const toastId = _failureToastIdsByJob.get(job.id);
  if (toastId) {
    _failureToastIdsByJob.delete(job.id);
    uiNotificationService.hide(toastId);
  }
}

/**
 * Begin announcing download outcomes. Idempotent, and safe to call before any job exists.
 */
export function startDownloadNotifications(): void {
  if (_subscriptions.length) {
    return;
  }

  _subscriptions = [
    DownloadManagerService.subscribe(
      DownloadManagerServiceEvents.JOB_STATE_CHANGED,
      _onJobStateChanged
    ),
    DownloadManagerService.subscribe(DownloadManagerServiceEvents.JOB_RETRIED, _onJobRetried),
  ];
}

/** Tear down the subscription (tests; the app never stops listening). */
export function stopDownloadNotifications(): void {
  _subscriptions.forEach(subscription => subscription.unsubscribe());
  _subscriptions = [];
  _notifiedJobIds.clear();
  _failureToastIdsByJob.clear();
  _suppressCancelNoticesUntil = 0;
}

function _capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/**
 * One sentence naming the transfer mode, for a completed archive-mode job (#129 FR-8).
 *
 * Says "transferred as per-series archives", never "downloaded an archive": in this dialog
 * "archive" now means both a zip file and a way of moving an offline copy, and this notice must
 * not read as though a file was saved to the user's computer (#129 AR-6).
 */
function _describeTransferMode(job: any): string {
  if (job?.transferMode !== TRANSFER_MODES.ARCHIVES) {
    return '';
  }

  const fallbacks = job.fallbackSeriesCount || 0;
  const mode = 'Transferred as per-series archives.';

  if (!fallbacks) {
    return mode;
  }

  // "series" is its own plural, so only the verb changes.
  return `${mode} ${fallbacks} series ${_plural(fallbacks, 'was', 'were')} retrieved image by image ` +
    'after the archive could not be used.';
}

/** The failed/fallback series of an archive job, for the Issues list Details drawer. */
function _failedSeriesDetails(job: any) {
  if (!Array.isArray(job?.series)) {
    return undefined;
  }

  const notable = job.series.filter(
    (series: any) => series.failedCount > 0 || series.error || series.path === 'instances'
  );

  return notable.length
    ? notable.map((series: any) => ({
        SeriesInstanceUID: series.SeriesInstanceUID,
        SeriesNumber: series.SeriesNumber,
        state: series.state,
        path: series.path,
        failedCount: series.failedCount,
        error: series.error,
        details: series.details,
      }))
    : undefined;
}
