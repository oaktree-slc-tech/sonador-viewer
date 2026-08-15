// The progress panel a bulk run reports into: a heading, a bar, and one line per operation.
//
// The per-operation log is the reason a bulk dialog stays open at all. Twelve studies and three
// recipients is thirty-six writes; a toast each would bury everything else in the tray, so the detail
// lives here and only the summary goes to the notification service. On a partial failure this list is
// the ONLY place the user can see which operations did not land, which is why the dialogs hold
// themselves open rather than closing over it.

import React, { useEffect, useRef } from 'react';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import styles from './bulkAction.module.scss';


export default function BulkProgressPanel({
  progress,
  isRunning,
  runningLabel,
  doneLabel,
  runningNote,
  onClose,
}) {
  // Auto-scroll, so the newest line stays visible on a long run.
  const logRef = useRef(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [progress?.completed]);

  if (!progress) {
    return null;
  }

  return (
    <div className={styles.section}>
      <p className={styles.sectionLabel}>{isRunning ? runningLabel : doneLabel}</p>

      <div className={styles.progressTrack}>
        <div
          className={styles.progressBar}
          style={{ width: `${progress.total ? (progress.completed / progress.total) * 100 : 0}%` }}
        />
      </div>

      <div className={styles.progressLog} ref={logRef}>
        {progress.entries.map((entry) => (
          <div
            key={entry.key}
            className={classNames(styles.progressEntry, {
              [styles.progressEntryFailed]: entry.status !== 'ok',
            })}
          >
            <span className={styles.progressEntryLabel}>{entry.label}</span>
            <span className={styles.progressEntryMessage}>{entry.message}</span>
          </div>
        ))}
      </div>

      {isRunning ? (
        <p className={styles.sectionNoteAfter}>{runningNote}</p>
      ) : (
        <div className={styles.bottom}>
          <button type="button" className={styles.saveBtn} onClick={onClose}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}


BulkProgressPanel.propTypes = {
  /** From useBulkProgress: { total, completed, succeeded, failed, entries }. */
  progress: PropTypes.object,
  isRunning: PropTypes.bool,
  /** Heading while the run is in flight, e.g. "Applying 3 of 12...". */
  runningLabel: PropTypes.node,
  /** Heading once it has settled, e.g. "12 of 12 access policies applied". */
  doneLabel: PropTypes.node,
  /** The "leave this open" line shown under the log while running. */
  runningNote: PropTypes.node,
  onClose: PropTypes.func,
};
