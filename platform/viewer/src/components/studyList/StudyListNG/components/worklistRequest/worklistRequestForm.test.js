// Transitions of the shared review-request form.
//
// The reported defect these exist for: selecting a group stored its id, and editing the text
// afterwards left that id in place. The submit button stayed enabled, so a user who picked
// "Radiology", typed over it looking for "Cardiology" and submitted without re-picking sent the whole
// batch to Radiology while the field read "Cardiology". These pin the rule that fixes it -- an id
// only ever comes from an explicit pick -- rather than leaving it to be re-derived from the
// component.

import {
  buildRequestedProcedure,
  canSubmitWorklistRequest,
  describeGroup,
  describeMember,
  emptyWorklistRequest,
  filterMembership,
  withGroupSelected,
  withGroupTerm,
  withMemberSelected,
  withMemberTerm,
  withProcedure,
  withReason,
} from './worklistRequestForm';


const group = (id, overrides = {}) => ({ id, name: `Group ${id}`, ...overrides });
const member = (id, overrides = {}) => ({ id, first_name: 'Ada', last_name: 'Lovelace', ...overrides });

/** A form with a group and a reviewer both chosen, which is the state the bug lived in. */
const chosen = () =>
  withMemberSelected(withGroupSelected(emptyWorklistRequest(), group(1)), member(2));


describe('an id only ever comes from an explicit pick', () => {
  it('is not submittable until both a group and a reviewer have been picked', () => {
    const empty = emptyWorklistRequest();

    expect(canSubmitWorklistRequest(empty)).toBe(false);
    expect(canSubmitWorklistRequest(withGroupSelected(empty, group(1)))).toBe(false);
    expect(canSubmitWorklistRequest(chosen())).toBe(true);
  });

  it('drops the chosen group when the group text is edited', () => {
    const next = withGroupTerm(chosen(), 'Cardio');

    expect(next.group).toBeNull();
    expect(next.groupTerm).toBe('Cardio');
    expect(canSubmitWorklistRequest(next)).toBe(false);
  });

  it('drops the chosen reviewer too, because the reviewer list is scoped to the group', () => {
    // Not merely stale: a reviewer from the old group is a (group, user) pair the gateway rejects.
    const next = withGroupTerm(chosen(), 'Cardio');

    expect(next.member).toBeNull();
    expect(next.memberTerm).toBe('');
  });

  it('drops the chosen reviewer when the reviewer text is edited', () => {
    const next = withMemberTerm(chosen(), 'Grace');

    expect(next.member).toBeNull();
    expect(next.memberTerm).toBe('Grace');
    expect(next.group).toEqual(group(1));
    expect(canSubmitWorklistRequest(next)).toBe(false);
  });

  it('clears a previously chosen reviewer when a different group is picked', () => {
    const next = withGroupSelected(chosen(), group(9));

    expect(next.group).toEqual(group(9));
    expect(next.member).toBeNull();
    expect(next.memberTerm).toBe('');
  });

  it('restores submittability once a reviewer is picked again', () => {
    const edited = withGroupTerm(chosen(), 'Cardio');
    const repicked = withMemberSelected(withGroupSelected(edited, group(9)), member(4));

    expect(canSubmitWorklistRequest(repicked)).toBe(true);
    expect(repicked.group.id).toBe(9);
    expect(repicked.member.id).toBe(4);
  });

  it('does not consider text that merely looks like a group to be a group', () => {
    const typed = withGroupTerm(emptyWorklistRequest(), 'Group 1');

    expect(typed.group).toBeNull();
    expect(canSubmitWorklistRequest(typed)).toBe(false);
  });
});


describe('search terms follow the selection', () => {
  it('fills the field with the picked group and reviewer names', () => {
    const state = chosen();

    expect(state.groupTerm).toBe('Group 1');
    expect(state.memberTerm).toBe('Ada Lovelace');
  });

  it('never writes undefined into a controlled input', () => {
    // getDisplayName returns undefined for a member with no name, email or username; feeding that
    // back into the field would flip it from controlled to uncontrolled.
    const nameless = { id: 7 };
    const state = withMemberSelected(emptyWorklistRequest(), nameless);

    expect(state.memberTerm).toBe('User 7');
  });

  it('preserves the reason and procedure across a group change', () => {
    const withText = withProcedure(withReason(chosen(), 'Second opinion'), 'CT Chest');
    const next = withGroupTerm(withText, 'Cardio');

    expect(next.reason).toBe('Second opinion');
    expect(next.procedure).toBe('CT Chest');
  });
});


describe('describeGroup / describeMember', () => {
  it('never returns undefined', () => {
    expect(describeGroup(group(2))).toBe('Group 2');
    expect(describeGroup({ id: 5 })).toBe('Group 5');
    expect(describeGroup(null)).toBe('');
    expect(describeMember(member(1))).toBe('Ada Lovelace');
    expect(describeMember(member(9, { first_name: undefined, last_name: undefined }))).toBe('User 9');
    expect(describeMember(null)).toBe('');
  });

  it('falls back through email for a member with no name', () => {
    expect(
      describeMember(member(1, { first_name: undefined, last_name: undefined, email: 'ada@example.org' }))
    ).toBe('ada@example.org');
  });
});


describe('buildRequestedProcedure', () => {
  it('omits the facet entirely when neither field is filled in', () => {
    expect(buildRequestedProcedure()).toBeUndefined();
    expect(buildRequestedProcedure(emptyWorklistRequest())).toBeUndefined();
  });

  it('treats whitespace-only input as absent', () => {
    expect(buildRequestedProcedure({ reason: '   ', procedure: '\n\t' })).toBeUndefined();
  });

  it('includes only the fields that were filled in, trimmed', () => {
    expect(buildRequestedProcedure({ reason: '  Second opinion  ' })).toEqual({
      RequestedProcedure: { ReasonForTheRequestedProcedure: 'Second opinion' },
    });
    expect(buildRequestedProcedure({ procedure: 'CT Chest' })).toEqual({
      RequestedProcedure: { RequestedProcedureDescription: 'CT Chest' },
    });
  });

  it('carries both fields when both are given', () => {
    expect(buildRequestedProcedure({ reason: 'Second opinion', procedure: 'CT Chest' })).toEqual({
      RequestedProcedure: {
        ReasonForTheRequestedProcedure: 'Second opinion',
        RequestedProcedureDescription: 'CT Chest',
      },
    });
  });
});


describe('filterMembership', () => {
  const members = [
    member(1),
    member(2, { first_name: 'Grace', last_name: 'Hopper' }),
    member(3, { first_name: undefined, last_name: undefined, email: 'kat@example.org' }),
  ];

  it('returns everything for an empty term', () => {
    expect(filterMembership(members, '')).toHaveLength(3);
    expect(filterMembership(members)).toHaveLength(3);
  });

  it('matches case-insensitively', () => {
    // The per-study dialog compared raw substrings, so typing a surname in the case it is displayed
    // in filtered the list down to nothing.
    expect(filterMembership(members, 'hopper')).toHaveLength(1);
    expect(filterMembership(members, 'HOPPER')).toHaveLength(1);
    expect(filterMembership(members, 'Hopper')).toHaveLength(1);
  });

  it('matches on email and on the composed display name', () => {
    expect(filterMembership(members, 'kat@')).toHaveLength(1);
    expect(filterMembership(members, 'Ada Love')).toHaveLength(1);
  });

  it('tolerates a missing list', () => {
    expect(filterMembership(undefined, 'x')).toEqual([]);
  });
});
