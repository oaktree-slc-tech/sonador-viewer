import user from '@ohif/core/src/user';
import { urlUtil } from '@ohif/core/src/utils';

import { sonadorUrl, getAuthToken } from './sonador';

export const fetchTokens = () => {
  // Retrieve access tokens from the Sonador server

  return fetch(sonadorUrl('auth/api/cred/token').href, {
    headers: {
      Authorization: `Bearer ${getAuthToken()}`,
    },
    credentials: 'include',
  }).then((res) => res.json());
};

export const createToken = ({ description, csrfToken }) => {
  // Create an API access token

  return fetch(sonadorUrl('auth/api/cred/token').href, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getAuthToken()}`,
      'X-CSRFToken': csrfToken,
    },
    body: JSON.stringify({ description }),
    credentials: 'include',
  })
    .then((res) => res.json())
    .then((res) => {
      return {
        ...res['object-data'],
        message: res.message,
        status: res.status,
      };
    });
};

export const fetchAccesses = () => {
  // Fetch secure API access credentials from the Sonadoer server

  return fetch(sonadorUrl('auth/api/cred/access').href, {
    headers: {
      Authorization: `Bearer ${getAuthToken()}`,
    },
    credentials: 'include',
  }).then((res) => res.json());
};

export const createAccessIdAndSecretKey = ({ description, csrfToken }) => {
  // Create Sonador secure authorization credentials (access ID and secret key)

  return fetch(sonadorUrl('auth/api/cred/access').href, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getAuthToken()}`,
      'X-CSRFToken': csrfToken,
    },
    body: JSON.stringify({ description }),
    credentials: 'include',
  })
    .then((res) => res.json())
    .then((res) => {
      return {
        ...res['object-data'],
        message: res.message,
        status: res.status,
      };
    });
};

export const getCsrfToken = () => {
  // Retrieve a CSRF token from Sonador to allow

  return fetch(sonadorUrl('auth/api/cred/csrf-token').href, {
    headers: {
      Authorization: `Bearer ${getAuthToken()}`,
    },
    credentials: 'include',
  }).then((res) => res.json());
};

export const deleteToken = ({ token, csrfToken }) => {
  // Delete an API access token

  return fetch(sonadorUrl('auth/api/cred/token').href, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${getAuthToken()}`,
      'X-CSRFToken': csrfToken,
    },
    body: JSON.stringify({ token }),
    credentials: 'include',
  }).then((res) => res.json());
};

export const deleteAccessIdAndSecretKey = ({ token, csrfToken }) => {
  // Delete Sonador secure authorization credentials (access ID and secret key)

  return fetch(urlUtil.urlJoin(sonadorUrl('auth/api/cred/access').href, token), {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${getAuthToken()}`,
      'X-CSRFToken': csrfToken,
    },
    credentials: 'include',
  }).then((res) => res.json());
};
