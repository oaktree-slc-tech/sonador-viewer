import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import {
  notificationLogService,
  NotificationLogSources,
  uiNotificationService,
} from '@ohif/core';

import { reportSafely } from '../components/bulkAction/bulkFailure';
import { withBulkRunLatch } from '../components/bulkAction/bulkRun';
import { dedupeStudies } from '../components/bulkAction/bulkStudies';
import { buildShareOperations, summariseBulkShare, summarisePermissions }
  from '../components/BulkShareModal/bulkSharePlan';
import {
  describeWriteFailure,
  isTransportFailure,
  runBulkShare,
} from '../components/BulkShareModal/bulkShareRunner';

import useBulkProgress from './useBulkProgress';


function _notifyOperationFailure({ studyLabel, subjectLabel, err, StudyInstanceUID }) {
  // Sticky and individual, matching the removal path: a share the user believes happened but did
  // not is invisible otherwise, and the summary only gives them a count.
  //
  // A transport failure is titled and worded differently on purpose. When `fetch` rejects with no
  // status the response never reached JavaScript -- a dropped connection, or a response the browser
  // withheld because it carried no CORS headers -- and the server may well have applied the policy.
  // Claiming "not applied" in that case tells the user something about their data that is not known
  // to be true. The old wording did exactly that, and said nothing about why.
  const transport = isTransportFailure(err);

  uiNotificationService.show({
    title: transport ? 'Access policy status unknown' : 'Access policy not applied',
    message: transport
      ? `${subjectLabel || 'A recipient'} — ${studyLabel}: the server did not return a readable `
        + `response (${err?.message || 'no detail'}). The policy may or may not have been applied; `
        + 'reopen Share on this study to check.'
      : subjectLabel
        ? `${subjectLabel} was not granted access to ${studyLabel}. ${describeWriteFailure(err)}`
        : `Access policies for ${studyLabel} could not be applied. ${describeWriteFailure(err)}`,
    type: 'error',
    autoClose: false,
    studyInstanceUID: StudyInstanceUID,
    // `message` and `name` are included because a transport failure carries no url/status/body at
    // all, and a notification with an empty Details drawer is what made this hard to diagnose.
    details: {
      url: err?.url,
      status: err?.status,
      body: err?.body,
      error: err?.message,
      type: err?.name,
    },
    error: err,
  });
}


export default function useBulkShare() {
  // React binding for the bulk-share run. The execution loop itself lives in bulkShareRunner so it
  // can be tested without a renderer -- "how many requests does this issue?" is the question that
  // matters most here and it is not answerable from a hook.
  //
  // Modelled on useRemoveResource: this owns the in-flight flag the dialog blocks on, the progress
  // state, the notifications and the cache invalidation; the dialog stays presentation.

  const queryClient = useQueryClient();
  const [isApplying, setIsApplying] = useState(false);
  const { progress, begin, record, reset: resetProgress } = useBulkProgress();

  // Guards re-entry synchronously. `isApplying` is state and lands a render too late to stop a
  // second click landing on the same Apply button -- the same trap the segmentation editor hit.
  const applyingRef = useRef(false);


  const applyBulkShare = useCallback(async ({ server, studies = [], subjects = [], permissions = {} }) => {
    const operations = buildShareOperations({ studies, subjects });

    if (!operations.length) {
      return null;
    }

    // Every line below runs inside the latch's try/finally, so the release cannot be skipped -- see
    // withBulkRunLatch. The in-flight check the ref used to do by hand happens in there too.
    const run = async () => {
      begin(operations.length);

      // One notice for the whole operation, before anything is written (the per-policy detail
      // streams into the dialog instead -- a twelve-study, three-group run is thirty-six writes, and
      // thirty-six toasts would bury everything else in the tray).
      //
      // Guarded, like every other reporting call in this feature: a notification service that throws
      // must not abort a run the user asked for, and must not decide whether their policies get
      // written. The count is the de-duplicated one, matching the dialog's own heading.
      const affected = dedupeStudies(studies);

      reportSafely((notice) => uiNotificationService.show(notice), {
        title: 'Applying access policies',
        message: `${summarisePermissions(permissions)} on ${affected.length} `
          + `${affected.length === 1 ? 'study' : 'studies'} for ${subjects.length} `
          + `${subjects.length === 1 ? 'recipient' : 'recipients'}.`,
        type: 'info',
        log: true,
      }, 'Bulk share');

      return runBulkShare({
        server,
        operations,
        permissions,
        onRecord: (entry) => record({
          ...entry,
          message: entry.status === 'ok' ? summarisePermissions(permissions) : entry.message,
        }),
        // Log-only: recorded in the Issues list so the change is auditable, without a toast per
        // policy -- twelve studies and three groups is thirty-six writes.
        //
        // Written straight to notificationLogService, NOT through LoggerService. What `@ohif/core`
        // exports as `LoggerService` is the service DESCRIPTOR (`{ name, create }`); the object
        // carrying `info`/`error` only exists after `create()`, which is why every other call site
        // reaches it through `servicesManager.services`. Importing the barrel symbol and calling
        // `.info` on it throws "info is not a function" -- and because that call sat next to the
        // write, it was reported as the ACL having failed. `uiNotificationService` is exported as a
        // ready instance, which is why the failure path worked and this one did not.
        onSuccess: ({ subjectLabel, studyLabel, StudyInstanceUID }) => notificationLogService.add({
          title: 'Access granted',
          message: `${subjectLabel} was granted ${summarisePermissions(permissions)} on ${studyLabel}.`,
          severity: 'success',
          source: NotificationLogSources.LOGGER,
          studyInstanceUID: StudyInstanceUID,
        }),
        onFailure: _notifyOperationFailure,
      });
    };

    return withBulkRunLatch({ latchRef: applyingRef, setBusy: setIsApplying, run });
  }, [begin, record]);



  const finishBulkShare = useCallback(async ({ outcome, studies = [] }) => {
    // Raised after the run settles, and separated from applyBulkShare so the dialog controls when
    // the closing notice appears relative to its own completion hold.
    const { applied = 0, total = 0 } = outcome || {};
    const clean = applied === total;

    // Guarded for the same reason as the opening notice: the run has finished and its
    // outcome is settled, so a notification service that throws here must not propagate out
    // of the dialog's completion path and leave a finished run looking unfinished.
    reportSafely((notice) => uiNotificationService.show(notice), {
      title: summariseBulkShare({ applied, total }),
      message: clean
        ? 'The selected studies are now shared with the chosen users and groups.'
        : 'Some access policies could not be applied. See the individual errors for details.',
      type: clean ? 'success' : 'warning',
      autoClose: clean,
      log: true,
    }, 'Bulk share');

    // The study list carries no ACL column, so nothing there needs refetching. What does go stale
    // is any open share dialog's per-study policy cache.
    await Promise.all(
      studies
        .filter((study) => study?.StudyInstanceUID)
        .flatMap((study) => [
          queryClient.invalidateQueries(['aclUsers', study.StudyInstanceUID]),
          queryClient.invalidateQueries(['aclGroups', study.StudyInstanceUID]),
        ])
    );
  }, [queryClient]);


  return { isApplying, progress, applyBulkShare, finishBulkShare, resetProgress };
}
