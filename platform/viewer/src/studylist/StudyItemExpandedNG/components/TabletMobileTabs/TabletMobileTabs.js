import React, { useState } from 'react';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import Comments from '../Comments/Comments';
import Metadata from '../Metadata/Metadata';

import styles from './TabletMobileTabs.module.scss';

const TAB_CONTENT = {
  comments: () => <Comments />,
  metadata: (study) => <Metadata study={study} />,
};

export default function TabletMobileTabs({ study }) {
  const [selectedTab, setSelectedTab] = useState('comments');

  const handleChangeTab = (tab) => {
    if (selectedTab !== tab) {
      setSelectedTab(tab);
    }
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
      {TAB_CONTENT[selectedTab](study)}
    </>
  );
}

TabletMobileTabs.propTypes = {
  study: PropTypes.object.isRequired,
};
