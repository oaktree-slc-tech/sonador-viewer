import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';

import { uiNotificationService } from '@ohif/core';

import { hotkeysManager } from '../../../../App';
import { PREFERENCE_SECTIONS,PREFERENCES_VERSION } from '../../../../constants/preferences';
import { useUpdateUserPreferenceSection } from '../../../../queries/preferences';
import { useDeviceStore } from '../../../../store/useDeviceStore';
import HotkeyFieldNG from '../HotkeyFieldNG/HotkeyFieldNG';
import TabFooterNG from '../TabFooterNG/TabFooterNG';
import TabHeaderNG from '../TabHeaderNG/TabHeaderNG';

import { getInitialState, splitHotkeys, validateCommandKey } from './logic';

import styles from './HotkeysTabNG.module.scss';

export default function HotkeysTabNG() {
  const { t } = useTranslation('UserPreferencesModal');
  const { hotkeyDefaults, hotkeyDefinitions } = hotkeysManager;

  const [state, setState] = useState(getInitialState(hotkeyDefinitions));

  const { isDesktop } = useDeviceStore();

  const { mutate: saveHotkeysSection } = useUpdateUserPreferenceSection(PREFERENCE_SECTIONS.HOTKEYS);

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

    // The preference section carries keys and label only; a binding's scope stays with its
    // default definition.
    const values = Object.fromEntries(
      Object.entries(hotkeys).map(([commandName, { keys, label }]) => [commandName, { keys, label }])
    );

    saveHotkeysSection(
      { version: PREFERENCES_VERSION, values },
      {
        onSuccess: ({ outcome }) => {
          if (outcome === 'saved') {
            uiNotificationService.show({ message: t('SaveMessage'), type: 'success' });
          } else if (outcome === 'queued') {
            uiNotificationService.show({ title: 'Hotkeys saved locally', message: 'They will sync when reconnected.', type: 'info' });
          } else {
            uiNotificationService.show({ title: 'Failed to save hotkeys', message: 'The server rejected the change; they were kept locally.', type: 'error' });
          }
        },
        onError: (error) => {
          uiNotificationService.show({ title: 'Failed to save hotkeys', message: error.message, type: 'error' });
        },
      }
    );
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
