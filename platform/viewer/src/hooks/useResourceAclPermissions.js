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

const _key = (server, kind, uid) => (server && uid ? `${server?.wadoRoot || ''}::${kind}::${uid}` : null);


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


// The metadata store is keyed by StudyInstanceUID alone, and the same UID can exist on two imaging
// servers. Grants written there carry the server they were fetched from (`permsServer`), and are
// read back only for that server; an entry without the marker, or from another server, is not an
// answer for this one.
const _storedStudyPerms = (server, StudyInstanceUID) => {
  if (!server || !StudyInstanceUID) {
    return null;
  }

  const meta = DicomMetadataStore.getStudyMetadata(StudyInstanceUID);

  return meta?.perms && meta.permsServer === server.wadoRoot ? meta.perms : null;
};


export default function useResourceAclPermissions({ server, StudyInstanceUID, SeriesInstanceUID }) {
  // Resolve the effective grants on a study or a series (ohif-viewers#127, FR-8/FR-9; #99).
  //
  // Every answer is stored with the key of the resource it was fetched for, and only read back
  // while the hook still points at that resource: a reply that lands after the caller has moved
  // to another study or series is ignored, and pointing at a new resource never shows the old
  // one's grants while the new answer is on its way.
  //
  // `view` / `remove` combine the study-or-server grant and the series grant as an OR: a series
  // grant authorises where the study grant does not, and the study grant covers its series by
  // inheritance. `activeServer.perms.*` is wildcard-only, true for a superuser or a `resource: '*'`
  // group policy and nothing else.
  //
  // Comment grants are NOT combined. Sonador's comment policy lets a local (series) denial override
  // a broader grant, so the most specific answer is taken as it stands: the series answer when a
  // series is shown (nothing until it has arrived), otherwise the study answer, otherwise the
  // server flags. Each answer already folds the global policy in, so nothing is lost by not
  // OR-ing.
  //
  // The STUDY grant resolves eagerly: it decides whether a menu's trigger renders at all. It is one
  // shared request per study and the answer is cached on DicomMetadataStore. The SERIES grant is
  // resolved on request (`resolveSeriesAcl`), and re-fetched when asked with `force`.

  const studyKey = _key(server, 'studies', StudyInstanceUID);
  const seriesKey = _key(server, 'series', SeriesInstanceUID);

  const [studyAnswer, setStudyAnswer] = useState(null);     // { key, perms }
  const [seriesAnswer, setSeriesAnswer] = useState(null);   // { key, perms }

  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  // What the hook currently points at, for replies to check against when they land.
  const current = useRef({ studyKey, seriesKey });
  current.current = { studyKey, seriesKey };

  const studyPerms = (studyAnswer?.key === studyKey ? studyAnswer.perms : null) || _storedStudyPerms(server, StudyInstanceUID);
  const seriesPerms = seriesAnswer?.key === seriesKey ? seriesAnswer.perms : null;

  const fetchStudy = useCallback(() => {
    if (!server || !StudyInstanceUID) {
      return;
    }

    const key = studyKey;

    const permsServer = server.wadoRoot;

    _share(server, 'studies', StudyInstanceUID,
      () => fetchStudyAclPermissions(server, StudyInstanceUID)
    ).then((perms) => {
      // A reply for a resource or server the hook has since left is dropped entirely; it is not
      // published to the shared store either, where it could displace the current answer.
      if (!mounted.current || current.current.studyKey !== key) {
        return;
      }

      DicomMetadataStore.updateStudyMetadata({ StudyInstanceUID, perms, permsServer });
      setStudyAnswer({ key, perms });
    });
  }, [server, StudyInstanceUID, studyKey]);

  useEffect(() => {
    // Eager study-scope resolution, once per resource the hook points at. Skipped when the store
    // already has the answer.
    if (!studyKey || studyPerms) {
      return;
    }

    fetchStudy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studyKey]);

  useEffect(() => {
    // A study's grants can change while it is on screen (the drawer refreshes them on open, and a
    // revocation arrives the same way). Follow the store rather than trusting the first answer.
    if (!server || !StudyInstanceUID || !DicomMetadataStore.subscribe) {
      return undefined;
    }

    const subscription = DicomMetadataStore.subscribe(
      DicomMetadataStore.EVENTS.STUDY_UPDATED,
      ({ StudyInstanceUID: updated, studyMetadata }) => {
        // Only an update that names this study AND this server is this study's answer.
        if (updated === StudyInstanceUID && studyMetadata?.perms
            && studyMetadata.permsServer === server.wadoRoot && mounted.current) {
          setStudyAnswer({ key: studyKey, perms: studyMetadata.perms });
        }
      }
    );

    return () => subscription?.unsubscribe?.();
  }, [server, StudyInstanceUID, studyKey]);

  const resolveSeriesAcl = useCallback(({ force = false } = {}) => {
    // Series-scope resolution, issued when a panel shows the series or a menu opens. `force`
    // re-fetches even when an answer is held, which is how a revoked grant is picked up.
    if (!server || !SeriesInstanceUID) {
      return;
    }

    if (!force && seriesAnswer?.key === seriesKey) {
      return;
    }

    const key = seriesKey;

    _share(server, 'series', SeriesInstanceUID,
      () => fetchSeriesAclPermissions(server, SeriesInstanceUID)
    ).then((perms) => {
      if (mounted.current && current.current.seriesKey === key) {
        setSeriesAnswer({ key, perms });
      }
    });
  }, [server, SeriesInstanceUID, seriesKey, seriesAnswer]);

  const refresh = useCallback(() => {
    // Re-fetch both scopes; used after the server refuses an action the UI offered.
    fetchStudy();
    resolveSeriesAcl({ force: true });
  }, [fetchStudy, resolveSeriesAcl]);

  const commentSource = SeriesInstanceUID ? seriesPerms : studyPerms;
  const commentGrant = (resourceFlag, serverFlag) => {
    if (SeriesInstanceUID) {
      return !!seriesPerms?.[resourceFlag];
    }

    return studyPerms ? !!studyPerms[resourceFlag] : !!server?.perms?.[serverFlag];
  };

  return {
    aclView: !!(server?.perms?.view || studyPerms?.View || seriesPerms?.View),
    aclRemove: !!(server?.perms?.remove || studyPerms?.Remove || seriesPerms?.Remove),
    aclCommentView: commentGrant('CommentView', 'comment_view'),
    aclCommentEdit: commentGrant('CommentEdit', 'comment_edit'),
    /** true once the answer the comment grants are read from has arrived. */
    commentGrantsResolved: !!commentSource,
    resolveSeriesAcl,
    refresh,
  };
}


export { _inFlight as __inFlightForTests };
