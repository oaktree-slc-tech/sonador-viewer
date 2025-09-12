import _ from 'lodash';

import React, { useContext, useState, useEffect, useMemo } from 'react';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';
import { ChatBubbleLeftIcon } from '@heroicons/react/24/solid';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import OHIF, { redux, DicomMetadataStore } from '@ohif/core';
import { Icon } from '@ohif/ui';

import CheckboxNG from '@ohif/ui/src/components/CheckboxNG/CheckboxNG';
import Dropdown from '@ohif/ui/src/components/Dropdown/Dropdown';
import { ReactComponent as ChevronDown } from '@ohif/ui/src/elements/Svg/svgs/chevron-down.svg';
import { ReactComponent as DownloadIcon } from '@ohif/ui/src/elements/Svg/svgs/cloud-download.svg';
import { ReactComponent as DotsIcon } from '@ohif/ui/src/elements/Svg/svgs/dots.svg';
import { ReactComponent as EyeIcon } from '@ohif/ui/src/elements/Svg/svgs/eye.svg';
import { ReactComponent as ShareIcon } from '@ohif/ui/src/elements/Svg/svgs/share.svg';

import { fetchDownloadStudies, fetchStudyAclPermissions } from '../../../../../api/ext';
import AppContext from '../../../../../context/AppContext';
import * as RoutesUtil from '../../../../../routes/routesUtil';
import { useDeviceStore } from '../../../../../store/useDeviceStore';
import CreateWorklistModal from '../CreateWorklistModal/CreateWorklistModal';
import StudiesTableShareModal from '../StudiesTableShareModal/StudiesTableShareModal';

import tableStyles from '../StudiesTable/StudiesTable.module.scss';
import styles from './SelectAndSettingsAndExpandCell.module.scss';


function _getStudyInstanceUID({ row, worklist=false}) {
  // Retrieve StudyInstanceUID for the row from the DicomMetadataStore
  if (!worklist) {
    return row.id;
  }

  // Attempt to retrieve StudyInstanceUID from DicomMetadataStore
  const _study = DicomMetadataStore.findStudy((_s) => {
    // Check study metdata for a worklistId which matches the row.id

    const studyMeta = (_s.getStudyMetadata() || {});
    return _.includes(studyMeta.worklistItems || [], row.id);
  });

  return _study.StudyInstanceUID;
}


export default function SelectAndSettingsAndExpandCell({ row  }) {
  // Studylist selection control and actions menu  

  const { pathname } = useLocation();

  // Retrieve StudyInstanceUID
  const StudyInstanceUID = _getStudyInstanceUID({ row, worklist: pathname.includes('worklist') });

  const isExpanded = row.getIsExpanded();
  const { activeServer } = useSelector(redux.selectors.activeOhifServer); 

  // Retrieve study metadata
  const _study = DicomMetadataStore.getStudy(StudyInstanceUID);
  if (!_study) {
    DicomMetadataStore.addStudy({ StudyInstanceUID, });
  }
  const studyMeta = DicomMetadataStore.getStudyMetadata(StudyInstanceUID);

  // Study action permissions
  const canWorkInWorklist = activeServer?.perms?.worklist;
  const [aclDownload, setAclDownload] = useState(activeServer?.perms?.view || studyMeta?.perms?.View || false);
  const [aclShare, setAclShare] = useState(activeServer?.perms?.acl || studyMeta?.perms?.ACL || false);
  const [resourceAclLoaded, setResourceAclLoaded] = useState(() => false);
  const [createWorklistModalOpen, setCreateWorklistModalOpen] = useState(false);
  const [isOpenedShareModal, setIsOpenedShareModal] = useState(false);

  const { appConfig } = useContext(AppContext);

  const { isDesktop } = useDeviceStore();

  const link = RoutesUtil.parseViewerPath(appConfig, activeServer, {
    studyInstanceUIDs: StudyInstanceUID,
  });

  const options = [
    {
      id: 'download',
      Label: () => (
        <div className={styles.rowDotsOption}>
          <DownloadIcon />
          <span>Download</span>
        </div>
      ),
      onClick: () => {
        fetchDownloadStudies(activeServer, StudyInstanceUID);
      },
    },
    {
      id: 'share',
      Label: () => (
        <div className={styles.rowDotsOption}>
          <ShareIcon />
          <span>Share</span>
        </div>
      ),
      onClick: () => {
        setIsOpenedShareModal(true);
      },
    },
    ...(canWorkInWorklist
      ? [{
        id: 'create-worklist',
        Label: () => (
          <div className={styles.rowDotsOption}>
            <ChatBubbleLeftIcon width={16} />
            <span>Request review</span>
          </div>
        ),
        onClick: () => {
          setCreateWorklistModalOpen(true);
        },
      }]
      : []),
  ];

  const filteredOptions = useMemo(() => {
    // Filter menu options by permissions

    return options.filter(option => {
      if (option.id === 'create-worklist') {
        return canWorkInWorklist && !pathname.includes('worklist');
      } else if (option.id == 'download') {
        return aclDownload;
      } else if (option.id == 'share') {
        return aclShare;
      }

      return true;
    });
  }, [aclDownload, aclShare])

  const onDropdownClick = async (e) => {
    // Retrieve resource permissions for study
    e.stopPropagation();

    if (activeServer && StudyInstanceUID && !resourceAclLoaded && (!aclDownload || !aclShare)) {
      const resourcePerms = await fetchStudyAclPermissions(activeServer, StudyInstanceUID);
      DicomMetadataStore.updateStudyMetadata(_.omit(resourcePerms, 'Level'));

      // Set permission for download
      if (!aclDownload && resourcePerms?.perms?.View) {
        setAclDownload(resourcePerms.perms.View);
      }

      // Set permission for ACL management
      if (!aclShare && resourcePerms?.perms?.ACL) {
        setAclShare(resourcePerms.perms.ACL);
      }

      // Mark resource ACL as loaded to prevent repeated API calls
      setResourceAclLoaded(true);      
    }
  }

  return (
    <>
      <div className={classNames(styles.selectorExpanderColumn, isDesktop && styles.desktop)}>
        <ChevronDown className={classNames(styles.expander, { [styles.expanded]: isExpanded })} />
        {isDesktop && (
          <>
            <Dropdown
              onClick={onDropdownClick}
              Button={() => <DotsIcon className={styles.dotsIcon} />}
              options={filteredOptions}
            />
            <CheckboxNG checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} />
          </>
        )}
        {activeServer?.perms.view && (
          <EyeIcon
            className={classNames(styles.rowEyeIcon, tableStyles.rowEyeIcon)}
            onClick={(e) => {
              e.stopPropagation();
              window.open(link, '_blank');
            }}
          />
        )}
      </div>
      {createWorklistModalOpen && (
        <CreateWorklistModal isOpen={createWorklistModalOpen} setIsOpen={setCreateWorklistModalOpen}
          studyInstanceUIDs={StudyInstanceUID} />
      )}
      {isOpenedShareModal && (
        <StudiesTableShareModal
          isOpenedShareModal={isOpenedShareModal}
          setIsOpenedShareModal={setIsOpenedShareModal}
          server={activeServer}
          selectedStudy={{ id: StudyInstanceUID }}
        />
      )}

    </>
  );
}


SelectAndSettingsAndExpandCell.propTypes = {
  row: PropTypes.object.isRequired,
};


export { _getStudyInstanceUID };