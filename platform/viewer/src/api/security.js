import { urlUtil } from '@ohif/core/src/utils';

import { getAuthToken, sonadorUrl } from './sonador';


export const fetchTokens = () => {
  // Retrieve access tokens from the Sonador server

  return fetch(sonadorUrl('auth/api/cred/token').href, {
    headers: {
      Authorization: `Bearer ${getAuthToken()}`,
    },
  }).then((res) => res.json());
};


export const createToken = (description) => {
  // Create an API access token

  return fetch(sonadorUrl('auth/api/cred/token').href, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getAuthToken()}`,
    },
    body: JSON.stringify({ description }),
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
  }).then((res) => res.json());
};


export const createAccessIdAndSecretKey = (description) => {
  // Create Sonador secure authorization credentials (access ID and secret key)

  return fetch(sonadorUrl('auth/api/cred/access').href, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getAuthToken()}`,
    },
    body: JSON.stringify({ description }),
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
  }).then((res) => res.json());
};


export const deleteToken = (token) => {
  // Delete an API access token

  return fetch(sonadorUrl('auth/api/cred/token').href, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${getAuthToken()}`,
    },
    body: JSON.stringify({ token }),
  }).then((res) => res.json());
};


export const deleteAccessIdAndSecretKey = (token) => {
  // Delete Sonador secure authorization credentials (access ID and secret key)

  return fetch(urlUtil.urlJoin(sonadorUrl('auth/api/cred/access').href, token), {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${getAuthToken()}`,
    },
  }).then((res) => res.json());
};
