// React binding for the shared review-request form.
//
// Owns the two directory searches, the two suggestion popups and their dismissal, and hands back a
// single bundle that WorklistRequestFields renders. The state transitions themselves live in
// worklistRequestForm so they can be tested without a renderer.

import { useCallback, useMemo, useRef, useState } from 'react';

import useClickOutside from '../../../../../hooks/useClickOutside';
import { useGroupMembership, useGroupSearch } from '../../../../../queries/worklist';

import {
  buildRequestedProcedure,
  canSubmitWorklistRequest,
  emptyWorklistRequest,
  filterMembership,
  withGroupSelected,
  withGroupTerm,
  withMemberSelected,
  withMemberTerm,
  withProcedure,
  withReason,
} from './worklistRequestForm';


export default function useWorklistRequestForm(server) {
  const [form, setForm] = useState(emptyWorklistRequest);

  const [showGroups, setShowGroups] = useState(false);
  const [showMembers, setShowMembers] = useState(false);

  const groupRef = useRef(null);
  const memberRef = useRef(null);

  // Stable callbacks: useClickOutside lists its callback in the effect deps, so an inline arrow
  // would tear down and re-register the document listener on every keystroke.
  useClickOutside(groupRef, useCallback(() => setShowGroups(false), []));
  useClickOutside(memberRef, useCallback(() => setShowMembers(false), []));

  const { data: groups = [] } = useGroupSearch(server, form.groupTerm);
  const { data: members = [] } = useGroupMembership({
    server,
    enabled: !!form.group,
    groupId: form.group?.id,
    term: form.memberTerm,
  });

  const filteredMembers = useMemo(
    () => filterMembership(members, form.memberTerm),
    [members, form.memberTerm]
  );

  const fields = {
    form,

    groupRef,
    groups,
    showGroups,
    onGroupFocus: () => setShowGroups(true),
    onGroupTermChange: (term) => {
      setShowGroups(true);
      setForm((prev) => withGroupTerm(prev, term));
    },
    onGroupSelect: (group) => {
      setShowGroups(false);
      // Opened straight away: picking a group is always followed by picking a reviewer, and the
      // membership list is already loading by the time the popup renders.
      setShowMembers(true);
      setForm((prev) => withGroupSelected(prev, group));
    },

    memberRef,
    members: filteredMembers,
    showMembers,
    onMemberFocus: () => setShowMembers(true),
    onMemberTermChange: (term) => {
      setShowMembers(true);
      setForm((prev) => withMemberTerm(prev, term));
    },
    onMemberSelect: (member) => {
      setShowMembers(false);
      setForm((prev) => withMemberSelected(prev, member));
    },

    onReasonChange: (reason) => setForm((prev) => withReason(prev, reason)),
    onProcedureChange: (procedure) => setForm((prev) => withProcedure(prev, procedure)),
  };

  return {
    form,
    fields,
    canSubmit: canSubmitWorklistRequest(form),
    procedure: buildRequestedProcedure(form),
  };
}
