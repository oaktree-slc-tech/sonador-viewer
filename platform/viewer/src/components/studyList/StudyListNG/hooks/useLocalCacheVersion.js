// Force-rerender hook for local/offline cache state (ohif-viewers#125).
//
// Study-list surfaces (row badge/font weight, action menu, Download Manager launcher) need to react
// to cache and download-job changes. The underlying state lives in LocalCacheService /
// DownloadManagerService (module singletons, read synchronously), so this hook simply bumps a
// version counter whenever those services broadcast, triggering a re-render of the consumer.

import { useEffect, useRef, useState } from 'react';

import { LocalCacheService, DownloadManagerService } from '@ohif/core';

// Coalesce the flurry of per-instance events emitted during a large download into at most one
// re-render per interval, so the studies table / Download Manager update smoothly instead of
// re-rendering hundreds of times.
const THROTTLE_MS = 200;

export default function useLocalCacheVersion() {
  const [version, setVersion] = useState(0);
  const pendingRef = useRef(null);

  useEffect(() => {
    const bump = () => {
      if (pendingRef.current) {
        return;
      }
      pendingRef.current = setTimeout(() => {
        pendingRef.current = null;
        setVersion(v => v + 1);
      }, THROTTLE_MS);
    };

    const subs = [];
    if (LocalCacheService) {
      subs.push(LocalCacheService.subscribe(LocalCacheService.EVENTS.STUDY_CACHE_UPDATED, bump));
    }
    if (DownloadManagerService) {
      subs.push(
        DownloadManagerService.subscribe(DownloadManagerService.EVENTS.JOB_STATE_CHANGED, bump),
        DownloadManagerService.subscribe(DownloadManagerService.EVENTS.JOB_PROGRESS, bump),
        DownloadManagerService.subscribe(DownloadManagerService.EVENTS.JOB_QUEUED, bump)
      );
    }

    return () => {
      subs.forEach(s => s.unsubscribe());
      if (pendingRef.current) {
        clearTimeout(pendingRef.current);
        pendingRef.current = null;
      }
    };
  }, []);

  return version;
}

export { useLocalCacheVersion };
