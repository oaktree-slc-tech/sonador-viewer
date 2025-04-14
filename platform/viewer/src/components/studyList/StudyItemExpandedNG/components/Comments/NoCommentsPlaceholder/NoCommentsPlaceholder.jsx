import React from 'react';

import styles from './NoCommentsPlaceholder.module.scss';

const NoCommentsPlaceholder = ({ studyId }) => {
  return (
    <div className={styles.placeholderContainer}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className={styles.icon}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M7 8h10M7 12h4m-7 8l4-4h10a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12l4-4z"
        />
      </svg>
      <p className={styles.title}>No comments for this {studyId ? 'Study' : 'Series'} yet</p>
      <p className={styles.subtitle}>Be the first to add.</p>
    </div>
  );
};

export default NoCommentsPlaceholder;
