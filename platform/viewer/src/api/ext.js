// Methods for retrieving data from the DICOM-EXT API of an imaging server.
import _ from 'lodash';

import OHIF, { sonador } from '@ohif/core';
import { urlUtil } from '@ohif/core/src/utils';

import { getAuthToken } from './sonador';


export const fetchSeriesComments = (server, series) => {
  // Retrieve comments for the provided series

  return fetch(urlUtil.urlJoin(server.wadoRoot, 'series', series.SeriesInstanceUID, 'comments'), {
    headers: { Authorization: `Bearer ${getAuthToken()}` },
  }).then((res) => res.json());
};


export const createSeriesComment = (server, series, text) => {
  // Create a comment for the provided series

  return fetch(urlUtil.urlJoin(server.wadoRoot, 'series', series.SeriesInstanceUID, 'comments'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${getAuthToken()}` },
    body: JSON.stringify({ Text: text }),
  });
};


export const fetchStudyComments = (server, studyId) => {
  // Retrieve comments for the provided series

  return fetch(urlUtil.urlJoin(server.wadoRoot, 'studies', studyId, 'comments'), {
    headers: { Authorization: `Bearer ${getAuthToken()}` },
  }).then((res) => res.json());
};



export const createStudyComment = (server, studyId, text) => {
  // Create a comment for the provided series

  return fetch(urlUtil.urlJoin(server.wadoRoot, 'studies', studyId, 'comments'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${getAuthToken()}` },
    body: JSON.stringify({ Text: text }),
  });
};


export const fetchDownloadStudies = async (server, studyId) => {
  // Download DICOM Studies data from Orthanc

  const url = urlUtil.urlJoin(server.wadoRoot, 'studies', studyId, 'archive');

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${getAuthToken()}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch archive: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();

    // Create a temporary anchor to trigger the download
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `${studyId}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    // Revoke the object URL after download
    window.URL.revokeObjectURL(downloadUrl);
  } catch (error) {
    console.error('Download failed:', error);
  }
}


export const fetchDownloadSeries = async (server, seriesId) => {
  // Download DICOM Series data from Orthanc

  try {
    const response = await fetch(urlUtil.urlJoin(server.wadoRoot, 'series', seriesId, 'archive'), {
      headers: { Authorization: `Bearer ${getAuthToken()}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch archive: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();

    // Create a temporary anchor to trigger the download
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `${seriesId}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    // Revoke the object URL after download
    window.URL.revokeObjectURL(downloadUrl);
  } catch (error) {
    console.error('Download for series="'+seriesId+'" failed:', error);
  }
}



export const fetchStudyAclPermissions = (server, studyId) => {
  // Retrieve ACL permissions for the provided study ID

  return fetch(urlUtil.urlJoin(server.wadoRoot, 'studies', studyId, 'resource-acl'), {
    headers: { Authorization: `Bearer ${getAuthToken()}` },
  }).then((res) => res.json());
}


export const fetchStudyWorklists = (server, studyId) => {
  // Retrieve the worklist items assigned to the provided study. Each item carries its
  // reviewer-facing Meta (RequestedProcedure, PerformedProcedure and the per-transition
  // ReviewHistory), which drives the Study Details review timeline.

  return fetch(urlUtil.urlJoin(server.wadoRoot, 'studies', studyId, 'worklists'), {
    headers: { Authorization: `Bearer ${getAuthToken()}` },
  }).then((res) => res.json());
}


export const getSeriesTagGroup = (server, term, options) => {
  // Retrieve groups which have series tags enabled.

  // @returns group list
  options = options || {};

  return sonador.searchImageServerGroups(server, term, { tag:  true }).then((res) => {

    // Trigger options.success callback to provide hook for access to the raw response objects.
    if (options.success && _.isFunction(options.success)) {
      options.success(res);
    }

    return res.json();
  }).then((res)=> {

    // Un-pack search response and return results
    return _.isObject(res) && res.results ? res.results : res;
  });
}


export const getTagList = (server, group, options) => {
  // Retrieve the tag list for the provided group. This method can be used
  // within components which switch between groups and accepts a null or undefined value
  // for the group. In cases where the group is null, an empty array will
  // be returned.

  // @returns tag list for the provided server and group
  options = options || {};

  if (!group) {
    console.warn('Unable to retrieve tag list. Invalid group.');
    return [];
  }

  return sonador.fetchGroupTags(server, group).then((res) => {

    // Trigger options.success callback to provide hook for access to the raw response object.
    if (options.success && _.isFunction(options.success)) {
      options.success(res);
    }

    return res.json();
  });
}


export const createSeriesTag = ({ server, group, payload }, options) => {
  // Create a series tag
  options = options || {};

  if (!group) {
    throw new Error('Unable to create series tag, invalid group');
  }

  // Retrieve group ID
  const group_id = _.isObject(group) ? group.id : group;

  return fetch(urlUtil.urlJoin(server.rootUrl, 'groups', group_id, 'tags'), {
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
}


export const updateSeriesTag = ({ server, group, tagId, payload }, options) => {
  // Update a series tag
  options = options || {};

  if (!group) {
    throw new Error('Unable to update series tag, invalid group');
  }

  // Retrieve group ID
  const group_id = _.isObject(group) ? group.id : group;

  return fetch(urlUtil.urlJoin(server.rootUrl, 'groups', group_id, 'tags', tagId), {
    method: 'PUT',
    headers: { Authorization: `Bearer ${getAuthToken()}` },
    body: JSON.stringify(payload),
  }).then((res) => res.json()).then((res) => {

    // Trigger success callback
    if (options.success && _.isFunction(options.success)) {
      options.success(res, { ID: tagId, payload, group, server });
    }

    return res;
  });
};


export const removeSeriesTag = ({ server, group, tagId }, options) => {
  // Remove a series tag from the group
  options = options || {};

  if (!tagId) {
    throw new Error('Unable to remove series tag, invalid tagId='+tagId);
  }

  // Retrieve group ID
  const group_id = _.isObject(group) ? group.id : group;

  return fetch(urlUtil.urlJoin(server.rootUrl, 'groups', group_id, 'tags', tagId), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${getAuthToken()}` },
  }).then((res) => res.json()).then((res) => {
    
    // Trigger success callback
    if (options.success && _.isFunction(options.success)) {
      options.success(res, { ID: tagId, server, group });
    }

    return res;
  });
};