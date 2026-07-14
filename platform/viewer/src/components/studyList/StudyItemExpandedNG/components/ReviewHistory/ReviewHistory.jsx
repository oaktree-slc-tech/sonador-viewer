import React from 'react';
import { useSelector } from 'react-redux';
import PropTypes from 'prop-types';

import Loader from '@ohif/ui/src/components/Loader/Loader';

import { getDisplayName } from '../../../../../lib/getDisplayName';
import { useStudyComments, useStudyWorklists } from '../Comments/logic';

import styles from './ReviewHistory.module.scss';


const userLabel = (user, fallbackPk) => {
  // Resolve a display label for a history actor. Prefer a full user object (from a linked
  // comment or the worklist assignment); otherwise fall back to the stored user pk.

  if (user && typeof user === 'object') {
    return getDisplayName(user);
  }
  if (fallbackPk !== undefined && fallbackPk !== null) {
    return `User #${fallbackPk}`;
  }
  return 'Unknown user';
};


const transitionLabel = (entry) => {
  // Human-readable label for a review-history transition.

  if (!entry.PreviousState) {
    return `Created as ${entry.State}`;
  }
  return `${entry.PreviousState} \u2192 ${entry.State}`;
};


const formatTimestamp = (value) => (value ? String(value).split('.')[0].replace('T', ' ') : '');


function ProcedureBlock({ title, rows }) {
  // Render a labelled set of procedure attribute rows, skipping empty values.

  const present = rows.filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (!present.length) {
    return null;
  }
  return (
    <div className={styles.procedureBlock}>
      <p className={styles.procedureTitle}>{title}</p>
      {present.map(([label, value]) => (
        <div key={label} className={styles.procedureRow}>
          <span className={styles.procedureLabel}>{label}</span>
          <span className={styles.procedureValue}>{value}</span>
        </div>
      ))}
    </div>
  );
}


export default function ReviewHistory({ studyId }) {
  // Unified, chronological review timeline for a study's worklist item(s). Assembles the
  // server-owned Meta (RequestedProcedure, PerformedProcedure, ReviewHistory) with the study
  // comments so each status transition is shown alongside its linked reviewer note.

  const activeServer = useSelector((state) => state.servers.servers.find((s) => s.active));
  const { data: worklists = [], isLoading: isLoadingWorklists } = useStudyWorklists(activeServer, studyId);
  const { data: studyComments = [] } = useStudyComments(activeServer, studyId);

  if (isLoadingWorklists) {
    return (
      <div className={styles.loaderWrapper}>
        <Loader />
      </div>
    );
  }

  const items = Array.isArray(worklists) ? worklists : [];
  if (!items.length) {
    return <p className={styles.placeholder}>No review history for this study.</p>;
  }

  // Index comments by UID so ReviewHistory entries can resolve their linked note (FR-4).
  const commentsById = {};
  (Array.isArray(studyComments) ? studyComments : []).forEach((comment) => {
    if (comment && comment.ID) {
      commentsById[comment.ID] = comment;
    }
  });

  return (
    <div className={styles.container}>
      {items.map((item) => {
        const meta = item.Meta || {};
        const requested = meta.RequestedProcedure || {};
        const performed = meta.PerformedProcedure || {};
        const history = Array.isArray(meta.ReviewHistory) ? [...meta.ReviewHistory] : [];

        // Defensive chronological ordering (entries are appended in order server-side).
        history.sort((a, b) => String(a.Timestamp || '').localeCompare(String(b.Timestamp || '')));

        const assignedUser = item.User && typeof item.User === 'object' ? item.User : null;

        return (
          <div key={item.ID} className={styles.worklistItem}>
            <ProcedureBlock
              title="Requested Procedure"
              rows={[
                ['Reason for Review', requested.ReasonForTheRequestedProcedure],
                ['Description', requested.RequestedProcedureDescription],
              ]}
            />
            <ProcedureBlock
              title="Performed Procedure"
              rows={[
                ['Description', performed.PerformedProcedureStepDescription],
              ]}
            />

            <ol className={styles.timeline}>
              {history.map((entry, index) => {
                const linkedComment = entry.CommentUID ? commentsById[entry.CommentUID] : null;
                const actor = linkedComment && linkedComment.User
                  ? linkedComment.User
                  : (assignedUser && assignedUser.id === entry.User ? assignedUser : null);

                return (
                  <li key={index} className={styles.timelineEntry}>
                    <div className={styles.timelineHeader}>
                      <span className={styles.transition}>{transitionLabel(entry)}</span>
                      <span className={styles.timestamp}>{formatTimestamp(entry.Timestamp)}</span>
                    </div>
                    <div className={styles.actor}>{userLabel(actor, entry.User)}</div>
                    {linkedComment && linkedComment.Text && (
                      <div className={styles.note}>{linkedComment.Text}</div>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}
    </div>
  );
}


ReviewHistory.propTypes = {
  studyId: PropTypes.string,
};
