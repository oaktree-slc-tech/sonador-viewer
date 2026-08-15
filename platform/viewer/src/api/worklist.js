import { format } from 'date-fns';
import moment from 'moment';

import { urlUtil } from '@ohif/core/src/utils';
import { getAuthToken, sonadorUrl } from './sonador';


export const getWorklistGroup = (server, term) => {
  // Retrieve the list of groups with worklists enabled which match the provided search term.
  // Only groups of which the user is a member will be retrieved.

  return fetch(sonadorUrl(urlUtil.urlJoin(`/visionaire/api/pacs/${server.token}/group/search/`)), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getAuthToken()}`,
    },
    credentials: 'omit',
    body: JSON.stringify({
      name: term,
      worklist: true,
    }),
  }).then((res) => res.json())
    .then((res) => res.results);
};


export const getWorklistMembership = ({ server, groupId, term }) => {
  // Sarch the group for users which match the provided search term.

  return fetch(sonadorUrl(urlUtil.urlJoin(`/visionaire/api/pacs/${server.token}/group/${groupId}/membership`)), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getAuthToken()}`,
    },
    credentials: 'omit',
    body: JSON.stringify({
      term,
    }),
  }).then((res) => res.json())
    .then((res) => res.results);
};


const _rejectedRequest = async (res, url) => {
  // Build the error a rejected worklist write throws.
  //
  // The `message` is unchanged from what this module has always thrown, so nothing that only reads
  // it is affected. What is new is the structure hung off it: status, the raw body, the url and the
  // parsed payload when the gateway sent JSON. The bulk path needs those to tell the user WHY one
  // study out of twelve failed -- with a bare message string the only honest thing it could report
  // was "it didn't work", which is what made a single rejected request in a large run undiagnosable.
  //
  // A body that is not JSON is kept as text rather than discarded: a proxy's HTML error page is
  // still the most useful thing available when it is all there is.
  const body = await res.text().catch(() => '');
  let json;

  try {
    json = body ? JSON.parse(body) : undefined;
  } catch (err) {
    json = undefined;
  }

  const error = new Error(`HTTP ${res.status}: ${body}`);

  error.status = res.status;
  error.body = body;
  error.url = url;
  error.json = json;

  return error;
};


export const createWorklistRequest = ({ server, groupId, StudyInstanceUID, userId, State, Procedure }) => {
  // Create a worklist request

  const url = urlUtil.urlJoin(server.wadoRoot, 'studies', StudyInstanceUID, 'worklists');

  return fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getAuthToken()}`,
    },
    credentials: 'omit',
    body: JSON.stringify({
      Group: groupId,
      User: userId,
      State,
      ...(Procedure ? { Procedure } : {}),
    }),
  })
    .then(async (res) => {
      if (!res.ok) {
        throw await _rejectedRequest(res, url);
      }
      return res.json();
    })
    .then((res) => res.results);
};


export const updateWorklist = ({ server, StudyInstanceUID, worklistId, State, Comment, Procedure }) => {
  // Update the provided worklist item

  const payload = {
    State,
    ...(Comment ? { Comment: { Text: Comment } } : {}),
    ...(Procedure ? { Procedure } : {}),
  };
  return fetch(
    urlUtil.urlJoin(server.wadoRoot, 'studies', StudyInstanceUID, 'worklists', worklistId),
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${getAuthToken()}`,
        'Content-Type': 'application/json',
      },
      credentials: 'omit',
      body: JSON.stringify(payload),
    },
  )
    .then(async (res) => {
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errorText}`);
      }
      return res.json();
    })
    .then((res) => res.results);
};


function toDateIfMoment(value ) {
  if (!value) return null;

  if (moment.isMoment(value)) {
    return value.toDate();
  }

  // If it's already a Date, return as-is
  if (value instanceof Date) {
    return value;
  }

  // Optionally handle ISO strings, etc.
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}


function formatStudyDate(studyDateFrom , studyDateTo) {
  // Format the study date to match the DICOM standard

  if (!studyDateFrom) return null;
  const from = toDateIfMoment(studyDateFrom)
  const to = toDateIfMoment(studyDateTo)

  const formatDate = (date) => format(date, 'yyyyMMdd');

  const fromStr = formatDate(from);
  const toStr = to ? formatDate(to) : fromStr;

  return `${fromStr}-${toStr}`;
}


export const getWorklistItems = ({ server, filters, studyStartDate, studyEndDate  }) => {
  // Retrieve worklist for the provided server. Is a server is not provided, the
  // an empty array is returned.

  if (!server) {
    console.warn('Unable to retrieve worklist items, invalid server.', server);
    return [];
  }

  const url = new URL(urlUtil.urlJoin(server.wadoRoot, 'worklist', 'studies'));

  const studyDate = formatStudyDate(studyStartDate, studyEndDate)
  if(studyDate){
    url.searchParams.append('StudyDate', studyDate)
  }
  // Append filters as query params
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.append(key, value);
    }
  });

  return fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${getAuthToken()}`,
    },
    credentials: 'omit',
  })
  .then((res) => res.json());
};
