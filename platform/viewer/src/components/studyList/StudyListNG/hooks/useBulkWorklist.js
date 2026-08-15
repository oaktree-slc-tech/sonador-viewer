import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import {
  notificationLogService,
  NotificationLogSources,
  uiNotificationService,
} from '@ohif/core';

import { reportSafely } from '../components/bulkAction/bulkFailure';
import { withBulkRunLatch } from '../components/bulkAction/bulkRun';
import {
  describeGroup,
  describeMember,
  summariseBulkWorklist,
} from '../components/BulkWorklistModal/bulkWorklistPlan';
import {
  describeRequestFailure,
  isTransportFailure,
  runBulkWorklist,
} from '../components/BulkWorklistModal/bulkWorklistRunner';

import useBulkProgress from './useBulkProgress';


function _notifyOperationFailure({ studyLabel, memberLabel, err, StudyInstanceUID }) {
  // Sticky and individual, matching the bulk-share and bulk-removal paths: a review the user
  // believes was requested but was not is invisible otherwise, and the summary only gives a count.
  //
  // A transport failure is titled and worded differently on purpose. When `fetch` rejects with no
  // status the response never reached JavaScript -- a dropped connection, or a response the browser
  // withheld because it carried no CORS headers -- and the server may well have created the
  // request. Claiming it was not created would tell the user something about their worklist that is
  // not known to be true, and would invite a retry that creates a duplicate.
  const transport = isTransportFailure(err);

  uiNotificationService.show({
    title: transport ? 'Review request status unknown' : 'Review not requested',
    message: transport
      ? `${studyLabel}: the server did not return a readable response `
        + `(${err?.message || 'no detail'}). The request may or may not have been created; check `
        + 'the worklist before requesting it again.'
      : `${memberLabel || 'The selected reviewer'} was not asked to review ${studyLabel}. `
        + describeRequestFailure(err),
    type: 'error',
    autoClose: false,
    studyInstanceUID: StudyInstanceUID,
    // `message` and `name` are included because a transport failure carries no url/status/body at
    // all, and a notification with an empty Details drawer is what makes this hard to diagnose.
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


export default function useBulkWorklist() {
  // React binding for the bulk review-request run. The execution loop itself lives in
  // bulkWorklistRunner so it can be tested without a renderer.
  //
  // Modelled on useBulkShare: this owns the in-flight flag the dialog blocks on, the progress state,
  // the notifications and the cache invalidation; the dialog stays presentation.

  const queryClient = useQueryClient();
  const [isRequesting, setIsRequesting] = useState(false);
  const { progress, begin, record, reset: resetProgress } = useBulkProgress();

  // Guards re-entry synchronously. `isRequesting` is state and lands a render too late to stop a
  // second click landing on the same button -- and a second run here means a second review request
  // for every study, which the worklist endpoint accepts rather than rejects.
  const requestingRef = useRef(false);


  const requestBulkReview = useCallback(async ({
    server,
    operations = [],
    group,
    member,
    procedure,
  }) => {
    if (!operations.length || !group?.id || !member?.id) {
      return null;
    }

    const memberLabel = describeMember(member);
    const groupLabel = describeGroup(group);

    // Every line below runs inside the latch's try/finally, so the release cannot be skipped -- see
    // withBulkRunLatch. The in-flight check the ref used to do by hand happens in there too.
    const run = async () => {
      begin(operations.length);

      // One notice for the whole operation, before anything is written (the per-study detail streams
      // into the dialog instead -- a fifteen-study run would otherwise be fifteen toasts, which is
      // the annoyance this feature exists to remove, moved from the form to the notification tray).
      //
      // Guarded, like every other reporting call in this feature: a notification service that throws
      // must not abort a run the user asked for, and must not decide whether their reviews get
      // requested.
      reportSafely((notice) => uiNotificationService.show(notice), {
        title: 'Requesting reviews',
        message: `${operations.length} ${operations.length === 1 ? 'study' : 'studies'} assigned to `
          + `${memberLabel} in ${groupLabel}.`,
        type: 'info',
        log: true,
      }, 'Bulk review request');

      return runBulkWorklist({
        server,
        operations,
        groupId: group.id,
        userId: member.id,
        procedure,
        onRecord: (entry) => record({
          ...entry,
          message: entry.status === 'ok' ? memberLabel : entry.message,
        }),
        // Log-only: recorded in the Issues list so the assignment is auditable, without a toast per
        // study.
        //
        // Written straight to notificationLogService, NOT through LoggerService. What `@ohif/core`
        // exports as `LoggerService` is the service DESCRIPTOR (`{ name, create }`); the object
        // carrying `info`/`error` only exists after `create()`. `uiNotificationService` and
        // `notificationLogService` are exported as ready instances, which is why they can be used
        // directly here.
        onSuccess: ({ studyLabel, StudyInstanceUID }) => notificationLogService.add({
          title: 'Review requested',
          message: `${memberLabel} was asked to review ${studyLabel} (${groupLabel}).`,
          severity: 'success',
          source: NotificationLogSources.LOGGER,
          studyInstanceUID: StudyInstanceUID,
        }),
        onFailure: (payload) => _notifyOperationFailure({ ...payload, memberLabel }),
      });
    };

    return withBulkRunLatch({ latchRef: requestingRef, setBusy: setIsRequesting, run });
  }, [begin, record]);


  const finishBulkReview = useCallback(async ({ outcome, studies = [] }) => {
    // Raised after the run settles, and separated from requestBulkReview so the dialog controls when
    // the closing notice appears relative to its own completion hold.
    const { created = 0, total = 0 } = outcome || {};
    const clean = created === total;

    // Guarded for the same reason as the opening notice: the run has finished and its
    // outcome is settled, so a notification service that throws here must not propagate out
    // of the dialog's completion path and leave a finished run looking unfinished.
    reportSafely((notice) => uiNotificationService.show(notice), {
      title: summariseBulkWorklist({ created, total }),
      message: clean
        ? 'The selected studies now appear in the reviewer\'s worklist.'
        : 'Some review requests could not be created. See the individual errors for details.',
      type: clean ? 'success' : 'warning',
      autoClose: clean,
      log: true,
    }, 'Bulk review request');

    // Two caches go stale, and both are places the user looks to confirm the run worked:
    //
    //   - the worklist itself (`useWorklistItems`, keyed under 'worklist'), which is where the new
    //     items appear. The prefix also covers the group/membership searches this dialog made,
    //     which is harmless -- they are re-fetched on demand;
    //   - each affected study's review history in the study drawer (`useStudyWorklists`, keyed
    //     ['studyWorklists', uid]). Without this an expanded row keeps showing the history as it was
    //     before the request, which reads as the request having failed.
    await Promise.all([
      queryClient.invalidateQueries(['worklist']),
      ...studies
        .filter((study) => study?.StudyInstanceUID)
        .map((study) => queryClient.invalidateQueries(['studyWorklists', study.StudyInstanceUID])),
    ]);
  }, [queryClient]);


  return { isRequesting, progress, requestBulkReview, finishBulkReview, resetProgress };
}
