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
import { describeStudy } from '../../utils/describeStudy';
import formatBytes from '../../utils/formatBytes';

import DownloadManagerService, {
  DownloadManagerServiceEvents,
  JOB_STATES,
} from './DownloadManagerService';

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

  const label = describeStudy(job);

  switch (job.state) {
    case JOB_STATES.COMPLETED: {
      _notifiedJobIds.add(job.id);
      const stored = job.progress?.total || 0;

      uiNotificationService.show({
        title: 'Study saved for offline use',
        message: `${label} — ${stored} ${_plural(stored, 'image', 'images')} stored on this device.`,
        type: 'success',
        studyInstanceUID: job.StudyInstanceUID,
      });
      break;
    }

    case JOB_STATES.ERROR: {
      _notifiedJobIds.add(job.id);

      // Sticky, because the study is now partially cached and the user has a decision to make
      // (retry, free up space, or remove the partial copy). `details` is what the Issues list
      // renders in its Details drawer.
      uiNotificationService.show({
        title: 'Offline download failed',
        message: `${label} — ${job.error || 'The study could not be saved to this device.'}`,
        type: 'error',
        autoClose: false,
        studyInstanceUID: job.StudyInstanceUID,
        details: {
          jobId: job.id,
          StudyInstanceUID: job.StudyInstanceUID,
          progress: job.progress,
        },
      });
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
      });
      break;
    }

    default:
      // Queued/downloading transitions are progress, not news: the Download Manager shows them.
      break;
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
  ];
}

/** Tear down the subscription (tests; the app never stops listening). */
export function stopDownloadNotifications(): void {
  _subscriptions.forEach(subscription => subscription.unsubscribe());
  _subscriptions = [];
  _notifiedJobIds.clear();
  _suppressCancelNoticesUntil = 0;
}

function _capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
