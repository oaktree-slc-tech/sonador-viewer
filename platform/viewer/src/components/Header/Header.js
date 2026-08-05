import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useParams } from 'react-router-dom';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import { ReactComponent as IssuesIcon } from '@ohif/ui/src/elements/Svg/svgs/issues.svg';
import { ReactComponent as ListIcon } from '@ohif/ui/src/elements/Svg/svgs/list.svg';

import ViewerMetadataSettings from '../../connectedComponents/ViewerMetadataSettings/ViewerMetadataSettings';
import { useNotificationLog } from '../../hooks/useNotificationLog';
import { useViewerSidePanels } from '../../store/useViewerSidePanels';
import OHIFLogo from '../OHIFLogo/OHIFLogo.js';
import UserMenu from '../UserMenu/UserMenu';

import './Header.css';
import issuesBtnStyles from './IssuesButton.module.scss';

function Header({ useLargeLogo = false, linkPath, linkText, children = OHIFLogo() }) {
  const { t } = useTranslation(['Header', 'AboutModal']);
  const location = useLocation();
  const { token, studyInstanceUIDs } = useParams();

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

            {/* Replaces the old text "Options" dropdown: one account menu across the viewer and
                the study list, so Logout is reachable from both (ohif-viewers#31). */}
            <UserMenu align="end" className="user-menu-toggle" />
          </div>
        </div>
      </div>
    </>
  );
}


function IssuesButton() {
  const { studyInstanceUIDs } = useParams();

  const { isIssuesContentRightSidePanel, setIsIssuesContentRightSidePanel, onChangeSidePanel } = useViewerSidePanels();
  const { entries } = useNotificationLog({ studyInstanceUID: studyInstanceUIDs });

  // The button appears only once the study has something to report.
  if (!entries.length) {
    return null;
  }

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
};

// The account menu owns its own modal and user manager wiring, so the header no longer needs
// either injected. Callers may still pass `userManager`; it is ignored.
export default Header;
