import React, { useContext, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ChatBubbleLeftIcon } from '@heroicons/react/24/solid';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import CheckboxNG from '@ohif/ui/src/components/CheckboxNG/CheckboxNG';
import Dropdown from '@ohif/ui/src/components/Dropdown/Dropdown';
import { ReactComponent as ChevronDown } from '@ohif/ui/src/elements/Svg/svgs/chevron-down.svg';
import { ReactComponent as DownloadIcon } from '@ohif/ui/src/elements/Svg/svgs/cloud-download.svg';
import { ReactComponent as DotsIcon } from '@ohif/ui/src/elements/Svg/svgs/dots.svg';
import { ReactComponent as EyeIcon } from '@ohif/ui/src/elements/Svg/svgs/eye.svg';
import { ReactComponent as ShareIcon } from '@ohif/ui/src/elements/Svg/svgs/share.svg';

import AppContext from '../../../../../context/AppContext';
import * as RoutesUtil from '../../../../../routes/routesUtil';
import { useDeviceStore } from '../../../../../store/useDeviceStore';
import CreateWorklistModal from '../CreateWorklistModal/CreateWorklistModal';

import tableStyles from '../StudiesTable/StudiesTable.module.scss';
import styles from './SelectAndSettingsAndExpandCell.module.scss';

export default function SelectAndSettingsAndExpandCell({ row, server }) {
  const isExpanded = row.getIsExpanded();
  const { pathname } = useLocation();

  const [createWorklistModalOpen, setCreateWorklistModalOpen] = useState(false);

  const { appConfig } = useContext(AppContext);

  const { isDesktop } = useDeviceStore();

  const link = RoutesUtil.parseViewerPath(appConfig, server, {
    studyInstanceUIDs: row.id,
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
      },
    },
    {
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
    },
  ];
  const filteredOptions = options.filter(option => {
    if (option.id === 'create-worklist') {
      return !pathname.includes('worklist');
    }
    return true;
  });

  return (
    <>
      <div className={styles.selectorExpanderColumn}>
        <ChevronDown className={classNames(styles.expander, { [styles.expanded]: isExpanded })} />
        {isDesktop && (
          <>
            <Dropdown
              onClick={(e) => e.stopPropagation()}
              Button={() => <DotsIcon className={styles.dotsIcon} />}
              options={filteredOptions}
            />
            <CheckboxNG checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} />
          </>
        )}
        {server?.perms.view && (
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
                             studyInstanceUIDs={row.id} />
      )}
    </>
  );
}

SelectAndSettingsAndExpandCell.propTypes = {
  row: PropTypes.object.isRequired,
  server: PropTypes.object.isRequired,
};
