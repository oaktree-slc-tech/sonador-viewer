// Planning and phrasing for a bulk share (ohif-viewers: bulk ACL editing).
//
// Pure, and separate from the component and the orchestration hook, for the same reason
// describeRemoval.js is: this decides how many policies get written and what the user is told they
// are agreeing to, and this repo's jest setup has no React renderer. An access-control change that
// silently touches more studies than the confirmation claimed is the defect worth a test.

import { dedupeStudies } from '../bulkAction/bulkStudies';

import { PERMISSION_IDS } from './permissionFields';


/**
 * Stable key for a share target (a user or a group).
 *
 * Namespaced by kind: a user and a group can carry the same numeric id, and collapsing them would
 * make the dialog drop one of the two.
 */
export const subjectKeyOf = (subject = {}) =>
  `${subject['result-type'] === 'user' ? 'user' : 'group'}:${subject.id}`;


/** True when the share target is a user rather than a group. */
export const isUserSubject = (subject = {}) => subject['result-type'] === 'user';


/** A short human label for a search-result share target. */
export const describeSubject = (subject = {}) => {
  if (!isUserSubject(subject)) {
    return subject.name || subject.label_group || `Group ${subject.id}`;
  }

  const fullName = [subject.first_name, subject.last_name].filter(Boolean).join(' ').trim();

  return fullName || subject.username || subject.email || `User ${subject.id}`;
};


/**
 * Expand a selection of studies and a selection of share targets into the flat list of ACL writes
 * that will be issued, one per (study, target) pair.
 *
 * Study-major, so the progress log reads as a walk down the list of studies the user selected
 * rather than jumping between them. Studies with no UID and duplicate targets are dropped here so
 * the count the confirmation quotes is the count that actually gets issued.
 */
export const buildShareOperations = ({ studies = [], subjects = [] } = {}) => {
  const seenSubjects = new Set();
  const uniqueSubjects = subjects.filter((subject) => {
    const key = subjectKeyOf(subject);

    if (seenSubjects.has(key)) {
      return false;
    }

    seenSubjects.add(key);
    return true;
  });

  // Studies are de-duplicated too. Only the recipients were, which left the study side of the
  // pairing able to double the whole run: a selection that yields the same StudyInstanceUID twice
  // produced two writes per recipient, and the second was rejected by the gateway as a duplicate.
  // Nothing downstream should have to assume the caller handed over a clean list. Shared with the
  // worklist plan and with the dialogs' own study list, so all three agree on what the selection is.
  const uniqueStudies = dedupeStudies(studies);

  const operations = [];
  // Final guard on the pairing itself, so `key` is genuinely unique whatever the inputs did --
  // it is what the executor de-duplicates issued writes by, and what React keys the progress log
  // on.
  const seenPairs = new Set();

  uniqueStudies.forEach((study) => {
    uniqueSubjects.forEach((subject) => {
      const key = `${study.StudyInstanceUID}::${subjectKeyOf(subject)}`;

      if (seenPairs.has(key)) {
        return;
      }

      seenPairs.add(key);
      operations.push({ key, study, subject });
    });
  });

  return operations;
};


/**
 * The permissions being granted, as a readable list.
 *
 * "No permissions" is deliberately spelled out rather than rendered as an empty string: applying a
 * policy that grants nothing is a legitimate way to strip access under overwrite semantics, and the
 * confirmation has to be able to say so.
 */
export const summarisePermissions = (permissions = {}) => {
  const granted = PERMISSION_IDS.filter(({ id }) => permissions[id]).map(({ label }) => label);

  return granted.length ? granted.join(', ') : 'No permissions';
};


const _plural = (count, singular, plural) => `${count} ${count === 1 ? singular : plural}`;


/**
 * The sentence the confirmation step asks the user to agree to.
 *
 * States all three magnitudes -- studies, recipients, and the resulting number of policies --
 * because the third is the one that surprises people: ten studies and three groups is thirty
 * writes, not three.
 */
export const describeBulkShareIntent = ({ studies = [], subjects = [], permissions = {} } = {}) => {
  const operations = buildShareOperations({ studies, subjects });
  // De-duplicated, like the operation count beside it: quoting the raw selection size here would
  // claim more studies than the run touches whenever the selection repeats one.
  const affected = dedupeStudies(studies);

  return {
    heading: 'Apply these permissions?',
    summary:
      `${summarisePermissions(permissions)} will be granted to ` +
      `${_plural(subjects.length, 'recipient', 'recipients')} on ` +
      `${_plural(affected.length, 'study', 'studies')}.`,
    detail: `This writes ${_plural(operations.length, 'access policy', 'access policies')}.`,
    // Overwrite semantics. Every permission the gateway stores is editable in this dialog, so this
    // is a genuine whole-policy replacement: a recipient who currently has more access than is set
    // here loses the difference, and nothing is silently carried over. An earlier version exposed
    // only four of the six and claimed a blanket replacement, which was untrue of the other two.
    warning:
      'Recipients who already have access to any of these studies will have their existing ' +
      'permissions replaced entirely with the ones set here, including any not selected.',
    total: operations.length,
  };
};


/** "24 of 24 access policies applied" -- always states both numbers, matching bulk removal. */
export const summariseBulkShare = ({ applied = 0, total = 0 } = {}) =>
  `${applied} of ${total} ${total === 1 ? 'access policy' : 'access policies'} applied`;
