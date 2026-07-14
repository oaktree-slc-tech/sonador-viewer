import React, { useState } from 'react';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import Comments from '../Comments/Comments';
import Metadata from '../Metadata/Metadata';

import styles from './TabletMobileTabs.module.scss';

export default function TabletMobileTabs({ study, series, studyId, commentsEdit = false }) {
  const [selectedTab, setSelectedTab] = useState('comments');

  const handleChangeTab = (tab) => {
    if (selectedTab !== tab) {
      setSelectedTab(tab);
    }
  };

  // Comments needs the study context when no series is selected (drawer opens with the STUDY
  // item active): without it both comment queries are disabled and the loader spins forever.
  const TAB_CONTENT = {
    comments: () => <Comments series={series} studyId={studyId} commentsEdit={commentsEdit} />,
    metadata: () => <Metadata study={study} />,
  };

  return (
    <>
      <div className={styles.tabs}>
        <button
          className={classNames(styles.tab, {
            [styles.active]: selectedTab === 'comments',
          })}
          onClick={() => handleChangeTab('comments')}
        >
          Comments
        </button>
        <button
          className={classNames(styles.tab, {
            [styles.active]: selectedTab === 'metadata',
          })}
          onClick={() => handleChangeTab('metadata')}
        >
          Metadata
        </button>
        <hr className={styles.indicator} />
      </div>
      {TAB_CONTENT[selectedTab]()}
    </>
  );
}

TabletMobileTabs.propTypes = {
  study: PropTypes.object.isRequired,
  series: PropTypes.object,
  studyId: PropTypes.string,
  commentsEdit: PropTypes.bool,
};
