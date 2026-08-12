import _, { extend, pick } from 'lodash';

import { urlUtil } from '@ohif/core/src/utils';

import { getAuthToken, sonadorUrl } from './sonador';


// Failure shape shared by every write in this module, matching `ext.js`'s removal errors so the
// notification helpers can attach the request URL, the HTTP status and the response body to the
// Issues list without special-casing ACL failures.
const _aclError = async (message, url, response) => {
  // Body read as text, not JSON: a gateway 502 answers in HTML, and a parse failure inside the
  // error path would replace a diagnosable failure with an unrelated one.
  let body;
  try {
    body = await response.text();
  } catch (err) {
    body = undefined;
  }

  const error = new Error(`${message} (HTTP ${response.status})`);
  error.url = url;
  error.status = response.status;
  error.body = body;

  // Parsed alongside the raw text, never instead of it: the duplicate-policy handling below reads
  // structured fields out of the gateway's validation payload, while the notifications still want
  // the body verbatim.
  try {
    error.json = body ? JSON.parse(body) : undefined;
  } catch (err) {
    error.json = undefined;
  }

  return error;
};


// The Sonador cloud plugin rejects a POST that would duplicate an existing ACL policy rather than
// silently updating it. `UserAclValidationMixin.clean` / `GroupAclValidationMixin.clean` in
// orthanc-sonador query for a policy matching (resource, user|group) and, when one exists, raise a
// pydantic validation error with type `VALIDATION_APICODE_DUPLICATE` -- which resolves to the
// literal 'unique'. `ObjectManagementView.post` turns any validation error into
// `error_status_code`, which is 400. So a duplicate looks like:
//
//   HTTP 400
//   { "status": "fail",
//     "errors": { "User": [ { "field": "User", "code": "unique", "message": "..." } ] },
//     "object-data": { "ID": "<uuid of the existing policy>" } }
//
// The plugin attaches the existing policy's UID as `object-data.ID` (validation/auth.py sets
// `obj_data` on both the user and group paths), so a retry can go straight to PUT without
// re-reading the list. 401/403/404 are NOT this and must stay hard failures.
const DUPLICATE_CODE = 'unique';


/**
 * True when a create failed only because the policy already exists.
 *
 * The uniqueness code is REQUIRED, not merely one of two accepted signals. An earlier version also
 * treated the presence of `object-data.ID` as proof of a duplicate, which is too loose: any 400
 * that happened to carry an object id would have been converted into a PUT, silently overwriting a
 * policy in response to an unrelated validation failure. `object-data` tells us WHICH policy to
 * update; only the `unique` code tells us that updating is the right thing to do at all.
 *
 * Entries are `{ field, code, message, input }` (validation/base.err2msg), and the duplicate path in
 * the plugin always sets the code, so nothing is lost by insisting on it.
 */
export const isDuplicateAclError = (err) => {
  if (!err || err.status !== 400 || !err.json) {
    return false;
  }

  return Object.values(err.json.errors || {}).some((entries) =>
    (entries || []).some((entry) => (entry?.code ?? entry) === DUPLICATE_CODE)
  );
};


/** The existing policy's ID from a duplicate-create failure, when the gateway supplied it. */
export const duplicateAclPolicyId = (err) => err?.json?.['object-data']?.ID;


export const getAclUsers = (server, studyId) => {
  // Retrieve user authorization policies for provided server and study UID via
  // Orthanc DICOMweb ext API.

  return fetch(urlUtil.urlJoin(server.wadoRoot, 'studies', studyId, 'acl', 'user'), {
    headers: { Authorization: `Bearer ${getAuthToken()}` },
  })
    .then((res) => res.json())
    .then((res) => {
      // Modify API response so that rather than a nested object, user details are
      // available at the root of JSON.
      return res.map((p) => {
        p.user = p.user || p.User || {};

        // Move user properties to root of response
        p.User = p.user.id;
        extend(p, pick(p.user, ['username', 'email', 'first_name', 'last_name']));
        return p;
      });
    });
};


export const createAclUser = async (server, studyId, newUser, options) => {
  // Create a user ACL policy
  options = options || {};

  const url = urlUtil.urlJoin(server.wadoRoot, 'studies', studyId, 'acl', 'user');
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getAuthToken()}` },
    body: JSON.stringify(newUser),
  });

  if (!response.ok) {
    throw await _aclError('Failed to create ACL user', url, response);
  }

  // Parse response to JSON and trigger callbacks
  const _json = await response.json();
  if (options && _.isFunction(options.success)) {
    options.success(_json, { server, StudyInstanceUID: studyId, payload: newUser, });
  }
  
  return _json;
};


export const updateAclUser = async (server, studyId, user, options) => {
  // Update the provided user ACL policy
  options = options || {};

  const url = urlUtil.urlJoin(server.wadoRoot, 'studies', studyId, 'acl', 'user', user.ID);
  const response = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${getAuthToken()}` },
    body: JSON.stringify(user),
  });

  if (!response.ok) {
    throw await _aclError('Failed to update ACL user', url, response);
  }

  // Parse response to JSON and trigger callbacks
  const _json = await response.json();
  if (options && _.isFunction(options.success)) {
    options.success(_json, { server, StudyInstanceUID: studyId, payload: user });
  }

  return _json;
};


