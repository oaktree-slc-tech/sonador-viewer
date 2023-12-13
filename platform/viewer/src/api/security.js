import DICOMWeb from '@ohif/core/src/DICOMWeb';
import { sonadorUrl } from './sonador.js';

export const fetchTokens = (server) => {
  return fetch(sonadorUrl('auth/api/cred/token').href, {
    headers: DICOMWeb.getAuthorizationHeader(server),
    credentials: 'include',
  }).then((res) => res.json());
};

export const createToken = ({ server, description, csrfToken }) => {
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
  return fetch(sonadorUrl('auth/api/cred/token').href, {
    headers: DICOMWeb.getAuthorizationHeader(server),
    credentials: 'include',
  }).then((res) => res.json());
};

export const createAccessIdAndSecretKey = ({ server, description, csrfToken }) => {
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
  return fetch(sonadorUrl('auth/api/cred/csrf-token').href, {
    headers: DICOMWeb.getAuthorizationHeader(server),
    credentials: 'include',
  }).then((res) => res.json());
};
