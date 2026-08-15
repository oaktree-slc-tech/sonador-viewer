// Progress state for a bulk run, shared by useBulkShare and useBulkWorklist.
//
// Both hooks kept a byte-identical copy of this, including the idempotency guard, which is the kind
// of duplication that survives until one copy is fixed and the other is not.

import { useCallback, useState } from 'react';


export default function useBulkProgress() {
  // { total, completed, succeeded, failed, entries: [{ key, label, status, message }] }
  const [progress, setProgress] = useState(null);

  const begin = useCallback(
    (total) => setProgress({ total, completed: 0, succeeded: 0, failed: 0, entries: [] }),
    []
  );

  const reset = useCallback(() => setProgress(null), []);

  const record = useCallback((entry) => {
    setProgress((prev) => {
      if (!prev) {
        return prev;
      }

      // Idempotent on the operation key. The runners already issue each key once, but this is the
      // list the user reads, and a duplicated row here would look exactly like a duplicated write.
      if (prev.entries.some((existing) => existing.key === entry.key)) {
        return prev;
      }

      return {
        ...prev,
        completed: prev.completed + 1,
        succeeded: prev.succeeded + (entry.status === 'ok' ? 1 : 0),
        failed: prev.failed + (entry.status === 'ok' ? 0 : 1),
        entries: [...prev.entries, entry],
      };
    });
  }, []);

  return { progress, begin, record, reset };
}
