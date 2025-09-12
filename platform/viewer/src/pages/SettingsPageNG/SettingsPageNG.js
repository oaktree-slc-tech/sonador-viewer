import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import classNames from 'classnames';

import OHIF from '@ohif/core';
import { AboutContent } from '@ohif/ui';

import DeviceList from '../../components/DevicesListModal/DeviceList';
import ViewerMetadataSettings from '../../connectedComponents/ViewerMetadataSettings/ViewerMetadataSettings';
import Layout from '../../layouts/Layout/Layout';
import { useDeviceStore } from '../../store/useDeviceStore';

import GeneralTabNG from './components/GeneralTabNG/GeneralTabNG';
import HotkeysTabNG from './components/HotkeysTabNG/HotkeysTabNG';
import SecurityTabNG from './components/SecurityTabNG/SecurityTabNG';
import TabHeaderNG from './components/TabHeaderNG/TabHeaderNG';
import WindowLevelTabNG from './components/WindowLevelTabNG/WindowLevelTabNG';

import styles from './SettingsPageNG.module.scss';

const { redux } = OHIF;

const TOP_TABS = [
  { id: 'general', label: 'General', 'perm': null, },
  { id: 'hotkeys', label: 'Hotkeys', 'perm': null, },
  { id: 'window-level', label: 'Window Level', 'perm': null, },
  { id: 'about', label: 'About', 'perm': null, },
  { id: 'device-list', label: 'Device List', 'perm': 'devices_list', },
  { id: 'viewer-metadata', label: 'Viewer Metadata', 'perm': null, },
];

const BOTTOM_TABS = [
  { id: 'tokens', label: 'API Tokens' },
  { id: 'ids', label: 'Acess IDs' },
];


export default function SettingsPageNG() {
  // Sonador Viewer Settings Page

  const { t } = useTranslation();
  const { activeServer } = useSelector(redux.selectors.activeOhifServer);

  const [selectedTabId, setSelectedTabId] = useState(TOP_TABS[0].id);

  const { isDesktop } = useDeviceStore();
  
  const renderTabContent = () => {
    // Render Setting tab content

    if (selectedTabId === 'general') {
      return <GeneralTabNG />;
    }

    if (selectedTabId === 'hotkeys') {
      return <HotkeysTabNG />;

    }

    if (selectedTabId === 'window-level') {
      return <WindowLevelTabNG />;
    }

    if (selectedTabId === 'about') {
      return <div>
        {isDesktop && <TabHeaderNG title="About" />}
        <AboutContent />
      </div>;
    }

    if (selectedTabId === 'device-list' && activeServer && activeServer.perms?.devices_list) {
      return <DeviceList withDefaultHeader />;
    }

    if (selectedTabId === 'viewer-metadata') {
      return <ViewerMetadataSettings asTab withHeader />;
    }

    if (selectedTabId === 'tokens') {
      return (
        <SecurityTabNG
          title={t("API Access Tokens")}
          description={t("API Access tokens can be used to grant other systems to access additional API functions. API keys should never be exposed to the public, such as front-end code or GitHub. They should be kept secret as they can be used to access this website with your account.")}
          type="tokens"
        />
      );
    }

    if (selectedTabId === 'ids') {
      return (
        <SecurityTabNG
          title={t("Access IDs/Secret Keys")}
          description={t("Access IDs can be used to grant other systems to access additional API functions. Access IDs/Secret Keys should "
            + "never be exposed to the public, such as front-end code or GitHub. They should be kept secret as they can be used"
            + "to access this website with your account.")}
          type="ids"
        />
      );
    }

    return null;
  };

  return (
    <Layout type="settings">
      <div className={styles.header}>
        <h2 className={styles.title}>{t('Settings')}</h2>
        <h3 className={styles.investigational}>{t('INVESTIGATIONAL USE ONLY')}</h3>
      </div>
      <div className={styles.content}>
        <div className={styles.left}>
          {isDesktop && <h3 className={styles.leftTitle}>{t('General')}</h3>}
          {isDesktop && (
            <>
              <div className={styles.tabs}>
                {TOP_TABS.filter(({ perm }) => perm ? (activeServer && (activeServer.perms || {})[perm]) : true).map(({ id, label, perm }) => {
                  return (
                    <button
                      key={id}
                      className={classNames(styles.tabName, { [styles.active]: selectedTabId === id })}
                      onClick={() => setSelectedTabId(id)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <h3 className={classNames(styles.leftTitle, styles.securityTitle)}>{t('Security')}</h3>
              <div className={styles.tabs}>
                {BOTTOM_TABS.map(({ id, label }) => {
                  return (
                    <button
                      key={id}
                      className={classNames(styles.tabName, { [styles.active]: selectedTabId === id })}
                      onClick={() => setSelectedTabId(id)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {!isDesktop && (
            <div className={styles.horizontalTabs}>
              {[...TOP_TABS, ...BOTTOM_TABS].map(({ id, label }) => {
                return (
                  <button
                    key={id}
                    className={classNames(styles.horizontalTabName, { [styles.active]: selectedTabId === id })}
                    onClick={() => setSelectedTabId(id)}
                  >
                    {label}
                  </button>
                );
              })}
              {createPortal(<hr className={styles.indicator} />, document.getElementById('body'))}
            </div>
          )}
        </div>
        <div className={styles.right}>{renderTabContent()}</div>
      </div>
    </Layout>
  );
}
