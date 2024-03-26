import React from 'react';
import { useParams } from 'react-router-dom';

import { useViewerStudyErrors } from '@ohif/core/src/store/useViewerStudyErrors';
import { ReactComponent as CloseIcon } from '@ohif/ui/src/elements/Svg/svgs/octagonClose.svg';

import styles from './ViewerIssuesContent.module.scss';

export default function ViewerIssuesContent() {
  const { studyInstanceUIDs } = useParams();

  const { errors, removeError } = useViewerStudyErrors((state) => {
    return { errors: state.errors[studyInstanceUIDs], removeError: state.removeError };
  });

  return (
    <div className={styles.errors}>
      {errors?.length ? (
        errors.map(({ title, error, errorId }) => {
          return (
            <div key={errorId} className={styles.error}>
              <button onClick={() => removeError({ studyId: studyInstanceUIDs, errorId })} className={styles.close}>
                <CloseIcon />
              </button>
              <div>
                <p className={styles.title}>{title}</p>
                <p className={styles.description}>{error}</p>
              </div>
            </div>
          );
        })
      ) : (
        <p className={styles.emptyMessage}>No errors</p>
      )}
    </div>
  );
}
