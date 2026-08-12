// Naming the party an ACL policy grants access to.
//
// Shared by the single-study share dialog and the bulk share dialog so a group reads the same way
// in a revoke notification, a progress line and a confirmation. Pure, and tested: "the toast named
// the wrong group" is exactly the kind of defect that makes an access-control change untrustworthy.
//
// Policies reach the UI in two shapes. Search results carry `result-type`/`name`/`username`, while
// policies loaded from the server have been flattened by api/share.js, which lifts `first_name`,
// `last_name`, `email` and `name` onto the root. Both are handled here rather than at each call
// site.


/** True when the policy grants access to a user rather than to a group. */
export const isUserAcl = (acl = {}) =>
  acl['result-type'] === 'user' || acl.User !== undefined || acl.user !== undefined;


/**
 * A short human label for the user or group a policy applies to.
 *
 * Falls back through the identifiers each shape might carry and ends at the raw id, so a policy
 * with no display fields still produces something the user can match against the row in front of
 * them instead of "undefined".
 */
export const describeAclSubject = (acl = {}) => {
  if (!isUserAcl(acl)) {
    return acl.name || acl.label_group || (acl.Group !== undefined ? `Group ${acl.Group}` : 'this group');
  }

  const fullName = [acl.first_name, acl.last_name].filter(Boolean).join(' ').trim();

  return (
    fullName ||
    acl.username ||
    acl.email ||
    acl.label_user ||
    (acl.User !== undefined ? `User ${acl.User}` : 'this user')
  );
};


export default describeAclSubject;
