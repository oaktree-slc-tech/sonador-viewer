// Display Attributes: the orthanc-sonador plugin's group-curated overlay attribute collections.
//
// `GET /display-attributes` returns `{ groups: [{ id, name, manage }], tags: [...] }` for the
// caller; `/groups/<id>/display-attributes[/<uuid>]` is the per-group collection. The permission
// header carries `display_attr` / `display_attr_modify`. Unlike the older group APIs here, every
// helper checks `res.ok` and surfaces the plugin's message on failure.

import { urlUtil } from '@ohif/core/src/utils';

import { getAuthToken } from './sonador';

const PERMISSIONS_HEADER = 'sonador-permissions';

/**
 * Message for a failed plugin response: the body's `message`, the first field error, or the
 * HTTP status.
 */
export function failureMessage(status, body) {
  if (body && typeof body === 'object') {
    if (body.message) {
      return body.message;
    }

    const errors = body.errors && typeof body.errors === 'object' ? Object.values(body.errors).flat() : [];
    const first = errors.find(entry => entry && entry.message);
    if (first) {
      return first.message;
    }

    if (body.error) {
      return body.error;
    }
  }

  if (typeof body === 'string' && body.trim()) {
    return body.trim();
  }

  return `HTTP ${status}`;
}

/**
 * Permission flags carried on a collection GET, when the plugin exposed the header.
 */
export function parsePermissionsHeader(headers) {
  const raw = headers && typeof headers.get === 'function' ? headers.get(PERMISSIONS_HEADER) : null;
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    return { display_attr: !!parsed.display_attr, display_attr_modify: !!parsed.display_attr_modify };
  } catch (err) {
    return null;
  }
}

async function parseResponse(res) {
  const text = await res.text();
  let body = null;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch (err) {
      body = text;
    }
  }

  if (!res.ok) {
    const error = new Error(failureMessage(res.status, body));
    error.status = res.status;
    error.body = body;
    throw error;
  }

  return body;
}

function request(server, path, { method = 'GET', body } = {}) {
  if (!server || !server.rootUrl) {
    return Promise.reject(new Error('Unable to reach the imaging server: no plugin root URL'));
  }

  const init = { method, headers: { Authorization: `Bearer ${getAuthToken()}` } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  return fetch(urlUtil.urlJoin(server.rootUrl, ...path), init);
}

const groupId = group => (group && typeof group === 'object' ? group.id : group);

export function getDisplayAttributes(server) {
  return request(server, ['display-attributes']).then(parseResponse).then(body => ({
    groups: Array.isArray(body && body.groups) ? body.groups : [],
    tags: Array.isArray(body && body.tags) ? body.tags : [],
  }));
}

export function getDisplayAttributeCollection(server, group) {
  return request(server, ['groups', groupId(group), 'display-attributes']).then(async res => {
    const permissions = parsePermissionsHeader(res.headers);
    const body = await parseResponse(res);

    return { tags: Array.isArray(body) ? body : [], permissions };
  });
}

export function createDisplayAttribute(server, group, { Code, Label }) {
  const payload = { Code };
  if (Label) {
    payload.Label = Label;
  }

  return request(server, ['groups', groupId(group), 'display-attributes'], { method: 'POST', body: payload }).then(parseResponse);
}

export function updateDisplayAttribute(server, group, id, { Label }) {
  return request(server, ['groups', groupId(group), 'display-attributes', id], {
    method: 'PUT',
    body: { Label: Label || null },
  }).then(parseResponse);
}

export function removeDisplayAttribute(server, group, id) {
  return request(server, ['groups', groupId(group), 'display-attributes', id], { method: 'DELETE' }).then(parseResponse);
}
