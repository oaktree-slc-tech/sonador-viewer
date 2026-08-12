// The ACL permission fields, in one place.
//
// Shared by the single-study share dialog and the bulk one so the two cannot drift: a checkbox
// present in one dialog and absent from the other is an access-control difference the user has no
// way to see.
//
// These are the six booleans the gateway's study AND series ACL endpoints accept. Verified in
// orthanc-sonador:
//
//   - `AuthExtendedValidationForm` (validation/auth.py) declares View, Modify, Remove, ACL,
//     CommentEdit and CommentView;
//   - both the study and the series routes bind `*AclExtendedValidationForm`, in the DICOMweb
//     registrations (web/dicomweb.py) and the native ones (auth/__init__.py). Study and series
//     therefore take an identical permission set, which is what lets one list serve both;
//   - PATIENT routes bind the plain `*AclValidationForm`, which has only the first four. Nothing in
//     the viewer edits patient ACLs today; anything that does must NOT reuse this list.
//
// The wire names come from `orthanc_auth_resourcejson` (db/helpers.py), which reads
// SONADOR_ACL_ATTRS_DEFAULT = ('view', 'modify', 'remove', 'acl', 'comment_edit', 'comment_view')
// and title-cases each, upper-casing anything containing "acl" -- giving View, Modify, Remove, ACL,
// CommentEdit, CommentView. `false` is serialised (only `None` is dropped), so an unchecked box
// round-trips rather than arriving absent.

/** Every permission the share dialogs expose, in presentation order. */
export const PERMISSION_IDS = [
  { label: 'View', id: 'View' },
  { label: 'Modify', id: 'Modify' },
  { label: 'Remove', id: 'Remove' },
  { label: 'Manage ACL', id: 'ACL' },
  { label: 'View Comments', id: 'CommentView' },
  { label: 'Edit Comments', id: 'CommentEdit' },
];


/** All flags off -- the starting state of the bulk dialog and of a newly added recipient. */
export const emptyPermissions = () =>
  PERMISSION_IDS.reduce((acc, { id }) => ({ ...acc, [id]: false }), {});


/**
 * The permission payload for a write.
 *
 * Every field is written explicitly from the dialog's state, so a policy ends up exactly as shown.
 * Built from this list rather than by spreading the policy being replaced: the spread silently
 * carried through whatever the old policy held for anything not overwritten, which is how comment
 * permissions once survived a write the UI called a replacement.
 */
export const buildPermissionPayload = (permissions = {}) =>
  PERMISSION_IDS.reduce((acc, { id }) => ({ ...acc, [id]: Boolean(permissions[id]) }), {});


export default PERMISSION_IDS;
