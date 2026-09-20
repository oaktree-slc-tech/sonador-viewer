/**
 * @jest-environment ./src/__tests__/jsdomEnvironment.js
 */
// Rendered tests for the ACL hook's state binding: an answer belongs to the resource it was
// fetched for, a local comment denial is not re-enabled by a broader grant, and a change of grant
// reaches the hook.

import React, { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

const listeners = {};
const studies = {};

jest.mock('@ohif/core', () => ({
  DicomMetadataStore: {
    EVENTS: { STUDY_UPDATED: 'STUDY_UPDATED' },
    getStudyMetadata: (uid) => studies[uid],
    updateStudyMetadata: ({ StudyInstanceUID, ...fields }) => {
      studies[StudyInstanceUID] = { ...(studies[StudyInstanceUID] || {}), ...fields };
      (listeners.STUDY_UPDATED || []).forEach((cb) => cb({ StudyInstanceUID, studyMetadata: studies[StudyInstanceUID] }));
    },
    subscribe: (event, cb) => {
      (listeners[event] = listeners[event] || []).push(cb);
      return { unsubscribe: () => listeners[event].splice(listeners[event].indexOf(cb), 1) };
    },
  },
}));

const pending = { studies: {}, series: {} };
const slot = (server, uid) => (server.wadoRoot === 'https://other.test/dicom-web' ? `other:${uid}` : uid);
const deferred = (bucket, key) => new Promise((resolve) => { pending[bucket][key] = resolve; });

jest.mock('../api/ext', () => ({
  fetchStudyAclPermissions: (server, uid) => deferred('studies', slot(server, uid)),
  fetchSeriesAclPermissions: (server, uid) => deferred('series', slot(server, uid)),
}));

import useResourceAclPermissions, { __inFlightForTests } from './useResourceAclPermissions';

global.IS_REACT_ACT_ENVIRONMENT = true;

const SERVER = { wadoRoot: 'https://orthanc.test/dicom-web', perms: {} };
const OTHER_SERVER = { wadoRoot: 'https://other.test/dicom-web', perms: {} };
const STUDY_A = '1.2.3.4';
const STUDY_B = '1.2.3.9';
const SERIES_A = '1.2.3.4.5';
const SERIES_B = '1.2.3.4.6';

let latest;
let api;

function Probe({ server, StudyInstanceUID, SeriesInstanceUID }) {
  const result = useResourceAclPermissions({ server, StudyInstanceUID, SeriesInstanceUID });
  latest = result;
  useEffect(() => {
    api = result;
  });
  return null;
}

let container;
let root;

const render = (props) => {
  act(() => {
    root.render(<Probe {...props} />);
  });
};

const answer = (bucket, uid, perms) => act(async () => {
  pending[bucket][uid]({ perms });
  await Promise.resolve();
  await Promise.resolve();
});

const emitStudyUpdated = (uid, perms, permsServer = SERVER.wadoRoot) => act(() => {
  (listeners.STUDY_UPDATED || []).forEach((cb) => cb({ StudyInstanceUID: uid, studyMetadata: { perms, permsServer } }));
});

beforeEach(() => {
  Object.keys(studies).forEach((k) => delete studies[k]);
  Object.keys(listeners).forEach((k) => delete listeners[k]);
  pending.studies = {};
  pending.series = {};
  __inFlightForTests.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});


describe('answers are bound to the resource they were fetched for', () => {
  it("ignores series A's reply once the hook points at series B", async () => {
    render({ server: SERVER, StudyInstanceUID: STUDY_A, SeriesInstanceUID: SERIES_A });
    await answer('studies', STUDY_A, { View: true, CommentEdit: false, Remove: false });
    act(() => { api.resolveSeriesAcl(); });

    render({ server: SERVER, StudyInstanceUID: STUDY_A, SeriesInstanceUID: SERIES_B });
    act(() => { api.resolveSeriesAcl(); });

    // A's grant arrives late, after the switch to B.
    await answer('series', SERIES_A, { View: true, CommentEdit: true, Remove: true });

    expect(latest.aclCommentEdit).toBe(false);
    expect(latest.aclRemove).toBe(false);
    expect(latest.commentGrantsResolved).toBe(false);

    await answer('series', SERIES_B, { View: true, CommentEdit: false, Remove: false });
    expect(latest.commentGrantsResolved).toBe(true);
    expect(latest.aclCommentEdit).toBe(false);
  });

  it('fetches an uncached study after switching from a cached one', async () => {
    studies[STUDY_A] = { perms: { View: true, CommentEdit: true }, permsServer: SERVER.wadoRoot };
    render({ server: SERVER, StudyInstanceUID: STUDY_A });
    expect(latest.aclCommentEdit).toBe(true);
    expect(pending.studies[STUDY_A]).toBeUndefined();

    render({ server: SERVER, StudyInstanceUID: STUDY_B });
    // No grant is shown for B until B's own answer arrives, and B is actually requested.
    expect(latest.aclCommentEdit).toBe(false);
    expect(pending.studies[STUDY_B]).toBeDefined();

    await answer('studies', STUDY_B, { View: true, CommentEdit: true });
    expect(latest.aclCommentEdit).toBe(true);
  });
});


describe('comment grants take the most specific answer', () => {
  it('a series-level CommentEdit denial is not overridden by the study grant', async () => {
    studies[STUDY_A] = { perms: { View: true, CommentEdit: true, Remove: true }, permsServer: SERVER.wadoRoot };
    render({ server: SERVER, StudyInstanceUID: STUDY_A, SeriesInstanceUID: SERIES_A });

    // Study says yes; nothing is offered until the series has answered.
    expect(latest.aclCommentEdit).toBe(false);
    expect(latest.commentGrantsResolved).toBe(false);

    act(() => { api.resolveSeriesAcl(); });
    await answer('series', SERIES_A, { View: true, CommentEdit: false, Remove: true });

    expect(latest.aclCommentEdit).toBe(false);
    // remove stays additive, so the study's grant still counts.
    expect(latest.aclRemove).toBe(true);
  });

  it('a server wildcard comment grant does not override a study-level denial', async () => {
    studies[STUDY_A] = { perms: { View: true, CommentEdit: false }, permsServer: SERVER.wadoRoot };
    render({ server: { ...SERVER, perms: { comment_edit: true } }, StudyInstanceUID: STUDY_A });

    expect(latest.aclCommentEdit).toBe(false);
  });
});


describe('grant changes reach the hook', () => {
  it('a study update revoking CommentEdit turns the grant off', async () => {
    studies[STUDY_A] = { perms: { View: true, CommentEdit: true }, permsServer: SERVER.wadoRoot };
    render({ server: SERVER, StudyInstanceUID: STUDY_A });
    expect(latest.aclCommentEdit).toBe(true);

    emitStudyUpdated(STUDY_A, { View: true, CommentEdit: false });
    expect(latest.aclCommentEdit).toBe(false);

    // Another study's update is not applied to this one.
    emitStudyUpdated(STUDY_B, { View: true, CommentEdit: true });
    expect(latest.aclCommentEdit).toBe(false);
  });

  it('a forced series resolution re-fetches and applies the new answer', async () => {
    studies[STUDY_A] = { perms: { View: true }, permsServer: SERVER.wadoRoot };
    render({ server: SERVER, StudyInstanceUID: STUDY_A, SeriesInstanceUID: SERIES_A });
    act(() => { api.resolveSeriesAcl(); });
    await answer('series', SERIES_A, { View: true, CommentEdit: true });
    expect(latest.aclCommentEdit).toBe(true);

    // A plain resolve keeps the held answer; a forced one asks again.
    delete pending.series[SERIES_A];
    act(() => { api.resolveSeriesAcl(); });
    expect(pending.series[SERIES_A]).toBeUndefined();

    act(() => { api.resolveSeriesAcl({ force: true }); });
    expect(pending.series[SERIES_A]).toBeDefined();
    await answer('series', SERIES_A, { View: true, CommentEdit: false });
    expect(latest.aclCommentEdit).toBe(false);
  });
});


describe('the same study UID on another imaging server is another resource', () => {
  it("does not reuse server A's cached grants for server B, and fetches B", async () => {
    studies[STUDY_A] = { perms: { View: true, CommentEdit: true, Remove: true }, permsServer: SERVER.wadoRoot };
    render({ server: SERVER, StudyInstanceUID: STUDY_A });
    expect(latest.aclCommentEdit).toBe(true);
    expect(latest.aclRemove).toBe(true);

    render({ server: OTHER_SERVER, StudyInstanceUID: STUDY_A });
    expect(latest.aclCommentEdit).toBe(false);
    expect(latest.aclRemove).toBe(false);
    expect(pending.studies[`other:${STUDY_A}`]).toBeDefined();

    await answer('studies', `other:${STUDY_A}`, { View: true, CommentEdit: false, Remove: false });
    expect(latest.aclCommentEdit).toBe(false);
    expect(latest.aclRemove).toBe(false);
  });

  it("a late reply from server A does not overwrite server B's confirmed denial, nor the store", async () => {
    render({ server: SERVER, StudyInstanceUID: STUDY_A });
    expect(pending.studies[STUDY_A]).toBeDefined();

    render({ server: OTHER_SERVER, StudyInstanceUID: STUDY_A });
    await answer('studies', `other:${STUDY_A}`, { View: true, CommentEdit: false, Remove: false });
    expect(latest.aclCommentEdit).toBe(false);

    // Server A's grant lands afterwards.
    await answer('studies', STUDY_A, { View: true, CommentEdit: true, Remove: true });

    expect(latest.aclCommentEdit).toBe(false);
    expect(latest.aclRemove).toBe(false);
    expect(studies[STUDY_A].permsServer).toBe(OTHER_SERVER.wadoRoot);
    expect(studies[STUDY_A].perms.CommentEdit).toBe(false);
  });

  it("an unscoped or other-server study update is not taken as this server's answer", async () => {
    studies[STUDY_A] = { perms: { View: true, CommentEdit: false }, permsServer: SERVER.wadoRoot };
    render({ server: SERVER, StudyInstanceUID: STUDY_A });
    expect(latest.aclCommentEdit).toBe(false);

    emitStudyUpdated(STUDY_A, { View: true, CommentEdit: true }, OTHER_SERVER.wadoRoot);
    expect(latest.aclCommentEdit).toBe(false);

    emitStudyUpdated(STUDY_A, { View: true, CommentEdit: true }, null);
    expect(latest.aclCommentEdit).toBe(false);

    emitStudyUpdated(STUDY_A, { View: true, CommentEdit: true });
    expect(latest.aclCommentEdit).toBe(true);
  });
});
