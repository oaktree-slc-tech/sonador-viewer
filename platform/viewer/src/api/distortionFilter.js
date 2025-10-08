import _ from 'lodash';
import OHIF, { sonador } from '@ohif/core';
import { urlUtil } from '@ohif/core/src/utils';

import { getAuthToken, sonadorUrl } from './sonador';


export const getDevicelistGroup = (server, term, options) => {
  // Retrieve the list of groups with device list / distortion field testing which 
  // match the provided search term. Only groups of which the user is a member
  // will be retrieved.

  // @returns group list 

  options = options || {};

  return sonador.searchImageServerGroups(server, term, { devices_list: true }).then((res) => {

    // Trigger options.success callback to provide hook to the raw response object.
    if (options.success && _.isFunction(options.success)) {
      options.success(res);
    }

    return res.json();
  }).then((res) => res.results);
}


export const getDeviceList = (server, group, options) => {
  // Retrieve the distortion filter device list for the provided server instance.
  // This method can be used within components which switch between groups and accepts a
  // null or undefined value for group. In cases where group is null, an empty array will
  // be returned.

  // @returns devices list for the provided server and group
  options = options || {};
  
  if (!group) {
    console.warn('Unable to retrieve device list. Invalid group.');
    return [];
  }

  // Retrieve group ID
  const group_id = _.isObject(group) ? group.id : group;

  // Fetch device list from Orthanc group API
  return fetch(urlUtil.urlJoin(server.rootUrl, 'groups', group_id, 'distortion-filter/devices'), {
    headers: { Authorization: `Bearer ${getAuthToken()}` },
  }).then((res) => {

    // Trigger options.success callback to provide hook for access to the raw response object.
    if (options.success && _.isFunction(options.success)) {
      options.success(res);
    }

    return res.json();
  });
};


export const createDevice = ({ server, group, payload }, options) => {
  // Create a distortion filter device
  options = options || {};

  if (!group) {
    throw new Error('Unable to create device record, invalid group');
  }

  // Retrieve group ID
  const group_id = _.isObject(group) ? group.id : group;
  
  return fetch(urlUtil.urlJoin(server.rootUrl, 'groups', group_id, 'distortion-filter/devices'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${getAuthToken()}` },
    body: JSON.stringify(payload),
  }).then((res) => res.json()).then((res) => {

    // Trigger success callback
    if (options.success && _.isFunction(options.success)) {
      options.success(res, { payload, group, server });
    }

    return res;
  });
};


export const updateDevice = ({ server, group, deviceId, payload }, options) => {
  // Update a distortion filter device
  options = options || {};  

  if (!group) {
    throw new Error('Unable to update device record, invalid group');
  }

  // Retrieve group ID
  const group_id = _.isObject(group) ? group.id : group;

  return fetch(urlUtil.urlJoin(server.rootUrl, 'groups', group_id, 'distortion-filter/devices', deviceId), {
    method: 'PUT',
    headers: { Authorization: `Bearer ${getAuthToken()}` },
    body: JSON.stringify(payload),
  }).then((res) => res.json()).then((res) => {

    // Trigger success callback
    if (options.success && _.isFunction(options.success)) {
      options.success(res, { ID: deviceId, payload, group, server });
    }

    return res;
  });
};


export const removeDevice = ({ server, group, deviceId }, options) => {
  // Remove a distortion filter device from the group
  options = options || {};

  if (!deviceId) {
    throw new Error('Unable to remove distortion filter device, invalid DeviceID='+deviceId);
  }

  // Retrieve group ID
  const group_id = _.isObject(group) ? group.id : group;

  return fetch(urlUtil.urlJoin(server.rootUrl, 'groups', group_id, 'distortion-filter/devices', deviceId), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${getAuthToken()}` },
  }).then((res) => res.json()).then((res) => {

    // Trigger success callback
    if (options.success && _.isFunction(options.success)) {
      options.success(res, { ID: deviceId, server, group });
    }

    return res;
  });
};
