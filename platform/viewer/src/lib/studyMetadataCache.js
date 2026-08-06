// Client-side study/series metadata cache eviction.
//
// The study drawer's thumbnail rail is served by THREE caches, and `@tanstack/react-query` owns
// only the outermost one. Invalidating a query key alone does not refetch from the server — the
// refetch runs, hits a memoised promise, and returns pre-change data. Anything that changes which
// studies or series exist has to come through here first.
//
//   1. `retrieveStudyMetadata` memoises its promise per StudyInstanceUID in a module-level Map and
//      returns it unless `options.force_fetch` is set. `loadStudies` (useSeriesMetadata) passes no
//      options, so this Map is authoritative for the rail and, until a full page reload, nothing
//      cleared it.
//   2. `studyMetadataManager` is written by `updateStudyMetadataManager`, which inserts only when
//      the study is ABSENT — a stale entry is never refreshed in place, so it survives a refetch.
//   3. `DisplaySetService` accumulates the display sets `loadStudies` adds on every fetch; nothing
//      removes the ones whose series no longer exists, so `getDisplaySetByUID` keeps resolving it.
//
// Deliberately NOT solved by passing `force_fetch` in `loadStudies`: that function is shared by
// every drawer consumer, and defeating the memoisation for all of them would trade correctness on
// a rare mutation for redundant metadata requests on every drawer open.

import { display, studies, utils } from '@ohif/core';


const _displaySetService = () => display.DisplaySetApi.Instance?.displaySetService;


export function purgeRemovedResourceMetadata({ StudyInstanceUID, SeriesInstanceUID }) {
  // Evict the caches for a resource that has just been REMOVED from the server.
  //
  // Display sets are dropped here, unlike in the refresh path below, because the resource is gone:
  // a lingering display set for a deleted series keeps `getDisplaySetByUID` resolving something
  // that no longer exists anywhere.

  const displaySetService = _displaySetService();

  if (SeriesInstanceUID) {
    // Series removal: only this series' display sets go. The surviving series are re-derived by
    // the refetch, and their current display sets stay valid until then.
    displaySetService?.getDisplaySetsBy(
      (ds) => ds.SeriesInstanceUID === SeriesInstanceUID
    ).forEach((ds) => displaySetService.deleteDisplaySet(ds.displaySetInstanceUID));
  } else if (StudyInstanceUID) {
    // Study removal: the whole study is gone, so nothing under it is worth keeping.
    displaySetService?.getDisplaySetsForStudy(StudyInstanceUID)
      .forEach((ds) => displaySetService.deleteDisplaySet(ds.displaySetInstanceUID));
  }

  if (StudyInstanceUID) {
    studies.deleteStudyMetadataPromise(StudyInstanceUID);
    utils.studyMetadataManager.remove(StudyInstanceUID);
  }
}


export function purgeAllStudyMetadata() {
  // Evict every study's cached metadata, for a user-initiated study-list refresh.
  //
  // A refresh cannot name the studies whose metadata happens to be memoised, and the change it is
  // reaching for may have been made somewhere this tab never saw — the viewer opens in a separate
  // tab, so a series saved there (an SR document, say) is invisible to this one's caches. Dropping
  // the lot is the only honest answer to "retrieve the latest results from the server", and it is
  // cheap: clearing the Maps costs nothing, and only queries that are actually mounted refetch.
  //
  // Display sets are deliberately NOT purged here, unlike the removal path above. Nothing has been
  // deleted, an open drawer is still rendering from the ones it has, and `loadStudies` re-adds
  // fresh ones as each refetch lands. Dropping them would blank out the Metadata panel's lookups
  // until the network round trip completed, to fix nothing.

  studies.purgeStudyMetadataPromises();
  utils.studyMetadataManager.purge();
}
