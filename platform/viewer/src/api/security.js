import DICOMWeb from '@ohif/core/src/DICOMWeb';

export const fetchTokens = (server) => {
  return fetch('https://imaging.gke.oak-tree.tech/auth/api/cred/token', {
    headers: DICOMWeb.getAuthorizationHeader(server),
    credentials: 'include',
  }).then((res) => res.json());
};

export const createToken = ({ server, description, csrfToken }) => {
  const headers = DICOMWeb.getAuthorizationHeader(server);
  headers['X-CSRFToken'] = csrfToken;

  return fetch('https://imaging.gke.oak-tree.tech/auth/api/cred/token', {
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
  return fetch('https://imaging.gke.oak-tree.tech/auth/api/cred/access', {
    headers: DICOMWeb.getAuthorizationHeader(server),
    credentials: 'include',
  }).then((res) => res.json());
};

export const createAccessIdAndSecretKey = ({ server, description, csrfToken }) => {
  const headers = DICOMWeb.getAuthorizationHeader(server);
  headers['X-CSRFToken'] = csrfToken;

  return fetch('https://imaging.gke.oak-tree.tech/auth/api/cred/access', {
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
  return fetch('https://imaging.gke.oak-tree.tech/auth/api/cred/csrf-token', {
    headers: DICOMWeb.getAuthorizationHeader(server),
    credentials: 'include',
  }).then((res) => res.json());
};
