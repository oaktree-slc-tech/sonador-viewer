import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { Link, useLocation, useParams } from 'react-router-dom';
import classNames from 'classnames';
import qs from 'querystring';

import { ReactComponent as GroupIcon } from '@ohif/ui/src/elements/Svg/svgs/group.svg';
import { ReactComponent as AccountIcon } from '@ohif/ui/src/elements/Svg/svgs/person.svg';
import { ReactComponent as SettingsIcon } from '@ohif/ui/src/elements/Svg/svgs/settings.svg';
import { ReactComponent as Logo } from '@ohif/ui/src/elements/Svg/svgs/sonador-logo.svg';
import { ReactComponent as StudiesIcon } from '@ohif/ui/src/elements/Svg/svgs/studies.svg';
import { ReactComponent as UploadIcon } from '@ohif/ui/src/elements/Svg/svgs/upload-cloud.svg';

import ImageServerPickerNG from '../../sonador/ImageServerPickerNG';
import { useDeviceStore } from '../../store/useDeviceStore';
import toggleScrolling from '../../utils/toggleScrolling';

import styles from './SideBarNG.module.scss';

export default function SideBarNG() {
  const location = useLocation();
  const params = useParams();

  const activeServer = useSelector((state) => state.servers.servers.find((s) => s.active));

  const isUploadPage = location.pathname.endsWith('/upload');
  const isSettingsPage = location.pathname.endsWith('/settings');
  const isAccountPage = location.pathname.endsWith('/account');
  const isSharedWithMePage = location.pathname.endsWith('/shared-with-me');
  const isStudiesPage = !isUploadPage && !isAccountPage && !isSettingsPage && !isSharedWithMePage;
  const searchParams = qs.parse(location.search.replace('?', ''));

  const [isStudiesSubMenuOpen, setIsStudiesSubMenuOpen] = useState(isStudiesPage);

  const { isLarge, isDesktop, isTablet, isMobile } = useDeviceStore();

  const canUpload = activeServer?.perms?.upload;
  const studyListPathname =
    (location.pathname.includes('/server') && params.token) || location.pathname.includes('studylist')
      ? location.pathname
      : '/ng';

  const enableScrolling = () => {
    if (isTablet || isMobile) {
      toggleScrolling(true);
    }
  };

  const handleClickStudiesLink = () => {
    if (!isStudiesSubMenuOpen) {
      setIsStudiesSubMenuOpen(true);
    }

    enableScrolling();
  };

  const handleClickNotStudiesLink = () => {
    if (isStudiesSubMenuOpen) {
      setIsStudiesSubMenuOpen(false);
    }

    enableScrolling();
  };

  return (
    <aside className={styles.ngSidebar}>
      {!isLarge && (
        <Link to="/ng" className={styles.logoWrapper}>
          <Logo />
        </Link>
      )}
      {isDesktop && <ImageServerPickerNG server={activeServer} />}
      <nav className={styles.navigation}>
        <div>
          <Link
            to="/ng"
            onClick={handleClickStudiesLink}
            className={classNames(styles.menuItem, {
              [styles.active]: isStudiesPage,
            })}
          >
            <StudiesIcon fill={isStudiesPage ? '#ffffff' : '#60646D'} />
            <span className={styles.name}>Studies</span>
          </Link>
          {isStudiesSubMenuOpen && (
            <>
              <Link
                to={studyListPathname}
                className={classNames(styles.menuSubItem, {
                  [styles.active]: !searchParams.studyType && isStudiesPage,
                })}
                onClick={enableScrolling}
              >
                <span>All</span>
                {/*<span className={styles.count}>1,543</span>*/}
              </Link>
              <Link
                to={{ pathname: studyListPathname, search: 'studyType=worklist' }}
                className={classNames(styles.menuSubItem, {
                  [styles.active]: searchParams.studyType === 'worklist',
                })}
                onClick={enableScrolling}
              >
                <span>Worklist</span>
                {/*<span className={styles.count}>12</span>*/}
              </Link>
            </>
          )}
          <Link
            to="/ng/shared-with-me"
            className={classNames(styles.menuItem, { [styles.active]: isSharedWithMePage })}
            onClick={enableScrolling}
          >
            <GroupIcon fill={isSharedWithMePage ? '#ffffff' : '#60646D'} />
            <span className={styles.name}>Shared with me</span>
          </Link>
          {canUpload && (
            <Link
              to="/ng/upload"
              onClick={handleClickNotStudiesLink}
              className={classNames(styles.menuItem, { [styles.active]: isUploadPage })}
            >
              <UploadIcon fill={isUploadPage ? '#ffffff' : '#60646D'} />
              <span className={styles.name}>Upload</span>
            </Link>
          )}
        </div>
        <div className={styles.bottom}>
          <Link
            to=""
            className={classNames(styles.menuItem, { [styles.active]: isAccountPage })}
            onClick={(e) => {
              e.preventDefault(); // TODO remove once account page is ready
              enableScrolling();
            }}
          >
            <AccountIcon fill={isAccountPage ? '#ffffff' : '#60646D'} />
            <span className={styles.name}>Account</span>
          </Link>
          <Link
            to="/ng/settings"
            onClick={handleClickNotStudiesLink}
            className={classNames(styles.menuItem, { [styles.active]: isSettingsPage })}
          >
            <SettingsIcon fill={isSettingsPage ? '#ffffff' : '#60646D'} />
            <span className={styles.name}>Settings</span>
          </Link>
        </div>
      </nav>
    </aside>
  );
}
