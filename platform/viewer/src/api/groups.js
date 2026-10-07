// Sonador group search for the group-scoped settings editors (Series Tags, Device Registry,
// Display Attributes). `filter` narrows the results to groups whose server policy sets the given
// flags, e.g. `{ display_attr: true }`.

import { sonador } from '@ohif/core';

export function searchGroups(server, term, filter) {
  if (!server || !server.token) {
    return Promise.resolve([]);
  }

  return sonador
    .searchImageServerGroups(server, term || '', { ...(filter || {}) })
    .then(res => {
      if (!res.ok) {
        throw new Error(`Group search failed: HTTP ${res.status}`);
      }

      return res.json();
    })
    .then(body => (Array.isArray(body && body.results) ? body.results : []));
}

export const groupSearchQueryKey = (server, filter, term) => [
  'groupSearch',
  server?.token || null,
  JSON.stringify(filter || {}),
  term || '',
];
