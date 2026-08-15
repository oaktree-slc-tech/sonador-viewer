// "N studies will be <something>", followed by the list of them.
//
// Every bulk dialog opens with this, and always shows the studies rather than collapsing them behind
// a count: the selection is the thing most easily got wrong, and a count alone gives the user nothing
// to check it against.
//
// The component de-duplicates the selection itself and hands the resulting count to `heading`, so the
// number in the heading is by construction the number of rows below it -- and both are the number of
// operations the run will issue, because the plans de-duplicate with the same function. Passing the
// heading in as a finished string is what let those diverge: the dialogs quoted a de-duplicated count
// over a raw list.

import React from 'react';
import PropTypes from 'prop-types';

import { describeStudy } from '../RemoveResourceConfirm/describeRemoval';

import { dedupeStudies } from './bulkStudies';

import styles from './bulkAction.module.scss';


export default function BulkStudyList({ studies, heading }) {
  const affected = dedupeStudies(studies);

  return (
    <div className={styles.section}>
      <p className={styles.sectionLabel}>{heading(affected.length)}</p>
      <div className={styles.studyList}>
        {affected.map((study) => {
          const { title, subtitle } = describeStudy(study);

          return (
            <div key={study.StudyInstanceUID} className={styles.studyRow}>
              <span className={styles.studyTitle}>{title}</span>
              {subtitle && <span className={styles.studySubtitle}>{subtitle}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}


BulkStudyList.propTypes = {
  /** Study descriptors from `_getStudyDescriptor` -- StudyInstanceUID plus display attributes. */
  studies: PropTypes.arrayOf(PropTypes.object).isRequired,
  /** Called with the de-duplicated count; returns the line above the list. */
  heading: PropTypes.func.isRequired,
};
