import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import { AboutContent, Dropdown, withModal } from '@ohif/ui';
import { ReactComponent as ListIcon } from '@ohif/ui/src/elements/Svg/svgs/list.svg';

import DevicesListModal from '../DevicesListModal/DevicesListModal';
import OHIFLogo from '../OHIFLogo/OHIFLogo.js';
import { UserPreferences } from '../UserPreferences';

import './Header.css';

function Header({
  user,
  userManager,
  modal: { show },
  useLargeLogo = false,
  linkPath,
  linkText,
  children = OHIFLogo(),
}) {
  const { t } = useTranslation(['Header', 'AboutModal']);
  const location = useLocation();

  const [isOpenDevicesList, setIsOpenDevicesList] = useState(false);

  const options = [
    {
      title: t('About'),
      icon: { name: 'info' },
      onClick: () =>
        show({
          content: AboutContent,
          title: t('OHIF Viewer - About'),
        }),
    },
    // {
    //   title: t('Device List'),
    //   IconComponent: ListIcon,
    //   onClick: () => setIsOpenDevicesList(true),
    // },
    {
      title: t('Preferences'),
      icon: {
        name: 'user',
      },
      onClick: () =>
        show({
          content: UserPreferences,
          title: t('User Preferences'),
        }),
    },
  ];

  if (user && userManager) {
    options.push({
      title: t('Logout'),
      icon: { name: 'power-off' },
      onClick: () => userManager.signoutRedirect(),
    });
  }

  return (
    <>
      <div className="notification-bar">{t('INVESTIGATIONAL USE ONLY')}</div>
      <div className={classNames('entry-header', { 'header-big': useLargeLogo })}>
        <div className="header-left-box">
          {location && location.studyLink && (
            <Link to={location.studyLink} className="header-btn header-viewerLink">
              {t('Back to Viewer')}
            </Link>
          )}

          {children}
          {linkText && linkPath && (
            <Link
              className="header-btn header-studyListLinkSection"
              to={linkPath}
              state={{ stydyLink: location.pathname }}
            >
              {t(linkText)}
            </Link>
          )}
        </div>

        <div className="header-menu">
          <span className="research-use">{t('INVESTIGATIONAL USE ONLY')}</span>
          <Dropdown title={t('Options')} list={options} align="right" />
        </div>
      </div>
      {isOpenDevicesList && <DevicesListModal setIsOpen={setIsOpenDevicesList} />}
    </>
  );
}

Header.propTypes = {
  linkText: PropTypes.string,
  linkPath: PropTypes.string,
  useLargeLogo: PropTypes.bool,
  children: PropTypes.node,
  userManager: PropTypes.object,
  user: PropTypes.object,
  modal: PropTypes.object,
  servers: PropTypes.array,
};

export default withModal(Header);
