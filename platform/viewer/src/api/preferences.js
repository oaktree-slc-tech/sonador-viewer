import { urlUtil } from '@ohif/core/src/utils';

import { getAuthToken, sonadorUrl } from './sonador';

export const getUserPreferences = () => {
  return fetch(sonadorUrl(urlUtil.urlJoin(`/visionaire/api/user-preferences/`)), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${getAuthToken()}`,
    },
    credentials: 'omit',
  })
    .then((res) => res.json())
    .then((res) => res.results || {});
};

export const updateUserPreferences = (payload) => {
  return fetch(sonadorUrl(urlUtil.urlJoin(`/visionaire/api/user-preferences/`)), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getAuthToken()}`,
    },
    credentials: 'omit',
    body: JSON.stringify(payload),
  })
    .then((res) => res.json())
    .then((res) => res.results);
};
