// Force-rerender hook for archive-export state (ohif-viewers#52).
//
// Direct analogue of useLocalCacheVersion, and deliberately a SEPARATE hook rather than an
// extension of it (#52 AR-6). The two features are independent: extending useLocalCacheVersion to
// cover both services would make an archive export re-render the Offline Storage badge and vice
// versa, quietly coupling two queues the whole design keeps apart.
//
// The state lives in ArchiveDownloadService (a module singleton, read synchronously), so this hook
// only bumps a version counter when the service broadcasts, triggering a re-render of the consumer.

import { useEffect, useRef, useState } from 'react';

import { ArchiveDownloadService } from '@ohif/core';

// The service already throttles its progress events at the source, but a 5 GB archive at 200 ms
// still means five events a second, times however many jobs are running. Coalesce them into at
// most one re-render per interval so the toolbar updates smoothly.
const THROTTLE_MS = 200;

export default function useArchiveDownloadVersion() {
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
    if (ArchiveDownloadService) {
      subs.push(
        ArchiveDownloadService.subscribe(ArchiveDownloadService.EVENTS.JOB_QUEUED, bump),
        ArchiveDownloadService.subscribe(ArchiveDownloadService.EVENTS.JOB_PROGRESS, bump),
        ArchiveDownloadService.subscribe(ArchiveDownloadService.EVENTS.JOB_STATE_CHANGED, bump)
      );
    }

    return () => {
      // Both halves matter on unmount: the subscriptions would otherwise stack up across remounts
      // of the study list, and a pending timeout would fire setState on a dead component.
      subs.forEach(s => s.unsubscribe());
      if (pendingRef.current) {
        clearTimeout(pendingRef.current);
        pendingRef.current = null;
      }
    };
  }, []);

  return version;
}

export { useArchiveDownloadVersion };
