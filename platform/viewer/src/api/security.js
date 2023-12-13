import DICOMWeb from '@ohif/core/src/DICOMWeb';
import { sonadorUrl } from './sonador.js';

export const fetchTokens = (server) => {
  // Retrieve access tokens from the Sonador server

  return fetch(sonadorUrl('auth/api/cred/token').href, {
    headers: DICOMWeb.getAuthorizationHeader(server),
    credentials: 'include',
  }).then((res) => res.json());
};

export const createToken = ({ server, description, csrfToken }) => {
  // Create an API access token

  const headers = DICOMWeb.getAuthorizationHeader(server);
  headers['X-CSRFToken'] = csrfToken;

  return fetch(sonadorUrl('auth/api/cred/token').href, {
    method: 'POST',
    headers,
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

export const fetchAccesses = (server) => {
  // Fetch secure API access credentials from the Sonadoer server

  return fetch(sonadorUrl('auth/api/cred/token').href, {
    headers: DICOMWeb.getAuthorizationHeader(server),
    credentials: 'include',
  }).then((res) => res.json());
};

export const createAccessIdAndSecretKey = ({ server, description, csrfToken }) => {
  // Create Sonador secure authorization credentials (access ID and secret key)

  const headers = DICOMWeb.getAuthorizationHeader(server);
  headers['X-CSRFToken'] = csrfToken;

  return fetch(sonadorUrl('auth/api/cred/access').href, {
    method: 'POST',
    headers,
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

export const getCsrfToken = ({ server }) => {
  // Retrieve a CSRF token from Sonador to allow

  return fetch(sonadorUrl('auth/api/cred/csrf-token').href, {
    headers: DICOMWeb.getAuthorizationHeader(server),
    credentials: 'include',
  }).then((res) => res.json());
};
