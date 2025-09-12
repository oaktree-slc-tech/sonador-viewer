import React, { useContext, useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate, useLocation } from 'react-router-dom';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import OHIF, { display, redux, DicomMetadataStore } from '@ohif/core';

import { ReactComponent as DownloadIcon } from '@ohif/ui/src/elements/Svg/svgs/cloud-download.svg';
import { ReactComponent as EyeIcon } from '@ohif/ui/src/elements/Svg/svgs/eye.svg';
import { ReactComponent as UpdateStatusIcon } from '@ohif/ui/src/elements/Svg/svgs/reload-circle.svg';
import { ReactComponent as ViewAndProcessIcon } from '@ohif/ui/src/elements/Svg/svgs/search-circle.svg';
import { ReactComponent as ShareIcon } from '@ohif/ui/src/elements/Svg/svgs/share.svg';

import AppContext from '../../../../../context/AppContext';
import { parseViewerPath } from '../../../../../routes/routesUtil';
import { useWorkListStore } from '../../../../../store/useWorkListStore';
import StudiesTableShareModal from '../StudiesTableShareModal/StudiesTableShareModal';
import { _getStudyInstanceUID } from '../SelectAndSettingsAndExpandCell/SelectAndSettingsAndExpandCell.js';

import UpdateWorklistModal from './components/UpdateWorklistModal';

import styles from './StudiesTableActions.module.scss';


export default function StudiesTableActions({  selectedRows, isWorkList }) {
  // Sonador study list viewer actions

  const { activeServer } = useSelector(redux.selectors.activeOhifServer);
  const { appConfig } = useContext(AppContext);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [openUpdateWorklistModal, setOpenUpdateWorklistModal] = useState(false);

  const [isOpenedShareModal, setIsOpenedShareModal] = useState(false);
  const { setWorkListSelectedStudies } = useWorkListStore();

  const handleViewAllSelectedStudies = () => {
    selectedRows.forEach(({ id }) => {
      const _id = _getStudyInstanceUID({ row: { id, }, worklist: pathname.includes('worklist') });
      const link = parseViewerPath(appConfig, activeServer, {
        studyInstanceUIDs: _id,
      });

      window.open(link, '_blank');
    });
  };

  const handleClickShare = () => {
    if (selectedRows.length === 1) {
      setIsOpenedShareModal(true);
    }
  };

  // Permissions
  const aclShare = activeServer?.perms?.acl;

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
            {aclShare && (
              <button className={styles.action} disabled={selectedRows.length !== 1} onClick={handleClickShare}>
                <ShareIcon />
                Share
              </button>
            )}
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
        <UpdateWorklistModal
          isOpen={openUpdateWorklistModal} selectedWorklists={selectedRows}
          setIsOpen={setOpenUpdateWorklistModal} />}
    </>
  );
}


StudiesTableActions.propTypes = {
  server: PropTypes.object,
  selectedRows: PropTypes.arrayOf(PropTypes.object),
  isWorkList: PropTypes.bool,
};
