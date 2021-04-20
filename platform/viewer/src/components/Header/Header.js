import React, { useState, useEffect } from 'react';
import { Link, withRouter } from 'react-router-dom';
import { withTranslation } from 'react-i18next';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import { Dropdown, AboutContent, withModal } from '@ohif/ui';
//
import { UserPreferences } from './../UserPreferences';
import OHIFLogo from '../OHIFLogo/OHIFLogo.js';
import './Header.css';
import Modal from 'react-modal';

const customStyles = {
  content: {
    top: '15%',
    left: '50%',
    right: 'auto',
    bottom: 'auto',
    marginRight: '-50%',
    transform: 'translate(-50%, -50%)',
    width: '40%',
    color: '#91B9CD',
    backgroundColor: 'black',
    font: 'inherit',
    border: '2px solid #44626F',
    borderRadius: '3px',
    cursor: 'pointer',
    padding: '0',
  },
  overlay: {
    backgroundColor: 'rgb(23 23 23 /.85)',
    zIndex: 3,
  },
};

function Header(props) {
  const {
    t,
    user,
    userManager,
    modal: { show },
    useLargeLogo,
    linkPath,
    linkText,
    location,
    children,
    servers,
    switchServer,
  } = props;
  const [options, setOptions] = useState([]);
  const hasLink = linkText && linkPath;

  useEffect(() => {
    const optionsValue = [
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
      optionsValue.push({
        title: t('Logout'),
        icon: { name: 'power-off' },
        onClick: () => userManager.signoutRedirect(),
      });
    }

    setOptions(optionsValue);
  }, [setOptions, show, t, user, userManager]);

  const [modalIsOpen, setIsOpen] = React.useState(false);

  function openModal() {
    setIsOpen(true);
  }

  function closeModal() {
    setIsOpen(false);
  }

  function switchToAnotherServer(token) {
    switchServer(token);
  }

  return (
    <>
      <div className="notification-bar">{t('INVESTIGATIONAL USE ONLY')}</div>
      <div
        className={classNames('entry-header', { 'header-big': useLargeLogo })}
      >
        <div className="header-left-box">
          {location && location.studyLink && (
            <Link
              to={location.studyLink}
              className="header-btn header-viewerLink"
            >
              {t('Back to Viewer')}
            </Link>
          )}

          {children}
          {hasLink && (
            <Link
              className="header-btn header-studyListLinkSection"
              to={{
                pathname: linkPath,
                state: { studyLink: location.pathname },
              }}
            >
              {t(linkText)}
            </Link>
          )}
        </div>
        <div
          onClick={openModal}
          className="header-btn header-server-information"
        >
          Server Information
        </div>
        <Modal
          isOpen={modalIsOpen}
          onRequestClose={closeModal}
          style={customStyles}
          contentLabel="Example Modal"
        >
          <div className="modal-title">
            <span>Server Information</span>
            <span onClick={closeModal}>&#10006;</span>
          </div>
          <div className="modal-table-wrapper">
            <div className="modal-table">
              <div className="modal-table-row">
                <div className="modal-table-head">Name</div>
                <div className="modal-table-head">Type</div>
                <div className="modal-table-head">INFO</div>
              </div>
              {servers.map((server, i) => {
                return (
                  <div className="modal-table-row" key={i}>
                    <div className="modal-table-cell" key={i}>
                      {server.name}
                    </div>
                    <div className="modal-table-cell" key={i}>
                      {server.type}
                    </div>
                    <div
                      onClick={() => {
                        switchToAnotherServer(server.token);
                      }}
                      className="modal-table-cell"
                      key={i}
                    >
                      {server.active ? String.fromCharCode(10003) : 'SWITCH'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Modal>

        <div className="header-menu">
          <span className="research-use">{t('INVESTIGATIONAL USE ONLY')}</span>
          <Dropdown title={t('Options')} list={options} align="right" />
        </div>
      </div>
    </>
  );
}

Header.propTypes = {
  // Study list, /
  linkText: PropTypes.string,
  linkPath: PropTypes.string,
  useLargeLogo: PropTypes.bool,
  //
  location: PropTypes.object.isRequired,
  children: PropTypes.node,
  t: PropTypes.func.isRequired,
  userManager: PropTypes.object,
  user: PropTypes.object,
  modal: PropTypes.object,
  servers: PropTypes.array,
};

Header.defaultProps = {
  useLargeLogo: false,
  children: OHIFLogo(),
};

export default withTranslation(['Header', 'AboutModal'])(
  withRouter(withModal(Header))
);
