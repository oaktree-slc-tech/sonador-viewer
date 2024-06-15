import React, { useContext, useState } from 'react';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import { ReactComponent as DownloadIcon } from '@ohif/ui/src/elements/Svg/svgs/cloud-download.svg';
import { ReactComponent as EyeIcon } from '@ohif/ui/src/elements/Svg/svgs/eye.svg';
import { ReactComponent as ShareIcon } from '@ohif/ui/src/elements/Svg/svgs/share.svg';

import AppContext from '../../../../../context/AppContext';
import { parseViewerPath } from '../../../../../routes/routesUtil';
import StudiesTableShareModal from '../StudiesTableShareModal/StudiesTableShareModal';

import styles from './StudiesTableActions.module.scss';

export default function StudiesTableActions({ server, selectedRows }) {
  const { appConfig } = useContext(AppContext);

  const [isOpenedShareModal, setIsOpenedShareModal] = useState(false);

  const handleViewAllSelectedStudies = () => {
    selectedRows.forEach(({ id }) => {
      const link = parseViewerPath(appConfig, server, {
        studyInstanceUIDs: id,
      });

      window.open(link, '_blank');
    });
  };

  const handleClickShare = () => {
    if (selectedRows.length === 1) {
      setIsOpenedShareModal(true);
    }
  };

  return (
    <>
      <div className={styles.tableActions}>
        <span
          className={classNames(styles.selectedRows, {
            [styles.noSelectedRows]: !selectedRows.length,
          })}
        >
          {selectedRows.length} Studies Selected
        </span>
        {server?.perms?.view && (
          <button className={styles.action} disabled={!selectedRows.length} onClick={handleViewAllSelectedStudies}>
            <EyeIcon />
            View
          </button>
        )}
        <button className={styles.action} disabled={!selectedRows.length}>
          <DownloadIcon />
          Download
        </button>
        <div className={styles.shareContainer}>
          <button className={styles.action} disabled={selectedRows.length !== 1} onClick={handleClickShare}>
            <ShareIcon />
            Share
          </button>
          {selectedRows.length > 1 && (
            <span className={styles.tooltipText}>Only one resource at a time can be shared</span>
          )}
        </div>
      </div>
      {isOpenedShareModal && (
        <StudiesTableShareModal
          isOpenedShareModal={isOpenedShareModal}
          setIsOpenedShareModal={setIsOpenedShareModal}
          server={server}
          selectedStudy={selectedRows[0]}
        />
      )}
    </>
  );
}

StudiesTableActions.propTypes = {
  server: PropTypes.object,
  selectedRows: PropTypes.arrayOf(PropTypes.object),
};
