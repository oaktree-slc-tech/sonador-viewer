import React, { useContext, useState } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import { ReactComponent as DownloadIcon } from '@ohif/ui/src/elements/Svg/svgs/cloud-download.svg';
import { ReactComponent as EyeIcon } from '@ohif/ui/src/elements/Svg/svgs/eye.svg';
import { ReactComponent as UpdateStatusIcon } from '@ohif/ui/src/elements/Svg/svgs/reload-circle.svg';
import { ReactComponent as ViewAndProcessIcon } from '@ohif/ui/src/elements/Svg/svgs/search-circle.svg';
import { ReactComponent as ShareIcon } from '@ohif/ui/src/elements/Svg/svgs/share.svg';

import AppContext from '../../../../../context/AppContext';
import { parseViewerPath } from '../../../../../routes/routesUtil';
import { useWorkListStore } from '../../../../../store/useWorkListStore';
import StudiesTableShareModal from '../StudiesTableShareModal/StudiesTableShareModal';

import UpdateWorklistModal from './components/UpdateWorklistModal';

import styles from './StudiesTableActions.module.scss';


export default function StudiesTableActions({  selectedRows, isWorkList }) {
  const activeServer = useSelector((state) => state.servers.servers.find((s) => s.active));
  const { appConfig } = useContext(AppContext);
  const navigate = useNavigate();
  const [openUpdateWorklistModal, setOpenUpdateWorklistModal] = useState(false);

  const [isOpenedShareModal, setIsOpenedShareModal] = useState(false);
  const { setWorkListSelectedStudies } = useWorkListStore();

  const handleViewAllSelectedStudies = () => {
    selectedRows.forEach(({ id }) => {
      const link = parseViewerPath(appConfig, activeServer, {
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
        {activeServer?.perms?.view && (
          <button className={styles.action} disabled={!selectedRows.length} onClick={handleViewAllSelectedStudies}>
            <EyeIcon />
            View
          </button>
        )}
        {isWorkList ? (
          <button
            className={styles.action}
            disabled={!selectedRows.length}
            onClick={() => {
              setWorkListSelectedStudies(selectedRows);
              navigate(`/worklist/viewer/`);
            }}
          >
            <ViewAndProcessIcon />
            View and Process
          </button>
        ) : (
          <button className={styles.action} disabled={!selectedRows.length}>
            <DownloadIcon />
            Download
          </button>
        )}
        {isWorkList ? (
          <button onClick={() => {
            setOpenUpdateWorklistModal(true);
          }} className={styles.action} disabled={!selectedRows.length}>
            <UpdateStatusIcon />
            Update Status
          </button>
        ) : (
          <div className={styles.shareContainer}>
            <button className={styles.action} disabled={selectedRows.length !== 1} onClick={handleClickShare}>
              <ShareIcon />
              Share
            </button>
            {selectedRows.length > 1 && (
              <span className={styles.tooltipText}>Only one resource at a time can be shared</span>
            )}
          </div>
        )}
      </div>
      {isOpenedShareModal && (
        <StudiesTableShareModal
          isOpenedShareModal={isOpenedShareModal}
          setIsOpenedShareModal={setIsOpenedShareModal}
          selectedStudy={selectedRows[0]}
        />
      )}
      {isWorkList && openUpdateWorklistModal &&
        <UpdateWorklistModal isOpen={openUpdateWorklistModal}
                             selectedWorklists={selectedRows}
                             setIsOpen={setOpenUpdateWorklistModal} />}
    </>
  );
}


StudiesTableActions.propTypes = {
  server: PropTypes.object,
  selectedRows: PropTypes.arrayOf(PropTypes.object),
  isWorkList: PropTypes.bool,
};
