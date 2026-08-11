import { useEffect, useState } from 'react';

import { sonador } from '@ohif/core';

/** Identity of the server a system report belongs to. */
export const serverKeyOf = (server) => server?.rootUrl || server?.token || null;

/**
 * Narrow a stored report to the server currently being asked about.
 *
 * A report fetched for one imaging server must never be read as if it described another. React
 * commits the render in which `server` changes before the effect that reloads for it runs, so
 * without this guard that render would pair the new server with the previous server's versions.
 *
 * Pure, so the server-switch case is testable without a renderer.
 */
export function reportForServer(report, server) {
  if (!server) {
    return { sysInfo: undefined, isLoading: false, error: null };
  }

  // Populated by whichever consumer fetched first; see the cache note in the hook below.
  if (server.sysInfo) {
    return { sysInfo: server.sysInfo, isLoading: false, error: null };
  }

  if (report.key !== serverKeyOf(server)) {
    return { sysInfo: undefined, isLoading: true, error: null };
  }

  return { sysInfo: report.sysInfo, isLoading: report.isLoading, error: report.error };
}

const EMPTY = { key: null, sysInfo: undefined, isLoading: false, error: null };

/**
 * Load an imaging server's `/system` report: Orthanc's own details plus the Sonador cloud plugin
 * keys (`SonadorVersion`, `SonadorUrl`).
 *
 * Results are cached onto `server.sysInfo`, the same place the study list reads and writes, so
 * reopening a consumer does not re-request.
 *
 * @returns {Object} `{ sysInfo, isLoading, error }` for the server passed in.
 */
export default function useServerSystemInfo(server) {
  const [report, setReport] = useState(EMPTY);
  const key = serverKeyOf(server);

  useEffect(() => {
    if (!server || server.sysInfo) {
      return undefined;
    }

    let cancelled = false;

    setReport({ ...EMPTY, key, isLoading: true });

    // `fetchServerSystemInfo` throws synchronously for a server with no `rootUrl`, so the call is
    // made inside the promise chain to keep both failure modes on one path.
    Promise.resolve()
      .then(() => sonador.fetchServerSystemInfo(server))
      .then((response) => {
        if (!response.ok) {
          return response.text().then((message) => {
            throw new Error(`HTTP ${response.status}: ${message}`);
          });
        }

        return response.json();
      })
      .then((sysInfo) => {
        if (cancelled) {
          return;
        }

        server.sysInfo = sysInfo;
        setReport({ key, sysInfo, isLoading: false, error: null });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        // Callers are diagnostic surfaces; they report the gap rather than raising a notification.
        console.error('Unable to retrieve the imaging server system report.', error);
        setReport({ ...EMPTY, key, error });
      });

    return () => {
      cancelled = true;
    };
  }, [server, key]);

  return reportForServer(report, server);
}

export { useServerSystemInfo };
