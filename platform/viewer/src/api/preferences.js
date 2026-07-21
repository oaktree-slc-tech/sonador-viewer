import { urlUtil } from '@ohif/core/src/utils';

import { PREFERENCE_SECTION_PATHS } from '../constants/preferences';

import { getAuthToken, sonadorUrl } from './sonador';

// Treat non-2xx responses as failures (FR-8): `fetch` resolves on HTTP errors, so without this
// check the mutation success paths fire on 400/500 responses. The HTTP status is attached to
// the thrown error so the write queue can classify the failure (FR-21: 400 drop, 401/403 hold,
// network/5xx retry).
const rejectOnHTTPError = (res) => {
  if (!res.ok) {
    const error = new Error(`User preferences request failed with HTTP ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return res;
};

const sectionUrl = (section) => {
  const path = PREFERENCE_SECTION_PATHS[section];
  if (!path) {
    throw new Error(`Unknown user-preference section: ${section}`);
  }
  return sonadorUrl(urlUtil.urlJoin(`/visionaire/api/user-preferences/${path}/`));
};

export const getUserPreferences = () => {
  return fetch(sonadorUrl(urlUtil.urlJoin(`/visionaire/api/user-preferences/`)), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${getAuthToken()}`,
    },
    credentials: 'omit',
  })
    .then(rejectOnHTTPError)
    .then((res) => res.json())
    // The whole-document GET (guru GuruApiDetailsMixin -> model_to_dict) returns the BARE
    // document -- {user, viewer, studylist} with no `results` envelope -- unlike the section
    // endpoints, which wrap in operation_results. Accept both shapes so hydration keeps
    // working if the endpoint is ever brought in line with the envelope convention.
    .then((res) => (res && res.results) || res || {});
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
    .then(rejectOnHTTPError)
    .then((res) => res.json())
    .then((res) => res.results);
};

export const getUserPreferenceSection = (section, version) => {
  // Retrieve `{ version, values }` for a single preference section; `values` is empty when
  // nothing is stored for that version (FR-3). Version resolution/backfill is the caller's
  // concern (FR-10).

  const url = sectionUrl(section);
  if (version) {
    url.searchParams.set('version', version);
  }

  return fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${getAuthToken()}`,
    },
    credentials: 'omit',
  })
    .then(rejectOnHTTPError)
    .then((res) => res.json())
    .then((res) => res.results || {});
};

export const updateUserPreferenceSection = (section, payload) => {
  // POST `{ version, values }` to a section endpoint. Viewer sections replace the whole
  // section under that version; the `studylist` section merges at the interface level and
  // returns the full stored version document (FR-14).

  return fetch(sectionUrl(section), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getAuthToken()}`,
    },
    credentials: 'omit',
    body: JSON.stringify(payload),
  })
    .then(rejectOnHTTPError)
    .then((res) => res.json())
    .then((res) => res.results);
};
