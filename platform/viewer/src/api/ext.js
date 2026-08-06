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


export const fetchSeriesAclPermissions = (server, seriesId) => {
  // Retrieve ACL permissions for the provided series ID.
  //
  // Direct analogue of fetchStudyAclPermissions above; the payload differs only in carrying
  // Level: 'Series' and a SeriesInstanceUID key alongside the same PascalCase `perms` object
  // ({ View, Modify, Remove, CommentEdit, CommentView, ACL }).
  //
  // Series-granular grants are why this exists (ohif-viewers#127, FR-9): a user can hold `view`
  // on one series of a study without holding it on the study, and `activeServer.perms` is
  // wildcard-only, so neither the server flag nor the study resource-acl can authorise them.
  // Callers combine the two — the effective permission is the study/server grant OR the series
  // grant, never the series grant alone.

  return fetch(urlUtil.urlJoin(server.wadoRoot, 'series', seriesId, 'resource-acl'), {
    headers: { Authorization: `Bearer ${getAuthToken()}` },
  }).then((res) => res.json());
}


const _removeResource = async (server, resourceType, resourceId) => {
  // Permanently remove an imaging resource from the imaging server.
  //
  // removeStudy and removeSeries below are the ONLY entry points to resource removal in the
  // viewer (ohif-viewers#127, AR-1), the same discipline fetchDownloadStudies/fetchDownloadSeries
  // document for archive export. No component issues its own DELETE: removal is irreversible, and
  // a second code path is a second place for the error handling, the 404 semantics and the
  // redirect behavior below to drift.
  //
  // REDIRECT — do not "fix" this by setting a `redirect` option. The gateway answers 307 with a
  // Location pointing at the Orthanc-native resource endpoint, and 307 preserves the method, so
  // fetch's DEFAULT follow behavior re-issues the DELETE at the target and that is what actually
  // performs the deletion. `redirect: 'manual'` yields an opaque response whose headers cannot be
  // read, so the Location cannot be recovered and the follow-up cannot be issued by hand. The
  // request shape here deliberately mirrors the archive helpers, which follow the same gateway's
  // redirect in production. (A regression to 302 on the server side would let the user agent
  // rewrite DELETE to GET and silently delete nothing — that is asserted server-side, in
  // orthanc-sonador#57.)
  const url = urlUtil.urlJoin(server.wadoRoot, resourceType, resourceId, 'manage');

  const response = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${getAuthToken()}` },
  });

  // 404 is success, not failure (FR-15). The resource is already gone — a double-click, or a row
  // that went stale while the study list sat open — and the caller's terminal state is the same
  // either way. Raising an error here would put an Issues-list entry behind every double-click.
  if (response.ok || response.status === 404) {
    return { url, status: response.status, alreadyRemoved: response.status === 404 };
  }

  // Capture the body so the failure notification can carry it (FR-13). Read as text rather than
  // JSON: a 403 from the authorization plugin and a 500 from the gateway do not agree on a
  // content type, and a parse failure here would replace a diagnosable error with a useless one.
  let body;
  try {
    body = await response.text();
  } catch (err) {
    body = undefined;
  }

  const error = new Error(`Unable to remove ${resourceType}=${resourceId} (HTTP ${response.status})`);
  error.url = url;
  error.status = response.status;
  error.body = body;

  throw error;
}


export const removeStudy = (server, studyId) => {
  // Permanently remove a study, and every series and instance beneath it, from the imaging
  // server. Hard delete — Orthanc has no undo, no soft delete and no recycle bin. Distinct from
  // LocalCacheService.removeStudy, which evicts this browser's offline copy and touches nothing
  // on the server (ohif-viewers#125).

  return _removeResource(server, 'studies', studyId);
}


export const removeSeries = (server, seriesId) => {
  // Permanently remove a series, and every instance beneath it, from the imaging server. Removing
  // the last series of a study removes the study too, by Orthanc's cascade.

  return _removeResource(server, 'series', seriesId);
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