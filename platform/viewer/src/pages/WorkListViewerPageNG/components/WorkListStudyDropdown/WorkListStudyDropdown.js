import React, { useCallback, useRef, useState } from 'react';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import { ReactComponent as CheckmarkIcon } from '@ohif/ui/src/elements/Svg/svgs/circleCheckmark.svg';
import { ReactComponent as DropdownCaretIcon } from '@ohif/ui/src/elements/Svg/svgs/dropdownCaret.svg';

import useClickOutside from '../../../../hooks/useClickOutside';
import { useWorkListStore } from '../../../../store/useWorkListStore';

import styles from './WorkListStudyDropdown.module.scss';

export default function WorkListStudyDropdown({
  setSelectedStudy,
  selectedStudy,
  setSelectedStudyIndex,
  selectedStudyIndex,
}) {
  const [isOpen, setIsOpen] = useState(false);

  const ref = useRef(null);

  const { workListSelectedStudies } = useWorkListStore();

  const callback = useCallback(() => setIsOpen(false), []);

  useClickOutside(ref, callback);

  const handleSelectStudy = (study, index) => {
    if (index !== selectedStudyIndex) {
      setSelectedStudy(study);
      setSelectedStudyIndex(index);
    }

    setIsOpen(false);
  };

  return (
    <div ref={ref} className={styles.container}>
      <button className={styles.selectedStudy} onClick={() => setIsOpen((prevState) => !prevState)}>
        <CheckmarkIcon />
        <div>
          <p className={styles.value}>{selectedStudy.original.StudyDescription.value}</p>
        </div>
        <DropdownCaretIcon
          className={classNames(styles.caret, {
            [styles.openCaret]: isOpen,
          })}
        />
      </button>
      {isOpen && (
        <div className={styles.studyList}>
          {workListSelectedStudies.map((study, index) => {
            return (
              <button key={study.id} className={styles.studyItem} onClick={() => handleSelectStudy(study, index)}>
                {study.original.StudyDescription.value}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

WorkListStudyDropdown.propTypes = {
  selectedStudy: PropTypes.shape({
    studyId: PropTypes.string,
    patientName: PropTypes.string,
  }).isRequired,
  setSelectedStudy: PropTypes.func.isRequired,
  setSelectedStudyIndex: PropTypes.func.isRequired,
  selectedStudyIndex: PropTypes.number,
};
