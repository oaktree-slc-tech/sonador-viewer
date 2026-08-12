// The bulk-share execution loop, extracted from useBulkShare so it can be exercised without React.
//
// This is the part that decides how many requests are issued, and "every policy was written twice"
// is precisely the defect that has to be provable in a test rather than argued about from a reading
// of the code. There is no React renderer in this repo's jest setup, so the loop takes its API
// surface as an injectable dependency and the hook becomes a thin wrapper -- the same split as
// describeRemoval, studyRowDescriptors and aclReconcile.

import {
  getAclGroups,
  getAclUsers,
  upsertAclGroup,
  upsertAclUser,
} from '../../../../../api/share';
import { describeStudy } from '../RemoveResourceConfirm/describeRemoval';

import { describeSubject, isUserSubject } from './bulkSharePlan';
import { buildPermissionPayload } from './permissionFields';


// How many studies are processed at once. Bounded for the same reason MAX_CONCURRENT_REMOVALS is
// in useRemoveResource: a fifty-study selection must not open a hundred simultaneous requests
// against the gateway. Recipients within one study are applied in order, so a study's policies are
// never half-written by two racing requests.
export const MAX_CONCURRENT_STUDIES = 3;


const DEFAULT_API = { getAclUsers, getAclGroups, upsertAclUser, upsertAclGroup };


/**
 * Invoke a reporting callback without letting it affect the run.
 *
 * The run's job is to write policies and say truthfully what happened. A notification service that
 * throws must not abort the remaining writes, and must not be mistaken for a write that failed --
 * it is reported to the console instead, where it is a bug in the caller rather than in the data.
 */
const _report = (callback, payload) => {
  try {
    callback(payload);
  } catch (err) {
    console.error('Bulk share: a progress callback threw; the ACL write itself was unaffected.', err);
  }
};


/**
 * The policy body for a write.
 *
 * Built field by field from the canonical list rather than by spreading the existing policy and
 * overwriting part of it. The spread was the bug: it carried every field of the old policy through,
 * so a write the UI described as replacing the policy in fact left the permissions the dialog did
 * not render untouched. Enumerating the fields means a permission the gateway gains cannot be
 * silently inherited; it will simply be absent until it is added to permissionFields.
 *
 * Now that all six permissions are editable this is a genuine whole-policy replacement -- nothing
 * is carried over from what is being replaced. The recipient id and the policy ID are attached by
 * the caller.
 */
const _policyBody = (permissions) => buildPermissionPayload(permissions);


/**
 * A one-line reason for a failed write, drawn from the gateway's validation payload when it sent
 * one.
 *
 * The plugin answers a rejected write with `{ errors: { <Field>: [{ code, message }] } }`, so the
 * field and code are the useful part -- "User: unique" says the policy already exists, "User:
 * required" says the payload was wrong. Falls back to the status alone.
 */
export const describeWriteFailure = (err) => {
  const entries = Object.entries(err?.json?.errors || {});

  if (entries.length) {
    const [field, messages] = entries[0];
    const first = (messages || [])[0];
    const detail = first?.code || first?.message || first;

    return `${field}: ${detail} (HTTP ${err.status})`;
  }

  if (err?.status) {
    return `Request failed (HTTP ${err.status}).`;
  }

  // No status at all means the response never reached JavaScript -- a network drop, or a response
  // the browser refused to expose because it carried no CORS headers. The distinction matters and
  // must not be flattened into "Request failed": the request may well have been applied on the
  // server, so telling the user their policy was not written would be wrong. `fetch` reports this
  // as a bare TypeError, which is why the message has to be quoted rather than a status read.
  return err?.message
    ? `No response from the server (${err.message}). The policy may still have been applied.`
    : 'Request failed.';
};


/** True when the failure is a transport/CORS failure rather than a response from the gateway. */
export const isTransportFailure = (err) => Boolean(err) && err.status === undefined;


/**
 * Existing policies for a study, indexed by recipient id, so the writes below can choose PUT over
 * POST. Fetched once per study rather than once per recipient.
 *
 * Keyed by String(id): the policy list carries ids lifted off the nested user/group object while
 * the recipients come from the directory search, and a numeric 5 missing a string '5' would send
 * an already-shared study down the create path on every run.
 */
const _loadExisting = async (api, server, StudyInstanceUID, { needUsers, needGroups }) => {
  // Only the lists that are actually needed. Both were read for every study regardless of who the
  // recipients were, so sharing with groups alone still issued a user-policy GET per study -- half
  // the reads in the run, for nothing, and noise in a network trace that reads like duplication.
  const [users, groups] = await Promise.all([
    needUsers ? api.getAclUsers(server, StudyInstanceUID) : Promise.resolve([]),
    needGroups ? api.getAclGroups(server, StudyInstanceUID) : Promise.resolve([]),
  ]);

  return {
    users: new Map((users || []).map((acl) => [String(acl.User), acl])),
    groups: new Map((groups || []).map((acl) => [String(acl.Group), acl])),
  };
};


