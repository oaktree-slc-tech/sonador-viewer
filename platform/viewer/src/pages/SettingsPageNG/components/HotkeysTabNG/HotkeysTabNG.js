import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';


import { hotkeysManager } from '../../../../App';
import { useUserPreferences } from '../../../../queries/preferences';
import { useDeviceStore } from '../../../../store/useDeviceStore';
import HotkeyFieldNG from '../HotkeyFieldNG/HotkeyFieldNG';
import TabFooterNG from '../TabFooterNG/TabFooterNG';
import TabHeaderNG from '../TabHeaderNG/TabHeaderNG';

import { getInitialState, splitHotkeys, validateCommandKey } from './logic';

import styles from './HotkeysTabNG.module.scss';
import { uiNotificationService } from '@ohif/core';

export default function HotkeysTabNG() {
  const { t } = useTranslation('UserPreferencesModal');
  const { hotkeyDefaults, hotkeyDefinitions } = hotkeysManager;

  const [state, setState] = useState(getInitialState(hotkeyDefinitions));

  const { isDesktop } = useDeviceStore();

  // TODO use prefences fetched from api
  const { data: userPreferences } = useUserPreferences()

  const onReset = () => {
    const defaultHotKeyDefinitions = {};

    hotkeyDefaults.map((item) => {
      const { commandName, ...values } = item;
      defaultHotKeyDefinitions[commandName] = { ...values };
    });

    setState(getInitialState(defaultHotKeyDefinitions));
  };

  const onSave = () => {
    const { hotkeys } = state;

    hotkeysManager.setHotkeys(hotkeys);

    localStorage.setItem('hotkey-definitions', JSON.stringify(hotkeys));

    uiNotificationService.show({
      message: t('SaveMessage'),
      type: 'success',
    });
  };

  /**
   *
   * @param {string} commandName
   * @param { keys: string[], label: string } hotkeyDefinition
   * @param {string[]} keys
   */
  const onHotKeyChanged = (commandName, hotkeyDefinition, keys) => {
    const { errorMessage } = validateCommandKey({
      commandName,
      pressedKeys: keys,
      hotkeys: state.hotkeys,
    });

    setState((prevState) => ({
      hotkeys: {
        ...prevState.hotkeys,
        [commandName]: { ...hotkeyDefinition, keys },
      },
      errors: {
        ...prevState.errors,
        [commandName]: errorMessage,
      },
    }));
  };

  const hasErrors = Object.keys(state.errors).some((key) => !!state.errors[key]);
  const hasHotkeys = Object.keys(state.hotkeys).length;
  const splitedHotkeys = splitHotkeys(state.hotkeys);

  return (
    <>
      {isDesktop && <TabHeaderNG title="Hotkey Settings" description="Insert description here" />}
      <div className={styles.content}>
        {hasHotkeys ? (
          <>
            {splitedHotkeys.map((hotkeys, index) => {
              return (
                <div className={styles.column} key={index}>
                  {hotkeys.map((hotkey) => {
                    const commandName = hotkey[0];
                    const hotkeyDefinition = hotkey[1];
                    const { keys, label } = hotkeyDefinition;
                    const errorMessage = state.errors[hotkey[0]];

                    return (
                      <div key={commandName} className={styles.row}>
                        <p className={styles.hotKeyLabel}>{label}</p>
                        <div
                          className={classNames(styles.hotFieldContainer, {
                            stateError: !!errorMessage,
                          })}
                        >
                          <HotkeyFieldNG
                            keys={keys}
                            onChange={(keys) => onHotKeyChanged(commandName, hotkeyDefinition, keys)}
                            isError={!!errorMessage}
                          />
                          {errorMessage && <p className={styles.errorMessage}>{errorMessage}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </>
        ) : (
          'Hotkeys definitions is empty'
        )}
      </div>
      <TabFooterNG onReset={onReset} onSave={onSave} onCancel={() => {
      }} hasErrors={hasErrors} />
    </>
  );
}
