import _ from 'lodash';

import { urlUtil } from '../utils';
import { getAuthToken } from './sonador';


export const getDistortionCheck = (server, group, studyId, options) => {
  // Check the provided study against the distortion filter API
  options = options || {};

  if (!group) {
    throw new Error('Unable to retrieve distortion filter results for study, invalid group');
  }

  const group_id = _.isObject(group) ? group.id : group;

  return fetch(urlUtil.urlJoin(server.wadoRoot, 'groups', group_id, 'distortion-filter', studyId), {
    headers: { Authorization: `Bearer ${getAuthToken()}` },
  }).then((res) => {

    // Trigger success callback to provide access to the raw response object
    if (options.success && _.isFunction(options.success)) {
      options.success(res, { server, group, studyId });
    }
    
    return res.json();
  });
};