/**
 * Apply one recipient's permissions to one study.
 *
 * Overwrite semantics: an existing policy for this recipient is PUT to exactly the permissions the
 * dialog specifies, so the whole selection ends up genuinely uniform. Merging would leave the user
 * with a claim ("these studies are now shared identically") that is not true.
 *
 * The pre-read snapshot decides PUT-vs-POST for the common case, but it is only a snapshot --
 * upsertAcl* recovers when it is wrong by retrying a duplicate-rejected POST as a PUT.
 */
const _applyOne = ({ api, server, StudyInstanceUID, subject, permissions, existing }) => {
  if (isUserSubject(subject)) {
    const current = existing.users.get(String(subject.id));

    return api.upsertAclUser(server, StudyInstanceUID, {
      ..._policyBody(permissions),
      User: subject.id,
      ID: current?.ID,
    });
  }

  const current = existing.groups.get(String(subject.id));

  return api.upsertAclGroup(server, StudyInstanceUID, {
    ..._policyBody(permissions, current),
    Group: subject.id,
    ID: current?.ID,
  });
};


/**
 * Execute a prepared list of share operations.
 *
 * Every operation results in exactly one `onRecord` call and at most one write, whatever the
 * operation list contains -- duplicates in it are skipped rather than issued.
 *
 * @param {Object}   options
 * @param {Object}   options.server      Active imaging server.
 * @param {Array}    options.operations  From `buildShareOperations`.
 * @param {Object}   options.permissions The four flags, applied uniformly.
 * @param {Function} options.onRecord    Called once per operation with a progress entry.
 * @param {Function} options.onSuccess   Called once per written policy, for the audit log.
 * @param {Function} options.onFailure   Called once per failure, for the error notification.
 * @param {Object}   [options.api]       Injection seam for tests.
 * @returns {Promise<{total: number, applied: number, failed: number}>}
 */
export const runBulkShare = async ({
  server,
  operations = [],
  permissions = {},
  onRecord = () => {},
  onSuccess = () => {},
  onFailure = () => {},
  api = DEFAULT_API,
  concurrency = MAX_CONCURRENT_STUDIES,
}) => {
  let applied = 0;
  let failed = 0;

  // Operation keys already issued in this run. Belt to the plan's braces: whatever produced a
  // duplicate, it is not written twice.
  const issued = new Set();

  // Grouped by study so each study's existing policies are fetched once and its recipients are
  // applied in sequence against that snapshot.
  const byStudy = new Map();

  operations.forEach((operation) => {
    const uid = operation.study?.StudyInstanceUID;

    if (!uid) {
      return;
    }

    if (!byStudy.has(uid)) {
      byStudy.set(uid, { study: operation.study, operations: [] });
    }

    byStudy.get(uid).operations.push(operation);
  });

  const queue = [...byStudy.values()];

  const worker = async () => {
    while (queue.length) {
      const { study, operations: studyOperations } = queue.shift();
      const { StudyInstanceUID } = study;
      const studyLabel = describeStudy(study).title;

      let existing;

      try {
        existing = await _loadExisting(api, server, StudyInstanceUID, {
          needUsers: studyOperations.some((o) => isUserSubject(o.subject)),
          needGroups: studyOperations.some((o) => !isUserSubject(o.subject)),
        });
      } catch (err) {
        // The study's current policies could not be read, so PUT-vs-POST cannot be decided. Its
        // recipients are all reported as failed rather than guessed at.
        studyOperations.forEach((operation) => {
          if (issued.has(operation.key)) {
            return;
          }

          issued.add(operation.key);
          failed += 1;
          onRecord({
            key: operation.key,
            label: `${describeSubject(operation.subject)} — ${studyLabel}`,
            status: 'failed',
            message: 'Existing permissions could not be read.',
          });
        });

        onFailure({ studyLabel, subjectLabel: null, err, StudyInstanceUID });
        continue;
      }

      for (const operation of studyOperations) {
        if (issued.has(operation.key)) {
          continue;
        }

        issued.add(operation.key);

        const subjectLabel = describeSubject(operation.subject);

        // ONLY the write is guarded here. Reporting lives outside this try deliberately: it used to
        // sit inside it, so anything that threw while recording a SUCCESSFUL write -- a logging
        // call, a progress callback -- was caught and reported as "Access policy not applied",
        // telling the user their policy had not been written when it had. A defect in the reporting
        // path must never be able to misdescribe the state of the data.
        let writeError = null;

        try {
          await _applyOne({
            api,
            server,
            StudyInstanceUID,
            subject: operation.subject,
            permissions,
            existing,
          });
        } catch (err) {
          writeError = err || new Error('Unknown failure');
        }

        if (writeError) {
          failed += 1;
          _report(onRecord, {
            key: operation.key,
            label: `${subjectLabel} — ${studyLabel}`,
            status: 'failed',
            message: describeWriteFailure(writeError),
          });
          _report(onFailure, { studyLabel, subjectLabel, err: writeError, StudyInstanceUID });
        } else {
          applied += 1;
          _report(onRecord, {
            key: operation.key,
            label: `${subjectLabel} — ${studyLabel}`,
            status: 'ok',
            message: undefined,
          });
          _report(onSuccess, { subjectLabel, studyLabel, StudyInstanceUID });
        }
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, byStudy.size)) }, worker)
  );

  return { total: issued.size, applied, failed };
};


export default runBulkShare;
