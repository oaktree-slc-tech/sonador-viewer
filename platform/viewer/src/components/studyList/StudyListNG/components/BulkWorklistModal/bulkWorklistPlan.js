// Planning and phrasing for a bulk review request.
//
// Pure, and separate from the component and the orchestration hook, for the same reason
// bulkSharePlan.js is: this decides how many worklist items get created and what the user is told
// they are about to do, and this repo's jest setup has no React renderer. A bulk action that creates
// more review requests than the dialog claimed is the defect worth a test.
//
// What a review request IS -- the group, the reviewer, the optional procedure facet and the rules
// for changing them -- lives in worklistRequest/worklistRequestForm, shared with the per-study
// dialog. Only the bulk-specific part is here.

import { dedupeStudies } from '../bulkAction/bulkStudies';
import {
  buildRequestedProcedure,
  describeGroup,
  describeMember,
} from '../worklistRequest/worklistRequestForm';


export { describeGroup, describeMember };


/**
 * Expand a selection of studies into the flat list of worklist creations that will be issued, one
 * per study.
 *
 * Unlike a bulk share there is no second axis: a run assigns ONE reviewer, so the operation count is
 * the study count. Studies with no UID and duplicate UIDs are dropped here so the count the dialog
 * quotes is the count that actually gets issued -- a duplicated study would otherwise create two
 * identical review requests for the same reviewer, which the worklist has no way to tell apart.
 */
export const buildWorklistOperations = ({ studies = [] } = {}) =>
  dedupeStudies(studies).map((study) => ({ key: study.StudyInstanceUID, study }));


const _plural = (count, singular, plural) => `${count} ${count === 1 ? singular : plural}`;


/**
 * The sentence the dialog shows above the create button.
 *
 * States the reviewer, the group and the number of requests, because the last is the one that is
 * easily got wrong: the selection is made in a table that can be filtered and paged under the user's
 * feet, and "12 studies selected" is the assertion this dialog is asking them to commit to.
 *
 * @param {Object} options.studies Study descriptors.
 * @param {Object} options.form    Form state from worklistRequestForm.
 */
export const describeBulkWorklistIntent = ({ studies = [], form = {} } = {}) => {
  const operations = buildWorklistOperations({ studies });
  const { group, member } = form;

  return {
    summary: member
      ? `${describeMember(member)} will be asked to review ` +
        `${_plural(operations.length, 'study', 'studies')}.`
      : `${_plural(operations.length, 'study', 'studies')} selected.`,
    detail: group
      ? `Requests are created in ${describeGroup(group)}.`
      : 'Select a group and a reviewer to continue.',
    // Spelled out rather than left implicit: a reason typed into a bulk dialog is applied to every
    // request in the run, and a reason that only makes sense for one of the studies is the mistake
    // this line exists to catch before it is written twelve times.
    note: buildRequestedProcedure(form)
      ? 'The reason and requested procedure below are applied identically to every request.'
      : undefined,
    total: operations.length,
  };
};


/** "12 of 12 review requests created" -- always states both numbers, matching bulk share. */
export const summariseBulkWorklist = ({ created = 0, total = 0 } = {}) =>
  `${created} of ${total} ${total === 1 ? 'review request' : 'review requests'} created`;
