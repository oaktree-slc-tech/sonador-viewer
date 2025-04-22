import { urlUtil } from '@ohif/core/src/utils';

import { getAuthToken, sonadorUrl } from './sonador';

export const getWorklistGroup = (server, term) => {
  return fetch(sonadorUrl(urlUtil.urlJoin(`/visionaire/api/pacs/${server.token}/group/search/`)), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getAuthToken()}`,
    },
    body: JSON.stringify({
      term,
      worklist: true,
    }),
  })
    .then((res) => res.json())
    .then((res) => res.results);
};

export const getWorklistMembership = ({ server, groupId, term }) => {
  return fetch(sonadorUrl(urlUtil.urlJoin(`/visionaire/api/pacs/${server.token}/group/${groupId}/membership`)), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getAuthToken()}`,
    },
    body: JSON.stringify({
      term,
    }),
  })
    .then((res) => res.json())
    .then((res) => res.results);
};

export const createWorklistRequest = ({ server, groupId, StudyInstanceUID, userId, State }) => {
  return fetch(urlUtil.urlJoin(server.wadoRoot, 'studies', StudyInstanceUID, 'worklists'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getAuthToken()}`,
    },
    body: JSON.stringify({
      Group: groupId,
      User: userId,
      State,
    }),
  })
    .then(async (res) => {
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errorText}`);
      }
      return res.json();
    })
    .then((res) => res.results);
};


export const updateWorklist = ({ server, StudyInstanceUID, worklistId, State, Comment }) => {
  const payload = {
    State,
    ...(Comment ? { Comment: { Text: Comment } } : {}),
  };
  return fetch(
    urlUtil.urlJoin(server.wadoRoot, 'studies', StudyInstanceUID, 'worklists', worklistId),
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${getAuthToken()}`,
        'Content-Type': 'application/json',
      },
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


export const getWorklistItems = ({ server, groupId, userId }) => {
  return fetch(urlUtil.urlJoin(server.wadoRoot, 'worklist', 'studies'), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${getAuthToken()}`,
    },
  })
    .then((res) => res.json());
};
