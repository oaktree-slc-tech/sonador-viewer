import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';

import Layout from '../../layouts/Layout/Layout';
import { useDeviceStore } from '../../store/useDeviceStore';

import GeneralTabNG from './components/GeneralTabNG/GeneralTabNG';
import HotkeysTabNG from './components/HotkeysTabNG/HotkeysTabNG';
import SecurityTabNG from './components/SecurityTabNG/SecurityTabNG';
import WindowLevelTabNG from './components/WindowLevelTabNG/WindowLevelTabNG';

import styles from './SettingsPageNG.module.scss';

const TOP_TABS = [
  { id: 'general', label: 'General' },
  { id: 'hotkeys', label: 'Hotkeys' },
  { id: 'window-level', label: 'Window Level' },
];

const BOTTOM_TABS = [
  { id: 'tokens', label: 'API Tokens' },
  { id: 'ids', label: 'Acess IDs' },
];

export default function SettingsPageNG() {
  const { t } = useTranslation();

  const [selectedTabId, setSelectedTabId] = useState(TOP_TABS[0].id);

  const { isDesktop } = useDeviceStore();
  const renderTabContent = () => {
    if (selectedTabId === 'general') {
      return <GeneralTabNG />;
    }

    if (selectedTabId === 'hotkeys') {
      return <HotkeysTabNG />;
    }

    if (selectedTabId === 'window-level') {
      return <WindowLevelTabNG />;
    }

    if (selectedTabId === 'tokens') {
      return (
        <SecurityTabNG
          title="API Access Tokens"
          description="API Access tokens can be used to grant other systems to access additional API functions. API keys should never be exposed to the public, such as front-end code or GitHub. They should be kept secret as they can be used to access this website with your account."
          type="tokens"
        />
      );
    }

    if (selectedTabId === 'ids') {
      return (
        <SecurityTabNG
          title="Access IDs/Secret Keys"
          description="Access IDs can be used to grant other systems to access additional API functions. Access IDs/Secret Keys should
        never be exposed to the public, such as front-end code or GitHub. They should be kept secret as they can be used
        to access this website with your account."
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
                {TOP_TABS.map(({ id, label }) => {
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
