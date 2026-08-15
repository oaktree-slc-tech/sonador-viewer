// The bulk review-request execution loop, extracted from useBulkWorklist so it can be exercised
// without React.
//
// Same split as bulkShareRunner: this is the part that decides how many requests are issued, and
// "the reviewer was asked to look at the same study twice" is precisely the kind of defect that has
// to be provable in a test rather than argued about from a reading of the code. There is no React
// renderer in this repo's jest setup, so the loop takes its API surface as an injectable dependency
// and the hook becomes a thin wrapper.

import { createWorklistRequest } from '../../../../../api/worklist';
import {
  describeOperationFailure,
  isTransportFailure,
  reportSafely,
} from '../bulkAction/bulkFailure';
import { describeStudy } from '../RemoveResourceConfirm/describeRemoval';
import { INITIAL_REVIEW_STATE } from '../worklistRequest/worklistRequestForm';


// How many requests are in flight at once. Bounded for the same reason MAX_CONCURRENT_STUDIES is in
// bulkShareRunner: a fifty-study selection must not open fifty simultaneous POSTs against the
// gateway.
export const MAX_CONCURRENT_REQUESTS = 3;


// Re-exported under the name this module's tests and callers already use. The value itself lives
// with the shared form, alongside everything else that defines what a review request is.
export const INITIAL_STATE = INITIAL_REVIEW_STATE;


// What may still be true when the response never reached the client. Deliberately different from the
// ACL path's hedge: an unwritten policy is checked by reopening the share dialog, but a review
// request that may or may not exist must NOT simply be retried, because the endpoint accepts the
// repeat and the reviewer ends up with it twice.
const NO_RESPONSE_HEDGE = 'The request may still have been created.';


const DEFAULT_API = { createWorklistRequest };


/** A one-line reason for a rejected review request. */
export const describeRequestFailure = (err) =>
  describeOperationFailure(err, { hedge: NO_RESPONSE_HEDGE });


export { isTransportFailure };


/**
 * Execute a prepared list of review-request operations.
 *
 * Every STUDY results in exactly one `onRecord` call and at most one POST, whatever the operation
 * list contains. De-duplication is on the StudyInstanceUID rather than on `operation.key`, because
 * the UID is what actually identifies a write here: a run assigns ONE reviewer, so (study, reviewer)
 * collapses to the study, and two operations carrying different keys for the same study would
 * otherwise both be posted while collapsing into a single line in the progress log -- one visible
 * request, two in the reviewer's worklist. `buildWorklistOperations` happens to key by UID, but this
 * loop states its own guarantee and must not depend on its caller to keep it.
 *
 * The guard matters more here than in the ACL path: the worklist endpoint ACCEPTS a repeat request
 * for the same study and reviewer rather than rejecting it as a duplicate, so nothing downstream
 * catches a doubled write.
 *
 * @param {Object}   options
 * @param {Object}   options.server      Active imaging server.
 * @param {Array}    options.operations  From `buildWorklistOperations`.
 * @param {number}   options.groupId     Group the requests are created in.
 * @param {number}   options.userId      Reviewer the requests are assigned to.
 * @param {Object}   [options.procedure] From `buildRequestedProcedure`; omitted when empty.
 * @param {Function} options.onRecord    Called once per study with a progress entry.
 * @param {Function} options.onSuccess   Called once per created request, for the audit log.
 * @param {Function} options.onFailure   Called once per failure, for the error notification.
 * @param {Object}   [options.api]       Injection seam for tests.
 * @returns {Promise<{total: number, created: number, failed: number}>}
 */
export const runBulkWorklist = async ({
  server,
  operations = [],
  groupId,
  userId,
  procedure,
  onRecord = () => {},
  onSuccess = () => {},
  onFailure = () => {},
  api = DEFAULT_API,
  concurrency = MAX_CONCURRENT_REQUESTS,
}) => {
  let created = 0;
  let failed = 0;

  const issued = new Set();

  const queue = operations.filter((operation) => {
    const uid = operation?.study?.StudyInstanceUID;

    if (!uid || issued.has(uid)) {
      return false;
    }

    issued.add(uid);
    return true;
  });

  const pending = [...queue];

  const worker = async () => {
    while (pending.length) {
      const { study } = pending.shift();
      const { StudyInstanceUID } = study;
      const studyLabel = describeStudy(study).title;

      // ONLY the write is guarded here. Reporting lives outside this try deliberately: with it
      // inside, anything that threw while recording a SUCCESSFUL request -- a logging call, a
      // progress callback -- would be caught and reported as "review not requested", telling the
      // user the request had not been created when it had. That exact defect was found and fixed in
      // the bulk-share loop; it is not being reintroduced here.
      let writeError = null;

      try {
        await api.createWorklistRequest({
          server,
          groupId,
          userId,
          StudyInstanceUID,
          State: INITIAL_STATE,
          Procedure: procedure,
        });
      } catch (err) {
        writeError = err || new Error('Unknown failure');
      }

      if (writeError) {
        failed += 1;
        reportSafely(onRecord, {
          key: StudyInstanceUID,
          label: studyLabel,
          status: 'failed',
          message: describeRequestFailure(writeError),
        }, 'Bulk review request');
        reportSafely(onFailure, { studyLabel, err: writeError, StudyInstanceUID }, 'Bulk review request');
      } else {
        created += 1;
        reportSafely(onRecord, {
          key: StudyInstanceUID,
          label: studyLabel,
          status: 'ok',
          message: undefined,
        }, 'Bulk review request');
        reportSafely(onSuccess, { studyLabel, StudyInstanceUID }, 'Bulk review request');
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, worker)
  );

  return { total: issued.size, created, failed };
};


export default runBulkWorklist;
