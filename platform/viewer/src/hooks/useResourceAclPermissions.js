import { useCallback, useEffect, useRef, useState } from 'react';

import { DicomMetadataStore } from '@ohif/core';

import { fetchSeriesAclPermissions, fetchStudyAclPermissions } from '../api/ext';


// One in-flight request per resource, shared across every component that asks for it.
//
// The viewer renders one series-actions menu per thumbnail, and a study can easily have a dozen.
// Without this, mounting the sidepanel would fire a dozen identical study `resource-acl` requests
// at once. Keyed by wadoRoot as well as UID so switching servers cannot serve one server's answer
// for another's.
const _inFlight = new Map();

const _key = (server, kind, uid) => `${server?.wadoRoot || ''}::${kind}::${uid}`;


function _share(server, kind, uid, fetcher) {
  const key = _key(server, kind, uid);
  const existing = _inFlight.get(key);

  if (existing) {
    return existing;
  }

  const promise = fetcher()
    .then((resourcePerms) => resourcePerms?.perms || {})
    .catch(() => ({}))   // a failed lookup grants nothing; it must not strand the caller
    .finally(() => _inFlight.delete(key));

  _inFlight.set(key, promise);

  return promise;
}


export default function useResourceAclPermissions({ server, StudyInstanceUID, SeriesInstanceUID }) {
  // Resolve the effective `view` / `remove` grants for a series (ohif-viewers#127, FR-8/FR-9).
  //
  // Two ACL scopes, combined as an OR: the study-or-server grant, and the series grant. A series
  // grant authorises where the study grant does not, and the study grant covers its series by
  // inheritance. `activeServer.perms.*` is wildcard-only — true for a superuser or a
  // `resource: '*'` group policy and nothing else — so gating on it alone would hide these actions
  // from exactly the users the ACL system exists to serve.
  //
  // The STUDY grant resolves eagerly, on mount. That is a deliberate departure from the study-list
  // drawer, which resolves it lazily on menu open: here the grant decides whether the menu's
  // TRIGGER renders at all, and a trigger that has to be opened before it can decide whether to
  // exist is a contradiction. It is one shared request per study (see _inFlight) and the answer is
  // cached on DicomMetadataStore, so the cost is a single round trip for the whole sidepanel.
  //
  // The SERIES grant stays lazy, on menu open, because it can only ever ADD an item to a menu that
  // is already showing — never decide whether the trigger exists.

  const studyMeta = StudyInstanceUID ? DicomMetadataStore.getStudyMetadata(StudyInstanceUID) : undefined;

  const [studyPerms, setStudyPerms] = useState(() => studyMeta?.perms || null);
  const [seriesPerms, setSeriesPerms] = useState(null);

  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  useEffect(() => {
    // Eager study-scope resolution. Skipped when the store already has the answer.
    if (!server || !StudyInstanceUID || studyPerms) {
      return;
    }

    _share(server, 'studies', StudyInstanceUID,
      () => fetchStudyAclPermissions(server, StudyInstanceUID)
    ).then((perms) => {
      DicomMetadataStore.updateStudyMetadata({ StudyInstanceUID, perms });

      if (mounted.current) {
        setStudyPerms(perms);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, StudyInstanceUID]);

  const resolveSeriesAcl = useCallback(() => {
    // Lazy series-scope resolution, issued when the menu opens.
    if (!server || !SeriesInstanceUID || seriesPerms) {
      return;
    }

    _share(server, 'series', SeriesInstanceUID,
      () => fetchSeriesAclPermissions(server, SeriesInstanceUID)
    ).then((perms) => {
      if (mounted.current) {
        setSeriesPerms(perms);
      }
    });
  }, [server, SeriesInstanceUID, seriesPerms]);

  return {
    aclView: !!(server?.perms?.view || studyPerms?.View || seriesPerms?.View),
    aclRemove: !!(server?.perms?.remove || studyPerms?.Remove || seriesPerms?.Remove),
    resolveSeriesAcl,
  };
}


export { _inFlight as __inFlightForTests };
