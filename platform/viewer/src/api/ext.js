// Methods for retrieving data from the DICOM-EXT API of an imaging server.
import _ from 'lodash';

import {
  sonador,
  DicomMetadataStore,
  ArchiveDownloadService,
  notifyArchivesQueued,
} from '@ohif/core';
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


export const fetchDownloadStudies = (server, studyId, descriptor) => {
  // Queue a zip-archive export of a DICOM study for download to the user's computer.
  //
  // These two helpers are the ONLY entry points to archive export in the viewer, so rather than
  // hunting down every call site they became thin adapters onto ArchiveDownloadService
  // (ohif-viewers#52, AR-5). Every caller — present and future — therefore gets a tracked,
  // observable, cancellable job in the Downloads menu for free.
  //
  // The call no longer downloads inline: it RETURNS the job and settles in the background. The
  // server builds the archive on demand, so a large study can sit for minutes before the first
  // byte arrives; progress, cancellation and the saved file are all owned by the service, and both
  // ends are announced through the unified notification service (see archiveNotifications).
  //
  // NOTE for future work: a direct fetch of an /archive URL followed by an anchor click is a
  // defect — it produces an export the user cannot see, monitor, or cancel. Go through the service.

  // Asked twice for the same study (a double-click, or a bulk action re-run over a partially
  // queued selection)? The service hands back the job already in flight rather than starting a
  // second request (FR-14), and the notice says so instead of re-announcing a queue that did not
  // happen.
  const duplicate = !!ArchiveDownloadService.getActiveJobForResource(studyId);

  const job = ArchiveDownloadService.enqueueStudy({
    server,
    StudyInstanceUID: studyId,
    // DicomMetadataStore is consulted only as a fallback: a study-list row is registered with no
    // metadata, so callers that have the row pass its attributes explicitly.
    descriptor: descriptor || DicomMetadataStore.getStudyMetadata(studyId) || {},
  });

  notifyArchivesQueued(duplicate ? { alreadyQueued: 1 } : { queued: [job] });

  return job;
}


export const fetchDownloadSeries = (server, seriesId, descriptor) => {
  // Queue a zip-archive export of a DICOM series. Routed through the queue exactly as the study
  // archive above; see that function for the reasoning.

  const duplicate = !!ArchiveDownloadService.getActiveJobForResource(seriesId);

  const job = ArchiveDownloadService.enqueueSeries({
    server,
    StudyInstanceUID: descriptor?.StudyInstanceUID,
    SeriesInstanceUID: seriesId,
    descriptor: descriptor || {},
  });

  notifyArchivesQueued(duplicate ? { alreadyQueued: 1 } : { queued: [job] });

  return job;
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