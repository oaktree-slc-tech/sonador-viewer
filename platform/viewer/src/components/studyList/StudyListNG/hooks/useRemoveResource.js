import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import {
  LocalCacheService,
  DownloadManagerService,
  uiNotificationService,
} from '@ohif/core';

import { removeSeries, removeStudy } from '../../../../api/ext';
import { purgeRemovedResourceMetadata } from '../../../../lib/studyMetadataCache';
// From the leaf queryKeys module, NOT from the hooks that define the queries: useSeriesMetadata
// imports '../App', and this hook is imported by the cornerstone extension's toolbar.
import { SERIES_METADATA_QUERY_KEY, STUDY_LIST_QUERY_KEY } from '../../../../hooks/queryKeys';
import {
  describeSeries,
  describeStudy,
  summariseBulkRemoval,
} from '../components/RemoveResourceConfirm/describeRemoval';


// How many removals run at once in a bulk action. Bounded so a fifty-study selection does not
// open fifty concurrent DELETEs against the gateway, each of which fans out to an Orthanc cascade
// delete; sequential would be needlessly slow for a selection of ten.
const MAX_CONCURRENT_REMOVALS = 3;


const _evictOfflineCopy = async (StudyInstanceUID) => {
  // FR-14: a study removed from the server takes its offline copy with it.
  //
  // The cache exists to mirror server-side data for offline review. Keeping a local copy of data
  // an authorised user has deliberately destroyed is both surprising and a data-retention hazard —
  // the study is gone everywhere the user can see except the one place they cannot audit.
  //
  // Best-effort: a cache that will not evict must not fail, or appear to fail, the removal that
  // already succeeded on the server. It raises a warning and the removal still reports success.
  if (!LocalCacheService?.isStudyCachedSync?.(StudyInstanceUID)) {
    return;
  }

  try {
    DownloadManagerService?.cancelStudy?.(StudyInstanceUID);
    await LocalCacheService.removeStudy(StudyInstanceUID);
  } catch (err) {
    uiNotificationService.show({
      title: 'Offline copy not removed',
      message: 'The study was removed from the imaging server, but its offline copy could not be '
        + 'evicted from this browser. Remove it from Offline Storage.',
      type: 'warning',
      autoClose: false,
      studyInstanceUID: StudyInstanceUID,
      error: err,
    });
  }
};


const _notifyFailure = ({ title, message, err, StudyInstanceUID, SeriesInstanceUID }) => {
  // FR-13: a failed removal is visible and diagnosable. Sticky, because a transient toast for a
  // destructive operation that did NOT happen is worse than no toast — the user walks away
  // believing it did. `error` and the UIDs put it in the Issues list with the request URL, the
  // HTTP status and the response body attached.
  uiNotificationService.show({
    title,
    message,
    type: 'error',
    autoClose: false,
    studyInstanceUID: StudyInstanceUID,
    seriesInstanceUID: SeriesInstanceUID,
    details: { url: err?.url, status: err?.status, body: err?.body },
    error: err,
  });
};


