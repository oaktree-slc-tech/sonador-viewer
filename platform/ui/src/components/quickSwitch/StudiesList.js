import React from 'react';
import PropTypes from 'prop-types';

import StudiesItem from './StudiesItem.js';

import './StudiesList.styl';

function StudiesList({ className, studyListData, onClick, activeStudyInstanceUID }) {
  return (
    <div className={`studiesList ${className}`}>
      {studyListData.map((studyData, index) => (
        <StudiesItem
          key={index}
          studyData={studyData}
          active={studyData.StudyInstanceUID === activeStudyInstanceUID}
          onClick={() => onClick(studyData)}
        />
      ))}
    </div>
  );
}

StudiesList.propTypes = {
  className: PropTypes.string,
  studyListData: PropTypes.array.isRequired,
  onClick: PropTypes.func.isRequired,
  activeStudyInstanceUID: PropTypes.string,
};

export default StudiesList;
