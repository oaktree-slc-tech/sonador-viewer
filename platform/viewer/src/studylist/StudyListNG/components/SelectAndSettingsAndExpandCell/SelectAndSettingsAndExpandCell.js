import React, { useContext } from 'react';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import CheckboxNG from '@ohif/ui/src/components/CheckboxNG/CheckboxNG';
import Dropdown from '@ohif/ui/src/components/Dropdown/Dropdown';
import { ReactComponent as ChevronDown } from '@ohif/ui/src/elements/Svg/svgs/chevron-down.svg';
import { ReactComponent as DownloadIcon } from '@ohif/ui/src/elements/Svg/svgs/cloud-download.svg';
import { ReactComponent as DotsIcon } from '@ohif/ui/src/elements/Svg/svgs/dots.svg';
import { ReactComponent as EyeIcon } from '@ohif/ui/src/elements/Svg/svgs/eye.svg';
import { ReactComponent as ShareIcon } from '@ohif/ui/src/elements/Svg/svgs/share.svg';

import AppContext from '../../../../context/AppContext';
import * as RoutesUtil from '../../../../routes/routesUtil';
import { useDeviceStore } from '../../../../store/useDeviceStore';

import tableStyles from '../StudiesTable/StudiesTable.module.scss';
import styles from './SelectAndSettingsAndExpandCell.module.scss';

export default function SelectAndSettingsAndExpandCell({ row, server }) {
  const isExpanded = row.getIsExpanded();

  const { appConfig } = useContext(AppContext);

  const { isDesktop } = useDeviceStore();

  const link = RoutesUtil.parseViewerPath(appConfig, server, {
    studyInstanceUIDs: row.id,
  });

  return (
    <div className={styles.selectorExpanderColumn}>
      <ChevronDown className={classNames(styles.expander, { [styles.expanded]: isExpanded })} />
      {isDesktop && (
        <>
          <Dropdown
            onClick={(e) => e.stopPropagation()}
            Button={() => <DotsIcon className={styles.dotsIcon} />}
            options={[
              {
                id: 'download',
                Label: () => (
                  <div className={styles.rowDotsOption}>
                    <DownloadIcon />
                    <span>Download</span>
                  </div>
                ),
                onClick: () => {},
              },
              {
                id: 'share',
                Label: () => (
                  <div className={styles.rowDotsOption}>
                    <ShareIcon />
                    <span>Share</span>
                  </div>
                ),
                onClick: () => {},
              },
            ]}
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
  );
}

SelectAndSettingsAndExpandCell.propTypes = {
  row: PropTypes.object.isRequired,
  server: PropTypes.object.isRequired,
};
