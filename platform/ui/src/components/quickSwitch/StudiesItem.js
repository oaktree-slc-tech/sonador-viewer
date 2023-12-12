import React from 'react';
import PropTypes from 'prop-types';

import './StudiesItem.styl';

const StudiesItem = ({ onClick, studyData, active }) => {
  const { StudyDate, StudyDescription, modalities, studyAvailable } = studyData;
  const activeClass = active ? ' active' : '';
  const hasDescriptionAndDate = StudyDate && StudyDescription;

  return (
    <div className={`studyBrowseItem${activeClass}`} onClick={onClick}>
      <div className="studyItemBox">
        <div className="studyModality">
          <div className="studyModalityText">{modalities}</div>
        </div>
        <div className="studyText">
          {hasDescriptionAndDate ? (
            <>
              <div className="studyDate">{StudyDate}</div>
              <div className="studyDescription">{StudyDescription}</div>
            </>
          ) : (
            <div className="studyAvailability">{studyAvailable ? 'N/A' : 'Click to load'}</div>
          )}
        </div>
      </div>
    </div>
  );
};

StudiesItem.propTypes = {
  onClick: PropTypes.func.isRequired,
  studyData: PropTypes.object.isRequired,
  active: PropTypes.bool,
};

export default StudiesItem;
