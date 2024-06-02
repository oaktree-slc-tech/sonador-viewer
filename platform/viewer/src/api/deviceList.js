import { urlUtil } from '@ohif/core/src/utils';

import { getAuthToken } from './sonador';

export const getDeviceList = (server) => {
  // Retrieve the distortion filter device list for the provided server instance
  return fetch(urlUtil.urlJoin(server.wadoRoot, 'distortion-filter/devices'), {
    headers: { Authorization: `Bearer ${getAuthToken()}` },
  }).then((res) => res.json());
};

export const createDevice = ({ server, payload }) => {
  // Create a distortion filter device
  return fetch(urlUtil.urlJoin(server.wadoRoot, 'distortion-filter/devices'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${getAuthToken()}` },
    body: JSON.stringify(payload),
  }).then((res) => res.json());
};

export const updateDevice = ({ server, deviceId, payload }) => {
  // Update a distortion filter device
  return fetch(urlUtil.urlJoin(server.wadoRoot, 'distortion-filter/devices', deviceId), {
    method: 'PUT',
    headers: { Authorization: `Bearer ${getAuthToken()}` },
    body: JSON.stringify(payload),
  }).then((res) => res.json());
};

export const removeDevice = ({ server, deviceId }) => {
  // Remove a distortion filter device from the list
  return fetch(urlUtil.urlJoin(server.wadoRoot, 'distortion-filter/devices', deviceId), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${getAuthToken()}` },
  }).then((res) => res.json());
};

export const getDistortionCheck = (server, studyId) => {
  // Check the provided study against the distortion filter API
  return fetch(urlUtil.urlJoin(server.wadoRoot, 'distortion-filter', studyId), {
    headers: { Authorization: `Bearer ${getAuthToken()}` },
  }).then((res) => res.json());
};