export const getAclGroups = (server, studyId) => {
  // Retrieve group authorization policies for provided server and study UID via
  // Orthanc DICOMweb ext API .

  return fetch(urlUtil.urlJoin(server.wadoRoot, 'studies', studyId, 'acl', 'group'), {
    headers: { Authorization: `Bearer ${getAuthToken()}` },
  })
    .then((res) => res.json())
    .then((res) => {
      
      // Modify API response so that rather than a nested object, group name is at the
      // root of the JSON.
      return res.map((p) => {
        p.group = p.group || p.Group || {};

        // Move group properties to root of response
        p.Group = p.group.id;
        extend(p, pick(p.group, ['name']));
        return p;
      });
    });
};


export const createAclGroup = async (server, studyId, newGroup) => {
  // Create group access control policy.
  //
  // No `options` success callback, unlike its three siblings: this one accepted the parameter and
  // never called it, so a caller passing one got silence. Dropped rather than implemented -- the
  // callers await the returned promise.

  const url = urlUtil.urlJoin(server.wadoRoot, 'studies', studyId, 'acl', 'group');
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getAuthToken()}` },
    body: JSON.stringify(newGroup),
  });

  if (!response.ok) {
    throw await _aclError('Failed to create ACL group', url, response);
  }

  return response.json();
};


export const updateAclGroup = async (server, studyId, group, options) => {
  // Update a group access control policy
  options = options || {};

  const url = urlUtil.urlJoin(server.wadoRoot, 'studies', studyId, 'acl', 'group', group.ID);
  const response = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${getAuthToken()}` },
    body: JSON.stringify(group),
  });

  if (!response.ok) {
    throw await _aclError('Failed to update ACL group', url, response);
  }

  // Parse response to JSON and trigger callbacks
  const _json = await response.json();
  if (options && _.isFunction(options.success)) {
    options.success(_json, { server, StudyInstanceUID: studyId, payload: group });
  }

  return _json;
};


const _upsertAcl = async ({ create, update, list, idField, subjectId, policy, server, studyId }) => {
  // Write a policy without needing to know in advance whether one already exists.
  //
  // Callers decide POST-vs-PUT from a list they read earlier, and that list goes stale: another
  // user (or the same user in another tab) can grant access in between, and the bulk path reads
  // each study's policies once and then issues many writes against that snapshot. When the create
  // loses that race the gateway answers 400 'unique' rather than updating, so the write is retried
  // as an update against the ID the gateway hands back.
  if (policy.ID) {
    return update(server, studyId, policy);
  }

  try {
    return await create(server, studyId, policy);
  } catch (err) {
    if (!isDuplicateAclError(err)) {
      throw err;
    }

    let existingId = duplicateAclPolicyId(err);

    if (!existingId) {
      // Belt and braces: the plugin does supply object-data.ID today, but a duplicate we cannot
      // address is better resolved by re-reading the list than by reporting a failure for a policy
      // that demonstrably exists.
      const current = await list(server, studyId);
      existingId = (current || []).find((acl) => String(acl[idField]) === String(subjectId))?.ID;
    }

    if (!existingId) {
      throw err;
    }

    return update(server, studyId, { ...policy, ID: existingId });
  }
};


/** Create the user's policy, or update it in place if the gateway says it already exists. */
export const upsertAclUser = (server, studyId, user) =>
  _upsertAcl({
    create: createAclUser,
    update: updateAclUser,
    list: getAclUsers,
    idField: 'User',
    subjectId: user.User,
    policy: user,
    server,
    studyId,
  });


/** Create the group's policy, or update it in place if the gateway says it already exists. */
export const upsertAclGroup = (server, studyId, group) =>
  _upsertAcl({
    create: createAclGroup,
    update: updateAclGroup,
    list: getAclGroups,
    idField: 'Group',
    subjectId: group.Group,
    policy: group,
    server,
    studyId,
  });


export const searchAcl = (server, searchParams) => {
  return fetch(sonadorUrl(urlUtil.urlJoin(`/visionaire/api/pacs/${server.token}/auth/search/`)), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getAuthToken()}`,
    },
    credentials: 'omit',
    body: JSON.stringify(searchParams),
  })
    .then((res) => res.json())
    .then((res) => res.results);
};


const _deleteAclPermission = async (server, studyId, kind, permissionId) => {
  // Revoke a single ACL policy.
  //
  // Both of these previously returned the raw `fetch` promise without inspecting it, so a 403 or a
  // 500 resolved exactly like a successful revoke and the caller reported the policy as removed.
  //
  // A 404 is treated as success, matching `ext.js`'s removal path: the policy is gone, which is
  // what the caller asked for. That also makes a repeated delete -- the second click on a row the
  // UI failed to drop -- a no-op instead of an error.
  const url = urlUtil.urlJoin(server.wadoRoot, 'studies', studyId, 'acl', kind, permissionId);

  const response = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${getAuthToken()}` },
  });

  if (response.ok || response.status === 404) {
    return { url, status: response.status, alreadyRemoved: response.status === 404 };
  }

  throw await _aclError(`Failed to delete ACL ${kind} policy ${permissionId}`, url, response);
};


export const deleteAclGroupPermission = (server, studyId, permissionId) =>
  _deleteAclPermission(server, studyId, 'group', permissionId);


export const deleteAclUserPermission = (server, studyId, permissionId) =>
  _deleteAclPermission(server, studyId, 'user', permissionId);
