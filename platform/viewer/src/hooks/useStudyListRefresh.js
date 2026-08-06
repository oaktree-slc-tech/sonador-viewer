import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { purgeAllStudyMetadata } from '../lib/studyMetadataCache';
import { SERIES_METADATA_QUERY_KEY } from './queryKeys';


export default function useStudyListRefresh() {
  // The study list's Refresh control: "retrieve the latest results from the server".
  //
  // Every study-list surface (study list, worklist, shared-with-me, recent uploads) had the same
  // three lines — a random `forceRerender` seed threaded into `useStudies({ isForce })` — which
  // refreshed the ROWS and nothing else. `searchStudies` honours `isForce` and re-queries QIDO, so
  // that half worked.
  //
  // What it did not do is reach the study drawer. The drawer's series come from
  // `retrieveStudyMetadata`, which memoises its promise per study in a module-level Map that
  // `isForce` never touched, so the rail kept serving whatever it had first seen. A series added
  // from another tab — saving an SR document from the viewer, which opens in its own tab — stayed
  // invisible no matter how many times the list was refreshed, until a full page reload cleared
  // the Map. That reload is what made the data appear, and it is the tell: the staleness was
  // entirely in module state, not on the server.
  //
  // So a refresh now does all three things: drop the memoised metadata, invalidate the drawer
  // queries so anything open refetches, and re-seed `isForce` for the row query.
  //
  // KNOWN LIMITATION — studies with an OFFLINE COPY are not refreshed by this.
  // `retrieveStudyMetadata` has a fourth cache: when LocalCacheService holds a study's metadata
  // payload it replays that instead of going to the network, and like the promise Map it is
  // skipped only for `force_fetch`. So for a study saved offline, purging the promise Map just
  // means the rebuild reads the cached payload instead — a series added elsewhere stays invisible
  // until the offline copy is re-downloaded. Not fixed here on purpose: the fix is to force-fetch,
  // which would defeat the network-free open that offline caching (ohif-viewers#125) exists to
  // provide, on every refresh, for every cached study. Whether a user-initiated refresh should
  // override an explicitly-saved offline copy is a product decision, not a cache-plumbing one.

  const queryClient = useQueryClient();
  const [forceRerender, setForceRerender] = useState(() => Math.random());

  const refreshApp = useCallback(() => {
    // Purge BEFORE invalidating: the refetch the invalidation triggers has to miss the memoised
    // promise, or it resolves against the same stale data and nothing changes.
    purgeAllStudyMetadata();
    queryClient.invalidateQueries({ queryKey: [SERIES_METADATA_QUERY_KEY] });

    setForceRerender(Math.random());
  }, [queryClient]);

  return { forceRerender, refreshApp };
}
