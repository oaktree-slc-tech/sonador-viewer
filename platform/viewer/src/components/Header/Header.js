import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { Link, useLocation, useParams } from 'react-router-dom';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import { useViewerStudyErrors } from '@ohif/core/src/store/useViewerStudyErrors';
import { AboutContent, Dropdown, withModal } from '@ohif/ui';
import { ReactComponent as IssuesIcon } from '@ohif/ui/src/elements/Svg/svgs/issues.svg';
import { ReactComponent as ListIcon } from '@ohif/ui/src/elements/Svg/svgs/list.svg';

import ViewerMetadataSettings from '../../connectedComponents/ViewerMetadataSettings/ViewerMetadataSettings';
import { useViewerSidePanels } from '../../store/useViewerSidePanels';
import OHIFLogo from '../OHIFLogo/OHIFLogo.js';
import { UserPreferences } from '../UserPreferences';

import './Header.css';
import issuesBtnStyles from './IssuesButton.module.scss';

function Header({ userManager, modal: { show }, useLargeLogo = false, linkPath, linkText, children = OHIFLogo() }) {
  const { t } = useTranslation(['Header', 'AboutModal']);
  const location = useLocation();
  const { token, studyInstanceUIDs } = useParams();

  const user = useSelector((state) => state.oidc && state.oidc.user);

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
            <Link to={location.studyLink} className="header-btn">
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
          <div className="useAndOptions">
            <span className="research-use">{t('INVESTIGATIONAL USE ONLY')}</span>
            <Dropdown title={t('Options')} list={options} align="right" />
          </div>
        </div>
      </div>
    </>
  );
}

function IssuesButton() {
  const { studyInstanceUIDs } = useParams();

  const { isIssuesContentRightSidePanel, setIsIssuesContentRightSidePanel, onChangeSidePanel } = useViewerSidePanels();
  const errors = useViewerStudyErrors((state) => {
    return state.errors[studyInstanceUIDs];
  });

  if (!errors) return null;

  return (
    <button
      className={issuesBtnStyles.issuesBtn}
      onClick={() => {
        setIsIssuesContentRightSidePanel(!isIssuesContentRightSidePanel);
        onChangeSidePanel('right', 'issues');
      }}
    >
      <span
        className={classNames({
          [issuesBtnStyles.active]: isIssuesContentRightSidePanel,
        })}
      >
        <IssuesIcon />
      </span>
      <span>Issues</span>
    </button>
  );
}

IssuesButton.displayName = 'IssuesButton';

Header.displayName = 'Header';

Header.propTypes = {
  linkText: PropTypes.string,
  linkPath: PropTypes.string,
  useLargeLogo: PropTypes.bool,
  children: PropTypes.node,
  userManager: PropTypes.object,
  modal: PropTypes.object,
};

export default withModal(Header);
