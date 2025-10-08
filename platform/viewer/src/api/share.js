import _, { extend, pick } from 'lodash';

import { urlUtil } from '@ohif/core/src/utils';

import { getAuthToken, sonadorUrl } from './sonador';


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

  const response = await fetch(
    urlUtil.urlJoin(server.wadoRoot, 'studies', studyId, 'acl', 'user'),
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${getAuthToken()}` },
      body: JSON.stringify(newUser),
    },
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Failed to create ACL user: ${response.status} ${message}`);
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

  const response = await fetch(
    urlUtil.urlJoin(server.wadoRoot, 'studies', studyId, 'acl', 'user', user.ID),
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${getAuthToken()}` },
      body: JSON.stringify(user),
    },
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Failed to update ACL user: ${response.status} ${message}`);
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


export const createAclGroup = async (server, studyId, newGroup, options) => {
  // Create group access control policy
  options = options || {};

  const response = await fetch(
    urlUtil.urlJoin(server.wadoRoot, 'studies', studyId, 'acl', 'group'),
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${getAuthToken()}` },
      body: JSON.stringify(newGroup),
    },
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Failed to create ACL group: ${response.status} ${message}`);
  }

  return response.json();
};


export const updateAclGroup = async (server, studyId, group, options) => {
  // Update a group access control policy
  options = options || {};

  const response = await fetch(
    urlUtil.urlJoin(server.wadoRoot, 'studies', studyId, 'acl', 'group', group.ID),
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${getAuthToken()}` },
      body: JSON.stringify(group),
    }
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Failed to update ACL group: ${response.status} ${message}`);
  }

  // Parse response to JSON and trigger callbacks
  const _json = await response.json();
  if (options && _.isFunction(options.success)) {
    options.success(_json, { server, StudyInstanceUID: studyId, payload: group });
  }

  return _json;
};


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


export const deleteAclGroupPermission = (server, studyId, permissionId) => {
  return fetch(urlUtil.urlJoin(server.wadoRoot, 'studies', studyId, 'acl', 'group', permissionId), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${getAuthToken()}` },
  });
};


export const deleteAclUserPermission = (server, studyId, permissionId) => {
  return fetch(urlUtil.urlJoin(server.wadoRoot, 'studies', studyId, 'acl', 'user', permissionId), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${getAuthToken()}` },
  });
};
