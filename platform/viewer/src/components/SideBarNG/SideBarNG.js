import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { Link, NavLink, useLocation, useParams } from 'react-router-dom';
import classNames from 'classnames';

import { ReactComponent as GroupIcon } from '@ohif/ui/src/elements/Svg/svgs/group.svg';
import { ReactComponent as AccountIcon } from '@ohif/ui/src/elements/Svg/svgs/person.svg';
import { ReactComponent as SettingsIcon } from '@ohif/ui/src/elements/Svg/svgs/settings.svg';
import { ReactComponent as Logo } from '@ohif/ui/src/elements/Svg/svgs/sonador-logo.svg';
import { ReactComponent as StudiesIcon } from '@ohif/ui/src/elements/Svg/svgs/studies.svg';
import { ReactComponent as UploadIcon } from '@ohif/ui/src/elements/Svg/svgs/upload-cloud.svg';

import ImageServerPickerNG from '../../components/ImageServerPickerNG/ImageServerPickerNG';
import { useDeviceStore } from '../../store/useDeviceStore';
import toggleScrolling from '../../utils/toggleScrolling';

import OHIFLogo from '../OHIFLogo/OHIFLogo.js';
import styles from './SideBarNG.module.scss';


export default function SideBarNG({ children = OHIFLogo() }) {
  // Sonador Viewer Sidebar

  const location = useLocation();
  const params = useParams();

  const activeServer = useSelector((state) => state.servers.servers.find((s) => s.active));

  const isUploadPage = location.pathname.endsWith('/upload');
  const isSettingsPage = location.pathname.endsWith('/settings');
  const isAccountPage = location.pathname.endsWith('/account');
  const isSharedWithMePage = location.pathname.endsWith('/shared-with-me');
  const isStudiesPage = !isUploadPage && !isAccountPage && !isSettingsPage && !isSharedWithMePage;

  const [isStudiesSubMenuOpen, setIsStudiesSubMenuOpen] = useState(isStudiesPage);

  const { isLarge, isDesktop, isTablet, isMobile } = useDeviceStore();

  const canUpload = activeServer?.perms?.upload;
  const canWorkInWorklist = activeServer?.perms?.worklist;
  const studyListPathname = location.pathname.includes('/server') && params.token ? location.pathname : '/';

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
        <div className={styles.logoWrapper}>
          { children }
        </div>
      )}
      {isDesktop && <ImageServerPickerNG />}
      <nav className={styles.navigation}>
        <div>
          <NavLink
            to="/"
            end
            onClick={handleClickStudiesLink}
            className={({ isActive }) =>
              classNames(styles.menuItem, {
                [styles.active]: isActive,
              })
            }
          >
            <StudiesIcon fill={isStudiesPage ? '#ffffff' : '#60646D'} />
            <span className={styles.name}>Studies</span>
          </NavLink>
          {isStudiesSubMenuOpen && (
            <>
              <NavLink
                to={studyListPathname}
                end
                className={({ isActive }) =>
                  classNames(styles.menuSubItem, {
                    [styles.active]: isActive,
                  })
                }
                onClick={enableScrolling}
              >
                <span>All</span>
                {/*<span className={styles.count}>1,543</span>*/}
              </NavLink>
              {canWorkInWorklist && <NavLink
                to="/worklist"
                className={({ isActive }) =>
                  classNames(styles.menuSubItem, {
                    [styles.active]: isActive,
                  })
                }
                onClick={enableScrolling}
              >
                <span>Worklist</span>
                {/*<span className={styles.count}>12</span>*/}
              </NavLink>}
            </>
          )}
          <NavLink
            to="/shared-with-me"
            className={({ isActive }) => classNames(styles.menuItem, { [styles.active]: isActive })}
            onClick={enableScrolling}
          >
            <GroupIcon fill={isSharedWithMePage ? '#ffffff' : '#60646D'} />
            <span className={styles.name}>Shared with me</span>
          </NavLink>
          {canUpload && (
            <NavLink
              to="/upload"
              onClick={handleClickNotStudiesLink}
              className={({ isActive }) => classNames(styles.menuItem, { [styles.active]: isActive })}
            >
              <UploadIcon fill={isUploadPage ? '#ffffff' : '#60646D'} />
              <span className={styles.name}>Upload</span>
            </NavLink>
          )}
        </div>
        <div className={styles.bottom}>
          {/*<NavLink*/}
          {/*  to="/account"*/}
          {/*  className={({ isActive }) => classNames(styles.menuItem, { [styles.active]: isActive })}*/}
          {/*  onClick={(e) => {*/}
          {/*    e.preventDefault(); // TODO remove once account page is ready*/}
          {/*    enableScrolling();*/}
          {/*  }}*/}
          {/*>*/}
          {/*  <AccountIcon fill={isAccountPage ? '#ffffff' : '#60646D'} />*/}
          {/*  <span className={styles.name}>Account</span>*/}
          {/*</NavLink>*/}
          <NavLink
            to="/settings"
            onClick={handleClickNotStudiesLink}
            className={({ isActive }) => classNames(styles.menuItem, { [styles.active]: isActive })}
          >
            <SettingsIcon fill={isSettingsPage ? '#ffffff' : '#60646D'} />
            <span className={styles.name}>Settings</span>
          </NavLink>
        </div>
      </nav>
    </aside>
  );
}
