// Reconciliation between the ACL policies the server reports and the ones on screen.
//
// The share dialog holds an editable copy of each policy list so permission checkboxes can be
// toggled before anything is written. That copy was previously replaced wholesale every time the
// react-query data changed:
//
//   useEffect(() => { if (aclGroups) setGroupsWithAccess(aclGroups); }, [aclGroups]);
//
// which fought every other update. Deleting a policy filtered it out of the local list optimistically
// and the next refetch put it straight back; toggling a checkbox and then touching anything that
// invalidated the query silently discarded the toggle.
//
// Pure and separate from the component because this is the logic that can be got wrong, and this
// repo's jest setup has no React renderer -- same reasoning as describeRemoval.js next door.


import { PERMISSION_IDS } from '../BulkShareModal/permissionFields';


/**
 * Stable identity for a policy across a refetch.
 *
 * Not the policy's `ID`: a policy that has been selected from the search box but not yet saved has
 * no ID at all, and it still has to match the row the server sends back once it is created.
 */
export const aclKeyOf = (acl = {}) =>
  acl.User !== undefined && acl.User !== null ? `user:${acl.User}` : `group:${acl.Group}`;


// The flags the dialogs let a user change. Taken from the canonical list rather than repeated, so
// this cannot drift from what the checkboxes actually render. CommentEdit/CommentView are absent
// on purpose: neither dialog edits them, so the server's value always wins for those.
const EDITABLE_FIELDS = PERMISSION_IDS.map(({ id }) => id);


/**
 * Does this policy differ from what the server holds?
 *
 * The single definition of "changed" for the share dialog. It decides three things that MUST agree:
 * whether Save is offered, which rows get written when Save is pressed, and whether a row's local
 * values survive a refetch. They used to be decided separately -- an `isUpdated` flag asserted on
 * every keystroke, and a field comparison done at save time -- so toggling a permission and putting
 * it back left the row flagged dirty while producing no save task. Save stayed lit forever and
 * pressing it wrote nothing while reporting success.
 *
 * A policy with no server counterpart is dirty by definition: it is a pending addition from the
 * search box that has never been written.
 */
export const isPolicyDirty = (local = {}, server = undefined) => {
  if (!server) {
    return true;
  }

  return EDITABLE_FIELDS.some((field) => Boolean(local[field]) !== Boolean(server[field]));
};


/**
 * Recompute `isUpdated` for every policy against what the server holds.
 *
 * Call this after ANY local mutation. `isUpdated` is then never asserted, only derived, which is
 * what makes the toggle-and-restore case correct without special-casing it.
 *
 * Rows whose flag is already right are returned by reference so React sees no change.
 */
export const markDirtyPolicies = (list = [], serverList = []) => {
  const byKey = new Map((serverList || []).map((acl) => [aclKeyOf(acl), acl]));

  return (list || []).map((acl) => {
    const dirty = isPolicyDirty(acl, byKey.get(aclKeyOf(acl)));

    return Boolean(acl.isUpdated) === dirty ? acl : { ...acl, isUpdated: dirty };
  });
};


/**
 * Fold a freshly fetched policy list into the list currently on screen.
 *
 * The server is authoritative about *membership* -- which policies exist -- and the local copy is
 * authoritative about *unsaved edits*. Concretely:
 *
 *  - a policy the server no longer reports is dropped, which is what makes a delete stick;
 *  - a policy both sides know about keeps its server identity and display fields, but retains the
 *    local permission flags when the user has edited them (`isUpdated`);
 *  - a policy the server reports and the local list has not seen is added, so a grant made in
 *    another tab appears rather than being invisible until reload;
 *  - a local policy with no `ID` is a pending addition from the search box and is preserved, since
 *    the server cannot yet know about it.
 *
 * @param {Array<Object>} serverList Policies as returned by getAclUsers / getAclGroups.
 * @param {Array<Object>} localList  The editable copy currently rendered.
 * @returns {Array<Object>} The list to render.
 */
export const reconcileAclList = (serverList = [], localList = []) => {
  const local = new Map((localList || []).map((acl) => [aclKeyOf(acl), acl]));

  const reconciled = (serverList || []).map((serverAcl) => {
    const key = aclKeyOf(serverAcl);
    const localAcl = local.get(key);

    // Consumed, so the pending-additions pass below does not re-append it.
    local.delete(key);

    if (!localAcl || !localAcl.isUpdated) {
      return serverAcl;
    }

    // Edited locally: the server row supplies identity and display fields (it is the one that
    // knows the policy's ID, which the save path needs to choose PUT over POST), the local row
    // supplies the permission flags the user has been toggling.
    return {
      ...serverAcl,
      ...EDITABLE_FIELDS.reduce((acc, field) => ({ ...acc, [field]: localAcl[field] }), {}),
      isUpdated: true,
    };
  });

  // Whatever is left in `local` has no counterpart on the server. Unpersisted additions are kept;
  // anything carrying an ID was a policy the server has since dropped, so it goes.
  local.forEach((acl) => {
    if (!acl.ID) {
      reconciled.push(acl);
    }
  });

  // Re-derived against the list that just arrived, so a refetch cannot leave a flag asserting a
  // change that is no longer a change -- most obviously right after a save, when the server has
  // caught up with the edit.
  return markDirtyPolicies(reconciled, serverList);
};


// There is deliberately no `clearSavedFlags` here any more. An earlier version cleared the dirty
// flag for the rows whose write succeeded, which fixed the "successful save stays dirty" symptom
// but reintroduced the underlying problem: a second place deciding what "changed" means. Dirtiness
// is now derived from the server state alone, so a saved row goes clean because the server agrees
// with it, and a row whose write failed stays dirty because the server does not -- no bookkeeping,
// and no way for the flag and the save set to disagree.

export default reconcileAclList;
