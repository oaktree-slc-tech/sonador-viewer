// The state of a "request a review" form, as pure transitions.
//
// One copy, shared by the per-study dialog (CreateWorklistModal) and the bulk one
// (BulkWorklistModal), because the two forms ask for exactly the same four things and a divergence
// between them is invisible until someone's request goes to the wrong reviewer.
//
// Pure and separate from React because the transitions are where this form can be got dangerously
// wrong, and this repo's jest setup has no React renderer. The specific danger, and the reason this
// module exists at all:
//
//   Selecting a group stores its id; editing the text afterwards used to leave that id in place. So
//   a user who picked "Radiology", then typed over it to look for "Cardiology" and submitted without
//   re-picking, sent the whole batch to Radiology while the field on screen read "Cardiology". The
//   submit button stayed enabled throughout, because it checked the stored id and the stored id was
//   still there. Every transition below that changes a search term therefore CLEARS the selection it
//   belongs to: an id may only ever come from an explicit pick.

import { getDisplayName } from '../../../../../lib/getDisplayName';


// The state a newly requested review is created in. Shared so a request created in bulk is
// indistinguishable from one created study by study -- if these diverged, the worklist's status
// filters would treat the two paths differently.
export const INITIAL_REVIEW_STATE = 'Scheduled';


/** A short human label for the group a request is created in. */
export const describeGroup = (group) => {
  if (!group) {
    return '';
  }

  return group.name || `Group ${group.id}`;
};


/**
 * A short human label for the reviewer a request is assigned to.
 *
 * Guarded, unlike getDisplayName on its own: that dereferences its argument, and both dialogs render
 * this label from the moment they open -- before a reviewer has been picked. It also falls back to
 * the id, because getDisplayName returns undefined for a member carrying no name, email or username,
 * and feeding undefined back into a controlled input flips it to uncontrolled.
 */
export const describeMember = (member) => {
  if (!member) {
    return '';
  }

  return getDisplayName(member) || `User ${member.id}`;
};


/** A form nobody has touched yet. */
export const emptyWorklistRequest = () => ({
  groupTerm: '',
  group: null,
  memberTerm: '',
  member: null,
  reason: '',
  procedure: '',
});


/**
 * The user typed in the group field.
 *
 * Clears the group AND the reviewer. The reviewer list is scoped to the group, so a reviewer chosen
 * under the old group is not merely stale, it is a (group, user) pair the gateway rejects.
 */
export const withGroupTerm = (state, groupTerm) => ({
  ...state,
  groupTerm,
  group: null,
  member: null,
  memberTerm: '',
});


/** The user picked a group from the suggestions. The only way a group id enters the form. */
export const withGroupSelected = (state, group) => ({
  ...state,
  group,
  groupTerm: describeGroup(group),
  member: null,
  memberTerm: '',
});


/** The user typed in the reviewer field. Clears the reviewer, for the reason given at the top. */
export const withMemberTerm = (state, memberTerm) => ({
  ...state,
  memberTerm,
  member: null,
});


/** The user picked a reviewer. The only way a user id enters the form. */
export const withMemberSelected = (state, member) => ({
  ...state,
  member,
  memberTerm: describeMember(member),
});


export const withReason = (state, reason) => ({ ...state, reason });


export const withProcedure = (state, procedure) => ({ ...state, procedure });


/**
 * Is the form complete enough to submit?
 *
 * Reads the stored objects rather than the search text: an id is what gets posted, and text that
 * merely looks like a group name is not a group.
 */
export const canSubmitWorklistRequest = (state = {}) =>
  Boolean(state.group?.id && state.member?.id);


/**
 * The optional RequestedProcedure facet.
 *
 * Empty and whitespace-only inputs are omitted; if neither field is filled in, no Procedure block is
 * sent at all. Shared so a request created in bulk is indistinguishable on the wire from one created
 * study by study.
 */
export const buildRequestedProcedure = (state = {}) => {
  const reason = (state.reason || '').trim();
  const description = (state.procedure || '').trim();

  const requested = {
    ...(reason ? { ReasonForTheRequestedProcedure: reason } : {}),
    ...(description ? { RequestedProcedureDescription: description } : {}),
  };

  return Object.keys(requested).length ? { RequestedProcedure: requested } : undefined;
};


/**
 * Narrow a group's membership by what the user has typed.
 *
 * On top of the server's own `term` filter, which is why this tolerates an empty term.
 * Case-insensitive: the per-study dialog compared raw substrings, so typing a surname in the case it
 * is displayed in filtered the list down to nothing.
 */
export const filterMembership = (members = [], term = '') => {
  if (!term) {
    return members || [];
  }

  const needle = term.toLowerCase();

  return (members || []).filter((member) =>
    [member.first_name, member.last_name, member.email, getDisplayName(member)]
      .some((field) => (field || '').toLowerCase().includes(needle))
  );
};
