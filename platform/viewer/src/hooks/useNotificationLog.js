// React binding for the NotificationLogService (ohif-viewers#84).
//
// The service is a plain PubSubService so that non-React producers -- image loaders, parsers,
// command modules -- can record entries without a component in scope. This hook is the read side:
// it subscribes to the service's events and re-renders the consumer whenever the log changes.

import { useCallback, useEffect, useState } from 'react';

import { notificationLogService, NotificationLogServiceEvents } from '@ohif/core';

/**
 * Entries from the unified log, newest first, filtered by the supplied scope.
 *
 * @param {object} [filter]
 * @param {string} [filter.studyInstanceUID]
 * @param {string} [filter.seriesInstanceUID]
 * @param {string} [filter.severity] - Minimum severity
 * @param {string} [filter.source]
 */
export const useNotificationLog = ({
  studyInstanceUID,
  seriesInstanceUID,
  severity,
  source,
} = {}) => {
  const read = useCallback(
    () =>
      notificationLogService.getEntries({
        studyInstanceUID,
        seriesInstanceUID,
        severity,
        source,
      }),
    [studyInstanceUID, seriesInstanceUID, severity, source]
  );

  const [entries, setEntries] = useState(read);

  useEffect(() => {
    const refresh = () => setEntries(read());

    // Re-read on every mutation. The log is small and bounded, so recomputing the filtered view
    // is cheaper than maintaining a parallel copy in component state.
    const subscriptions = [
      notificationLogService.subscribe(NotificationLogServiceEvents.ENTRY_ADDED, refresh),
      notificationLogService.subscribe(NotificationLogServiceEvents.ENTRY_REMOVED, refresh),
      notificationLogService.subscribe(NotificationLogServiceEvents.CLEARED, refresh),
    ];

    refresh();

    return () => subscriptions.forEach(subscription => subscription.unsubscribe());
  }, [read]);

  const remove = useCallback(id => notificationLogService.remove(id), []);
  const clear = useCallback(
    () => notificationLogService.clear({ studyInstanceUID }),
    [studyInstanceUID]
  );

  return { entries, remove, clear };
};

export default useNotificationLog;
