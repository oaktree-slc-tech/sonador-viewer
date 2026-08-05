import React from 'react';
import { useParams } from 'react-router-dom';

import { ReactComponent as CloseIcon } from '@ohif/ui/src/elements/Svg/svgs/octagonClose.svg';

import { useNotificationLog } from '../../hooks/useNotificationLog';

import styles from './ViewerIssuesContent.module.scss';

const SEVERITY_STYLES = {
  error: styles.severityError,
  warning: styles.severityWarning,
  info: styles.severityInfo,
  success: styles.severitySuccess,
};

/**
 * The unified error list (imaging-development-env#69, ohif-viewers#84).
 *
 * This previously read a per-study zustand store that only the viewport error paths wrote to. It
 * now reads the NotificationLogService, so application logs, user notifications, and series
 * warnings all reach it from the single call that produced them.
 *
 * Entries are session-scoped by design: each is derived from immutable DICOM, so reopening a study
 * reproduces whatever is still true of it. See the NotificationLogService header.
 */
export default function ViewerIssuesContent() {
  const { studyInstanceUIDs } = useParams();

  const { entries, remove, clear } = useNotificationLog({ studyInstanceUID: studyInstanceUIDs });

  if (!entries.length) {
    return (
      <div className={styles.errors}>
        <p className={styles.emptyMessage}>No errors</p>
      </div>
    );
  }

  return (
    <div className={styles.errors}>
      <div className={styles.toolbar}>
        <span className={styles.summary}>
          {entries.length} {entries.length === 1 ? 'issue' : 'issues'}
        </span>
        <button type="button" className={styles.clearAll} onClick={clear}>
          Clear all
        </button>
      </div>

      {entries.map(({ id, title, message, severity, source, count, details }) => (
        <div key={id} className={`${styles.error} ${SEVERITY_STYLES[severity] || ''}`}>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => remove(id)}
            className={styles.close}
          >
            <CloseIcon />
          </button>
          <div className={styles.body}>
            <p className={styles.title}>
              {title}
              {count > 1 && <span className={styles.repeat}>&times;{count}</span>}
            </p>
            {message && <p className={styles.description}>{message}</p>}
            {details && (
              // Failed-request diagnostics -- URL, HTTP status, response body
              // (imaging-development-env#69).
              <details className={styles.details}>
                <summary>Details</summary>
                <dl>
                  {Object.entries(details).map(([key, value]) => (
                    <React.Fragment key={key}>
                      <dt>{key}</dt>
                      <dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              </details>
            )}
            <p className={styles.source}>{source}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