export default function useRemoveResource() {
  // Removal orchestration shared by the three entry points: the drawer's series Actions menu, the
  // study-list row menu, and the bulk toolbar. Owns the in-flight flag the confirmation disables
  // its button from, the offline-cache eviction, the notifications, and the cache invalidation.
  //
  // AR-7: results flow back through the existing react-query cache. Nothing here reaches into
  // table state to splice a row out, and nothing forces a page reload.

  const queryClient = useQueryClient();
  const [isRemoving, setIsRemoving] = useState(false);

  const invalidateStudyList = useCallback(() => {
    return queryClient.invalidateQueries({ queryKey: [STUDY_LIST_QUERY_KEY] });
  }, [queryClient]);

  const invalidateSeriesMetadata = useCallback((server, StudyInstanceUID) => {
    // useSeriesMetadata keys on [SERIES_METADATA_QUERY_KEY, JSON.stringify(server), studyId];
    // refetching re-derives the display sets from the server, which is what drops the removed
    // series from the thumbnail rail.
    return queryClient.invalidateQueries({
      queryKey: [SERIES_METADATA_QUERY_KEY, JSON.stringify(server), StudyInstanceUID],
    });
  }, [queryClient]);


  const removeOneStudy = useCallback(async (server, descriptor) => {
    // Remove a single study. Resolves true on success (including an already-removed 404),
    // false on failure — the bulk path counts these rather than aborting on the first error.
    const { StudyInstanceUID } = descriptor || {};

    if (!StudyInstanceUID) {
      return false;
    }

    try {
      await removeStudy(server, StudyInstanceUID);
    } catch (err) {
      _notifyFailure({
        title: 'Study not removed',
        message: `${describeStudy(descriptor).title} could not be removed from the imaging server.`,
        err,
        StudyInstanceUID,
      });

      return false;
    }

    // Success path only: a throw in here must not report "not removed" for a study the server has
    // already destroyed.
    purgeRemovedResourceMetadata({ StudyInstanceUID });

    await _evictOfflineCopy(StudyInstanceUID);

    return true;
  }, []);


  const removeStudyResource = useCallback(async (server, descriptor) => {
    // Single-study removal, from the study-list row menu.
    setIsRemoving(true);

    try {
      const ok = await removeOneStudy(server, descriptor);

      if (ok) {
        uiNotificationService.show({
          title: 'Study removed',
          message: `${describeStudy(descriptor).title} was permanently removed from the imaging server.`,
          type: 'success',
          studyInstanceUID: descriptor.StudyInstanceUID,
          log: true,
        });

        await invalidateStudyList();
      }

      return ok;
    } finally {
      setIsRemoving(false);
    }
  }, [removeOneStudy, invalidateStudyList]);


  const removeStudiesResource = useCallback(async (server, descriptors = [], { deferRefresh = false } = {}) => {
    // Bulk removal, from the study-list toolbar.
    //
    // A partial failure is NOT rolled back (FR-13): the successful deletes have already happened
    // on the server and cannot be undone, so the honest reporting is one error notification per
    // failure plus a summary that states both numbers.
    //
    // `deferRefresh` hands the study-list invalidation back to the caller instead of firing it
    // here. The bulk toolbar uses it to hold the refresh until after the confirmation has closed:
    // refetching while N cascade deletes are still settling server-side was crashing the study
    // list, and the ordering is easier to reason about when one place owns it. Returns the counts
    // so the caller can report and time the rest of the sequence.
    setIsRemoving(true);

    try {
      const queue = [...descriptors];
      let removed = 0;

      const worker = async () => {
        while (queue.length) {
          const descriptor = queue.shift();
          const ok = await removeOneStudy(server, descriptor);

          if (ok) {
            removed += 1;
          }
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(MAX_CONCURRENT_REMOVALS, descriptors.length) }, worker)
      );

      uiNotificationService.show({
        title: summariseBulkRemoval({ removed, total: descriptors.length }),
        message: removed === descriptors.length
          ? 'The selected studies were permanently removed from the imaging server.'
          : 'Some studies could not be removed. See the individual errors for details.',
        type: removed === descriptors.length ? 'success' : 'warning',
        autoClose: removed === descriptors.length,
        log: true,
      });

      if (!deferRefresh) {
        await invalidateStudyList();
      }

      return { removed, total: descriptors.length };
    } finally {
      setIsRemoving(false);
    }
  }, [removeOneStudy, invalidateStudyList]);


  const removeSeriesResource = useCallback(async (server, descriptor) => {
    // Single-series removal, from the drawer's series Actions menu.
    const { SeriesInstanceUID, StudyInstanceUID } = descriptor || {};

    if (!SeriesInstanceUID) {
      return false;
    }

    setIsRemoving(true);

    try {
      try {
        await removeSeries(server, SeriesInstanceUID);
      } catch (err) {
        _notifyFailure({
          title: 'Series not removed',
          message: `${describeSeries(descriptor)} could not be removed from the imaging server.`,
          err,
          StudyInstanceUID,
          SeriesInstanceUID,
        });

        return false;
      }

      // Success path only, and BEFORE the invalidation below — the refetch that invalidation
      // triggers has to miss these caches, or it rebuilds the rail exactly as it was.
      purgeRemovedResourceMetadata({ StudyInstanceUID, SeriesInstanceUID });

      uiNotificationService.show({
        title: 'Series removed',
        message: `${describeSeries(descriptor)} was permanently removed from the imaging server.`,
        type: 'success',
        studyInstanceUID: StudyInstanceUID,
        seriesInstanceUID: SeriesInstanceUID,
        log: true,
      });

      // Removing the last series of a study removes the study too, by Orthanc's cascade, so the
      // study list is invalidated alongside the drawer's own series query.
      await Promise.all([
        invalidateSeriesMetadata(server, StudyInstanceUID),
        invalidateStudyList(),
      ]);

      return true;
    } finally {
      // Held across the notification and the invalidation, not just the DELETE, so the confirm
      // button cannot re-enable for a frame between the request settling and the overlay closing.
      setIsRemoving(false);
    }
  }, [invalidateSeriesMetadata, invalidateStudyList]);


  return {
    isRemoving,
    removeStudyResource,
    removeStudiesResource,
    removeSeriesResource,
    /** For callers that passed `deferRefresh` and own the timing themselves. */
    refreshStudyList: invalidateStudyList,
  };
}
